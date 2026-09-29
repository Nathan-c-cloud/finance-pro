-- Nouvelles fréquences de dépenses fixes : tous les 2 mois, trimestrielle, semestrielle.
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run.
-- (Les données existantes 'monthly' et 'annual' restent valides.)
alter table fixed_expenses drop constraint if exists fixed_expenses_frequency_check;
alter table fixed_expenses
  add constraint fixed_expenses_frequency_check
  check (frequency in ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual'));
