# Suivi Budget

Application web (Angular + Supabase) pour suivre tes dépenses fixes, dépenses
variables et revenus mois par mois — pensée pour remplacer le fichier Excel.

Principes clés :

- **Rien n'est jamais rétroactif.** Le "Référentiel" des dépenses fixes est un
  modèle. Quand tu cliques sur *Nouveau mois*, les dépenses fixes actives sont
  **copiées** (montant, catégorie...) dans le nouveau mois. Modifier le
  référentiel après coup ne change jamais un mois déjà créé.
- **"Clôturé" est juste une étiquette.** Aucun mois n'est verrouillé : tu peux
  toujours revenir corriger un mois passé, même des semaines après.
- **Le solde se reporte automatiquement** d'un mois sur l'autre (solde de fin
  du mois N = solde de départ du mois N+1), avec possibilité de forcer une
  valeur pour recaler sur ton compte en banque réel.
- **Multi-appareils** : PC, téléphone, tablette — tout est stocké dans
  Supabase (Postgres) derrière un compte utilisateur, avec sécurité au niveau
  des lignes (RLS) : chacun ne voit que ses propres données.

## 1. Créer le projet Supabase (une seule fois)

1. Va sur [supabase.com](https://supabase.com), crée un compte et un nouveau
   projet (gratuit).
2. Dans **SQL Editor**, colle le contenu de `supabase/schema.sql` et clique
   sur *Run*. Ça crée toutes les tables, les index et les règles de sécurité
   (RLS).
3. Dans **Project Settings > API**, récupère :
   - *Project URL*
   - *anon public* key
4. Dans **Authentication > Providers**, l'authentification par email est
   activée par défaut. Tu peux désactiver "Confirm email" dans
   **Authentication > Settings** si tu veux te connecter immédiatement après
   inscription sans passer par un mail de confirmation (recommandé pour un
   usage perso).

## 2. Configurer l'application

Ouvre `src/environments/environment.ts` (et `environment.prod.ts`) et
remplace :

```ts
export const environment = {
  production: false,
  supabaseUrl: 'https://VOTRE-PROJET.supabase.co',
  supabaseAnonKey: 'VOTRE_CLE_ANON_PUBLIC',
};
```

par les vraies valeurs récupérées à l'étape 1.

## 3. Installer et lancer

```bash
npm install
npm start        # dev, http://localhost:4200
# ou
npm run build     # build de production dans dist/budget-app
```

La première connexion (bouton "Créer un compte" sur l'écran de connexion)
crée ton compte Supabase et un jeu de catégories par défaut.

Pour héberger l'app (Vercel, Netlify, GitHub Pages...), déploie simplement le
contenu de `dist/budget-app/browser` après `npm run build`.

## 4. Importer tes données depuis l'ancien fichier Excel

Un script Python convertit le fichier `.xlsm` en JSON, sans jamais le
modifier :

```bash
pip install --break-system-packages openpyxl   # une seule fois
python3 scripts/excel_to_json.py "Suivi_Budget.xlsm"
# -> écrit Suivi_Budget.import.json à côté du fichier Excel
```

Ensuite, dans l'application : **Réglages > Importer depuis Excel**,
sélectionne le fichier `.json` généré. Les catégories, dépenses fixes, mois
et transactions sont créés dans Supabase (les catégories et mois déjà
existants ne sont pas dupliqués).

Le script part de la structure du fichier livré par Claude (tables Excel
`TableFixes` / `TableSoldes` / `Tableau1`, liste des catégories en colonne H
de l'onglet Référentiel_Fixes). Si ton fichier a une structure différente,
vérifie le JSON produit avant de l'importer.

## 4bis. Héberger sur Vercel (gratuit)

Le fichier `vercel.json` à la racine est déjà prêt (build Angular + redirection
de toutes les routes vers `index.html`, nécessaire pour le routing côté
client). Aucune variable d'environnement à configurer sur Vercel : les clés
Supabase sont déjà compilées dans le code (elles sont faites pour être
publiques, c'est la sécurité RLS côté Supabase qui protège tes données, pas
cette clé).

1. Va sur [vercel.com](https://vercel.com), connecte toi avec ton compte
   GitHub.
2. *Add New > Project*, sélectionne le repo `finance-pro`.
3. Vercel détecte automatiquement `vercel.json` : laisse les réglages par
   défaut et clique sur *Deploy*.
4. Tu obtiens une URL type `finance-pro.vercel.app`, accessible depuis PC et
   téléphone. Chaque nouveau `git push` sur `main` redéploie automatiquement.

## 5. Structure du projet

```
src/app/
  core/
    models/          interfaces TypeScript (Category, Transaction, ...)
    services/
      supabase.service.ts   client Supabase + session/auth
      data.service.ts       état de l'app (signals), CRUD, calculs, import
      calc.ts                fonctions pures (résumé de mois, taux d'épargne...)
      format.ts               formatage € et %
    guards/
      auth.guard.ts          protège les pages, redirige vers /connexion
  features/
    auth/            écran de connexion / inscription
    shell/            barre de navigation + mise en page commune
    mois/              vue principale : le mois en cours, transactions, solde
    dashboard/        graphiques (Chart.js)
    fixed-expenses/    référentiel des dépenses fixes
    categories/        gestion des catégories
    settings/           solde initial, déconnexion, import Excel
supabase/
  schema.sql          schéma Postgres + RLS à exécuter dans Supabase
scripts/
  excel_to_json.py     conversion Excel -> JSON pour import
```

## 6. Pour aller plus loin

- Ajouter un deuxième compte (par exemple pour Ophélia) : elle crée son
  propre compte via "Créer un compte" — RLS garantit que chacun ne voit que
  ses données. Un budget partagé entre deux comptes n'est pas géré pour
  l'instant (à ajouter si besoin, ex. un `household_id` commun).
- Les graphiques du Dashboard sont générés avec Chart.js directement (pas de
  librairie wrapper Angular, pour éviter un conflit de version avec
  Angular 19).
