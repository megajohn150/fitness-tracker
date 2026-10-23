-- Phases (bulk, cut, reverse…). Run once in the SQL editor.
-- Week numbering restarts with every phase, and the previous ones stay listed.

create table if not exists phases (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  label      text not null,
  started_on date not null,
  unique (user_id, started_on)
);

alter table phases enable row level security;

drop policy if exists own_rows on phases;
create policy own_rows on phases for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists phases_start_idx on phases (user_id, started_on);

-- carry over whatever the settings row already says
insert into phases (user_id, label, started_on)
select s.user_id, s.phase_label, s.phase_start
from settings s
where s.phase_start is not null
on conflict (user_id, started_on) do nothing;
