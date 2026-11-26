<div align="center">

# 💪 Fitness Tracker

### Weight, measurements, the week's activity and caffeine, in one pocket app

<p>
  <img src="https://img.shields.io/badge/JavaScript-ES_modules-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript ES modules">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5">
  <img src="https://img.shields.io/badge/CSS-1572B6?style=for-the-badge&logo=css&logoColor=white" alt="CSS">
  <img src="https://img.shields.io/badge/PWA-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white" alt="PWA">
</p>
<p>
  <img src="https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Cloudflare_Pages-F38020?style=for-the-badge&logo=cloudflarepages&logoColor=white" alt="Cloudflare Pages">
  <img src="https://img.shields.io/badge/platform-iOS_home_screen-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Platform: iOS home screen">
</p>
<p>
  <img src="https://img.shields.io/badge/framework-none-555555?style=for-the-badge" alt="No framework">
  <img src="https://img.shields.io/badge/build_step-none-555555?style=for-the-badge" alt="No build step">
</p>

> Weigh in. Watch the weekly average. Know when the last coffee was.

</div>

---

## 📖 Overview

A personal tracker for the numbers around training: body weight with weekly averages, body
measurements, the weekly activity plan, a caffeine limit based on how long is left before
sleep, and a steps / treadmill-minutes / kcal converter.

Plain HTML, CSS and ES modules, with no framework and no build step. Data lives in Supabase,
and the app keeps working offline.

## ✨ Features

### ⚖️ Weight and body
- Daily weigh-ins with a weekly average and a trend chart
- Advice from the weekly change: gaining too fast says how many calories to cut, too slow says how many to add
- Bulk and cut phases, each with its own start date and history
- Body measurements every Monday, with the change since the start

### 🏃 The week
- A weekly activity plan and an energy balance you can edit with a tap
- Steps left for the day, and a weekly review that plans the week after it
- A converter between steps, incline and stepper minutes, and kcal

### ☕ Everyday
- A caffeine limit that shrinks as bedtime gets closer
- A gym bag checklist and notes

### ⚙️ Under the hood
- Offline-first: changes wait in an outbox and sync when the connection is back
- Works with no backend at all: leave the config empty and everything stays in the browser
- Installs to the iPhone home screen and opens without browser chrome

## 🧱 How it is built

| Part | What it uses |
|---|---|
| 📱 App | `index.html` + `css/app.css` + ES modules in `js/` |
| 🗄️ Data | Supabase (Postgres + Auth), or the browser's storage when unconfigured |
| 📡 Offline | `sw.js`, a service worker for the app shell |
| ☁️ Hosting | Cloudflare Pages, serving the repository root as is |

## 🔒 Security

Every table has row level security that locks each row to its owner, so a signed-in account
sees only its own data. The key in `js/config.js` is the public `anon` key; the `service_role`
key never goes into this repo. New sign-ups are switched off, since the app has one user.

## 🚀 Run it locally

```bash
python3 -m http.server 8777
```

Then open http://localhost:8777. With `js/config.js` left empty the app stores everything in
that browser, which is handy for trying things out.

## 🗄️ Connect Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run `supabase/schema.sql`. It creates the tables and locks every
   row to its owner with row level security. Then run each file in `supabase/migrations/` in
   order; they add what came after the first schema.
3. Authentication → Users → add your account (email + password). Then switch off
   "Allow new users to sign up", so nobody else can create an account with the public key.
4. Project settings → API: copy the project URL and the `anon` key into `js/config.js`. The
   anon key is meant to be public, since RLS is what protects the data. Never paste the
   `service_role` key anywhere in this repo.

## ☁️ Deploy to Cloudflare Pages

Connect the GitHub repository in the Cloudflare dashboard and create a Pages project with:

- **Build command:** *(leave empty)*
- **Build output directory:** `/`

Every push to `main` publishes the site.

## 📱 On the phone

Open the deployed URL in Safari → Share → Add to Home Screen. The manifest and
`apple-mobile-web-app-capable` make it open without browser chrome, so it behaves like an app.

## 📂 Project layout

```
index.html          markup for every view
css/app.css         the whole design system
js/config.js        Supabase URL + anon key
js/db.js            data layer: Supabase, or this browser when unconfigured
js/calc.js          dates, weekly grouping, caffeine tiers, unit conversion
js/app.js           rendering, navigation and actions
supabase/           schema and migrations
mockups/            the original visual sketches
```

## 🔢 Conversion rates

Everything is expressed in steps, which keeps the four rules consistent:

| Activity | Value |
|---|---|
| incline minute | 262 steps |
| stepper minute | 400 steps |
| step | 0.043 kcal |
| incline minute | 11.27 kcal |
