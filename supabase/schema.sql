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
-- Comptes bancaires (un utilisateur peut en avoir plusieurs).
-- Chaque compte a sa propre chronologie de mois, ses dépenses fixes et son solde de départ.
-- Un compte ne se supprime pas : il se clôture (pas de politique DELETE ci dessous).
-- Migration d'une base existante : supabase/migrations/2026-11-03_accounts_*.sql
-- ------------------------------------------------------------
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  -- Étiquette choisie librement par l'utilisateur (c'est lui qui décide de l'usage d'un compte).
  kind text not null default 'checking' check (kind in ('checking', 'savings')),
  opening_balance numeric not null default 0, -- solde de départ du suivi de ce compte (sans origine)
  opening_date date,                          -- information : mois de départ du suivi (le 1er du mois)
  status text not null default 'active' check (status in ('active', 'closed')),
  closed_at date,
  created_at timestamptz not null default now(),
  unique (user_id, name),
  -- Cible des clés étrangères composites : un mois ou une dépense fixe ne peut jamais
  -- être rattaché au compte d'un autre utilisateur.
  constraint accounts_id_user_key unique (id, user_id),
  constraint accounts_closed_consistent check ((status = 'closed') = (closed_at is not null))
);

-- ------------------------------------------------------------
-- Référentiel des dépenses fixes (abonnements, loyer, etc.)
-- Source de vérité "actuelle" : modifier une ligne ici n'affecte
-- jamais les mois déjà générés (copie figée dans transactions).
-- ------------------------------------------------------------
create table if not exists fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  constraint fixed_expenses_account_fk foreign key (account_id, user_id) references accounts (id, user_id),
  name text not null,
  amount numeric not null,
  category_id uuid references categories(id) on delete set null,
  frequency text not null default 'monthly' check (frequency in ('monthly','bimonthly','quarterly','semiannual','annual')),
  payment_day int check (payment_day is null or payment_day between 1 and 31), -- null = pas de date
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
  account_id uuid not null,
  constraint months_account_fk foreign key (account_id, user_id) references accounts (id, user_id),
  month_date date not null,                 -- toujours le 1er du mois
  status text not null default 'current' check (status in ('current','closed')),
  starting_balance_override numeric,         -- pour recaler sur la banque si besoin
  real_balance_check numeric,                -- dernier solde réel saisi (rapprochement)
  created_at timestamptz not null default now(),
  constraint months_account_month_key unique (account_id, month_date) -- un mois par compte
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

-- Rattachement automatique : une ligne insérée sans account_id est rattachée au plus ancien compte
-- actif de l'utilisateur ; s'il n'a encore aucun compte, un "Compte principal" est créé.
create or replace function assign_default_account() returns trigger
language plpgsql as $$
begin
  if new.account_id is null then
    select a.id into new.account_id
      from accounts a
     where a.user_id = new.user_id and a.status = 'active'
     order by a.created_at, a.id
     limit 1;

    if new.account_id is null then
      if exists (select 1 from accounts a where a.user_id = new.user_id) then
        raise exception 'Aucun compte actif : choisis un compte pour cette opération.';
      end if;
      insert into accounts (user_id, name, kind)
      values (new.user_id, 'Compte principal', 'checking')
      returning id into new.account_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists months_assign_account on months;
create trigger months_assign_account
  before insert on months
  for each row execute function assign_default_account();

drop trigger if exists fixed_expenses_assign_account on fixed_expenses;
create trigger fixed_expenses_assign_account
  before insert on fixed_expenses
  for each row execute function assign_default_account();

create index if not exists idx_accounts_user on accounts(user_id);
create index if not exists idx_fixed_expenses_user on fixed_expenses(user_id);
create index if not exists idx_fixed_expenses_account on fixed_expenses(account_id);
create index if not exists idx_months_user on months(user_id);
create index if not exists idx_months_account on months(account_id);
create index if not exists idx_transactions_user on transactions(user_id);
create index if not exists idx_transactions_month on transactions(month_id);
create index if not exists idx_categories_user on categories(user_id);

-- ============================================================
-- Row Level Security : chacun ne voit et ne modifie que ses données
-- ============================================================
alter table user_settings enable row level security;
alter table accounts enable row level security;
alter table categories enable row level security;
alter table fixed_expenses enable row level security;
alter table months enable row level security;
alter table transactions enable row level security;

create policy "user_settings_owner" on user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Pas de politique DELETE pour les comptes : on les clôture, on ne les supprime pas.
create policy "accounts_select_owner" on accounts
  for select using (auth.uid() = user_id);
create policy "accounts_insert_owner" on accounts
  for insert with check (auth.uid() = user_id);
create policy "accounts_update_owner" on accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "categories_owner" on categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "fixed_expenses_owner" on fixed_expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "months_owner" on months
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "transactions_owner" on transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Budgets par catégorie et archivage : voir supabase/budgets.sql (à exécuter ensuite).
-- ============================================================

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
