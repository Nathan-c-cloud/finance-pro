-- ============================================================
-- Multi-comptes, ÉTAPE 5 : virements entre comptes
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run.
-- Peut être relancé sans danger. Ne modifie ni ne supprime aucune donnée existante :
-- l'application actuellement en ligne continue de fonctionner sans changement.
--
-- Un virement = DEUX lignes dans "transactions", reliées par un identifiant commun (transfer_id) :
--   * une sortie (type 'variable') dans un mois du compte qui envoie ;
--   * une entrée (type 'income') dans le mois correspondant du compte qui reçoit.
-- Les deux lignes ont le même montant et la même date. Supprimer l'une supprime l'autre ;
-- changer le montant ou la date de l'une les change aussi sur l'autre (dans la base elle même,
-- donc quel que soit le côté modifié ou l'écran utilisé).
-- ============================================================

begin;

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

-- ------------------------------------------------------------
-- Contrôle final : si quelque chose ne va pas, tout est annulé.
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'create_transfer') then
    raise exception 'create_transfer absente : migration annulée.';
  end if;
  if exists (select 1 from transactions where transfer_id is not null) then
    -- Ne doit jamais arriver à la première exécution (rien n'écrit transfer_id avant ce script).
    raise notice 'Des virements existent déjà : relance détectée, rien d''autre n''a été modifié.';
  end if;
end $$;

commit;
