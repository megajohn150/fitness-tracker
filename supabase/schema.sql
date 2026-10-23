-- Gym tracker — run this once in the Supabase SQL editor.
-- Every table is per-user and locked down with row level security.

create table if not exists settings (
  user_id     uuid primary key references auth.users on delete cascade default auth.uid(),
  sleep_time  time not null default '23:30',
  phase_label text not null default 'Bulk',
  phase_start date not null default current_date,
  updated_at  timestamptz not null default now()
);

create table if not exists weights (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  day     date not null,
  kg      numeric(5,2) not null,
  unique (user_id, day)
);

create table if not exists measurements (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  day     date not null,
  biceps  numeric(4,1),
  quad    numeric(4,1),
  waist   numeric(4,1),
  unique (user_id, day)
);

-- the weekly template: one row per weekday, 0 = Monday
create table if not exists week_days (
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  dow         smallint not null check (dow between 0 and 6),
  steps       integer not null default 20000,
  session     text    not null default 'Rest',
  extra       text    not null default '',
  maintenance integer not null default 2939,
  eat         integer not null default 3100,
  primary key (user_id, dow)
);

create table if not exists notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  body       text not null,
  created_at timestamptz not null default now()
);

create table if not exists bag_items (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users on delete cascade default auth.uid(),
  grp      text not null,
  item     text not null,
  position integer not null default 0
);

alter table settings     enable row level security;
alter table weights      enable row level security;
alter table measurements enable row level security;
alter table week_days    enable row level security;
alter table notes        enable row level security;
alter table bag_items    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings','weights','measurements','week_days','notes','bag_items'] loop
    execute format('drop policy if exists own_rows on %I', t);
    execute format(
      'create policy own_rows on %I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

create index if not exists weights_day_idx      on weights (user_id, day desc);
create index if not exists measurements_day_idx on measurements (user_id, day desc);
create index if not exists notes_created_idx    on notes (user_id, created_at desc);
