import { Account, FixedExpense, MonthBudget, MonthRow, Transaction } from '../models/models';
import {
  ACCOUNT_NAME_MAX,
  accountNameError,
  budgetsOfMonths,
  fixedExpensesOfAccount,
  monthsOfAccount,
  pickCurrentAccount,
  pickMonthToShow,
  startMonthOptions,
  transactionsOfMonths,
} from './account-scope';

const account = (id: string, name: string, over: Partial<Account> = {}): Account =>
  ({
    id,
    user_id: 'u1',
    name,
    kind: 'checking',
    opening_balance: 0,
    opening_date: null,
    status: 'active',
    closed_at: null,
    created_at: `2026-01-0${id}T00:00:00Z`,
    ...over,
  }) as Account;

const month = (id: string, accountId: string, date: string, status: MonthRow['status'] = 'closed'): MonthRow => ({
  id,
  user_id: 'u1',
  account_id: accountId,
  month_date: date,
  status,
  starting_balance_override: null,
  real_balance_check: null,
});

describe('account-scope', () => {
  describe('pickCurrentAccount', () => {
    const a = account('1', 'BNP');
    const b = account('2', 'Trade Republic', { kind: 'savings' });

    it('retourne null sans compte', () => {
      expect(pickCurrentAccount([], null)).toBeNull();
    });

    it('reprend le compte mémorisé', () => {
      expect(pickCurrentAccount([a, b], '2')?.id).toBe('2');
    });

    it('ignore un identifiant mémorisé qui n\'existe plus et prend le plus ancien compte actif', () => {
      expect(pickCurrentAccount([b, a], 'inconnu')?.id).toBe('1');
    });

    it('préfère un compte actif à un compte clôturé plus ancien', () => {
      const closed = account('1', 'Ancien', { status: 'closed', closed_at: '2026-02-01T00:00:00Z' });
      expect(pickCurrentAccount([closed, b], null)?.id).toBe('2');
    });

    it('retombe sur le plus ancien compte si tous sont clôturés', () => {
      const c1 = account('1', 'A', { status: 'closed', closed_at: '2026-02-01T00:00:00Z' });
      const c2 = account('2', 'B', { status: 'closed', closed_at: '2026-02-01T00:00:00Z' });
      expect(pickCurrentAccount([c2, c1], null)?.id).toBe('1');
    });
  });

  describe('données par compte', () => {
    const m1 = month('m1', '1', '2026-02-01');
    const m0 = month('m0', '1', '2026-01-01');
    const m2 = month('m2', '2', '2026-01-01');
    const tx = (id: string, monthId: string) => ({ id, month_id: monthId }) as Transaction;
    const budget = (id: string, monthId: string) => ({ id, month_id: monthId }) as MonthBudget;
    const fixed = (id: string, accountId: string) => ({ id, account_id: accountId }) as FixedExpense;

    it('ne garde que les mois du compte, du plus ancien au plus récent', () => {
      expect(monthsOfAccount([m1, m2, m0], '1').map((m) => m.id)).toEqual(['m0', 'm1']);
    });

    it('ne renvoie aucun mois sans compte choisi', () => {
      expect(monthsOfAccount([m1, m2], null)).toEqual([]);
    });

    it('ne garde que les dépenses fixes du compte', () => {
      expect(fixedExpensesOfAccount([fixed('f1', '1'), fixed('f2', '2')], '2').map((f) => f.id)).toEqual(['f2']);
      expect(fixedExpensesOfAccount([fixed('f1', '1')], null)).toEqual([]);
    });

    it('rattache transactions et budgets au compte via leur mois', () => {
      const months = monthsOfAccount([m0, m1, m2], '1');
      const txs = [tx('t1', 'm0'), tx('t2', 'm2'), tx('t3', 'm1')];
      const budgets = [budget('b1', 'm2'), budget('b2', 'm1')];
      expect(transactionsOfMonths(txs, months).map((t) => t.id)).toEqual(['t1', 't3']);
      expect(budgetsOfMonths(budgets, months).map((b) => b.id)).toEqual(['b2']);
    });
  });

  describe('pickMonthToShow', () => {
    it('retourne null sans mois', () => {
      expect(pickMonthToShow([])).toBeNull();
    });

    it('prend le mois courant s\'il existe', () => {
      const months = [month('a', '1', '2026-01-01'), month('b', '1', '2026-02-01', 'current'), month('c', '1', '2026-03-01')];
      expect(pickMonthToShow(months)?.id).toBe('b');
    });

    it('sinon le plus récent', () => {
      const months = [month('a', '1', '2026-01-01'), month('b', '1', '2026-02-01')];
      expect(pickMonthToShow(months)?.id).toBe('b');
    });
  });

  describe('accountNameError', () => {
    const accounts = [account('1', 'BNP'), account('2', 'Épargne')];

    it('refuse un nom vide ou fait d\'espaces', () => {
      expect(accountNameError('', accounts)).toBeTruthy();
      expect(accountNameError('   ', accounts)).toBeTruthy();
    });

    it('refuse un nom trop long', () => {
      expect(accountNameError('x'.repeat(ACCOUNT_NAME_MAX + 1), accounts)).toBeTruthy();
      expect(accountNameError('x'.repeat(ACCOUNT_NAME_MAX), accounts)).toBeNull();
    });

    it('refuse un doublon sans tenir compte de la casse, des accents ni des espaces autour', () => {
      expect(accountNameError(' bnp ', accounts)).toBe('Un compte porte déjà ce nom.');
      expect(accountNameError('epargne', accounts)).toBe('Un compte porte déjà ce nom.');
    });

    it('accepte de garder son propre nom en renommant', () => {
      expect(accountNameError('BNP', accounts, '1')).toBeNull();
    });

    it('accepte un nom libre', () => {
      expect(accountNameError('Trade Republic', accounts)).toBeNull();
    });
  });

  describe('startMonthOptions', () => {
    it('liste les mois du plus récent au plus ancien', () => {
      const options = startMonthOptions(new Date(2026, 10, 3), 4);
      expect(options).toEqual(['2026-11-01', '2026-10-01', '2026-09-01', '2026-08-01']);
    });

    it('passe correctement une fin d\'année', () => {
      const options = startMonthOptions(new Date(2026, 1, 15), 3);
      expect(options).toEqual(['2026-02-01', '2026-01-01', '2025-12-01']);
    });

    it('en propose 36 par défaut', () => {
      expect(startMonthOptions(new Date(2026, 10, 3)).length).toBe(36);
    });
  });
});
