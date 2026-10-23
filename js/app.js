import { auth, loadData, makeStore, cached, flush, pending, online, onSyncChange,
         syncInfo, retrySync, discardBlocked, BAG_GROUPS, REMOTE } from './db.js';
import * as C from './calc.js';

const $  = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const sp     = n => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
const num    = t => { const v = parseFloat(String(t).replace(/[^\d.-]/g, '')); return Number.isNaN(v) ? 0 : v; };
const sign   = n => (n < 0 ? '−' : '+') + sp(Math.abs(n));
const signKg = n => (n < 0 ? '−' : '+') + Math.abs(n).toFixed(2);
const decimal = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const weeklyKg = kcal => `${kcal < 0 ? '−' : '+'}${Math.abs(kcal / C.KCAL_PER_KG).toFixed(2)}`;

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
  calc:     { title: 'Calculator', sub: true },
  review:   { title: 'Weekly review', sub: true }
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
    case 'review':   return 'The week that just ended';
    default:         return 'Tools & settings';
  }
}

const sleepTime = () => store?.data.settings.sleep_time?.slice(0, 5) || '23:30';

/** Phases in order, each one ending where the next begins. */
function phaseList() {
  const phases = (store?.data.phases ?? []).slice().sort((a, b) => a.started_on.localeCompare(b.started_on));
  if (!phases.length) {
    const { phase_label, phase_start } = store?.data.settings ?? {};
    const started = phase_start ?? store?.data.weights[0]?.day;
    return started ? [{ id: null, label: phase_label ?? 'Bulk', started_on: started, ends_on: null }] : [];
  }
  return phases.map((p, i) => ({ ...p, ends_on: phases[i + 1]?.started_on ?? null }));
}

/** The phase that has actually started — one dated next Monday is not it yet. */
const currentPhase = () => {
  const phases = phaseList();
  const begun = phases.filter(p => p.started_on <= C.today());
  return begun.at(-1) ?? phases[0] ?? { label: 'Bulk', started_on: null, ends_on: null };
};

function phaseWeeks(phase) {
  return C.weeklyWeights(store.data.weights, phase.started_on, phase.ends_on);
}

function phaseText() {
  const phase = currentPhase();
  const weeks = phaseWeeks(phase);
  return weeks.length ? `${phase.label} week ${weeks.length}` : phase.label;
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

function confirmSheet({ title, sub, action = 'Delete' }) {
  return openSheet({ title, sub, fields: [], action }).then(Boolean);
}

function openSheet({ title, sub = '', fields, action = 'Save' }) {
  const dialog = $('sheet');
  $('sheetTitle').textContent = title;
  $('sheetSub').textContent = sub;
  $('sheetFields').innerHTML = fields.map(f => `
    <div>
      <p class="lab">${f.label}</p>
      ${f.type === 'textarea'
        ? `<textarea class="field" name="${f.key}" rows="3" style="font-size:17px;line-height:1.45;resize:none">${f.value ?? ''}</textarea>`
        : `<input class="field" name="${f.key}"
             type="${f.type === 'number' ? 'text' : f.type ?? 'text'}"
             inputmode="${f.type === 'number' ? 'decimal' : 'text'}"
             value="${f.value ?? ''}" placeholder="${f.placeholder ?? ''}">`}
    </div>`).join('');
  $('sheetSave').textContent = action;
  $('sheetFields').style.flexDirection =
    fields.length > 2 || fields[0]?.type === 'textarea' ? 'column' : 'row';

  dialog.showModal();
  setTimeout(() => $('sheetFields').querySelector('input,textarea')?.focus(), 50);

  // WebKit does not reliably fire `close` for a method="dialog" submit, so the
  // submit itself is what resolves this; `cancel` and `close` are the fallbacks.
  return new Promise(resolve => {
    const form = $('sheetForm');

    const finish = saved => {
      form.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      if (!saved) return resolve(null);
      const out = {};
      $$('#sheetFields [name]').forEach(el => { out[el.name] = el.value.trim(); });
      resolve(out);
    };

    const onSubmit = event => finish((event.submitter?.value ?? dialog.returnValue) === 'save');
    const onCancel = () => finish(false);
    const onClose  = () => finish(dialog.returnValue === 'save');

    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
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

/** Several series on one scale — only comparable because they are all deltas. */
function multiSpark(id, series, count) {
  const el = $(id);
  const w = 300, h = 96, pad = 10;
  el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const all = series.flatMap(s => s.points.map(p => p.v));
  if (all.length < 2) { el.innerHTML = ''; return; }

  const span = Math.max(0.6, Math.max(...all.map(Math.abs)) * 2.2);
  const X = i => (count < 2 ? w / 2 : i * (w / (count - 1)));
  const Y = v => pad + (0.5 - v / span) * (h - 2 * pad);

  el.innerHTML =
    `<line class="zero" x1="0" y1="${Y(0).toFixed(1)}" x2="${w}" y2="${Y(0).toFixed(1)}"/>` +
    series.map((s, k) => {
      const points = s.points.map(p => `${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
      const cls = ['s1', 's2', 's3'][k] ?? 's1';
      const end = s.points.at(-1);
      return `<polyline class="${cls}" points="${points}"/>` +
             `<circle class="dot" style="fill:var(${s.color})" cx="${X(end.i)}" cy="${Y(end.v)}" r="2.6"/>`;
    }).join('');
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
  renderReview();
  renderSettings();
  $('sub').textContent = subtitleFor(lastTab);
}

function renderWeight() {
  const { weights } = store.data;
  const phase = currentPhase();
  const weeks = phaseWeeks(phase);
  const todayISO = C.today();
  const todayEntry = weights.find(w => w.day === todayISO);
  const current = weeks.at(-1) ?? { days: [null, null, null, null, null], avg: null };
  const shown = C.displayWeek(weeks) ?? current;
  // The comparison has to follow whichever week is on screen, or a weekend with
  // nothing logged compares last week against itself and reads +0.00.
  const previous = weeks[weeks.indexOf(shown) - 1];
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
    const thisWeek = C.isoOf(C.mondayOf(new Date()));
    $('wLast').textContent = last
      ? `Not logged today · last ${last.kg.toFixed(2)} on ` +
        (last.day >= thisWeek ? C.DAY_NAMES[C.dowOf(C.parseISO(last.day))] : C.shortDate(last.day))
      : 'Nothing logged yet';
  }
  $('wPill').classList.toggle('hide', delta == null);
  if (delta != null) $('wPill').textContent = `${signKg(delta)} kg vs ${previous.label}`;

  weekSpark('sp1', current.days);

  // Weight view
  $('wkLabel').textContent = `${phase.label} week ${weeks.length || 1} average`;
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
      `<td><b>${week.avg?.toFixed(2) ?? '—'}</b></td>` +
      (week.days.some(v => v != null)
        ? `<td class="del"><button data-clear-week="${week.monday}" aria-label="Clear ${week.label}">×</button></td>`
        : '<td class="del"></td>') + '</tr>';
  }).join('') || '<tr><td colspan="8" class="mut">No entries yet</td></tr>';

  $('phaseLabel').textContent = phase.label;
  $('phaseStart').textContent = phase.started_on ? `start ${C.shortDate(phase.started_on)}` : '';
  renderPhases();

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

function renderBodyTrend() {
  const measurements = store.data.measurements;
  const card = $('bodyTrend');
  if (measurements.length < 2) { card.classList.add('hide'); return; }
  card.classList.remove('hide');

  const metrics = [
    { key: 'biceps', label: 'Biceps', color: '--c1' },
    { key: 'quad',   label: 'Quad',   color: '--c2' },
    { key: 'waist',  label: 'Waist',  color: '--c3' }
  ];
  const series = metrics.map(m => {
    const taken = measurements
      .map((x, i) => ({ i, value: x[m.key] == null ? null : Number(x[m.key]) }))
      .filter(p => p.value != null);
    const base = taken[0]?.value;
    return { ...m, points: taken.map(p => ({ i: p.i, v: p.value - base })) };
  }).filter(s => s.points.length > 1);

  if (!series.length) { card.classList.add('hide'); return; }

  multiSpark('spBody', series, measurements.length);
  $('trendFrom').textContent = `from ${C.shortDate(measurements[0].day)}`;
  $('bodyLegend').innerHTML = series.map(s =>
    `<span><i style="background:var(${s.color})"></i>${s.label} ${signCm(s.points.at(-1).v)}</span>`).join('');
}

const signCm = n => `${n < 0 ? '−' : '+'}${Math.abs(n).toFixed(1)} cm`;

function renderPhases() {
  const phases = phaseList();
  $('phaseCount').textContent = phases.length ? `${phases.length} total` : '';

  $('phaseList').innerHTML = phases.slice().reverse().map((p, i) => {
    const weeks = phaseWeeks(p);
    const logged = weeks.flatMap(w => w.days).filter(v => v != null);
    const change = logged.length > 1 ? logged.at(-1) - logged[0] : null;
    const range = `${C.shortDate(p.started_on)} – ${p.ends_on ? C.shortDate(p.ends_on) : 'now'}`;
    return `<div class="row">
      <span class="k">${escapeHtml(p.label)}${i === 0 ? ' · current' : ''}<br><span class="mut">${range} · ${weeks.length} wk</span></span>
      <span class="v">${change == null ? '—' : signKg(change) + ' kg'}
        ${p.id ? `<button class="rowdel" data-del-phase="${p.id}" aria-label="Delete phase">×</button>` : ''}</span>
    </div>`;
  }).join('') || '<p class="mut">No phase yet — start one to number the weeks.</p>';
}

async function newPhase() {
  const result = await openSheet({
    title: 'Start new phase',
    sub: 'Week numbering restarts from here.',
    fields: [
      { key: 'label', label: 'Name', type: 'text', value: '', placeholder: 'Cut' },
      { key: 'started_on', label: 'Starts on', type: 'date', value: C.isoOf(C.mondayOf(new Date())) }
    ],
    action: 'Start'
  });
  if (!result?.label || !result.started_on) return;
  await store.addPhase(result.label, result.started_on);
  renderAll();
  toast(`${result.label} started`);
}

async function deletePhase(id) {
  const phase = phaseList().find(p => p.id === id);
  const ok = await confirmSheet({
    title: `Delete ${phase.label}?`,
    sub: 'The weights stay — only the phase marker goes.'
  });
  if (!ok) return;
  await store.deletePhase(id);
  renderAll();
}

function renderBody() {
  const { measurements, weights } = store.data;
  const firstMonday = C.mondayOf(currentPhase().started_on || weights[0]?.day || C.today());
  const weekOf = iso => Math.round((C.mondayOf(iso) - firstMonday) / 6048e5) + 1;

  $('bodyRows').innerHTML = measurements.map((m, i) => {
    const isLast = i === measurements.length - 1;
    return `<tr class="${isLast ? 'cur' : ''}"><td>${C.shortDate(m.day)}</td><td>W${weekOf(m.day)}</td>` +
      ['biceps', 'quad', 'waist'].map(k => `<td>${m[k] != null ? Number(m[k]).toFixed(1) : '—'}</td>`).join('') +
      `<td class="del"><button data-del-measure="${m.day}" aria-label="Delete measurement">×</button></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="mut">No measurements yet</td></tr>';

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

  // This week's measurement is only "done" once it exists; until then it is due,
  // which on a Monday means today rather than a week from now.
  const thisMonday = C.isoOf(C.mondayOf(new Date()));
  const takenThisWeek = measurements.some(m => m.day >= thisMonday);
  const due = takenThisWeek ? C.isoOf(C.addDays(C.parseISO(thisMonday), 7)) : thisMonday;
  $('bodyNext').textContent = 'Measured every Monday after waking up. ' +
    (due === C.today() ? 'Due today.' : due < C.today() ? `Missed ${C.shortDate(due)}.` : `Next: ${C.shortDate(due)}.`);

  renderBodyTrend();

  const loggedToday = measurements.some(m => m.day === C.today());
  $('mondayCta').classList.toggle('hide', !(C.dowOf(new Date()) === 0 && !loggedToday));
}

function renderActivity() {
  const week = store.data.week;
  const todayIndex = C.dowOf(new Date());
  const cell = (dow, key, value) => `<td contenteditable data-dow="${dow}" data-key="${key}">${value}</td>`;

  $('planRows').innerHTML = week.map(d => `<tr class="${d.dow === todayIndex ? 'cur' : ''}"><td>${C.DAY_NAMES[d.dow]}</td>` +
    cell(d.dow, 'steps', sp(d.steps)) + cell(d.dow, 'session', escapeHtml(d.session || '—')) + '</tr>').join('');

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
  $('energyRate').textContent = `${sign(eat - maint)} ≈ ${weeklyKg(eat - maint)} kg`;
  $('energyTot').innerHTML = `<tr class="tot"><td>Total</td><td>${sp(maint)}</td><td>${sp(eat)}</td><td>${sign(eat - maint)}</td></tr>`;
  $$('#energyRows tr').forEach(tr => {
    const dow = Number(tr.querySelector('[data-dow]').dataset.dow);
    const d = week.find(x => x.dow === dow);
    tr.querySelector('.diff').textContent = sign(d.eat - d.maintenance);
  });

  if ($('stepsGoal')) renderStepsLeft();

  const today = week.find(d => d.dow === C.dowOf(new Date()));
  $('tSteps').textContent = sp(today.steps);
  $('tEat').textContent = sp(today.eat);
  $('tSurplus').textContent = `${sign(today.eat - today.maintenance)} surplus`;
  $('tDayLabel').textContent = `${C.LONG_DAYS[today.dow]} target`;
}

/* The Today list is a daily checklist: ticked items drop to the bottom of their
   own group and the whole thing clears itself overnight. It lives on the device
   — it says nothing about the week, only about this morning. */
const BAG_STATE_KEY = 'gym.bag.today';
let bagChecked = null;

function defaultChecked() {
  return new Set(store.data.bag.filter(b => b.grp === BAG_GROUPS[2]).map(b => String(b.id)));
}

function loadBagState() {
  try {
    const saved = JSON.parse(localStorage.getItem(BAG_STATE_KEY));
    if (saved?.day === C.today()) return new Set(saved.ids.map(String));
  } catch { /* private mode */ }
  return defaultChecked();
}

function saveBagState() {
  try {
    localStorage.setItem(BAG_STATE_KEY, JSON.stringify({ day: C.today(), ids: [...bagChecked] }));
  } catch { /* private mode */ }
}

function renderBag() {
  const items = store.data.bag.slice().sort((a, b) => a.position - b.position);
  const inGroup = grp => items.filter(i => i.grp === grp);

  if (!bagChecked) bagChecked = loadBagState();
  const ids = new Set(items.map(i => String(i.id)));
  [...bagChecked].forEach(id => { if (!ids.has(id)) bagChecked.delete(id); });   // item was removed

  // Today — tappable, ticked items sink within their group
  $('bagToday').innerHTML = BAG_GROUPS.filter(g => inGroup(g).length).map(g => {
    const rows = inGroup(g).slice().sort((a, b) =>
      (bagChecked.has(String(a.id)) - bagChecked.has(String(b.id))) || a.position - b.position);
    return `<div class="bg"><h3>${g}</h3><ul>` + rows.map(i =>
      `<li class="${bagChecked.has(String(i.id)) ? 'done' : ''}" data-check="${i.id}" data-pos="${i.position}">` +
      `<span>${escapeHtml(i.item)}</span></li>`).join('') + '</ul></div>';
  }).join('');

  // More — the preset behind it
  $('bagFull').innerHTML = BAG_GROUPS.map(grp => `
    <div class="bg">
      <h3>${grp}</h3>
      <ul>${inGroup(grp).map(i => `
        <li><span contenteditable data-bag="${i.id}">${escapeHtml(i.item)}</span>
            <button data-del-bag="${i.id}" aria-label="Remove ${escapeHtml(i.item)}">×</button></li>`).join('')}
      </ul>
      <button class="add" data-add-bag="${grp}">+ Add item</button>
    </div>`).join('');

  updateBagCount(items.length);
}

const updateBagCount = total =>
  $('bagCount').textContent = `${bagChecked.size} / ${total ?? store.data.bag.length}`;

/** Tick, then slide the row to the bottom of its own group. */
function toggleBagItem(id) {
  const row = document.querySelector(`#bagToday [data-check="${CSS.escape(id)}"]`);
  if (!row) return;
  const list = row.parentElement;
  const rows = [...list.children];
  const before = new Map(rows.map(el => [el, el.getBoundingClientRect().top]));

  bagChecked.has(id) ? bagChecked.delete(id) : bagChecked.add(id);
  saveBagState();
  row.classList.toggle('done');

  rows.slice()
    .sort((a, b) => (a.classList.contains('done') - b.classList.contains('done')) ||
                    (Number(a.dataset.pos) - Number(b.dataset.pos)))
    .forEach(el => list.appendChild(el));

  // play the move from where each row used to be
  rows.forEach(el => {
    const shift = before.get(el) - el.getBoundingClientRect().top;
    if (!shift) return;
    el.style.transition = 'none';
    el.style.transform = `translateY(${shift}px)`;
    requestAnimationFrame(() => {
      el.style.transition = '';
      el.style.transform = '';
    });
  });

  updateBagCount();
}

async function addBagItem(grp) {
  const result = await openSheet({
    title: 'Add item', sub: grp,
    fields: [{ key: 'item', label: 'Name', type: 'text', placeholder: 'Wrist wraps' }],
    action: 'Add'
  });
  if (!result?.item) return;
  await store.addBagItem(grp, result.item);
  renderBag();
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
  const { pending: waiting, online: up, error, blocked, lastSync } = syncInfo();
  const pill = $('syncPill');
  const text = error ? 'Sync stuck'
             : !up   ? (waiting ? `Offline · ${waiting} to sync` : 'Offline')
             : waiting ? `${waiting} to sync` : '';
  pill.textContent = text;
  pill.classList.toggle('hide', !text);

  const storage = $('setStorage');
  if (storage && REMOTE) {
    storage.textContent = error ? 'Supabase · stuck'
      : waiting ? `Supabase · ${waiting} waiting`
      : lastSync ? `Supabase · ${new Date(lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : 'Supabase';
  }

  $('syncCard').classList.toggle('hide', !error);
  if (error) {
    $('syncMsg').textContent =
      `The server refused ${blocked ?? 'a change'} and the queue stopped behind it` +
      `${waiting > 1 ? `, holding ${waiting - 1} more` : ''}. ${error}`;
  }
}

/* ------------------------------- review --------------------------------- */

/** The last week that is fully behind us — the one worth judging. */
function reviewWeek() {
  const weeks = phaseWeeks(currentPhase());
  const todayISO = C.today();
  const finished = weeks.filter(w => C.isoOf(C.addDays(C.parseISO(w.monday), 4)) < todayISO);
  return { week: finished.at(-1) ?? null, previous: finished.at(-2) ?? null };
}

function verdictFor(delta) {
  if (delta == null) return { lab: 'Not enough data', text: 'Two full weeks are needed before the rule says anything.', amount: 0 };
  if (delta > 0.25)  return { lab: 'Above target', amount: -500,
    text: `Gained ${delta.toFixed(2)} kg — more than 0.25. The rule says cut 300–600 kcal from the week.` };
  if (delta < 0.1)   return { lab: 'Below target', amount: 500,
    text: `${delta < 0 ? 'Lost' : 'Gained'} ${Math.abs(delta).toFixed(2)} kg — under 0.1. The rule says add 500 calories to the week.` };
  return { lab: 'On target', amount: 0,
    text: `Gained ${delta.toFixed(2)} kg, inside the 0.1–0.25 window. Leave the week as it is.` };
}

function renderReview() {
  const { week, previous } = reviewWeek();
  const { settings, week: plan } = store.data;

  if (!week) {
    $('revRange').textContent = 'No finished week yet';
    $('revAvg').textContent = '—';
    $('revDays').textContent = 'Come back after the first Friday of this phase.';
    $('revDelta').classList.add('hide');
    $('revVerdict').classList.add('hide');
  } else {
    const delta = week.avg != null && previous?.avg != null ? week.avg - previous.avg : null;
    const verdict = verdictFor(delta);
    const friday = C.isoOf(C.addDays(C.parseISO(week.monday), 4));

    $('revRange').textContent = `${week.label} · ${C.shortDate(week.monday)} – ${C.shortDate(friday)}`;
    $('revAvg').textContent = week.avg?.toFixed(2) ?? '—';
    $('revDays').textContent = `${week.days.filter(d => d != null).length} of 5 days logged` +
      (previous?.avg != null ? ` · ${previous.label} was ${previous.avg.toFixed(2)}` : '');
    $('revDelta').classList.toggle('hide', delta == null);
    if (delta != null) $('revDelta').textContent = `${signKg(delta)} kg`;

    $('revVerdict').classList.remove('hide');
    $('revVerdictLab').textContent = verdict.lab;
    $('revVerdictText').textContent = verdict.text;

    const done = settings.adjusted_week === week.monday;
    const button = $('revApplyBtn');
    button.classList.toggle('hide', !verdict.amount);
    button.textContent = `${verdict.amount < 0 ? 'Cut' : 'Add'} ${Math.abs(verdict.amount)} kcal across the week`;
    button.dataset.amount = verdict.amount;
    button.dataset.monday = week.monday;
    $('revApplied').textContent = done
      ? `Already applied ${sign(settings.adjusted_kcal ?? 0)} kcal for this week.` : '';
  }

  const eat = plan.reduce((a, d) => a + d.eat, 0);
  const maint = plan.reduce((a, d) => a + d.maintenance, 0);
  $('revSurplus').textContent = `${sign(eat - maint)} kcal · ${weeklyKg(eat - maint)} kg / wk`;
  $('revRows').innerHTML = plan.map(d =>
    `<tr><td>${C.DAY_NAMES[d.dow]}</td><td>${sp(d.maintenance)}</td><td>${sp(d.eat)}</td>` +
    `<td class="diff">${sign(d.eat - d.maintenance)}</td></tr>`).join('');

  const monday = C.isoOf(C.mondayOf(new Date()));
  const taken = store.data.measurements.find(m => m.day >= monday);
  $('revMeasureWhen').textContent = taken ? `done ${C.shortDate(taken.day)}` : 'not taken yet';
  $('revMeasureBody').innerHTML = taken
    ? ['biceps', 'quad', 'waist'].map(k =>
        `<div class="row"><span class="k">${k[0].toUpperCase() + k.slice(1)}</span>` +
        `<span class="v">${taken[k] != null ? Number(taken[k]).toFixed(1) : '—'} cm</span></div>`).join('')
    : '<p class="mut">Biceps, quad and waist — Monday, after waking up.</p>';
  $('revMeasureBtn').classList.toggle('hide', Boolean(taken));
}

/** Spreads a weekly change over the seven days without drifting off the total. */
async function applyAdjustment(total, monday) {
  const amount = Math.round(Number(total));
  const plan = store.data.week.slice().sort((a, b) => a.dow - b.dow);
  let allocated = 0;
  for (let i = 0; i < plan.length; i++) {
    const share = Math.round((amount * (i + 1)) / plan.length) - allocated;
    allocated += share;
    await store.setWeekDay(plan[i].dow, { eat: plan[i].eat + share });
  }
  await store.setSettings({ adjusted_week: monday, adjusted_kcal: amount });
  renderActivity();
  renderReview();
  toast(`${sign(amount)} kcal spread over the week`);
}

/* ------------------------------ calculator ------------------------------ */

/** Today's step count, kept on this device only — it is a scratch number. */
const STEPS_KEY = 'gym.steps.today';
function todaySteps() {
  try {
    const saved = JSON.parse(localStorage.getItem(STEPS_KEY));
    return saved?.day === C.today() ? saved.steps : null;
  } catch { return null; }
}
function saveTodaySteps(steps) {
  try { localStorage.setItem(STEPS_KEY, JSON.stringify({ day: C.today(), steps })); } catch {}
}

function renderStepsLeft() {
  const goal = store.data.week.find(d => d.dow === C.dowOf(new Date()))?.steps ?? 0;
  const done = num($('stepsNow').value);
  const left = Math.max(0, goal - done);

  $('stepsGoal').textContent = `/ ${sp(goal)}`;
  $('useLeftBtn').disabled = !left;
  $('useLeftBtn').textContent = !done ? `${sp(goal)} to go ›` : left ? `Convert ${sp(left)} ›` : 'Goal reached';
  return left;
}

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

  const stepsNow = $('stepsNow');
  const saved = todaySteps();
  if (saved != null) stepsNow.value = sp(saved);
  stepsNow.oninput = () => { saveTodaySteps(num(stepsNow.value)); renderStepsLeft(); };
  stepsNow.onblur = () => { const n = num(stepsNow.value); if (n) stepsNow.value = sp(n); };

  $('useLeftBtn').onclick = () => {
    const left = renderStepsLeft();
    if (!left) return;
    from.value = 'steps';
    if (to.value === 'steps') to.value = 'incline';
    $('cAmt').value = sp(left);
    run();
    $('cAmt').scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
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
  const kg = decimal(result?.kg);
  if (kg == null) return;
  await store.setWeight(todayISO, kg);
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
  const values = {
    biceps: decimal(result.biceps), quad: decimal(result.quad), waist: decimal(result.waist)
  };
  // An all-empty row would sit in the table forever and drag the chart to zero.
  if (Object.values(values).every(v => v == null)) return;
  await store.setMeasurement(C.today(), values);
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

async function clearWeek(monday) {
  const weeks = phaseWeeks(currentPhase());
  const week = weeks.find(w => w.monday === monday);
  const days = week.days
    .map((v, k) => (v == null ? null : C.isoOf(C.addDays(C.parseISO(monday), k))))
    .filter(Boolean);

  const ok = await confirmSheet({
    title: `Clear ${week.label}?`,
    sub: `${days.length} ${days.length === 1 ? 'entry' : 'entries'} from the week of ${C.shortDate(monday)}.`,
    action: 'Clear week'
  });
  if (!ok) return;

  for (const day of days) await store.deleteWeight(day);
  renderWeight();
  toast(`${week.label} cleared`);
}

async function deleteMeasurement(day) {
  const ok = await confirmSheet({
    title: 'Delete measurement?',
    sub: `Taken on ${C.shortDate(day)}.`
  });
  if (!ok) return;
  await store.deleteMeasurement(day);
  renderBody();
  toast('Measurement deleted');
}

/* --------------------------------- wiring ------------------------------- */

function wire() {
  document.addEventListener('click', async e => {
    const target = e.target.closest('[data-go]');
    if (target) return go(target.dataset.go);

    const phaseId = e.target.dataset.delPhase;
    if (phaseId) return deletePhase(phaseId);

    const checkRow = e.target.closest('#bagToday [data-check]');
    if (checkRow) return toggleBagItem(checkRow.dataset.check);

    const addGroup = e.target.dataset.addBag;
    if (addGroup) return addBagItem(addGroup);

    const bagId = e.target.dataset.delBag;
    if (bagId) {
      await store.deleteBagItem(bagId);
      renderBag();
      return;
    }

    const monday = e.target.dataset.clearWeek;
    if (monday) return clearWeek(monday);

    const measureDay = e.target.dataset.delMeasure;
    if (measureDay) return deleteMeasurement(measureDay);

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
  $('mondayCta').onclick = () => go('review');
  $('signOutBtn').onclick = async () => { await auth.signOut(); location.reload(); };
  $('newPhaseBtn').onclick = newPhase;
  $('revMeasureBtn').onclick = addMeasurement;
  $('revApplyBtn').onclick = async e => {
    const { amount, monday } = e.target.dataset;
    const already = store.data.settings.adjusted_week === monday;
    const result = await openSheet({
      title: Number(amount) < 0 ? 'Cut calories' : 'Add calories',
      sub: already ? 'This week was already adjusted once.' : 'Spread evenly across all seven days.',
      fields: [{ key: 'amount', label: 'Kcal for the week', type: 'number', step: '50', value: amount }],
      action: 'Apply'
    });
    const kcal = decimal(result?.amount);
    if (kcal) await applyAdjustment(kcal, monday);
  };
  $('syncRetry').onclick = () => retrySync();
  $('syncDiscard').onclick = async () => { await discardBlocked(); renderSync(); toast('Change discarded'); };

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
    day[key] = key === 'session' ? e.target.textContent.trim() : num(e.target.textContent);
    updateTotals();
  });

  // a gym bag item
  document.addEventListener('focusout', async e => {
    const id = e.target.dataset?.bag;
    if (!id) return;
    const name = e.target.textContent.trim();
    if (!name) await store.deleteBagItem(id);
    else await store.renameBagItem(id, name);
    renderBag();
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
    if (key === 'session') {
      if (!day[key]) e.target.textContent = '—';
    } else {
      e.target.textContent = sp(day[key]);
    }
    await store.setWeekDay(dow, { [key]: day[key] });
  });
}

const isEditing = () => {
  const el = document.activeElement;
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)));
};

function watchSync() {
  let wasWaiting = pending() > 0;
  onSyncChange(async ({ pending: waiting, online: up }) => {
    renderSync();
    const drained = wasWaiting && !waiting && up;
    wasWaiting = waiting > 0;
    // Re-reading the server after every single save would cost a round trip per
    // keystroke and rebuild the table under the cursor.
    if (!drained || !REMOTE || isEditing()) return;
    toast('Synced');
    try { store = makeStore(await loadData()); renderAll(); } catch { /* keep what we have */ }
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
