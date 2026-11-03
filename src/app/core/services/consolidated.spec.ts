import { Account, Category, MonthRow, Transaction } from '../models/models';
import { balanceAt, consolidate } from './consolidated';
import { buildAccountSummaries } from './summaries';

const acc = (id: string, name: string, kind: Account['kind'], opening: number, over: Partial<Account> = {}): Account =>
  ({ id, user_id: 'u', name, kind, opening_balance: opening, opening_date: null, status: 'active', closed_at: null, created_at: `2026-01-0${id.length}T00:00:00Z`, ...over }) as Account;

const month = (id: string, accountId: string, date: string): MonthRow => ({
  id, user_id: 'u', account_id: accountId, month_date: date, status: 'closed', starting_balance_override: null, real_balance_check: null,
});

let n = 0;
const tx = (monthId: string, over: Partial<Transaction>): Transaction => ({
  id: `t${n++}`, user_id: 'u', month_id: monthId, type: 'variable', name: 'x', amount: 0, category_id: null, tx_date: '2026-11-02',
  detail: null, necessary: null, received: null, ...over,
});

const cats: Category[] = [{ id: 'cat-e', name: 'Épargne' } as Category];
const BNP = acc('b', 'BNP', 'checking', 1000);
const TR = acc('tr', 'Trade Republic', 'savings', 500);
const savingsIds = new Set([TR.id]);

/** Construit les résumés de chaque compte comme le fait le DataService. */
function build(accounts: Account[], months: MonthRow[], txs: Transaction[], savingsFlows = new Map<string, Map<string, number>>()) {
  const map = new Map<string, ReturnType<typeof buildAccountSummaries>>();
  for (const a of accounts) {
    const ms = months.filter((m) => m.account_id === a.id).sort((x, y) => x.month_date.localeCompare(y.month_date));
    const ids = new Set(ms.map((m) => m.id));
    map.set(a.id, buildAccountSummaries({
      account: a, months: ms, transactions: txs.filter((t) => ids.has(t.month_id)), categories: cats,
      savingsAccountIds: savingsIds, savingsFlows: savingsFlows.get(a.id) ?? new Map(),
    }));
  }
  return map;
}

describe('vue Tous les comptes', () => {
  const today = new Date(2026, 10, 15); // novembre 2026

  it('un virement entre deux comptes ne change pas le solde total', () => {
    const months = [month('mb', BNP.id, '2026-11-01'), month('mt', TR.id, '2026-11-01')];
    const txs = [
      tx('mb', { type: 'income', amount: 2000, received: true }),
      tx('mb', { amount: 100, transfer_id: 'x', transfer_account_id: TR.id }),
      tx('mt', { type: 'income', amount: 100, transfer_id: 'x', transfer_account_id: BNP.id, received: true }),
    ];
    const c = consolidate([BNP, TR], build([BNP, TR], months, txs), today);
    expect(c.totalBalance).toBe(1000 + 2000 + 500); // 3500 : le virement s'annule entre les deux comptes
    expect(c.accounts.find((a) => a.account.id === BNP.id)!.balance).toBe(2900);
    expect(c.accounts.find((a) => a.account.id === TR.id)!.balance).toBe(600);
    expect(c.savingsBalance).toBe(600);
  });

  it('le taux d\'épargne global compte les revenus et l\'épargne des comptes courants, virements vers l\'épargne compris', () => {
    const months = [month('mb', BNP.id, '2026-11-01'), month('mt', TR.id, '2026-11-01')];
    const txs = [
      tx('mb', { type: 'income', amount: 2000, received: true }),
      tx('mb', { amount: 100, transfer_id: 'x', transfer_account_id: TR.id }),
      tx('mt', { type: 'income', amount: 100, transfer_id: 'x', transfer_account_id: BNP.id, received: true }),
    ];
    const c = consolidate([BNP, TR], build([BNP, TR], months, txs), today);
    expect(c.current!.income).toBe(2000);
    expect(c.current!.savings).toBe(100);
    expect(c.current!.savingsRate).toBeCloseTo(0.05);
  });

  it('un virement entre deux comptes courants n\'est ni revenu ni dépense ni épargne', () => {
    const CHK2 = acc('c2', 'Autre', 'checking', 0);
    const months = [month('mb', BNP.id, '2026-11-01'), month('m2', CHK2.id, '2026-11-01')];
    const txs = [
      tx('mb', { type: 'income', amount: 2000, received: true }),
      tx('mb', { amount: 300, transfer_id: 'y', transfer_account_id: CHK2.id }),
      tx('m2', { type: 'income', amount: 300, transfer_id: 'y', transfer_account_id: BNP.id, received: true }),
    ];
    const c = consolidate([BNP, CHK2], build([BNP, CHK2], months, txs), today);
    expect(c.current!.income).toBe(2000);
    expect(c.current!.expensesExcludingSavings).toBe(0);
    expect(c.current!.savings).toBe(0);
    expect(c.totalBalance).toBe(3000);
  });

  it('une dépense directe sur l\'épargne baisse l\'épargne globale, une seule fois', () => {
    const months = [month('mb', BNP.id, '2026-11-01'), month('mt', TR.id, '2026-11-01')];
    const txs = [
      tx('mb', { type: 'income', amount: 2000, received: true }),
      tx('mt', { amount: 20 }), // dépense directe sur Trade Republic
    ];
    const flows = new Map([[BNP.id, new Map([['2026-11-01', -20]])]]);
    const c = consolidate([BNP, TR], build([BNP, TR], months, txs, flows), today);
    expect(c.current!.savings).toBe(-20);
    expect(c.accounts.find((a) => a.account.id === TR.id)!.balance).toBe(480);
  });

  it('un compte clôturé sort du total mais son historique reste dans les revenus', () => {
    const OLD = acc('old', 'Ancien', 'checking', 100, { status: 'closed', closed_at: '2026-10-31' });
    const months = [month('mo', OLD.id, '2026-10-01'), month('mb', BNP.id, '2026-10-01'), month('mb2', BNP.id, '2026-11-01')];
    const txs = [tx('mo', { type: 'income', amount: 500, received: true })];
    const c = consolidate([OLD, BNP], build([OLD, BNP], months, txs), today);
    expect(c.accounts.map((a) => a.account.id)).toEqual([BNP.id]);
    expect(c.totalBalance).toBe(1000);
    expect(c.months.find((m) => m.monthDate === '2026-10-01')!.income).toBe(500);
  });

  it('un compte qui démarre plus tard compte 0 avant son premier mois, puis son solde de départ', () => {
    const months = [month('mb1', BNP.id, '2026-10-01'), month('mb2', BNP.id, '2026-11-01'), month('mt', TR.id, '2026-11-01')];
    const c = consolidate([BNP, TR], build([BNP, TR], months, []), today);
    expect(c.months.map((m) => m.totalBalance)).toEqual([1000, 1500]);
  });

  it('les mois sans donnée entre deux mois connus gardent les soldes reportés', () => {
    const months = [month('a', BNP.id, '2026-09-01'), month('b', BNP.id, '2026-11-01')];
    const c = consolidate([BNP], build([BNP], months, []), today);
    expect(c.months.map((m) => m.monthDate)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    expect(c.months.every((m) => m.totalBalance === 1000)).toBeTrue();
  });

  it('sans aucun mois, le solde est le solde de départ du compte', () => {
    const c = consolidate([BNP], new Map(), today);
    expect(c.totalBalance).toBe(1000);
    expect(c.months).toEqual([]);
    expect(c.current).toBeNull();
  });

  it('balanceAt reprend le dernier solde connu avant la date', () => {
    const months = [month('a', BNP.id, '2026-09-01')];
    const s = build([BNP], months, [tx('a', { type: 'income', amount: 50, received: true })]).get(BNP.id)!;
    expect(balanceAt(BNP, s, '2026-12-01')).toBe(1050);
    expect(balanceAt(BNP, s, '2026-08-01')).toBe(0);
  });
});
