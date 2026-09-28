-- ============================================================
-- Suivi Budget — schéma Supabase (Postgres + RLS)
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Réglages par utilisateur (solde initial du tout premier mois)
-- ------------------------------------------------------------
create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  initial_balance numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Catégories (liste libre, l'utilisateur en ajoute/retire à volonté)
-- ------------------------------------------------------------
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ------------------------------------------------------------
-- Référentiel des dépenses fixes (abonnements, loyer, etc.)
-- Source de vérité "actuelle" : modifier une ligne ici n'affecte
-- jamais les mois déjà générés (copie figée dans transactions).
-- ------------------------------------------------------------
create table if not exists fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount numeric not null,
  category_id uuid references categories(id) on delete set null,
  frequency text not null default 'monthly' check (frequency in ('monthly','annual')),
  payment_day int not null default 1 check (payment_day between 1 and 28),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Mois (un par mois créé ; le statut est juste une étiquette,
-- jamais un verrou — on peut toujours corriger un mois clôturé)
-- ------------------------------------------------------------
create table if not exists months (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_date date not null,                 -- toujours le 1er du mois
  status text not null default 'current' check (status in ('current','closed')),
  starting_balance_override numeric,         -- pour recaler sur la banque si besoin
  real_balance_check numeric,                -- dernier solde réel saisi (rapprochement)
  created_at timestamptz not null default now(),
  unique (user_id, month_date)
);

-- ------------------------------------------------------------
-- Transactions (dépenses fixes copiées + dépenses variables + revenus)
-- Rattachées à un mois précis : rien n'est jamais recalculé
-- rétroactivement quand le référentiel change.
-- ------------------------------------------------------------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_id uuid not null references months(id) on delete cascade,
  type text not null check (type in ('fixed','variable','income')),
  name text not null,
  amount numeric not null,
  category_id uuid references categories(id) on delete set null,
  tx_date date,
  detail text,
  necessary boolean,
  received boolean,
  created_at timestamptz not null default now()
);

create index if not exists idx_fixed_expenses_user on fixed_expenses(user_id);
create index if not exists idx_months_user on months(user_id);
create index if not exists idx_transactions_user on transactions(user_id);
create index if not exists idx_transactions_month on transactions(month_id);
create index if not exists idx_categories_user on categories(user_id);

-- ============================================================
-- Row Level Security : chacun ne voit et ne modifie que ses données
-- ============================================================
alter table user_settings enable row level security;
alter table categories enable row level security;
alter table fixed_expenses enable row level security;
alter table months enable row level security;
alter table transactions enable row level security;

create policy "user_settings_owner" on user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "categories_owner" on categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "fixed_expenses_owner" on fixed_expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "months_owner" on months
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "transactions_owner" on transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Catégories de départ (facultatif — l'app peut aussi les créer
-- au premier lancement). Décommente et remplace <USER_ID> si tu
-- veux les insérer à la main depuis le SQL Editor.
-- ============================================================
-- insert into categories (user_id, name, sort_order) values
--   ('<USER_ID>', 'Logement', 1),
--   ('<USER_ID>', 'Énergie', 2),
--   ('<USER_ID>', 'Abonnements', 3),
--   ('<USER_ID>', 'Santé', 4),
--   ('<USER_ID>', 'Transport', 5),
--   ('<USER_ID>', 'Épargne', 6),
--   ('<USER_ID>', 'Alimentation', 7),
--   ('<USER_ID>', 'Loisirs', 8),
--   ('<USER_ID>', 'Autres', 9);
