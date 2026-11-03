-- ============================================================
-- Multi-comptes, ÉTAPES 2 et 3 : modèle de comptes + rattachement de l'existant
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run,
-- APRÈS 2026-11-03_accounts_01_backup.sql.
--
-- Tout est dans une seule transaction : si quoi que ce soit échoue (y compris
-- le contrôle final), RIEN n'est modifié. Le script peut être relancé sans danger.
--
-- Ce que ça fait :
--   * crée la table "accounts" (un compte bancaire : nom, type, solde de départ, statut) ;
--   * rattache les mois et les dépenses fixes à un compte (account_id) ;
--   * crée un premier compte et y rattache TOUT l'existant, sans rien modifier d'autre ;
--   * l'application actuellement en ligne continue de fonctionner sans changement :
--     tout ce qu'elle crée est rattaché automatiquement au premier compte actif.
--
-- Les transactions et les budgets par mois n'ont pas d'account_id : ils sont rattachés
-- à un mois, donc au compte de ce mois. Aucune donnée existante n'est modifiée ni supprimée.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Réglage à changer si besoin : le nom du premier compte (renommable plus tard).
-- ------------------------------------------------------------
create temp table _migration_params (first_account_name text not null) on commit drop;
insert into _migration_params values ('BNP');

-- ------------------------------------------------------------
-- ÉTAPE 2a : table des comptes
-- ------------------------------------------------------------
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  -- Étiquette choisie librement par l'utilisateur : c'est lui qui décide de l'usage d'un compte
  -- (ex. un compte Trade Republic utilisé comme épargne). Modifiable plus tard.
  kind text not null default 'checking' check (kind in ('checking', 'savings')),
  opening_balance numeric not null default 0, -- solde de départ du suivi de ce compte (sans origine)
  opening_date date,                          -- information : mois de départ du suivi (le 1er du mois)
  status text not null default 'active' check (status in ('active', 'closed')),
  closed_at date,
  created_at timestamptz not null default now(),
  unique (user_id, name),
  -- Cible des clés étrangères composites ci dessous : garantit qu'un mois ou une dépense fixe
  -- ne peut jamais être rattaché au compte d'un AUTRE utilisateur.
  constraint accounts_id_user_key unique (id, user_id),
  constraint accounts_closed_consistent check ((status = 'closed') = (closed_at is not null))
);

create index if not exists idx_accounts_user on accounts(user_id);

alter table accounts enable row level security;

-- Pas de politique DELETE volontairement : un compte ne se supprime pas, il se clôture.
drop policy if exists "accounts_select_owner" on accounts;
drop policy if exists "accounts_insert_owner" on accounts;
drop policy if exists "accounts_update_owner" on accounts;
create policy "accounts_select_owner" on accounts
  for select using (auth.uid() = user_id);
create policy "accounts_insert_owner" on accounts
  for insert with check (auth.uid() = user_id);
create policy "accounts_update_owner" on accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- ÉTAPE 2b : account_id sur les mois et les dépenses fixes (nullable le temps du rattachement)
-- ------------------------------------------------------------
alter table months         add column if not exists account_id uuid;
alter table fixed_expenses add column if not exists account_id uuid;

-- ------------------------------------------------------------
-- ÉTAPE 2c : rattachement automatique pour l'application actuelle
-- Une ligne insérée sans account_id (ancienne version de l'app) est rattachée au plus ancien
-- compte actif de l'utilisateur ; s'il n'a encore aucun compte (nouvelle inscription), un
-- "Compte principal" est créé. S'il n'a que des comptes clôturés, l'insertion est refusée.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- ÉTAPE 3 : rattachement de l'existant
-- Un compte par utilisateur qui a déjà des données. Son solde de départ reprend le solde initial
-- actuel (réglages) et son mois de départ est son premier mois. Rien d'autre n'est modifié.
-- ------------------------------------------------------------
insert into accounts (user_id, name, kind, opening_balance, opening_date)
select u.user_id,
       (select first_account_name from _migration_params),
       'checking',
       coalesce((select s.initial_balance from user_settings s where s.user_id = u.user_id), 0),
       (select min(m.month_date) from months m where m.user_id = u.user_id)
  from (
    select user_id from user_settings
    union select user_id from months
    union select user_id from fixed_expenses
  ) u
 where not exists (select 1 from accounts a where a.user_id = u.user_id);

update months m
   set account_id = (select a.id from accounts a
                      where a.user_id = m.user_id and a.status = 'active'
                      order by a.created_at, a.id limit 1)
 where m.account_id is null;

update fixed_expenses f
   set account_id = (select a.id from accounts a
                      where a.user_id = f.user_id and a.status = 'active'
                      order by a.created_at, a.id limit 1)
 where f.account_id is null;

-- ------------------------------------------------------------
-- Contraintes définitives (après le rattachement)
-- ------------------------------------------------------------
alter table months         alter column account_id set not null;
alter table fixed_expenses alter column account_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'months_account_fk') then
    alter table months add constraint months_account_fk
      foreign key (account_id, user_id) references accounts (id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fixed_expenses_account_fk') then
    alter table fixed_expenses add constraint fixed_expenses_account_fk
      foreign key (account_id, user_id) references accounts (id, user_id);
  end if;
end $$;

-- Un mois n'est plus unique par utilisateur mais par compte : chaque compte a sa propre chronologie.
alter table months drop constraint if exists months_user_id_month_date_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'months_account_month_key') then
    alter table months add constraint months_account_month_key unique (account_id, month_date);
  end if;
end $$;

create index if not exists idx_months_account on months(account_id);
create index if not exists idx_fixed_expenses_account on fixed_expenses(account_id);

-- ------------------------------------------------------------
-- Contrôle final : si une ligne reste sans compte, ou si un compte n'appartient pas au
-- bon utilisateur, la transaction entière est annulée et rien n'est modifié.
-- ------------------------------------------------------------
do $$
declare
  orphan_months int;
  orphan_fixed int;
  users_without_account int;
begin
  select count(*) into orphan_months from months where account_id is null;
  select count(*) into orphan_fixed  from fixed_expenses where account_id is null;
  select count(*) into users_without_account
    from (select user_id from months union select user_id from fixed_expenses) u
   where not exists (select 1 from accounts a where a.user_id = u.user_id);

  if orphan_months > 0 or orphan_fixed > 0 or users_without_account > 0 then
    raise exception 'Migration annulée : % mois, % dépenses fixes sans compte, % utilisateurs sans compte.',
      orphan_months, orphan_fixed, users_without_account;
  end if;
end $$;

commit;
