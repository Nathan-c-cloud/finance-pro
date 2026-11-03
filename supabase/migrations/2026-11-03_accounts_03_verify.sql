-- ============================================================
-- Multi-comptes : vérifications APRÈS la migration (lecture seule, ne modifie rien)
-- À exécuter dans Supabase : SQL Editor > New query > coller > Run.
-- ============================================================

-- 1. Les comptes créés : un par utilisateur, avec son solde de départ et son mois de départ.
select id, user_id, name, kind, opening_balance, opening_date, status
  from accounts
 order by created_at;

-- 2. Rien ne doit être orphelin : les deux nombres doivent être 0.
select (select count(*) from months         where account_id is null) as mois_sans_compte,
       (select count(*) from fixed_expenses where account_id is null) as depenses_fixes_sans_compte;

-- 3. Les données n'ont pas changé : même nombre de lignes qu'avant la migration (colonnes de gauche
--    = maintenant, colonnes de droite = sauvegarde). Chaque ligne doit montrer deux nombres identiques.
select 'months' as table_name,
       (select count(*) from months) as maintenant,
       (select count(*) from backup_20261103.months) as sauvegarde
union all select 'fixed_expenses',
       (select count(*) from fixed_expenses),
       (select count(*) from backup_20261103.fixed_expenses)
union all select 'transactions',
       (select count(*) from transactions),
       (select count(*) from backup_20261103.transactions)
union all select 'transactions : somme des montants',
       (select coalesce(sum(amount), 0) from transactions),
       (select coalesce(sum(amount), 0) from backup_20261103.transactions);

-- 4. Sécurité : toutes les tables de l'application doivent avoir la RLS activée (rls_enabled = true).
select tablename, rowsecurity as rls_enabled
  from pg_tables
 where schemaname = 'public'
   and tablename in ('accounts', 'categories', 'fixed_expenses', 'months',
                     'transactions', 'month_budgets', 'user_settings')
 order by tablename;

-- 5. Sécurité : la liste des règles. "accounts" doit avoir select / insert / update, mais PAS delete.
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;

-- 6. Le solde de départ du premier compte doit être égal au solde initial des réglages.
select a.name,
       a.opening_balance as solde_depart_compte,
       s.initial_balance as solde_initial_reglages
  from accounts a
  left join user_settings s on s.user_id = a.user_id;
