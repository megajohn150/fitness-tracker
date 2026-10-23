-- Remembers which week already had its calorie adjustment applied,
-- so the weekly review cannot quietly cut the same week twice.
alter table settings add column if not exists adjusted_week date;
alter table settings add column if not exists adjusted_kcal integer;
