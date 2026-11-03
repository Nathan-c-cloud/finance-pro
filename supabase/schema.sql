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

-- ============================================================
-- Virements entre comptes (étape 5) : identique à migrations/2026-11-03_accounts_04_transfers.sql.
-- Un virement = deux lignes de transactions reliées par transfer_id (sortie 'variable' + entrée 'income').
-- ============================================================

-- ------------------------------------------------------------
-- Colonnes : le lien entre les deux lignes et le compte "en face"
-- ------------------------------------------------------------
alter table transactions add column if not exists transfer_id uuid;
alter table transactions add column if not exists transfer_account_id uuid;

-- Le compte en face doit appartenir au même utilisateur (même garantie que pour les mois).
alter table transactions drop constraint if exists transactions_transfer_account_fk;
alter table transactions
  add constraint transactions_transfer_account_fk
  foreign key (transfer_account_id, user_id) references accounts (id, user_id);

alter table transactions drop constraint if exists transactions_transfer_consistent;
alter table transactions
  add constraint transactions_transfer_consistent
  check ((transfer_id is null) = (transfer_account_id is null) and (transfer_id is null or tx_date is not null));

create index if not exists idx_transactions_transfer on transactions(transfer_id) where transfer_id is not null;

-- Au plus une sortie et une entrée par virement.
create unique index if not exists uq_transactions_transfer_side
  on transactions (transfer_id, (type = 'income')) where transfer_id is not null;

-- ------------------------------------------------------------
-- Protection : le lien et le sens d'un virement ne se modifient pas
-- ------------------------------------------------------------
create or replace function guard_transfer_row() returns trigger
language plpgsql as $$
begin
  if old.transfer_id is not null or new.transfer_id is not null then
    if new.transfer_id is distinct from old.transfer_id
       or new.transfer_account_id is distinct from old.transfer_account_id
       or new.type is distinct from old.type then
      raise exception 'Le lien et le sens d''un virement ne peuvent pas être modifiés : supprime le virement et recrée le.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_guard_transfer on transactions;
create trigger transactions_guard_transfer
  before update on transactions
  for each row execute function guard_transfer_row();

-- ------------------------------------------------------------
-- Propagation : supprimer une ligne supprime l'autre
-- ------------------------------------------------------------
create or replace function propagate_transfer_delete() returns trigger
language plpgsql as $$
begin
  delete from transactions
   where transfer_id = old.transfer_id and user_id = old.user_id and id <> old.id;
  return old;
end;
$$;

drop trigger if exists transactions_transfer_delete on transactions;
create trigger transactions_transfer_delete
  after delete on transactions
  for each row when (old.transfer_id is not null)
  execute function propagate_transfer_delete();

-- ------------------------------------------------------------
-- Propagation : le montant et la date sont identiques des deux côtés
-- ------------------------------------------------------------
create or replace function propagate_transfer_update() returns trigger
language plpgsql as $$
begin
  update transactions
     set amount = new.amount,
         tx_date = new.tx_date,
         -- côté entrée, "reçu" suit la date : un virement daté d'aujourd'hui ou avant est arrivé
         received = case when type = 'income' then new.tx_date <= current_date else received end
   where transfer_id = new.transfer_id
     and user_id = new.user_id
     and id <> new.id
     and (amount is distinct from new.amount or tx_date is distinct from new.tx_date);
  return new;
end;
$$;

drop trigger if exists transactions_transfer_update on transactions;
create trigger transactions_transfer_update
  after update of amount, tx_date on transactions
  for each row
  when (new.transfer_id is not null and (old.amount is distinct from new.amount or old.tx_date is distinct from new.tx_date))
  execute function propagate_transfer_update();

-- ------------------------------------------------------------
-- Création atomique d'un virement (les deux lignes, ou rien)
-- ------------------------------------------------------------
-- p_from_month : le mois du compte qui envoie, dans lequel la sortie est saisie.
-- Le mois correspondant (même mois) du compte qui reçoit est créé s'il n'existe pas, vide, ainsi que
-- les mois qui manquent entre son dernier mois et celui là. Avant le premier mois du compte qui reçoit,
-- le virement est refusé : ce compte n'existait pas encore dans le suivi.
create or replace function create_transfer(
  p_from_month uuid,
  p_to_account uuid,
  p_amount numeric,
  p_date date,
  p_name text default null,
  p_detail text default null
) returns uuid
language plpgsql as $$
declare
  v_uid uuid := auth.uid();
  v_from_month months%rowtype;
  v_from_account accounts%rowtype;
  v_to_account accounts%rowtype;
  v_to_month_id uuid;
  v_first date;
  v_transfer uuid := gen_random_uuid();
begin
  if v_uid is null then raise exception 'Non connecté.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Le montant du virement doit être positif.'; end if;
  if p_date is null then raise exception 'La date du virement est obligatoire.'; end if;

  select * into v_from_month from months where id = p_from_month and user_id = v_uid;
  if not found then raise exception 'Mois introuvable.'; end if;

  select * into v_from_account from accounts where id = v_from_month.account_id and user_id = v_uid;
  select * into v_to_account from accounts where id = p_to_account and user_id = v_uid;
  if v_to_account.id is null then raise exception 'Compte de destination introuvable.'; end if;
  if v_from_account.id = v_to_account.id then raise exception 'Choisis un autre compte que celui d''où part le virement.'; end if;
  if v_from_account.status <> 'active' or v_to_account.status <> 'active' then
    raise exception 'Un compte clôturé ne peut plus envoyer ni recevoir de virement.';
  end if;

  select min(month_date) into v_first from months where account_id = v_to_account.id and user_id = v_uid;
  if v_first is null then raise exception 'Le compte « % » n''a encore aucun mois.', v_to_account.name; end if;
  if v_from_month.month_date < v_first then
    raise exception 'Le compte « % » démarre en %. Impossible d''y recevoir un virement avant.',
      v_to_account.name, to_char(v_first, 'MM/YYYY');
  end if;

  -- Mois manquants du compte qui reçoit, jusqu'au mois du virement (vides, comme un mois neuf).
  insert into months (user_id, account_id, month_date, status)
  select v_uid, v_to_account.id, d::date, 'closed'
    from generate_series(v_first, v_from_month.month_date, interval '1 month') as d
  on conflict (account_id, month_date) do nothing;

  select id into v_to_month_id from months
   where account_id = v_to_account.id and month_date = v_from_month.month_date and user_id = v_uid;

  insert into transactions (user_id, month_id, type, name, amount, category_id, tx_date, detail, necessary, received,
                            transfer_id, transfer_account_id)
  values (v_uid, v_from_month.id, 'variable',
          coalesce(nullif(btrim(p_name), ''), 'Virement vers ' || v_to_account.name),
          p_amount, null, p_date, nullif(btrim(p_detail), ''), null, null,
          v_transfer, v_to_account.id);

  insert into transactions (user_id, month_id, type, name, amount, category_id, tx_date, detail, necessary, received,
                            transfer_id, transfer_account_id)
  values (v_uid, v_to_month_id, 'income',
          coalesce(nullif(btrim(p_name), ''), 'Virement depuis ' || v_from_account.name),
          p_amount, null, p_date, nullif(btrim(p_detail), ''), null, p_date <= current_date,
          v_transfer, v_from_account.id);

  return v_transfer;
end;
$$;

grant execute on function create_transfer(uuid, uuid, numeric, date, text, text) to authenticated;

-- ============================================================
-- Dépenses fixes qui sont des virements (étape 8) : identique à migrations/2026-11-03_accounts_05_fixed_transfers.sql.
-- ============================================================

-- ------------------------------------------------------------
-- Dépenses fixes : compte de destination (facultatif)
-- ------------------------------------------------------------
alter table fixed_expenses add column if not exists transfer_account_id uuid;

-- Le compte de destination doit appartenir au même utilisateur (même garantie que pour les mois).
alter table fixed_expenses drop constraint if exists fixed_expenses_transfer_account_fk;
alter table fixed_expenses
  add constraint fixed_expenses_transfer_account_fk
  foreign key (transfer_account_id, user_id) references accounts (id, user_id);

-- Un virement fixe va vers un AUTRE compte et a besoin d'un jour de prélèvement (un virement a toujours une date).
alter table fixed_expenses drop constraint if exists fixed_expenses_transfer_consistent;
alter table fixed_expenses
  add constraint fixed_expenses_transfer_consistent
  check (transfer_account_id is null or (transfer_account_id <> account_id and payment_day is not null));

-- ------------------------------------------------------------
-- create_transfer : la sortie peut être de type 'fixed' (virement issu d'une dépense fixe)
-- ------------------------------------------------------------
drop function if exists create_transfer(uuid, uuid, numeric, date, text, text);

create or replace function create_transfer(
  p_from_month uuid,
  p_to_account uuid,
  p_amount numeric,
  p_date date,
  p_name text default null,
  p_detail text default null,
  p_out_type text default 'variable'
) returns uuid
language plpgsql as $$
declare
  v_uid uuid := auth.uid();
  v_from_month months%rowtype;
  v_from_account accounts%rowtype;
  v_to_account accounts%rowtype;
  v_to_month_id uuid;
  v_first date;
  v_transfer uuid := gen_random_uuid();
begin
  if v_uid is null then raise exception 'Non connecté.'; end if;
  if p_out_type not in ('variable', 'fixed') then raise exception 'Type de virement inconnu.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Le montant du virement doit être positif.'; end if;
  if p_date is null then raise exception 'La date du virement est obligatoire.'; end if;

  select * into v_from_month from months where id = p_from_month and user_id = v_uid;
  if not found then raise exception 'Mois introuvable.'; end if;

  select * into v_from_account from accounts where id = v_from_month.account_id and user_id = v_uid;
  select * into v_to_account from accounts where id = p_to_account and user_id = v_uid;
  if v_to_account.id is null then raise exception 'Compte de destination introuvable.'; end if;
  if v_from_account.id = v_to_account.id then raise exception 'Choisis un autre compte que celui d''où part le virement.'; end if;
  if v_from_account.status <> 'active' or v_to_account.status <> 'active' then
    raise exception 'Un compte clôturé ne peut plus envoyer ni recevoir de virement.';
  end if;

  select min(month_date) into v_first from months where account_id = v_to_account.id and user_id = v_uid;
  if v_first is null then raise exception 'Le compte « % » n''a encore aucun mois.', v_to_account.name; end if;
  if v_from_month.month_date < v_first then
    raise exception 'Le compte « % » démarre en %. Impossible d''y recevoir un virement avant.',
      v_to_account.name, to_char(v_first, 'MM/YYYY');
  end if;

  -- Mois manquants du compte qui reçoit, jusqu'au mois du virement (vides, comme un mois neuf).
  insert into months (user_id, account_id, month_date, status)
  select v_uid, v_to_account.id, d::date, 'closed'
    from generate_series(v_first, v_from_month.month_date, interval '1 month') as d
  on conflict (account_id, month_date) do nothing;

  select id into v_to_month_id from months
   where account_id = v_to_account.id and month_date = v_from_month.month_date and user_id = v_uid;

  insert into transactions (user_id, month_id, type, name, amount, category_id, tx_date, detail, necessary, received,
                            transfer_id, transfer_account_id)
  values (v_uid, v_from_month.id, p_out_type,
          coalesce(nullif(btrim(p_name), ''), 'Virement vers ' || v_to_account.name),
          p_amount, null, p_date, nullif(btrim(p_detail), ''), null, null,
          v_transfer, v_to_account.id);

  insert into transactions (user_id, month_id, type, name, amount, category_id, tx_date, detail, necessary, received,
                            transfer_id, transfer_account_id)
  values (v_uid, v_to_month_id, 'income',
          coalesce(nullif(btrim(p_name), ''), 'Virement depuis ' || v_from_account.name),
          p_amount, null, p_date, nullif(btrim(p_detail), ''), null, p_date <= current_date,
          v_transfer, v_from_account.id);

  return v_transfer;
end;
$$;

grant execute on function create_transfer(uuid, uuid, numeric, date, text, text, text) to authenticated;
