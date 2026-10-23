// Data layer. Talks to Supabase when config.js is filled in, otherwise keeps
// everything in this browser so the app stays usable (and testable) offline.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const REMOTE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const CACHE_KEY = 'gym.cache.v1';
const LOCAL_KEY = 'gym.local.v1';

export const DEFAULT_WEEK = [
  { dow: 0, steps: 22000, session: 'Rest', extra: 'WF',     maintenance: 3025, eat: 3100 },
  { dow: 1, steps: 20000, session: 'FBW',  extra: '',       maintenance: 2939, eat: 3100 },
  { dow: 2, steps: 22000, session: 'Rest', extra: '30 min', maintenance: 2963, eat: 3100 },
  { dow: 3, steps: 20000, session: 'Ant',  extra: '',       maintenance: 2939, eat: 3100 },
  { dow: 4, steps: 20000, session: 'Post', extra: '',       maintenance: 2939, eat: 3100 },
  { dow: 5, steps: 20000, session: 'Ant',  extra: '',       maintenance: 2939, eat: 3100 },
  { dow: 6, steps: 20000, session: 'Post', extra: '',       maintenance: 2939, eat: 3100 }
];

export const DEFAULT_BAG = [
  ['Pack every time',    ['Deodorant', 'Headphones', 'Straps', 'Intra carbs']],
  ['Depends on the day', ['Pre-workout', 'Daisy chain']],
  ['Always in the bag',  ['Water', 'Clothes + towel', 'Lock']]
].flatMap(([grp, items], g) =>
  items.map((item, i) => ({ id: `${g}-${i}`, grp, item, position: g * 100 + i })));

export const DEFAULT_SETTINGS = {
  sleep_time: '23:30', phase_label: 'Bulk', phase_start: null
};

const emptyData = () => ({
  settings: { ...DEFAULT_SETTINGS }, weights: [], measurements: [],
  week: DEFAULT_WEEK.map(d => ({ ...d })), notes: [], bag: DEFAULT_BAG.map(b => ({ ...b }))
});

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};

/* ------------------------------- local ---------------------------------- */

const local = {
  async session() { return { email: 'local' }; },
  async signIn() { return { ok: true }; },
  async signOut() { return { ok: true }; },
  async load() {
    // merge so a partial or older snapshot still boots with sane defaults
    const stored = read(LOCAL_KEY, {});
    const base = emptyData();
    return {
      ...base, ...stored,
      settings: { ...base.settings, ...(stored.settings ?? {}) },
      week: stored.week?.length ? stored.week : base.week,
      bag:  stored.bag?.length  ? stored.bag  : base.bag
    };
  },
  async save(data) { write(LOCAL_KEY, data); }
};

/* ------------------------------ supabase -------------------------------- */

let sb = null;
async function client() {
  if (!sb) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return sb;
}

async function uid() {
  const { data } = await (await client()).auth.getUser();
  return data.user?.id;
}

const remote = {
  async session() {
    const { data } = await (await client()).auth.getSession();
    return data.session?.user ?? null;
  },
  async signIn(email, password) {
    const { error } = await (await client()).auth.signInWithPassword({ email, password });
    return error ? { ok: false, message: error.message } : { ok: true };
  },
  async signOut() { await (await client()).auth.signOut(); return { ok: true }; },

  async load() {
    const db = await client();
    const [settings, weights, measurements, week, notes, bag] = await Promise.all([
      db.from('settings').select('*').maybeSingle(),
      db.from('weights').select('day, kg').order('day'),
      db.from('measurements').select('*').order('day'),
      db.from('week_days').select('*').order('dow'),
      db.from('notes').select('*').order('created_at', { ascending: false }),
      db.from('bag_items').select('*').order('position')
    ]);

    const data = {
      settings: settings.data ?? { ...DEFAULT_SETTINGS },
      weights: (weights.data ?? []).map(w => ({ day: w.day, kg: Number(w.kg) })),
      measurements: (measurements.data ?? []).map(m => ({
        day: m.day, biceps: Number(m.biceps), quad: Number(m.quad), waist: Number(m.waist)
      })),
      week: week.data?.length ? week.data : DEFAULT_WEEK.map(d => ({ ...d })),
      notes: notes.data ?? [],
      bag: bag.data?.length ? bag.data : DEFAULT_BAG.map(b => ({ ...b }))
    };

    if (!settings.data) await db.from('settings').insert({});
    if (!week.data?.length) await db.from('week_days').insert(DEFAULT_WEEK);
    if (!bag.data?.length) {
      await db.from('bag_items').insert(DEFAULT_BAG.map(({ grp, item, position }) => ({ grp, item, position })));
    }

    write(CACHE_KEY, data);
    return data;
  },

  async saveWeight(day, kg) {
    const db = await client();
    await db.from('weights').upsert({ day, kg }, { onConflict: 'user_id,day' });
  },
  async saveMeasurement(day, m) {
    const db = await client();
    await db.from('measurements').upsert({ day, ...m }, { onConflict: 'user_id,day' });
  },
  async saveWeekDay(dow, patch) {
    const db = await client();
    await db.from('week_days').update(patch).eq('dow', dow).eq('user_id', await uid());
  },
  async saveSettings(patch) {
    const db = await client();
    await db.from('settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', await uid());
  },
  async addNote(body) {
    const db = await client();
    const { data } = await db.from('notes').insert({ body }).select().single();
    return data;
  },
  async deleteNote(id) {
    const db = await client();
    await db.from('notes').delete().eq('id', id);
  }
};

/* -------------------------------- api ----------------------------------- */

export const cached = () => read(CACHE_KEY, null);

export const auth = REMOTE
  ? { session: remote.session, signIn: remote.signIn, signOut: remote.signOut }
  : { session: local.session, signIn: local.signIn, signOut: local.signOut };

// One shape for both backends: the app mutates `data` and tells us what changed.
export function makeStore(data) {
  const persistLocal = () => local.save(data);

  return {
    data,
    async setWeight(day, kg) {
      const row = data.weights.find(w => w.day === day);
      if (row) row.kg = kg; else data.weights.push({ day, kg });
      data.weights.sort((a, b) => a.day.localeCompare(b.day));
      REMOTE ? await remote.saveWeight(day, kg) : await persistLocal();
    },
    async setMeasurement(day, m) {
      const row = data.measurements.find(x => x.day === day);
      if (row) Object.assign(row, m); else data.measurements.push({ day, ...m });
      data.measurements.sort((a, b) => a.day.localeCompare(b.day));
      REMOTE ? await remote.saveMeasurement(day, m) : await persistLocal();
    },
    async setWeekDay(dow, patch) {
      Object.assign(data.week.find(d => d.dow === dow), patch);
      REMOTE ? await remote.saveWeekDay(dow, patch) : await persistLocal();
    },
    async setSettings(patch) {
      Object.assign(data.settings, patch);
      REMOTE ? await remote.saveSettings(patch) : await persistLocal();
    },
    async addNote(body) {
      const note = REMOTE
        ? await remote.addNote(body)
        : { id: crypto.randomUUID(), body, created_at: new Date().toISOString() };
      data.notes.unshift(note);
      if (!REMOTE) await persistLocal();
      return note;
    },
    async deleteNote(id) {
      data.notes = data.notes.filter(n => n.id !== id);
      REMOTE ? await remote.deleteNote(id) : await persistLocal();
    }
  };
}

export async function loadData() {
  return REMOTE ? await remote.load() : await local.load();
}
