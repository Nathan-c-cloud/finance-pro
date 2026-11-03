import { Category, MonthRow, Transaction } from '../models/models';
import {
  budgetSpent,
  isLateIncome,
  isTransfer,
  pendingOperations,
  summarizeMonth,
  theoreticalBalanceToday,
} from './calc';

const month: MonthRow = {
  id: 'm1',
  user_id: 'u1',
  account_id: 'bnp',
  month_date: '2026-11-01',
  status: 'current',
  starting_balance_override: null,
  real_balance_check: null,
};

const categories: Category[] = [
  { id: 'cat-epargne', name: 'Épargne' } as Category,
  { id: 'cat-logement', name: 'Logement' } as Category,
];

let n = 0;
const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t${n++}`,
  user_id: 'u1',
  month_id: 'm1',
  type: 'variable',
  name: 'x',
  amount: 0,
  category_id: null,
  tx_date: '2026-11-02',
  detail: null,
  necessary: null,
  received: null,
  ...over,
});

const salary = tx({ type: 'income', amount: 2000, received: true });
const TR = 'tr'; // compte d'épargne
const OTHER = 'other'; // autre compte courant
const savingsIds = new Set([TR]);

const toTr = (amount: number) => tx({ type: 'variable', amount, transfer_id: 'x1', transfer_account_id: TR });
const fromTr = (amount: number) => tx({ type: 'income', amount, transfer_id: 'x2', transfer_account_id: TR, received: true });
const toOther = (amount: number) => tx({ type: 'variable', amount, transfer_id: 'x3', transfer_account_id: OTHER });
const fromOther = (amount: number) => tx({ type: 'income', amount, transfer_id: 'x4', transfer_account_id: OTHER, received: true });

describe('virements entre comptes dans les calculs', () => {
  it('isTransfer reconnaît les lignes de virement', () => {
    expect(isTransfer(toTr(1))).toBeTrue();
    expect(isTransfer(salary)).toBeFalse();
  });

  it('un virement vers un compte d\'épargne compte comme de l\'épargne, pas comme une dépense', () => {
    const s = summarizeMonth(month, [salary, toTr(100)], categories, 0, null, savingsIds);
    expect(s.savings).toBe(100);
    expect(s.expensesExcludingSavings).toBe(0);
    expect(s.income).toBe(2000);
    expect(s.savingsRate).toBeCloseTo(0.05);
    expect(s.endingBalance).toBe(1900);
  });

  it('un retrait depuis l\'épargne n\'est pas un revenu : il baisse l\'épargne du mois (taux négatif)', () => {
    // 5 % d'épargne (100 sur 2000), puis 200 retirés de l'épargne dans le même mois
    const s = summarizeMonth(month, [salary, toTr(100), fromTr(200)], categories, 0, null, savingsIds);
    expect(s.income).toBe(2000);
    expect(s.savings).toBe(-100);
    expect(s.savingsRate).toBeCloseTo(-0.05);
    expect(s.endingBalance).toBe(2100);
  });

  it('un retrait ne touche que son mois : un autre mois garde son taux', () => {
    const other: MonthRow = { ...month, id: 'm0', month_date: '2026-10-01' };
    const octobre = summarizeMonth(other, [{ ...salary, month_id: 'm0' }, { ...toTr(100), month_id: 'm0' }], categories, 0, null, savingsIds);
    const novembre = summarizeMonth(month, [salary, fromTr(300)], categories, 0, null, savingsIds);
    expect(octobre.savingsRate).toBeCloseTo(0.05);
    expect(novembre.savingsRate).toBeCloseTo(-0.15);
  });

  it('un virement entre deux comptes courants change le solde sans être ni revenu, ni dépense, ni épargne', () => {
    const s = summarizeMonth(month, [salary, toOther(300), fromOther(50)], categories, 100, null, savingsIds);
    expect(s.income).toBe(2000);
    expect(s.expensesExcludingSavings).toBe(0);
    expect(s.savings).toBe(0);
    expect(s.transfersNet).toBe(-250);
    expect(s.endingBalance).toBe(100 + 2000 - 250);
    expect(s.savingsRate).toBe(0);
  });

  it('les virements ne comptent pas dans la répartition par catégorie', () => {
    const s = summarizeMonth(month, [toOther(300), toTr(100), tx({ amount: 20, category_id: 'cat-logement' })], categories, 0, null, savingsIds);
    expect(s.byCategory.reduce((a, c) => a + c.amount, 0)).toBe(20);
  });

  it('l\'épargne saisie à l\'ancienne (catégorie Épargne) fonctionne toujours et s\'additionne aux virements', () => {
    const old = tx({ amount: 50, category_id: 'cat-epargne' });
    const s = summarizeMonth(month, [salary, old, toTr(100)], categories, 0, null, savingsIds);
    expect(s.savings).toBe(150);
  });

  it('si le type d\'un compte change, le calcul suit (virement vers un compte plus considéré comme épargne)', () => {
    const asSavings = summarizeMonth(month, [salary, toTr(100)], categories, 0, null, new Set([TR]));
    const asChecking = summarizeMonth(month, [salary, toTr(100)], categories, 0, null, new Set());
    expect(asSavings.savings).toBe(100);
    expect(asChecking.savings).toBe(0);
    expect(asChecking.transfersNet).toBe(-100);
    expect(asChecking.endingBalance).toBe(asSavings.endingBalance);
  });

  it('sans aucun virement, le résultat est celui d\'avant', () => {
    const s = summarizeMonth(month, [salary, tx({ amount: 400, category_id: 'cat-logement' })], categories, 10);
    expect(s.endingBalance).toBe(10 + 2000 - 400);
    expect(s.transfersNet).toBe(0);
  });

  describe('mouvements directs des comptes d\'épargne', () => {
    it('une dépense sur un compte d\'épargne baisse l\'épargne et le taux du mois, pas le solde', () => {
      // 100 virés vers l'épargne (5 %), puis 13,56 dépensés directement depuis l'épargne
      const s = summarizeMonth(month, [salary, toTr(100)], categories, 0, null, savingsIds, -13.56);
      expect(s.savings).toBeCloseTo(86.44);
      expect(s.savingsRate).toBeCloseTo(0.0432, 3);
      expect(s.savingsFromSavingsAccounts).toBeCloseTo(-13.56);
      expect(s.endingBalance).toBe(1900); // le solde du compte courant ne bouge pas
    });

    it('des intérêts reçus sur l\'épargne augmentent l\'épargne sans toucher aux revenus du compte courant', () => {
      const s = summarizeMonth(month, [salary, toTr(100)], categories, 0, null, savingsIds, 4);
      expect(s.income).toBe(2000);
      expect(s.savings).toBe(104);
      expect(s.endingBalance).toBe(1900);
    });

    it('sans mouvement sur l\'épargne, rien ne change', () => {
      const s = summarizeMonth(month, [salary, toTr(100)], categories, 0, null, savingsIds);
      expect(s.savings).toBe(100);
      expect(s.savingsFromSavingsAccounts).toBe(0);
    });
  });

  describe('solde théorique et opérations en attente', () => {
    const today = new Date(2026, 10, 10);

    it('un virement compte des deux côtés dès que sa date est passée, sans case « Reçu »', () => {
      const out = toOther(100); // daté du 2
      const inn = { ...fromOther(100), received: false };
      expect(theoreticalBalanceToday(1000, [out], today)).toBe(900);
      expect(theoreticalBalanceToday(1000, [inn], today)).toBe(1100);
    });

    it('un virement daté plus tard ne compte pas encore, et reste en attente des deux côtés', () => {
      const later = { ...toOther(100), tx_date: '2026-11-20' };
      const laterIn = { ...fromOther(100), tx_date: '2026-11-20', received: false };
      expect(theoreticalBalanceToday(1000, [later, laterIn], today)).toBe(1000);
      const pending = pendingOperations([later, laterIn], today);
      expect(pending.items.length).toBe(2);
      expect(pending.net).toBe(0);
    });

    it('un virement entrant n\'est jamais un « revenu à confirmer »', () => {
      const inn = { ...fromOther(100), received: false };
      expect(isLateIncome(inn, today)).toBeFalse();
    });

    it('un revenu ordinaire garde sa règle : compte seulement s\'il est reçu', () => {
      const notReceived = tx({ type: 'income', amount: 500, received: false });
      expect(theoreticalBalanceToday(0, [notReceived], today)).toBe(0);
      expect(theoreticalBalanceToday(0, [{ ...notReceived, received: true }], today)).toBe(500);
    });
  });

  it('un virement ne compte pas dans un budget de catégorie', () => {
    const transfer = { ...toOther(300), category_id: 'cat-logement' };
    const normal = tx({ amount: 20, category_id: 'cat-logement' });
    expect(budgetSpent([transfer, normal], 'cat-logement', true)).toBe(20);
  });
});
