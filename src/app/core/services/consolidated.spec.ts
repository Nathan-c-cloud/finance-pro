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

  it('clôture avec virement : le total est continu, avant, pendant et après le mois de clôture', () => {
    // TR (500) reçoit 300 de OLD en novembre : OLD (800 en octobre) est clôturé en novembre avec ses 800 viré à TR
    const OLD = acc('old', 'Ancien', 'checking', 800, { status: 'closed', closed_at: '2026-11-03' });
    const months = [
      month('o1', OLD.id, '2026-10-01'), month('o2', OLD.id, '2026-11-01'),
      month('t1', TR.id, '2026-10-01'), month('t2', TR.id, '2026-11-01'),
    ];
    const txs = [
      tx('o2', { amount: 800, transfer_id: 'c1', transfer_account_id: TR.id }),
      tx('t2', { type: 'income', amount: 800, received: true, transfer_id: 'c1', transfer_account_id: OLD.id }),
    ];
    const c = consolidate([OLD, TR], build([OLD, TR], months, txs), today);
    expect(c.months.map((m) => m.totalBalance)).toEqual([1300, 1300]); // octobre : 800 + 500, novembre : 1300 chez TR
    expect(c.totalBalance).toBe(1300);
  });

  it('clôture sans virement : le total baisse dans le mois de la clôture, pas avant', () => {
    const OLD = acc('old', 'Ancien', 'checking', 200, { status: 'closed', closed_at: '2026-11-03' });
    const months = [
      month('o1', OLD.id, '2026-10-01'), month('o2', OLD.id, '2026-11-01'),
      month('b1', BNP.id, '2026-10-01'), month('b2', BNP.id, '2026-11-01'),
    ];
    const c = consolidate([OLD, BNP], build([OLD, BNP], months, []), today);
    expect(c.months.map((m) => m.totalBalance)).toEqual([1200, 1000]);
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

  describe('contrôles de cohérence sur un jeu de données complet', () => {
    // Trois comptes, trois mois, un peu de tout : revenus, dépenses, épargne à l'ancienne, virements dans tous les sens,
    // intérêts et dépense directe sur l'épargne.
    const CHK2 = acc('c2', 'Autre courant', 'checking', 200);
    const accounts = [BNP, CHK2, TR];
    const D = ['2026-09-01', '2026-10-01', '2026-11-01'];
    const months = accounts.flatMap((a) => D.map((d, i) => month(`${a.id}-${i}`, a.id, d)));
    const m = (a: Account, i: number) => `${a.id}-${i}`;

    const mirror = (id: string, from: Account, to: Account, i: number, amount: number) => [
      tx(m(from, i), { amount, transfer_id: id, transfer_account_id: to.id }),
      tx(m(to, i), { type: 'income', amount, transfer_id: id, transfer_account_id: from.id, received: true }),
    ];

    const txs: Transaction[] = [
      // septembre
      tx(m(BNP, 0), { type: 'income', amount: 2500, received: true }),
      tx(m(BNP, 0), { amount: 700 }),
      tx(m(BNP, 0), { amount: 120, category_id: 'cat-e' }), // épargne à l'ancienne, hors comptes de l'app
      ...mirror('t1', BNP, TR, 0, 150),
      // octobre
      tx(m(BNP, 1), { type: 'income', amount: 2500, received: true }),
      tx(m(CHK2, 1), { type: 'income', amount: 400, received: true }),
      tx(m(BNP, 1), { amount: 650 }),
      tx(m(CHK2, 1), { amount: 90 }),
      ...mirror('t2', BNP, TR, 1, 200),
      ...mirror('t3', BNP, CHK2, 1, 300),
      tx(m(TR, 1), { type: 'income', amount: 2.5, received: true }), // intérêts
      // novembre : retrait de l'épargne, dépense directe sur l'épargne, virement entre l'autre courant et l'épargne
      tx(m(BNP, 2), { type: 'income', amount: 2500, received: true }),
      tx(m(BNP, 2), { amount: 800 }),
      ...mirror('t4', TR, BNP, 2, 180),
      tx(m(TR, 2), { amount: 13.56 }),
      ...mirror('t5', CHK2, TR, 2, 50),
    ];

    const flows = new Map([[BNP.id, new Map([['2026-10-01', 2.5], ['2026-11-01', -13.56]])]]);
    const c = consolidate(accounts, build(accounts, months, txs, flows), new Date(2026, 10, 15));
    const nonTransfer = (monthIdx: number) => txs.filter((t) => !t.transfer_id && t.month_id.endsWith(`-${monthIdx}`));

    it('les revenus ne sont jamais comptés deux fois : seuls les vrais revenus des comptes courants', () => {
      D.forEach((d, i) => {
        const real = nonTransfer(i)
          .filter((t) => t.type === 'income' && !t.month_id.startsWith(TR.id))
          .reduce((s, t) => s + t.amount, 0);
        expect(c.months[i].income).toBeCloseTo(real, 2);
      });
    });

    it('les dépenses hors épargne sont les vraies dépenses des comptes courants, sans virement ni épargne', () => {
      D.forEach((d, i) => {
        const real = nonTransfer(i)
          .filter((t) => t.type !== 'income' && !t.month_id.startsWith(TR.id) && t.category_id !== 'cat-e')
          .reduce((s, t) => s + t.amount, 0);
        expect(c.months[i].expensesExcludingSavings).toBeCloseTo(real, 2);
      });
    });

    it('l\'épargne du mois = virements vers l\'épargne moins retraits, plus épargne à l\'ancienne, plus mouvements directs de l\'épargne', () => {
      expect(c.months[0].savings).toBeCloseTo(150 + 120, 2); // septembre
      expect(c.months[1].savings).toBeCloseTo(200 + 2.5, 2); // octobre : virement + intérêts
      expect(c.months[2].savings).toBeCloseTo(-180 - 13.56 + 50, 2); // novembre : retrait, dépense directe, virement de l'autre courant
    });

    it('le solde total ne varie que des vrais revenus et vraies dépenses, jamais d\'un virement', () => {
      let previous = accounts.reduce((s, a) => s + a.opening_balance, 0);
      D.forEach((d, i) => {
        const delta = nonTransfer(i).reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
        expect(c.months[i].totalBalance - previous).toBeCloseTo(delta, 2);
        previous = c.months[i].totalBalance;
      });
    });

    it('chaque virement a ses deux moitiés dans le même mois', () => {
      const monthOf = new Map(months.map((x) => [x.id, x.month_date]));
      const byTransfer = new Map<string, string[]>();
      for (const t of txs.filter((x) => x.transfer_id)) {
        byTransfer.set(t.transfer_id!, [...(byTransfer.get(t.transfer_id!) ?? []), monthOf.get(t.month_id)!]);
      }
      for (const dates of byTransfer.values()) expect(new Set(dates).size).toBe(1);
    });
  });
});
