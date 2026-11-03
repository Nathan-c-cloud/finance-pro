import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Account, FixedExpense, MonthRow, MonthSummary, Transaction } from '../models/models';
import { closureBlocker, closureFixedExpenses, localIsoDate, remainingBalance } from './account-closure';
import { DataService } from './data.service';
import { SupabaseService } from './supabase.service';

const account = (id: string, kind: Account['kind'] = 'checking', over: Partial<Account> = {}): Account =>
  ({ id, user_id: 'u1', name: id, kind, opening_balance: 0, opening_date: null, status: 'active', closed_at: null, created_at: `2026-01-0${id.length}T00:00:00Z`, ...over }) as Account;
const month = (id: string, accountId: string, date: string): MonthRow =>
  ({ id, user_id: 'u1', account_id: accountId, month_date: date, status: 'closed', starting_balance_override: null, real_balance_check: null }) as MonthRow;
const tx = (over: Partial<Transaction>): Transaction =>
  ({ user_id: 'u1', type: 'variable', name: 'x', amount: 1, category_id: null, tx_date: '2026-10-02', detail: null, necessary: null, received: null, transfer_id: null, transfer_account_id: null, ...over }) as Transaction;

const today = new Date(2026, 10, 3, 22, 0);

describe('clôture d\'un compte : garde-fous', () => {
  const bnp = account('bnp');
  const tr = account('tr', 'savings');
  const months = [month('b1', 'bnp', '2026-11-01'), month('t1', 'tr', '2026-11-01')];

  it('autorise un compte sans opération à venir', () => {
    expect(closureBlocker({ account: tr, accounts: [bnp, tr], months, transactions: [tx({ month_id: 't1' })], today })).toBeNull();
  });

  it('refuse de clôturer le dernier compte actif', () => {
    const closed = account('old', 'checking', { status: 'closed', closed_at: '2026-10-01' });
    expect(closureBlocker({ account: bnp, accounts: [bnp, closed], months, transactions: [], today })).toContain('dernier compte actif');
  });

  it('refuse un compte déjà clôturé', () => {
    const closed = account('old', 'checking', { status: 'closed', closed_at: '2026-10-01' });
    expect(closureBlocker({ account: closed, accounts: [bnp, closed], months, transactions: [], today })).toContain('déjà clôturé');
  });

  it('refuse s\'il reste une dépense à venir, un virement à venir ou un revenu non reçu, en les nommant', () => {
    const future = tx({ month_id: 't1', id: 'f', name: 'Abonnement', tx_date: '2026-12-01' });
    const msg = closureBlocker({ account: tr, accounts: [bnp, tr], months, transactions: [future], today });
    expect(msg).toContain('1 opération pas encore réalisée');
    expect(msg).toContain('« Abonnement »');

    const futureTransfer = tx({ month_id: 't1', type: 'income', tx_date: '2026-12-08', transfer_id: 'x', transfer_account_id: 'bnp', received: false });
    expect(closureBlocker({ account: tr, accounts: [bnp, tr], months, transactions: [futureTransfer], today })).toBeTruthy();

    const notReceived = tx({ month_id: 't1', type: 'income', received: false });
    expect(closureBlocker({ account: tr, accounts: [bnp, tr], months, transactions: [notReceived], today })).toBeTruthy();
  });

  it('les opérations des AUTRES comptes ne bloquent pas', () => {
    const future = tx({ month_id: 'b1', tx_date: '2026-12-01' });
    expect(closureBlocker({ account: tr, accounts: [bnp, tr], months, transactions: [future], today })).toBeNull();
  });

  it('dépenses fixes arrêtées : celles du compte et celles qui virent vers lui, actives seulement', () => {
    const f = (id: string, accountId: string, dest: string | null, active = true) =>
      ({ id, account_id: accountId, transfer_account_id: dest, active }) as FixedExpense;
    const list = [f('own', 'tr', null), f('toTr', 'bnp', 'tr'), f('other', 'bnp', null), f('off', 'tr', null, false)];
    expect(closureFixedExpenses('tr', list).map((x) => x.id)).toEqual(['own', 'toTr']);
  });

  it('solde restant : celui du mois du jour, sinon le dernier solde connu', () => {
    const summaries = [{ month: month('t1', 'tr', '2026-10-01'), endingBalance: 420 }] as MonthSummary[];
    expect(remainingBalance(tr, summaries, today)).toBe(420);
    expect(remainingBalance(account('x', 'checking', { opening_balance: 55 }), [], today)).toBe(55);
  });

  it('date locale : minuit passé reste le bon jour', () => {
    expect(localIsoDate(new Date(2026, 10, 4, 0, 30))).toBe('2026-11-04');
  });
});

/** Faux client Supabase : enregistre les écritures et répond « ok ». */
function fakeSupabase() {
  const calls: { table?: string; op: string; payload?: any; ids?: string[]; fn?: string }[] = [];
  let seq = 0;
  const chain = (table: string, op: string, payload: any) => ({
    in: (_c: string, ids: string[]) => (calls.push({ table, op, payload, ids }), Promise.resolve({ error: null })),
    eq: (_c: string, id: string) => (calls.push({ table, op, payload, ids: [id] }), Promise.resolve({ error: null })),
  });
  const client = {
    from: (table: string) => ({
      update: (payload: any) => chain(table, 'update', payload),
      insert: (rows: any[]) => {
        calls.push({ table, op: 'insert', payload: rows });
        return { select: () => Promise.resolve({ data: rows.map((r) => ({ ...r, id: `new${seq++}` })), error: null }) };
      },
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }),
    rpc: (fn: string, payload: any) => (calls.push({ op: 'rpc', fn, payload }), Promise.resolve({ data: 'transfer-1', error: null })),
  };
  return { calls, service: { client, userId: 'u1', ready: signal(false), user: signal(null), session: signal(null) } };
}

describe('closeAccount (vrai code de DataService)', () => {
  function setup(extra: Transaction[] = []) {
    const fake = fakeSupabase();
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseService, useValue: fake.service }] });
    const data = TestBed.inject(DataService);
    const nowMonth = new Date();
    const thisMonth = `${nowMonth.getFullYear()}-${String(nowMonth.getMonth() + 1).padStart(2, '0')}-01`;
    data.accounts.set([account('bnp', 'checking'), account('tr', 'savings', { opening_balance: 300 })]);
    data.allMonths.set([month('b1', 'bnp', thisMonth), month('t1', 'tr', thisMonth)]);
    data.allTransactions.set(extra);
    data.allFixedExpenses.set([
      { id: 'f-own', account_id: 'tr', transfer_account_id: null, active: true } as FixedExpense,
      { id: 'f-to', account_id: 'bnp', transfer_account_id: 'tr', active: true } as FixedExpense,
      { id: 'f-other', account_id: 'bnp', transfer_account_id: null, active: true } as FixedExpense,
    ]);
    data.currentAccountId.set('tr');
    return { data, calls: fake.calls };
  }

  it('avec virement : virement de clôture daté d\'aujourd\'hui, compte clôturé, dépenses fixes arrêtées, bascule sur un compte actif', async () => {
    const { data, calls } = setup();
    await data.closeAccount('tr', { transferToId: 'bnp', amount: 300 });

    const rpc = calls.find((c) => c.op === 'rpc')!;
    expect(rpc.payload.p_from_month).toBe('t1');
    expect(rpc.payload.p_to_account).toBe('bnp');
    expect(rpc.payload.p_amount).toBe(300);
    expect(rpc.payload.p_date).toBe(localIsoDate(new Date()));

    const closeCall = calls.find((c) => c.table === 'accounts')!;
    expect(closeCall.payload.status).toBe('closed');
    expect(closeCall.payload.closed_at).toBe(localIsoDate(new Date()));
    expect(calls.indexOf(rpc)).toBeLessThan(calls.indexOf(closeCall)); // le virement part avant la clôture

    const fixedCall = calls.find((c) => c.table === 'fixed_expenses')!;
    expect(fixedCall.ids!.sort()).toEqual(['f-own', 'f-to']);
    expect(data.allFixedExpenses().find((f) => f.id === 'f-other')!.active).toBeTrue();
    expect(data.accounts().find((a) => a.id === 'tr')!.status).toBe('closed');
    expect(data.currentAccountId()).toBe('bnp');
  });

  it('sans virement : aucun virement n\'est créé', async () => {
    const { data, calls } = setup();
    await data.closeAccount('tr', {});
    expect(calls.some((c) => c.op === 'rpc')).toBeFalse();
    expect(data.accounts().find((a) => a.id === 'tr')!.status).toBe('closed');
  });

  it('refusé s\'il reste une opération à venir : rien n\'est écrit', async () => {
    const future = tx({ month_id: 't1', tx_date: '2999-01-01' });
    const { data, calls } = setup([future]);
    await expectAsync(data.closeAccount('tr', {})).toBeRejectedWithError(/pas encore réalisée/);
    expect(calls.length).toBe(0);
    expect(data.accounts().find((a) => a.id === 'tr')!.status).toBe('active');
  });

  it('refuse un virement vers un compte clôturé ou le même compte, ou un montant nul', async () => {
    const { data, calls } = setup();
    await expectAsync(data.closeAccount('tr', { transferToId: 'tr', amount: 10 })).toBeRejected();
    await expectAsync(data.closeAccount('tr', { transferToId: 'bnp', amount: 0 })).toBeRejected();
    expect(calls.length).toBe(0);
  });

  it('rouvrir un compte le remet actif', async () => {
    const { data } = setup();
    await data.closeAccount('tr', {});
    await data.reopenAccount('tr');
    const a = data.accounts().find((x) => x.id === 'tr')!;
    expect(a.status).toBe('active');
    expect(a.closed_at).toBeNull();
  });
});
