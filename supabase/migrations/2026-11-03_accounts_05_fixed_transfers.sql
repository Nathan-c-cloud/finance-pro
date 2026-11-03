-- ============================================================
-- Multi-comptes, ÉTAPE 8 : dépenses fixes qui sont des virements
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run,
-- APRÈS 2026-11-03_accounts_04_transfers.sql.
-- Peut être relancé sans danger. Ne modifie ni ne supprime aucune donnée existante :
-- l'application actuellement en ligne continue de fonctionner sans changement.
--
-- Une dépense fixe du référentiel peut désigner un compte de destination (transfer_account_id).
-- Quand elle est ajoutée à un mois, l'application crée alors un virement (sortie fixe sur ce compte,
-- entrée sur le compte de destination) au lieu d'une simple dépense.
-- ============================================================

begin;

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

-- ------------------------------------------------------------
-- Contrôle final : si quelque chose ne va pas, tout est annulé.
-- ------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_proc where proname = 'create_transfer') <> 1 then
    raise exception 'create_transfer doit exister en un seul exemplaire : migration annulée.';
  end if;
end $$;

commit;
