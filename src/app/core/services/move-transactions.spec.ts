import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DataService } from './data.service';
import { SupabaseService } from './supabase.service';
import { shiftIsoDateToMonth } from './date-fr';
import { Account, MonthRow, Transaction } from '../models/models';

describe('shiftIsoDateToMonth', () => {
  it('garde le même jour dans le mois d\'arrivée', () => {
    expect(shiftIsoDateToMonth('2026-11-05', '2026-12-01')).toBe('2026-12-05');
  });
  it('ramène au dernier jour d\'un mois plus court', () => {
    expect(shiftIsoDateToMonth('2026-01-31', '2026-02-01')).toBe('2026-02-28');
    expect(shiftIsoDateToMonth('2026-10-31', '2026-11-01')).toBe('2026-11-30');
  });
  it('ne touche pas une date déjà dans le mois, ou plus tard', () => {
    expect(shiftIsoDateToMonth('2026-12-08', '2026-12-01')).toBe('2026-12-08');
    expect(shiftIsoDateToMonth('2027-01-15', '2026-12-01')).toBe('2027-01-15');
  });
  it('sans date, reste sans date', () => {
    expect(shiftIsoDateToMonth(null, '2026-12-01')).toBeNull();
  });
  it('passe correctement le changement d\'année', () => {
    expect(shiftIsoDateToMonth('2026-12-20', '2027-01-01')).toBe('2027-01-20');
  });
});

/** Faux client Supabase : enregistre les requêtes d'écriture, répond « ok ». */
function fakeSupabase() {
  const calls: { table: string; op: string; payload: any; ids?: string[] }[] = [];
  let seq = 0;
  const client = {
    from: (table: string) => ({
      update: (payload: any) => ({
        in: (_col: string, ids: string[]) => {
          calls.push({ table, op: 'update', payload, ids });
          return Promise.resolve({ error: null });
        },
      }),
      insert: (rows: any[]) => {
        calls.push({ table, op: 'insert', payload: rows });
        return { select: () => Promise.resolve({ data: rows.map((r) => ({ ...r, id: `new${seq++}` })), error: null }) };
      },
    }),
  };
  return { calls, service: { client, userId: 'u1', ready: signal(false), user: signal(null), session: signal(null) } };
}

describe('report des opérations dans le mois suivant (vrai code de DataService)', () => {
  const account = (id: string, kind: 'checking' | 'savings'): Account =>
    ({ id, user_id: 'u1', name: id, kind, opening_balance: 0, opening_date: null, status: 'active', closed_at: null, created_at: '2026-01-01T00:00:00Z' }) as Account;
  const month = (id: string, accountId: string, date: string): MonthRow =>
    ({ id, user_id: 'u1', account_id: accountId, month_date: date, status: 'closed', starting_balance_override: null, real_balance_check: null }) as MonthRow;
  const tx = (over: Partial<Transaction>): Transaction =>
    ({ user_id: 'u1', type: 'variable', name: 'x', amount: 1, category_id: null, tx_date: null, detail: null, necessary: null, received: null, transfer_id: null, transfer_account_id: null, ...over }) as Transaction;

  function setup() {
    const fake = fakeSupabase();
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseService, useValue: fake.service }] });
    const data = TestBed.inject(DataService);
    data.accounts.set([account('bnp', 'checking'), account('tr', 'savings')]);
    data.allMonths.set([month('bnp-nov', 'bnp', '2026-11-01'), month('bnp-dec', 'bnp', '2026-12-01'), month('tr-nov', 'tr', '2026-11-01')]);
    data.allTransactions.set([
      tx({ id: 'gym', month_id: 'bnp-nov', type: 'fixed', amount: 24.9, tx_date: '2026-11-05' }),
      tx({ id: 'undated', month_id: 'bnp-nov', amount: 10, tx_date: null }),
      // virement d'épargne du 06/11 et virement du 08/12 saisi dans novembre
      tx({ id: 'out1', month_id: 'bnp-nov', amount: 150, tx_date: '2026-11-06', transfer_id: 'x1', transfer_account_id: 'tr' }),
      tx({ id: 'in1', month_id: 'tr-nov', type: 'income', amount: 150, tx_date: '2026-11-06', received: false, transfer_id: 'x1', transfer_account_id: 'bnp' }),
      tx({ id: 'out2', month_id: 'bnp-nov', amount: 120, tx_date: '2026-12-08', transfer_id: 'x2', transfer_account_id: 'tr' }),
      tx({ id: 'in2', month_id: 'tr-nov', type: 'income', amount: 120, tx_date: '2026-12-08', received: false, transfer_id: 'x2', transfer_account_id: 'bnp' }),
    ]);
    return { data, calls: fake.calls };
  }

  it('les deux moitiés d\'un virement arrivent en décembre (mois créé pour l\'autre compte), avec la même date décalée', async () => {
    const { data, calls } = setup();
    await data.moveTransactions(['gym', 'undated', 'out1', 'out2'], 'bnp-dec');

    const inserted = calls.filter((c) => c.op === 'insert');
    expect(inserted.length).toBe(1);
    expect(inserted[0].payload.map((r: any) => [r.account_id, r.month_date])).toEqual([['tr', '2026-12-01']]);

    const byId = new Map(data.allTransactions().map((t) => [t.id, t]));
    const trDec = data.allMonths().find((m) => m.account_id === 'tr' && m.month_date === '2026-12-01')!;
    expect(trDec).toBeTruthy();

    expect(byId.get('gym')).toEqual(jasmine.objectContaining({ month_id: 'bnp-dec', tx_date: '2026-12-05' }));
    expect(byId.get('undated')).toEqual(jasmine.objectContaining({ month_id: 'bnp-dec', tx_date: null }));
    expect(byId.get('out1')).toEqual(jasmine.objectContaining({ month_id: 'bnp-dec', tx_date: '2026-12-06' }));
    expect(byId.get('in1')).toEqual(jasmine.objectContaining({ month_id: trDec.id, tx_date: '2026-12-06', received: false }));
    expect(byId.get('out2')).toEqual(jasmine.objectContaining({ month_id: 'bnp-dec', tx_date: '2026-12-08' }));
    expect(byId.get('in2')).toEqual(jasmine.objectContaining({ month_id: trDec.id, tx_date: '2026-12-08' }));
    // rien ne reste de virement dans novembre côté Trade Republic
    expect(data.allTransactions().filter((t) => t.month_id === 'tr-nov').length).toBe(0);
  });

  it('chaque requête envoyée à la base porte le bon mois et la bonne date', async () => {
    const { data, calls } = setup();
    await data.moveTransactions(['out1', 'out2'], 'bnp-dec');
    const updates = calls.filter((c) => c.op === 'update');
    const sent = updates.map((u) => ({ ids: [...u.ids!].sort(), date: u.payload.tx_date }));
    expect(sent).toContain(jasmine.objectContaining({ ids: ['out1'], date: '2026-12-06' }));
    expect(sent).toContain(jasmine.objectContaining({ ids: ['out2'], date: '2026-12-08' }));
    const peerUpdate = updates.find((u) => u.ids!.includes('in1'))!;
    expect(peerUpdate.payload.tx_date).toBe('2026-12-06');
    expect(peerUpdate.payload.month_id).not.toBe('bnp-dec');
  });
});
