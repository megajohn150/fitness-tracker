// Data layer. Talks to Supabase when config.js is filled in, otherwise keeps
// everything in this browser.
//
// Offline: every change is applied in memory, written to a local snapshot and
// queued in an outbox. The queue drains in order as soon as the network is
// back, so the app stays fully usable with no connection.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const REMOTE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const CACHE_KEY  = 'gym.cache.v1';
const LOCAL_KEY  = 'gym.local.v1';
const OUTBOX_KEY = 'gym.outbox.v1';

export const DEFAULT_WEEK = [
  { dow: 0, steps: 22000, session: 'Rest', extra: 'WF',     maintenance: 3025, eat: 3100 },
  { dow: 1, steps: 20000, session: 'FBW',  extra: '',       maintenance: 2939, eat: 3100 },
  { dow: 2, steps: 22000, session: 'Rest', extra: '30 min', maintenance: 2963, eat: 3100 },
  { dow: 3, steps: 20000, session: 'Ant',  extra: '',       maintenance: 2939, eat: 3100 },
  { dow: 4, steps: 20000, session: 'Post', extra: '',       maintenance: 2939, eat: 3100 },
  { dow: 5, steps: 20000, session: 'Ant',  extra: '',       maintenance: 2939, eat: 3100 },
  { dow: 6, steps: 20000, session: 'Post', extra: '',       maintenance: 2939, eat: 3100 }
];

export const BAG_GROUPS = ['Pack every time', 'Depends on the day', 'Always in the bag'];

export const DEFAULT_BAG = [
  ['Pack every time',    ['Deodorant', 'Headphones', 'Straps', 'Intra carbs']],
  ['Depends on the day', ['Pre-workout', 'Daisy chain']],
  ['Always in the bag',  ['Water', 'Clothes + towel', 'Lock']]
].flatMap(([grp, items], g) =>
  items.map((item, i) => ({ id: `${g}-${i}`, grp, item, position: g * 100 + i })));

export const DEFAULT_SETTINGS = { sleep_time: '23:30', phase_label: 'Bulk', phase_start: null };

const emptyData = () => ({
  settings: { ...DEFAULT_SETTINGS }, weights: [], measurements: [], phases: [],
  week: DEFAULT_WEEK.map(d => ({ ...d })), notes: [], bag: DEFAULT_BAG.map(b => ({ ...b }))
});

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};

export const cached = () => read(CACHE_KEY, null);

/* -------------------------------- outbox -------------------------------- */

let outbox = read(OUTBOX_KEY, []);
const saveOutbox = () => write(OUTBOX_KEY, outbox);

const SYNC_KEY = 'gym.sync.v1';
let sync = read(SYNC_KEY, { lastSync: null, error: null });
const saveSync = () => write(SYNC_KEY, sync);

export const pending = () => outbox.length;
export const online  = () => navigator.onLine !== false;

/** What the queue is doing, including the change that is blocking it. */
export const syncInfo = () => ({
  pending: outbox.length, online: online(),
  lastSync: sync.lastSync, error: sync.error,
  blocked: sync.error ? describe(outbox[0]) : null
});

const describe = op => op && ({
  setWeight: `weight for ${op.args.day}`,
  deleteWeight: `removing the weight for ${op.args.day}`,
  setMeasurement: `measurement for ${op.args.day}`,
  deleteMeasurement: `removing the measurement for ${op.args.day}`,
  setWeekDay: 'a change to the week plan',
  setSettings: 'a settings change',
  addNote: 'a note',
  deleteNote: 'removing a note',
  saveBagItem: 'a gym bag item',
  deleteBagItem: 'removing a gym bag item',
  addPhase: 'a new phase',
  deletePhase: 'removing a phase'
}[op.type] ?? 'a change');

/** Drops the change the server keeps refusing, so the rest of the queue can move. */
export function discardBlocked() {
  if (!outbox.length) return;
  outbox.shift();
  saveOutbox();
  sync.error = null;
  saveSync();
  announce();
  return flush();
}

export function retrySync() {
  sync.error = null;
  saveSync();
  announce();
  return flush();
}

let listeners = [];
export const onSyncChange = fn => listeners.push(fn);
const announce = () => listeners.forEach(fn => fn({ pending: outbox.length, online: online() }));

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

// Every call throws on failure so the outbox knows to hold on to the change.
const check = ({ error }) => { if (error) throw new Error(error.message); };

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
    const [settings, weights, measurements, week, notes, bag, phases] = await Promise.all([
      db.from('settings').select('*').maybeSingle(),
      db.from('weights').select('day, kg').order('day'),
      db.from('measurements').select('*').order('day'),
      db.from('week_days').select('*').order('dow'),
      db.from('notes').select('*').order('created_at', { ascending: false }),
      db.from('bag_items').select('*').order('position'),
      db.from('phases').select('*').order('started_on')
    ]);
    [weights, measurements, week, notes, bag].forEach(check);

    const data = {
      settings: settings.data ?? { ...DEFAULT_SETTINGS },
      weights: (weights.data ?? []).map(w => ({ day: w.day, kg: Number(w.kg) })),
      measurements: (measurements.data ?? []).map(m => ({
        day: m.day, biceps: Number(m.biceps), quad: Number(m.quad), waist: Number(m.waist)
      })),
      week: week.data?.length ? week.data : DEFAULT_WEEK.map(d => ({ ...d })),
      notes: notes.data ?? [],
      bag: bag.data?.length ? bag.data : DEFAULT_BAG.map(b => ({ ...b })),
      phases: phases.data ?? []
    };

    // Without a phase there is nothing to number the weeks against.
    if (!data.phases.length) {
      const started = settings.data?.phase_start ?? data.weights[0]?.day;
      if (started) {
        const seeded = await db.from('phases')
          .insert({ label: settings.data?.phase_label ?? 'Bulk', started_on: started }).select();
        if (seeded.data?.length) data.phases = seeded.data;
      }
    }

    if (!settings.data)     await db.from('settings').insert({});
    if (!week.data?.length) await db.from('week_days').insert(DEFAULT_WEEK);
    if (!bag.data?.length) {
      const seeded = await db.from('bag_items')
        .insert(DEFAULT_BAG.map(({ grp, item, position }) => ({ grp, item, position })))
        .select();
      if (seeded.data?.length) data.bag = seeded.data;
    }

    write(CACHE_KEY, data);
    return data;
  },

  async setWeight({ day, kg })       { const db = await client(); check(await db.from('weights').upsert({ day, kg }, { onConflict: 'user_id,day' })); },
  async deleteWeight({ day })        { const db = await client(); check(await db.from('weights').delete().eq('day', day)); },
  async setMeasurement({ day, values }) { const db = await client(); check(await db.from('measurements').upsert({ day, ...values }, { onConflict: 'user_id,day' })); },
  async deleteMeasurement({ day })   { const db = await client(); check(await db.from('measurements').delete().eq('day', day)); },
  async setWeekDay({ dow, patch })   { const db = await client(); check(await db.from('week_days').update(patch).eq('dow', dow).eq('user_id', await uid())); },
  async setSettings({ patch })       { const db = await client(); check(await db.from('settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', await uid())); },
  async addNote({ note })            { const db = await client(); check(await db.from('notes').upsert(note, { onConflict: 'id' })); },
  async deleteNote({ id })           { const db = await client(); check(await db.from('notes').delete().eq('id', id)); },
  async addPhase({ row })            { const db = await client(); check(await db.from('phases').upsert(row, { onConflict: 'id' })); },
  async deletePhase({ id })          { const db = await client(); check(await db.from('phases').delete().eq('id', id)); },
  async saveBagItem({ row })         { const db = await client(); check(await db.from('bag_items').upsert(row, { onConflict: 'id' })); },
  async deleteBagItem({ id })        { const db = await client(); check(await db.from('bag_items').delete().eq('id', id)); }
};

export const auth = REMOTE
  ? { session: remote.session, signIn: remote.signIn, signOut: remote.signOut }
  : { session: async () => ({ email: 'local' }), signIn: async () => ({ ok: true }), signOut: async () => ({ ok: true }) };

/* ------------------------------ syncing --------------------------------- */

let flushing = false;

/** Sends queued changes in order. Stops at the first failure and keeps the rest. */
export async function flush() {
  if (!REMOTE || flushing || !outbox.length || !online()) return false;
  flushing = true;
  let sent = 0;
  try {
    while (outbox.length) {
      const op = outbox[0];
      try {
        await remote[op.type](op.args);
      } catch (err) {
        // A rejection while online is the queue being stuck, not a dropped connection.
        if (online()) { sync.error = err.message || 'The server refused this change.'; saveSync(); }
        break;
      }
      outbox.shift();
      saveOutbox();
      sent++;
    }
    if (!outbox.length) { sync.error = null; sync.lastSync = new Date().toISOString(); saveSync(); }
  } finally {
    flushing = false;
    announce();
  }
  return sent > 0;
}

addEventListener('online',  () => { flush(); announce(); });
addEventListener('offline', announce);

/* --------------------------------- store -------------------------------- */

export function makeStore(data) {
  const persist = () => write(REMOTE ? CACHE_KEY : LOCAL_KEY, data);

  // Apply locally first so the UI never waits for the network.
  const queue = async (type, args) => {
    persist();
    if (!REMOTE) return;
    outbox.push({ type, args });
    saveOutbox();
    announce();
    await flush();
  };

  return {
    data,
    async setWeight(day, kg) {
      const row = data.weights.find(w => w.day === day);
      if (row) row.kg = kg; else data.weights.push({ day, kg });
      data.weights.sort((a, b) => a.day.localeCompare(b.day));
      await queue('setWeight', { day, kg });
    },
    async deleteWeight(day) {
      data.weights = data.weights.filter(w => w.day !== day);
      await queue('deleteWeight', { day });
    },
    async setMeasurement(day, values) {
      const row = data.measurements.find(m => m.day === day);
      if (row) Object.assign(row, values); else data.measurements.push({ day, ...values });
      data.measurements.sort((a, b) => a.day.localeCompare(b.day));
      await queue('setMeasurement', { day, values });
    },
    async deleteMeasurement(day) {
      data.measurements = data.measurements.filter(m => m.day !== day);
      await queue('deleteMeasurement', { day });
    },
    async setWeekDay(dow, patch) {
      Object.assign(data.week.find(d => d.dow === dow), patch);
      await queue('setWeekDay', { dow, patch });
    },
    async setSettings(patch) {
      Object.assign(data.settings, patch);
      await queue('setSettings', { patch });
    },
    async addNote(body) {
      const note = { id: crypto.randomUUID(), body, created_at: new Date().toISOString() };
      data.notes.unshift(note);
      await queue('addNote', { note });
      return note;
    },
    async addPhase(label, started_on) {
      const row = { id: crypto.randomUUID(), label, started_on };
      data.phases = [...data.phases.filter(p => p.started_on !== started_on), row]
        .sort((a, b) => a.started_on.localeCompare(b.started_on));
      await queue('addPhase', { row });
      return row;
    },
    async deletePhase(id) {
      data.phases = data.phases.filter(p => p.id !== id);
      await queue('deletePhase', { id });
    },
    async addBagItem(grp, item) {
      const inGroup = data.bag.filter(b => b.grp === grp);
      const row = {
        id: crypto.randomUUID(), grp, item,
        position: (inGroup.length ? Math.max(...inGroup.map(b => b.position)) : BAG_GROUPS.indexOf(grp) * 100) + 1
      };
      data.bag.push(row);
      await queue('saveBagItem', { row });
      return row;
    },
    async renameBagItem(id, item) {
      const row = data.bag.find(b => b.id === id);
      if (!row || row.item === item) return;
      row.item = item;
      await queue('saveBagItem', { row: { id: row.id, grp: row.grp, item: row.item, position: row.position } });
    },
    async setBagPosition(id, position) {
      const row = data.bag.find(b => String(b.id) === String(id));
      if (!row || row.position === position) return;
      row.position = position;
      await queue('saveBagItem', { row: { id: row.id, grp: row.grp, item: row.item, position } });
    },
    async deleteBagItem(id) {
      data.bag = data.bag.filter(b => b.id !== id);
      await queue('deleteBagItem', { id });
    },
    async deleteNote(id) {
      data.notes = data.notes.filter(n => n.id !== id);
      await queue('deleteNote', { id });
    }
  };
}

/* --------------------------------- load --------------------------------- */

export async function loadData() {
  if (!REMOTE) {
    const stored = read(LOCAL_KEY, {});
    const base = emptyData();
    return {
      ...base, ...stored,
      settings: { ...base.settings, ...(stored.settings ?? {}) },
      week: stored.week?.length ? stored.week : base.week,
      bag:  stored.bag?.length  ? stored.bag  : base.bag
    };
  }

  await flush();
  // Unsent changes would be clobbered by a fresh read, so keep the snapshot.
  if (outbox.length) return cached() ?? emptyData();

  try {
    return await remote.load();
  } catch {
    const snapshot = cached();
    if (snapshot) return snapshot;
    throw new Error('No connection and nothing cached yet.');
  }
}
