// Pure helpers: dates, weekly grouping, caffeine limits, unit conversion.

export const DAY_NAMES  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const LONG_DAYS  = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const dowOf   = d => (d.getDay() + 6) % 7;            // 0 = Monday
export const isoOf   = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today   = () => isoOf(new Date());
export const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export function mondayOf(dateOrISO) {
  const d = typeof dateOrISO === 'string' ? parseISO(dateOrISO) : new Date(dateOrISO);
  d.setDate(d.getDate() - dowOf(d));
  d.setHours(0, 0, 0, 0);
  return d;
}

export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const shortDate = iso => { const d = parseISO(iso); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`; };

export const average = xs => {
  const v = xs.filter(x => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * Weights grouped into Mon–Fri weeks, one row per week since the phase started.
 * A new week appears on its own as soon as the calendar reaches it.
 */
export function weeklyWeights(weights, phaseStart, phaseEnd) {
  if (!weights.length) return [];
  const first = mondayOf(phaseStart || weights[0].day);
  const today = mondayOf(new Date());
  const last  = phaseEnd ? mondayOf(addDays(parseISO(phaseEnd), -1)) : today;
  if (last < first) return [];
  const byDay = new Map(weights.map(w => [w.day, Number(w.kg)]));
  const weeks = [];

  for (let m = new Date(first), i = 1; m <= last; m = addDays(m, 7), i++) {
    const days = Array.from({ length: 5 }, (_, k) => byDay.get(isoOf(addDays(m, k))) ?? null);
    weeks.push({ label: `W${i}`, monday: isoOf(m), days, avg: average(days) });
  }
  return weeks;
}

/** Monday–Friday is the tracking window, so weekends keep showing the week that just ended. */
export function displayWeek(weeks) {
  if (!weeks.length) return null;
  const weekend = dowOf(new Date()) > 4;
  const current = weeks[weeks.length - 1];
  if (!weekend) return current;
  return current.days.some(d => d != null) ? current : weeks[weeks.length - 2] ?? current;
}

export const CAFFEINE = [
  [12, 395], [11, 345], [10, 300], [9, 260], [8, 225],
  [7, 200], [6, 170], [5, 150], [2, 100], [0, 0]
];

/** Hours left until bedtime, wrapping past midnight. */
export function hoursUntilSleep(nowHHMM, sleepHHMM) {
  const toH = s => { const [h, m] = s.split(':').map(Number); return h + m / 60; };
  let left = toH(sleepHHMM) - toH(nowHHMM);
  if (left < 0) left += 24;
  return left;
}

export function caffeineLimit(hoursLeft) {
  const tier = CAFFEINE.find(([h]) => hoursLeft >= h) ?? [0, 0];
  return { hours: tier[0], mg: tier[1] };
}

/** Latest clock time that still allows `mg`, given bedtime. */
export function caffeineCutoff(sleepHHMM, mg) {
  const tier = CAFFEINE.find(([, limit]) => limit <= mg) ?? CAFFEINE[CAFFEINE.length - 1];
  const [h, m] = sleepHHMM.split(':').map(Number);
  let t = h + m / 60 - tier[0];
  if (t < 0) t += 24;
  return `${String(Math.floor(t)).padStart(2, '0')}:${String(Math.round((t % 1) * 60)).padStart(2, '0')}`;
}

/** Rough energy content of a kilo of body mass — the usual 7 700 kcal. */
export const KCAL_PER_KG = 7700;

// Everything is expressed in steps — see supabase/README or the Rates card.
export const UNITS = {
  steps:   { label: 'steps',           factor: 1 },
  incline: { label: 'incline minutes', factor: 262 },
  stepper: { label: 'stepper minutes', factor: 400 },
  kcal:    { label: 'kcal',            factor: 1 / 0.043 }
};

export const convert = (amount, from, to) => amount * UNITS[from].factor / UNITS[to].factor;
