-- ============================================================
-- Multi-comptes, ÉTAPE 1 : sauvegarde AVANT la migration
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run.
-- À lancer AVANT 2026-11-03_accounts_02_migration.sql.
--
-- Ce script copie toutes les tables de l'application dans un schéma séparé
-- "backup_20261103". Un schéma à part n'est PAS exposé par l'API Supabase :
-- les copies ne sont donc lisibles que depuis le SQL Editor (jamais depuis
-- l'application ni depuis internet), contrairement à des tables copiées dans
-- "public" qui seraient sans protection RLS.
--
-- Ce n'est pas une sauvegarde hors de Supabase : en plus, fais un export
-- Excel depuis l'application (Réglages) et garde le fichier de côté.
-- ============================================================

create schema if not exists backup_20261103;
revoke all on schema backup_20261103 from anon, authenticated;

create table if not exists backup_20261103.user_settings   as table public.user_settings;
create table if not exists backup_20261103.categories      as table public.categories;
create table if not exists backup_20261103.fixed_expenses  as table public.fixed_expenses;
create table if not exists backup_20261103.months          as table public.months;
create table if not exists backup_20261103.transactions    as table public.transactions;

-- month_budgets n'existe que si supabase/budgets.sql a été exécuté.
do $$
begin
  if to_regclass('public.month_budgets') is not null then
    execute 'create table if not exists backup_20261103.month_budgets as table public.month_budgets';
  end if;
end $$;

-- Vérification : chaque ligne doit afficher le même nombre à gauche et à droite.
select 'user_settings' as table_name,
       (select count(*) from public.user_settings)  as live_rows,
       (select count(*) from backup_20261103.user_settings) as backup_rows
union all select 'categories',
       (select count(*) from public.categories),
       (select count(*) from backup_20261103.categories)
union all select 'fixed_expenses',
       (select count(*) from public.fixed_expenses),
       (select count(*) from backup_20261103.fixed_expenses)
union all select 'months',
       (select count(*) from public.months),
       (select count(*) from backup_20261103.months)
union all select 'transactions',
       (select count(*) from public.transactions),
       (select count(*) from backup_20261103.transactions);

-- ------------------------------------------------------------
-- Pour tout annuler plus tard (à n'utiliser qu'en cas de problème) :
--   1. vider les tables publiques dans cet ordre :
--        delete from public.transactions; delete from public.months;
--        delete from public.fixed_expenses;
--   2. les recopier depuis le schéma de sauvegarde :
--        insert into public.months         select * from backup_20261103.months;
--        insert into public.fixed_expenses select * from backup_20261103.fixed_expenses;
--        insert into public.transactions   select * from backup_20261103.transactions;
--   (les colonnes ajoutées par la migration, comme account_id, ne sont pas dans
--    la sauvegarde : retirer d'abord la migration, ou demander de l'aide avant.)
-- Quand tout est validé (plusieurs semaines), supprimer la sauvegarde :
--   drop schema backup_20261103 cascade;
-- ------------------------------------------------------------
