# Gym

A personal gym tracker: weight with weekly averages, body measurements, the weekly
activity plan, a caffeine limit based on how long is left before sleep, and a
steps / treadmill-minutes / kcal converter.

Plain HTML, CSS and ES modules — there is no build step. Data lives in Supabase.

## Run it locally

```bash
python3 -m http.server 8777
```

Then open <http://localhost:8777>. With `js/config.js` left empty the app stores
everything in that browser, which is handy for trying things out.

## Connect Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run `supabase/schema.sql`. It creates the tables and
   locks every row to its owner with row level security.
   Then run each file in `supabase/migrations/` in order — they add what came
   after the first schema.
3. Authentication → Users → add your account (email + password). Turn off
   "Enable email confirmations" under Authentication → Providers → Email if you
   do not want to confirm by mail.
4. Project settings → API: copy the project URL and the `anon` key into
   `js/config.js`. The anon key is meant to be public — RLS is what protects the
   data, so never paste the `service_role` key anywhere in this repo.

## Deploy to Cloudflare Pages

Connect the GitHub repository in the Cloudflare dashboard and create a Pages
project with:

- **Build command:** *(leave empty)*
- **Build output directory:** `/`

Every push to `main` publishes the site.

## On the phone

Open the deployed URL in Safari → Share → Add to Home Screen. The manifest and
`apple-mobile-web-app-capable` make it open without browser chrome, so it behaves
like an app.

## Layout

```
index.html          markup for every view
css/app.css         the whole design system
js/config.js        Supabase URL + anon key
js/db.js            data layer — Supabase, or this browser when unconfigured
js/calc.js          dates, weekly grouping, caffeine tiers, unit conversion
js/app.js           rendering, navigation and actions
supabase/           schema and migrations
mockups/            the original visual sketches
```

## Conversion rates

Everything is expressed in steps, which keeps the four rules consistent:

| | |
|---|---|
| incline minute | 262 steps |
| stepper minute | 400 steps |
| step | 0.043 kcal |
| incline minute | 11.27 kcal |
