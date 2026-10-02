-- Jour de prélèvement des dépenses fixes : devient facultatif (vide = la transaction est ajoutée sans date)
-- et accepte tous les jours de 1 à 31 (avant : obligatoire, de 1 à 28, 1 par défaut).
-- À exécuter une fois dans Supabase : SQL Editor > New query > coller > Run.
-- Les jours déjà saisis sont conservés tels quels (y compris les 1 mis par défaut : à vider si ce n'était pas voulu).
alter table fixed_expenses alter column payment_day drop not null;
alter table fixed_expenses alter column payment_day drop default;
alter table fixed_expenses drop constraint if exists fixed_expenses_payment_day_check;
alter table fixed_expenses
  add constraint fixed_expenses_payment_day_check
  check (payment_day is null or payment_day between 1 and 31);
