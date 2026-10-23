import { auth, loadData, makeStore, cached, flush, pending, online, onSyncChange, REMOTE } from './db.js';
import * as C from './calc.js';

const $  = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const sp     = n => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
const num    = t => { const v = parseFloat(String(t).replace(/[^\d.-]/g, '')); return Number.isNaN(v) ? 0 : v; };
const sign   = n => (n < 0 ? '−' : '+') + sp(Math.abs(n));
const signKg = n => (n < 0 ? '−' : '+') + Math.abs(n).toFixed(2);

let store = null;

/* ------------------------------- chrome --------------------------------- */

const VIEWS = {
  today:    { title: 'Today' },
  weight:   { title: 'Weight' },
  body:     { title: 'Body' },
  activity: { title: 'Activity' },
  more:     { title: 'More' },
  caffeine: { title: 'Caffeine', sub: true },
  bag:      { title: 'Gym bag',  sub: true },
  notes:    { title: 'Notes',    sub: true },
  calc:     { title: 'Calculator', sub: true }
};

let lastTab = 'today';

function go(name) {
  const view = VIEWS[name];
  if (!view.sub) lastTab = name;
  $$('.view').forEach(el => el.classList.toggle('on', el.id === 'v-' + name));
  const activeTab = view.sub ? lastTab : name;
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === activeTab));
  $('title').textContent = view.title;
  $('sub').textContent = subtitleFor(name);

  document.querySelector('.back')?.remove();
  if (view.sub) {
    const back = document.createElement('button');
    back.className = 'back';
    back.textContent = '‹ ' + VIEWS[lastTab].title;
    back.onclick = () => go(lastTab);
    $('sub').before(back);
  }
  requestAnimationFrame(() => scrollTo({ top: 0 }));
}

function subtitleFor(name) {
  const d = store?.data;
  const now = new Date();
  const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  switch (name) {
    case 'today':    return `${date}${d ? ' · ' + phaseText() : ''}`;
    case 'weight':   return d ? `${phaseText()} · ${d.weights.length} entries` : '';
    case 'body':     return d ? `${d.measurements.length} measurements` : '';
    case 'activity': return 'Weekly plan';
    case 'caffeine': return `Sleep at ${sleepTime()}`;
    case 'bag':      return d ? `${d.bag.length} items` : '';
    case 'notes':    return d ? `${d.notes.length} in the journal` : '';
    case 'calc':     return 'Steps · minutes · kcal';
    default:         return 'Tools & settings';
  }
}

const sleepTime = () => store?.data.settings.sleep_time?.slice(0, 5) || '23:30';

function phaseText() {
  const { settings } = store.data;
  const weeks = C.weeklyWeights(store.data.weights, settings.phase_start);
  return weeks.length ? `${settings.phase_label} week ${weeks.length}` : settings.phase_label;
}

function theme(next) {
  const html = document.documentElement;
  html.dataset.theme = next;
  try { localStorage.setItem('gym.theme', next); } catch {}
  $('themeBtn').textContent = next === 'dark' ? '☀' : '☾';
  const name = $('thName');
  if (name) name.textContent = next === 'dark' ? 'Dark' : 'Light';
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('on'), 1800);
}

/* -------------------------------- sheet --------------------------------- */

function openSheet({ title, sub = '', fields }) {
  const dialog = $('sheet');
  $('sheetTitle').textContent = title;
  $('sheetSub').textContent = sub;
  $('sheetFields').innerHTML = fields.map(f => `
    <div>
      <p class="lab">${f.label}</p>
      ${f.type === 'textarea'
        ? `<textarea class="field" name="${f.key}" rows="3" style="font-size:17px;line-height:1.45;resize:none">${f.value ?? ''}</textarea>`
        : `<input class="field" name="${f.key}" type="${f.type ?? 'text'}" inputmode="${f.type === 'number' ? 'decimal' : 'text'}"
             value="${f.value ?? ''}" placeholder="${f.placeholder ?? ''}" ${f.step ? `step="${f.step}"` : ''}>`}
    </div>`).join('');
  $('sheetFields').style.flexDirection = fields.length > 2 || fields[0].type === 'textarea' ? 'column' : 'row';

  dialog.showModal();
  setTimeout(() => $('sheetFields').querySelector('input,textarea')?.focus(), 50);

  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      if (dialog.returnValue !== 'save') return resolve(null);
      const out = {};
      $$('#sheetFields [name]').forEach(el => { out[el.name] = el.value.trim(); });
      resolve(out);
    }, { once: true });
  });
}

/* -------------------------------- charts -------------------------------- */

function spark(id, data, avg) {
  const el = $(id);
  const w = 300, h = id === 'sp2' ? 84 : 64, pad = 6;
  el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  if (data.length < 2) { el.innerHTML = ''; return; }
  const min = Math.min(...data) - 0.2, max = Math.max(...data) + 0.2;
  const X = i => i * (w / (data.length - 1));
  const Y = v => pad + (1 - (v - min) / (max - min || 1)) * (h - 2 * pad);
  const points = data.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  el.innerHTML =
    `<polygon class="ar" points="${points} ${w},${h} 0,${h}"/>` +
    (avg != null ? `<line class="gl" x1="0" y1="${Y(avg).toFixed(1)}" x2="${w}" y2="${Y(avg).toFixed(1)}"/>` : '') +
    `<polyline class="ln" points="${points}"/>` +
    `<circle class="dot" cx="${w}" cy="${Y(data.at(-1))}" r="2.6"/>`;
}

function weekSpark(id, days) {
  const el = $(id);
  const w = 300, h = 64, pad = 7, inset = 5;
  el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const logged = days.filter(v => v != null);
  const X = i => inset + i * ((w - 2 * inset) / (days.length - 1));

  if (!logged.length) {
    el.innerHTML = days.map((_, i) => `<line class="tick" x1="${X(i)}" y1="${h - 2}" x2="${X(i)}" y2="${h}" opacity=".5"/>`).join('');
    renderDayLabels(days, -1);
    return;
  }
  const avg = C.average(logged);
  const min = Math.min(...logged) - 0.15, max = Math.max(...logged) + 0.15;
  const Y = v => pad + (1 - (v - min) / (max - min || 1)) * (h - 2 * pad);
  const pts = days.map((v, i) => (v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean);
  const lastIndex = days.reduce((acc, v, i) => (v != null ? i : acc), 0);

  el.innerHTML =
    days.map((v, i) => `<line class="tick" x1="${X(i)}" y1="${h - 2}" x2="${X(i)}" y2="${h}" opacity="${v == null ? 0.5 : 1}"/>`).join('') +
    `<polygon class="ar" points="${pts.join(' ')} ${X(lastIndex)},${h} ${X(0)},${h}"/>` +
    `<line class="gl" x1="0" y1="${Y(avg).toFixed(1)}" x2="${w}" y2="${Y(avg).toFixed(1)}"/>` +
    `<polyline class="ln" points="${pts.join(' ')}"/>` +
    `<circle class="dot" cx="${X(lastIndex)}" cy="${Y(days[lastIndex])}" r="2.6"/>`;
  renderDayLabels(days, lastIndex);
}

function renderDayLabels(days, lastIndex) {
  $('days').innerHTML = C.DAY_NAMES.slice(0, 5)
    .map((d, i) => `<span class="${days[i] == null ? '' : i === lastIndex ? 'now' : 'has'}">${d}</span>`).join('');
}

/* ------------------------------- renders -------------------------------- */

function renderAll() {
  renderWeight();
  renderBody();
  renderActivity();
  renderBag();
  renderNotes();
  renderCaffeine();
  renderSettings();
  $('sub').textContent = subtitleFor(lastTab);
}

function renderWeight() {
  const { weights, settings } = store.data;
  const weeks = C.weeklyWeights(weights, settings.phase_start);
  const todayISO = C.today();
  const todayEntry = weights.find(w => w.day === todayISO);
  const current = weeks.at(-1) ?? { days: [null, null, null, null, null], avg: null };
  const shown = C.displayWeek(weeks) ?? current;
  const previous = weeks.at(-2);
  const delta = shown.avg != null && previous?.avg != null ? shown.avg - previous.avg : null;

  // Today card
  $('wLogged').classList.toggle('hide', !todayEntry);
  $('wEmpty').classList.toggle('hide', Boolean(todayEntry));
  $('logWeightBtn').classList.toggle('hide', Boolean(todayEntry));
  $('logWeightBtn2').textContent = todayEntry ? 'Update today’s weight' : 'Log today’s weight';
  if (todayEntry) {
    $('wToday').textContent = todayEntry.kg.toFixed(2);
    $('wAvg').textContent = shown.avg?.toFixed(2) ?? '—';
    $('wDays').textContent = `${shown.days.filter(d => d != null).length} of 5 days`;
  } else {
    const last = weights.at(-1);
    $('wLast').textContent = last
      ? `Not logged today · last ${last.kg.toFixed(2)} on ${C.DAY_NAMES[C.dowOf(C.parseISO(last.day))]}`
      : 'Nothing logged yet';
  }
  $('wPill').classList.toggle('hide', delta == null);
  if (delta != null) $('wPill').textContent = `${signKg(delta)} kg vs ${previous.label}`;

  weekSpark('sp1', current.days);

  // Weight view
  $('wkLabel').textContent = `${settings.phase_label} week ${weeks.length || 1} average`;
  $('wkAvg').textContent = shown.avg?.toFixed(2) ?? '—';
  $('wkDelta').classList.toggle('hide', delta == null);
  if (delta != null) $('wkDelta').textContent = `${signKg(delta)} / wk`;

  const flat = weights.map(w => w.kg);
  $('wRange').textContent = flat.length
    ? `Range ${Math.min(...flat).toFixed(2)} – ${Math.max(...flat).toFixed(2)} kg` : 'No entries yet';
  spark('sp2', flat, shown.avg);

  $('bulkRows').innerHTML = weeks.map((week, i) => {
    const isCurrent = i === weeks.length - 1;
    return `<tr class="${isCurrent ? 'cur' : ''}"><td>${week.label}</td>` +
      week.days.map((v, k) => {
        const day = C.isoOf(C.addDays(C.parseISO(week.monday), k));
        if (day > todayISO) return '<td class="mut">—</td>';        // nothing to log yet
        return `<td contenteditable data-day="${day}">${v == null ? '—' : v.toFixed(2)}</td>`;
      }).join('') +
      `<td><b>${week.avg?.toFixed(2) ?? '—'}</b></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="mut">No entries yet</td></tr>';

  $('phaseLabel').textContent = settings.phase_label;
  $('phaseStart').textContent = weeks.length ? `start ${C.shortDate(weeks[0].monday)}` : '';

  // coaching rule from the notes
  const hint = $('wHint');
  if (delta == null) hint.classList.add('hide');
  else if (delta > 0.25) {
    hint.classList.remove('hide');
    $('wHintLab').textContent = 'Above target';
    $('wHintText').textContent = `Gaining ${delta.toFixed(2)} kg/week — more than 0.25. Cut 300–600 kcal from the week.`;
  } else if (delta < 0.1) {
    hint.classList.remove('hide');
    $('wHintLab').textContent = 'Below target';
    $('wHintText').textContent = `${delta < 0 ? 'Down' : 'Up'} ${Math.abs(delta).toFixed(2)} kg — under 0.1. Add 500 calories to the week.`;
  } else hint.classList.add('hide');
}

function renderBody() {
  const { measurements, settings, weights } = store.data;
  const firstMonday = C.mondayOf(settings.phase_start || weights[0]?.day || C.today());
  const weekOf = iso => Math.round((C.mondayOf(iso) - firstMonday) / 6048e5) + 1;

  $('bodyRows').innerHTML = measurements.map((m, i) => {
    const isLast = i === measurements.length - 1;
    return `<tr class="${isLast ? 'cur' : ''}"><td>${C.shortDate(m.day)}</td><td>W${weekOf(m.day)}</td>` +
      ['biceps', 'quad', 'waist'].map(k => `<td>${m[k] != null ? Number(m[k]).toFixed(1) : '—'}</td>`).join('') + '</tr>';
  }).join('') || '<tr><td colspan="5" class="mut">No measurements yet</td></tr>';

  const last = measurements.at(-1), prev = measurements.at(-2);
  $('bodyNow').innerHTML = [['Biceps', 'biceps', false], ['Quad', 'quad', false], ['Waist', 'waist', true]]
    .map(([label, key, warn]) => {
      const value = last?.[key];
      const delta = value != null && prev?.[key] != null ? value - prev[key] : null;
      const cls = delta && warn ? (delta > 0 ? 'up' : 'dn') : '';
      const text = delta == null ? '—' : delta === 0 ? 'no change' : (delta < 0 ? '−' : '+') + Math.abs(delta).toFixed(1);
      return `<div class="card"><p class="lab">${label}</p>
        <div class="num n3" style="margin-top:6px">${value != null ? Number(value).toFixed(1) : '—'}</div>
        <p class="mut ${cls}" style="margin-top:3px">${text}</p></div>`;
    }).join('');

  const nextMonday = C.addDays(C.mondayOf(new Date()), 7);
  $('bodyNext').textContent = `Measured every Monday after waking up. Next: ${C.shortDate(C.isoOf(nextMonday))}.`;

  const loggedToday = measurements.some(m => m.day === C.today());
  $('mondayCta').classList.toggle('hide', !(C.dowOf(new Date()) === 0 && !loggedToday));
}

function renderActivity() {
  const week = store.data.week;
  const todayIndex = C.dowOf(new Date());
  const cell = (dow, key, value) => `<td contenteditable data-dow="${dow}" data-key="${key}">${value}</td>`;

  $('planRows').innerHTML = week.map(d => `<tr class="${d.dow === todayIndex ? 'cur' : ''}"><td>${C.DAY_NAMES[d.dow]}</td>` +
    cell(d.dow, 'steps', sp(d.steps)) + cell(d.dow, 'session', d.session || '—') + cell(d.dow, 'extra', d.extra || '—') + '</tr>').join('');

  $('energyRows').innerHTML = week.map(d => `<tr class="${d.dow === todayIndex ? 'cur' : ''}"><td>${C.DAY_NAMES[d.dow]}</td>` +
    cell(d.dow, 'maintenance', sp(d.maintenance)) + cell(d.dow, 'eat', sp(d.eat)) +
    `<td class="diff">${sign(d.eat - d.maintenance)}</td></tr>`).join('');

  updateTotals();
}

function updateTotals() {
  const week = store.data.week;
  const steps = week.reduce((a, d) => a + d.steps, 0);
  const eat   = week.reduce((a, d) => a + d.eat, 0);
  const maint = week.reduce((a, d) => a + d.maintenance, 0);

  $('aSteps').textContent = (steps / 1000).toFixed(steps % 1000 ? 1 : 0) + 'k';
  $('aEat').textContent = sp(eat / 7);
  $('aSurplus').textContent = sign(eat - maint);
  $('energyTot').innerHTML = `<tr class="tot"><td>Total</td><td>${sp(maint)}</td><td>${sp(eat)}</td><td>${sign(eat - maint)}</td></tr>`;
  $$('#energyRows tr').forEach(tr => {
    const dow = Number(tr.querySelector('[data-dow]').dataset.dow);
    const d = week.find(x => x.dow === dow);
    tr.querySelector('.diff').textContent = sign(d.eat - d.maintenance);
  });

  const today = week.find(d => d.dow === C.dowOf(new Date()));
  $('tSteps').textContent = sp(today.steps);
  $('tEat').textContent = sp(today.eat);
  $('tSurplus').textContent = `${sign(today.eat - today.maintenance)} surplus`;
  $('tDayLabel').textContent = `${C.LONG_DAYS[today.dow]} target`;
}

function renderBag() {
  const groups = [];
  store.data.bag.slice().sort((a, b) => a.position - b.position).forEach(item => {
    const group = groups.find(g => g.name === item.grp) ?? (groups.push({ name: item.grp, items: [] }), groups.at(-1));
    group.items.push(item.item);
  });
  const html = groups.map(g => `<div class="bg"><h3>${g.name}</h3><ul>${g.items.map(i => `<li>${i}</li>`).join('')}</ul></div>`).join('');
  $('bagToday').innerHTML = html;
  $('bagFull').innerHTML = html;
  $('bagCount').textContent = `${store.data.bag.length} items`;
}

function renderNotes() {
  const notes = store.data.notes;
  $('noteList').innerHTML = notes.map(n => `
    <div class="card">
      <p class="note">${escapeHtml(n.body)}</p>
      <div class="note-head">
        <span class="mut">${C.shortDate(n.created_at.slice(0, 10))}</span>
        <button data-note="${n.id}">Delete</button>
      </div>
    </div>`).join('') || '<p class="mut">Nothing written down yet.</p>';
}

const escapeHtml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function renderCaffeine(sourceValue) {
  const sleep = sleepTime();
  const now = new Date();
  const value = sourceValue ?? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  $$('.caf').forEach(card => {
    const input = card.querySelector('input');
    input.value = value;
    const left = C.hoursUntilSleep(value, sleep);
    const { mg } = C.caffeineLimit(left);
    card.querySelector('.mg').textContent = mg;
    card.querySelector('.sub').textContent =
      `${Math.floor(left)} h ${Math.round((left % 1) * 60)} m until sleep` +
      (mg ? ` · last ${mg} mg at ${C.caffeineCutoff(sleep, mg)}` : ' · too late for caffeine');
  });

  const activeTier = C.caffeineLimit(C.hoursUntilSleep(value, sleep)).hours;
  $('cafTable').innerHTML = C.CAFFEINE.map(([h, mg]) => `
    <tr class="${h === activeTier ? 'hit' : ''}">
      <td>${h === 2 ? '4–2 h' : h === 0 ? '&lt; 2 h' : h + ' h'}</td><td>${mg} mg</td>
    </tr>`).join('');
  $('sleepHint').textContent = `sleep ${sleep}`;
}

function renderSettings() {
  $('setPhase').textContent = phaseText();
  $('setSleep').value = sleepTime();
  $('setStorage').textContent = REMOTE ? 'Supabase' : 'This device';
  $('signOutBtn').classList.toggle('hide', !REMOTE);
  renderSync();
}

/** Only speaks up when something is actually waiting or the network is gone. */
function renderSync() {
  const waiting = pending();
  const pill = $('syncPill');
  const text = !online() ? (waiting ? `Offline · ${waiting} to sync` : 'Offline')
             : waiting  ? `${waiting} to sync` : '';
  pill.textContent = text;
  pill.classList.toggle('hide', !text);
  const storage = $('setStorage');
  if (storage && REMOTE) storage.textContent = text ? `Supabase · ${text.toLowerCase()}` : 'Supabase · synced';
}

/* ------------------------------ calculator ------------------------------ */

function setupCalculator() {
  const from = $('cFrom'), to = $('cTo');
  Object.entries(C.UNITS).forEach(([key, unit]) => {
    from.add(new Option(unit.label, key));
    to.add(new Option(unit.label, key));
  });
  from.value = 'steps';
  to.value = 'incline';

  const run = () => {
    const amount = parseFloat($('cAmt').value.replace(/[^\d.,-]/g, '').replace(',', '.'));
    $('cUnit').textContent = ' ' + C.UNITS[to.value].label;
    if (Number.isNaN(amount)) { $('cRes').textContent = '—'; $('cForm').textContent = ''; return; }
    const factor = C.UNITS[from.value].factor / C.UNITS[to.value].factor;
    const result = amount * factor;
    const digits = Math.abs(result) >= 100 ? 0 : Math.abs(result) >= 10 ? 1 : 2;
    $('cRes').textContent = result.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    $('cForm').textContent = from.value === to.value ? 'same unit'
      : factor >= 1 ? `${sp(amount)} × ${+factor.toFixed(4)}`
      : `${sp(amount)} ÷ ${+(1 / factor).toFixed(4)}`;
  };

  from.onchange = to.onchange = run;
  $('cAmt').oninput = run;
  $('swapBtn').onclick = () => { [from.value, to.value] = [to.value, from.value]; run(); };
  run();
}

/* -------------------------------- actions ------------------------------- */

async function logWeight() {
  const todayISO = C.today();
  const existing = store.data.weights.find(w => w.day === todayISO);
  const result = await openSheet({
    title: 'Log weight',
    sub: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
    fields: [{ key: 'kg', label: 'Weight (kg)', type: 'number', step: '0.05', value: existing?.kg ?? '' }]
  });
  if (!result?.kg) return;
  await store.setWeight(todayISO, Number(result.kg));
  renderWeight();
  toast('Weight saved');
}

async function addMeasurement() {
  const last = store.data.measurements.at(-1);
  const result = await openSheet({
    title: 'Add measurement',
    sub: 'Monday, after waking up',
    fields: [
      { key: 'biceps', label: 'Biceps', type: 'number', step: '0.1', value: last?.biceps ?? '' },
      { key: 'quad',   label: 'Quad',   type: 'number', step: '0.1', value: last?.quad ?? '' },
      { key: 'waist',  label: 'Waist',  type: 'number', step: '0.1', value: last?.waist ?? '' }
    ]
  });
  if (!result) return;
  await store.setMeasurement(C.today(), {
    biceps: Number(result.biceps) || null,
    quad:   Number(result.quad)   || null,
    waist:  Number(result.waist)  || null
  });
  renderBody();
  toast('Measurement saved');
}

async function addNote() {
  const result = await openSheet({
    title: 'New note', fields: [{ key: 'body', label: 'Note', type: 'textarea', value: '' }]
  });
  if (!result?.body) return;
  await store.addNote(result.body);
  renderNotes();
  toast('Note saved');
}

/* --------------------------------- wiring ------------------------------- */

function wire() {
  document.addEventListener('click', async e => {
    const target = e.target.closest('[data-go]');
    if (target) return go(target.dataset.go);

    const noteId = e.target.dataset.note;
    if (noteId) {
      await store.deleteNote(noteId);
      renderNotes();
      toast('Note deleted');
    }
  });

  $('themeBtn').onclick = () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('logWeightBtn').onclick = logWeight;
  $('logWeightBtn2').onclick = logWeight;
  $('addMeasureBtn').onclick = addMeasurement;
  $('addNoteBtn').onclick = addNote;
  $('mondayCta').onclick = addMeasurement;
  $('signOutBtn').onclick = async () => { await auth.signOut(); location.reload(); };

  $('setSleep').onchange = async e => {
    await store.setSettings({ sleep_time: e.target.value });
    renderCaffeine();
    toast('Sleep time saved');
  };

  $$('.caf input').forEach(input => { input.oninput = () => renderCaffeine(input.value); });

  // editable activity cells
  document.addEventListener('input', e => {
    const key = e.target.dataset?.key;
    if (!key) return;
    const dow = Number(e.target.dataset.dow);
    const day = store.data.week.find(d => d.dow === dow);
    day[key] = (key === 'session' || key === 'extra') ? e.target.textContent.trim() : num(e.target.textContent);
    updateTotals();
  });

  // a weight cell in the Bulk table
  document.addEventListener('focusout', async e => {
    const day = e.target.dataset?.day;
    if (!day) return;
    const text = e.target.textContent.trim().replace(',', '.');
    const value = parseFloat(text);
    if (!text || text === '—') await store.deleteWeight(day);
    else if (value >= 20 && value <= 400) await store.setWeight(day, Math.round(value * 100) / 100);
    renderWeight();                      // also reverts anything unparseable
  });

  document.addEventListener('focusout', async e => {
    const key = e.target.dataset?.key;
    if (!key) return;
    const dow = Number(e.target.dataset.dow);
    const day = store.data.week.find(d => d.dow === dow);
    if (key === 'session' || key === 'extra') {
      if (!day[key]) e.target.textContent = '—';
    } else {
      e.target.textContent = sp(day[key]);
    }
    await store.setWeekDay(dow, { [key]: day[key] });
  });
}

function watchSync() {
  let wasWaiting = pending() > 0;
  onSyncChange(async ({ pending: waiting, online: up }) => {
    renderSync();
    if (wasWaiting && !waiting && up) toast('Synced');
    wasWaiting = waiting > 0;
    if (!waiting && up && REMOTE) {
      try { store = makeStore(await loadData()); renderAll(); } catch { /* keep what we have */ }
    }
  });
  addEventListener('online', () => { renderSync(); flush(); });
  addEventListener('offline', renderSync);
}

/* ---------------------------------- boot -------------------------------- */

function showApp() {
  $('auth').classList.add('hide');
  $('app').classList.remove('hide');
  $('tabs').classList.remove('hide');
}

function showAuth() {
  $('auth').classList.remove('hide');
  $('app').classList.add('hide');
  $('tabs').classList.add('hide');
}

async function start(data) {
  store = makeStore(data);
  renderAll();
  renderSync();
  go('today');
}

async function init() {
  theme(localStorage.getItem('gym.theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  wire();
  setupCalculator();

  watchSync();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* http only, fine */ });
  }

  const user = await auth.session();
  if (!user) { showAuth(); return; }

  showApp();
  const snapshot = cached();
  if (snapshot) await start(snapshot);     // instant paint from the last sync
  try {
    await start(await loadData());
  } catch {
    if (!snapshot) toast('No connection, and nothing saved on this device yet.');
  }
}

$('authForm').onsubmit = async e => {
  e.preventDefault();
  $('authBtn').disabled = true;
  const result = await auth.signIn($('authEmail').value.trim(), $('authPass').value);
  $('authBtn').disabled = false;
  if (!result.ok) {
    $('authErr').textContent = result.message;
    $('authErr').classList.remove('hide');
    return;
  }
  showApp();
  await start(await loadData());
};

init();
