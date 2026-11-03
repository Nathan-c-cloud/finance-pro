-- ============================================================
-- Suivi Budget : budgets par catégorie et archivage des catégories
-- À exécuter UNE FOIS dans Supabase : SQL Editor > New query > coller > Run
-- Sans danger si tu le relances (tout est "if not exists").
-- ============================================================

-- Catégories : archivage + budget par défaut
alter table categories add column if not exists archived boolean not null default false;
alter table categories add column if not exists budget_default numeric check (budget_default is null or budget_default >= 0); -- null = pas de budget par défaut
alter table categories add column if not exists budget_include_fixed boolean not null default true; -- false = le budget ne suit que les dépenses variables

-- Budgets par mois : copie figée du budget par défaut, modifiable mois par mois
create table if not exists month_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_id uuid not null references months(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  amount numeric not null check (amount >= 0),
  include_fixed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (month_id, category_id)
);

create index if not exists idx_month_budgets_user on month_budgets(user_id);
create index if not exists idx_month_budgets_month on month_budgets(month_id);

alter table month_budgets enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'month_budgets' and policyname = 'month_budgets_owner'
  ) then
    create policy "month_budgets_owner" on month_budgets
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
