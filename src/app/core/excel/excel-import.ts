import { Category, FixedExpense, Frequency, MonthRow, Transaction, TxType, UserSettings } from '../models/models';
import { formatEUR } from '../services/format';
import { FREQUENCIES } from '../services/fixed-expense';
import {
  FREQUENCY_LABELS,
  H,
  SHEET,
  STATUS_LABELS,
  TYPE_LABELS,
  monthKeyOf,
  normalizeText,
} from './excel-format';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface Issue {
  level: 'error' | 'warning';
  sheet: string;
  /** Numéro de ligne dans Excel (null pour un problème qui concerne tout l'onglet). */
  row: number | null;
  message: string;
}

interface ParsedFixed {
  row: number;
  id: string | null;
  name: string;
  amount: number;
  categoryName: string | null;
  frequency: Frequency;
  paymentDay: number;
  active: boolean;
}
interface ParsedMonth {
  row: number;
  id: string | null;
  key: string; // AAAA-MM
  status: 'current' | 'closed' | null;
  override: number | null;
  realBalance: number | null;
}
interface ParsedTx {
  row: number;
  id: string | null;
  monthKey: string;
  type: TxType;
  name: string;
  amount: number;
  categoryName: string | null;
  date: string | null; // AAAA-MM-JJ
  detail: string | null;
  necessary: boolean | null;
  received: boolean | null;
}

export interface ParsedFile {
  initialBalance: number | null;
  categories: { row: number; name: string }[];
  fixed: ParsedFixed[] | null; // null = onglet absent
  months: ParsedMonth[] | null;
  transactions: ParsedTx[] | null;
  issues: Issue[];
}

export interface AppState {
  categories: Category[];
  fixedExpenses: FixedExpense[];
  months: MonthRow[];
  transactions: Transaction[];
  settings: UserSettings | null;
}

export type LineAction = 'create' | 'update' | 'delete' | 'doubtful';
export type LineEntity = 'Réglage' | 'Catégorie' | 'Mois' | 'Dépense fixe' | 'Transaction';

/** Une ligne de l'aperçu. */
export interface PlanLine {
  id: string;
  entity: LineEntity;
  action: LineAction;
  title: string;
  detail: string;
  sheet: string;
  row: number | null;
}

/** Ce que l'import fera, prêt à être appliqué par DataService.applyImportPlan. */
export interface ImportPlan {
  lines: PlanLine[];
  issues: Issue[];
  unchanged: number;
  ops: {
    initialBalance: number | null;
    createCategories: string[];
    createMonths: { key: string; status: 'current' | 'closed'; override: number | null; real: number | null }[];
    updateMonths: { id: string; patch: Partial<MonthRow> }[];
    createFixed: { lineId: string; data: FixedData }[];
    updateFixed: { lineId: string; id: string; patch: Partial<FixedData> }[];
    deleteFixed: { lineId: string; id: string }[];
    createTx: { lineId: string; data: TxData }[];
    updateTx: { lineId: string; id: string; patch: Partial<TxData> }[];
    deleteTx: { lineId: string; id: string }[];
  };
}

export interface FixedData {
  name: string;
  amount: number;
  categoryName: string | null;
  frequency: Frequency;
  payment_day: number;
  active: boolean;
}
export interface TxData {
  monthKey: string;
  type: TxType;
  name: string;
  amount: number;
  categoryName: string | null;
  tx_date: string | null;
  detail: string | null;
  necessary: boolean | null;
  received: boolean | null;
}

export const hasErrors = (plan: ImportPlan) => plan.issues.some((i) => i.level === 'error');

// ------------------------------------------------------------------
// Lecture du classeur
// ------------------------------------------------------------------

/** Valeur simple d'une cellule ExcelJS (texte, nombre, date ou null). */
function raw(v: any): any {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return raw(v.result);
    if ('richText' in v) return v.richText.map((t: any) => t.text).join('');
    if ('text' in v) return v.text;
    return null; // erreur de formule, etc.
  }
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  return v;
}

function parseAmount(v: any): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\s €]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return parseFloat(s);
}

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseDate(v: any): string | null {
  if (v instanceof Date) return validDate(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') {
    if (v < 1 || v > 100000) return null;
    const dt = new Date(Math.round((v - 25569) * 86400000));
    return validDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  if (typeof v !== 'string') return null;
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/);
  if (m) return validDate(+(m[3].length === 2 ? '20' + m[3] : m[3]), +m[2], +m[1]);
  return null;
}

const MONTH_NAMES = ['janv', 'fevr', 'mars', 'avr', 'mai', 'juin', 'juil', 'aout', 'sept', 'oct', 'nov', 'dec'];

/** "2026-10", une vraie date Excel, "10/2026" ou "octobre 2026" → "2026-10". */
function parseMonthKey(v: any): string | null {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}`;
  if (typeof v === 'number') {
    const d = parseDate(v);
    return d ? d.slice(0, 7) : null;
  }
  if (typeof v !== 'string') return null;
  let m = v.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(+m[2])}`;
  m = v.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}`;
  m = normalizeText(v).match(/^([a-z]+)\.?\s+(\d{4})$/);
  if (m) {
    const idx = MONTH_NAMES.findIndex((n) => m![1].startsWith(n));
    if (idx >= 0) return `${m[2]}-${pad(idx + 1)}`;
  }
  return null;
}

const YES_WORDS = ['oui', 'o', 'yes', 'true', 'vrai', '1', 'x'];
const NO_WORDS = ['non', 'n', 'no', 'false', 'faux', '0'];
function parseBool(v: any): boolean | 'invalid' | null {
  if (v === null) return null;
  if (typeof v === 'boolean') return v;
  const s = normalizeText(String(v));
  if (YES_WORDS.includes(s)) return true;
  if (NO_WORDS.includes(s)) return false;
  return 'invalid';
}

function parseType(v: any): TxType | null {
  const s = normalizeText(String(v ?? ''));
  if (['revenu', 'revenus', 'income'].includes(s)) return 'income';
  if (['depense fixe', 'fixe', 'fixed'].includes(s)) return 'fixed';
  if (['depense variable', 'variable'].includes(s)) return 'variable';
  return null;
}

function parseFrequency(v: any): Frequency | null {
  const s = normalizeText(String(v ?? ''));
  for (const f of FREQUENCIES) {
    if (s === normalizeText(f.label) || s === f.value || s === f.adjective) return f.value;
  }
  return null;
}

function parseStatus(v: any): 'current' | 'closed' | null {
  const s = normalizeText(String(v ?? ''));
  if (['courant', 'en cours', 'current'].includes(s)) return 'current';
  if (['cloture', 'closed'].includes(s)) return 'closed';
  return null;
}

type Cols = Map<string, number>;

function headerMap(ws: any): Cols {
  const map: Cols = new Map();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell: any, col: number) => {
    const key = normalizeText(String(raw(cell.value) ?? ''));
    if (key && !map.has(key)) map.set(key, col);
  });
  return map;
}

function findSheet(wb: any, name: string): any | null {
  const target = normalizeText(name);
  return wb.worksheets.find((w: any) => normalizeText(w.name) === target) ?? null;
}

/** Lit un classeur d'échange. Ne touche à aucune donnée : produit seulement un contenu + des problèmes. */
export async function parseWorkbook(buffer: ArrayBuffer): Promise<ParsedFile> {
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx) lisible.");
  }

  const out: ParsedFile = {
    initialBalance: null,
    categories: [],
    fixed: null,
    months: null,
    transactions: null,
    issues: [],
  };
  const err = (sheet: string, row: number | null, message: string) =>
    out.issues.push({ level: 'error', sheet, row, message });
  const warn = (sheet: string, row: number | null, message: string) =>
    out.issues.push({ level: 'warning', sheet, row, message });

  const wsTx = findSheet(wb, SHEET.transactions);
  const wsMonths = findSheet(wb, SHEET.months);
  if (!wsTx || !wsMonths) {
    throw new Error(
      `Ce classeur ne ressemble pas à un export de Suivi Budget : il faut au moins les onglets « ${SHEET.months} » et « ${SHEET.transactions} ».`
    );
  }

  /** Colonne obligatoire ou optionnelle, retrouvée par son en-tête. */
  const col = (cols: Cols, sheet: string, header: string, required: boolean, ...alt: string[]): number | null => {
    for (const h of [header, ...alt]) {
      const c = cols.get(normalizeText(h));
      if (c) return c;
    }
    if (required) err(sheet, null, `Colonne « ${header} » introuvable (ligne 1 de l'onglet).`);
    return null;
  };
  const val = (ws: any, r: number, c: number | null) => (c ? raw(ws.getCell(r, c).value) : null);
  const lastRow = (ws: any) => ws.actualRowCount > 0 ? ws.rowCount : 1;

  // ---- Réglages
  const wsSettings = findSheet(wb, SHEET.settings);
  if (wsSettings) {
    for (let r = 2; r <= lastRow(wsSettings); r++) {
      if (normalizeText(String(raw(wsSettings.getCell(r, 1).value) ?? '')) === normalizeText(H.initialBalance)) {
        const v = raw(wsSettings.getCell(r, 2).value);
        if (v !== null) {
          const n = parseAmount(v);
          if (n === null) err(SHEET.settings, r, `Solde initial illisible : « ${v} ».`);
          else out.initialBalance = n;
        }
      }
    }
  }

  // ---- Catégories
  const wsCats = findSheet(wb, SHEET.categories);
  if (wsCats) {
    const seen = new Set<string>();
    const c = col(headerMap(wsCats), SHEET.categories, H.categoryName, true);
    if (c) {
      for (let r = 2; r <= lastRow(wsCats); r++) {
        const name = val(wsCats, r, c);
        if (name === null) continue;
        const key = normalizeText(String(name));
        if (seen.has(key)) {
          warn(SHEET.categories, r, `Catégorie « ${name} » en double : ignorée.`);
          continue;
        }
        seen.add(key);
        out.categories.push({ row: r, name: String(name) });
      }
    }
  }

  // ---- Mois
  {
    const cols = headerMap(wsMonths);
    const cId = col(cols, SHEET.months, H.id, false);
    const cKey = col(cols, SHEET.months, H.monthKey, true, 'Mois');
    const cStatus = col(cols, SHEET.months, H.monthStatus, false);
    const cOver = col(cols, SHEET.months, H.monthOverride, false);
    const cReal = col(cols, SHEET.months, H.monthRealBalance, false);
    out.months = [];
    if (cKey) {
      const seen = new Set<string>();
      for (let r = 2; r <= lastRow(wsMonths); r++) {
        const rawKey = val(wsMonths, r, cKey);
        if (rawKey === null) continue;
        const key = parseMonthKey(rawKey);
        if (!key) {
          err(SHEET.months, r, `Mois illisible : « ${rawKey} ». Utilise le format AAAA-MM (par exemple 2026-10).`);
          continue;
        }
        if (seen.has(key)) {
          err(SHEET.months, r, `Le mois ${key} apparaît deux fois.`);
          continue;
        }
        seen.add(key);
        let status: 'current' | 'closed' | null = null;
        const rs = val(wsMonths, r, cStatus);
        if (rs !== null) {
          status = parseStatus(rs);
          if (!status) {
            err(SHEET.months, r, `Statut inconnu : « ${rs} ». Valeurs possibles : ${STATUS_LABELS.current} ou ${STATUS_LABELS.closed}.`);
            continue;
          }
        }
        const num = (c: number | null, label: string): number | null | 'bad' => {
          const v = val(wsMonths, r, c);
          if (v === null) return null;
          const n = parseAmount(v);
          if (n === null) {
            err(SHEET.months, r, `${label} illisible : « ${v} ».`);
            return 'bad';
          }
          return n;
        };
        const over = num(cOver, 'Solde de départ forcé');
        const real = num(cReal, 'Solde réel constaté');
        if (over === 'bad' || real === 'bad') continue;
        const id = val(wsMonths, r, cId);
        out.months.push({ row: r, id: id === null ? null : String(id), key, status, override: over, realBalance: real });
      }
    }
  }

  // ---- Dépenses fixes
  const wsFixed = findSheet(wb, SHEET.fixed);
  if (wsFixed) {
    const cols = headerMap(wsFixed);
    const cId = col(cols, SHEET.fixed, H.id, false);
    const cName = col(cols, SHEET.fixed, H.fixedName, true);
    const cAmount = col(cols, SHEET.fixed, H.fixedAmount, true, 'Montant');
    const cCat = col(cols, SHEET.fixed, H.fixedCategory, false);
    const cFreq = col(cols, SHEET.fixed, H.fixedFrequency, false);
    const cDay = col(cols, SHEET.fixed, H.fixedDay, false);
    const cActive = col(cols, SHEET.fixed, H.fixedActive, false);
    out.fixed = [];
    if (cName && cAmount) {
      for (let r = 2; r <= lastRow(wsFixed); r++) {
        const name = val(wsFixed, r, cName);
        const amountRaw = val(wsFixed, r, cAmount);
        const catRaw = val(wsFixed, r, cCat);
        const freqRaw = val(wsFixed, r, cFreq);
        const dayRaw = val(wsFixed, r, cDay);
        const activeRaw = val(wsFixed, r, cActive);
        if ([name, amountRaw, catRaw, freqRaw, dayRaw, activeRaw].every((v) => v === null)) continue;
        const before = out.issues.length;
        if (name === null) err(SHEET.fixed, r, 'Nom manquant.');
        const amount = amountRaw === null ? null : parseAmount(amountRaw);
        if (amount === null) err(SHEET.fixed, r, amountRaw === null ? 'Montant manquant.' : `Montant illisible : « ${amountRaw} ».`);
        else if (amount < 0) err(SHEET.fixed, r, 'Montant négatif : saisis un montant positif.');
        let frequency: Frequency = 'monthly';
        if (freqRaw === null) warn(SHEET.fixed, r, 'Fréquence vide : « Mensuelle » par défaut.');
        else {
          const f = parseFrequency(freqRaw);
          if (!f) err(SHEET.fixed, r, `Fréquence inconnue : « ${freqRaw} ».`);
          else frequency = f;
        }
        let day = 1;
        if (dayRaw !== null) {
          const n = parseAmount(dayRaw);
          if (n === null || !Number.isInteger(n) || n < 1 || n > 28) err(SHEET.fixed, r, `Jour de prélèvement invalide : « ${dayRaw} » (entre 1 et 28).`);
          else day = n;
        }
        let active = true;
        if (activeRaw !== null) {
          const b = parseBool(activeRaw);
          if (b === 'invalid') err(SHEET.fixed, r, `« Active » doit valoir Oui ou Non, pas « ${activeRaw} ».`);
          else if (b !== null) active = b;
        }
        if (out.issues.length > before) continue;
        const id = val(wsFixed, r, cId);
        out.fixed.push({
          row: r,
          id: id === null ? null : String(id),
          name: String(name),
          amount: amount as number,
          categoryName: catRaw === null ? null : String(catRaw),
          frequency,
          paymentDay: day,
          active,
        });
      }
    }
  }

  // ---- Transactions
  {
    const cols = headerMap(wsTx);
    const cId = col(cols, SHEET.transactions, H.id, false);
    const cMonth = col(cols, SHEET.transactions, H.txMonth, true, 'Mois');
    const cType = col(cols, SHEET.transactions, H.txType, true);
    const cName = col(cols, SHEET.transactions, H.txName, true);
    const cAmount = col(cols, SHEET.transactions, H.txAmount, true, 'Montant');
    const cCat = col(cols, SHEET.transactions, H.txCategory, false);
    const cDate = col(cols, SHEET.transactions, H.txDate, false);
    const cDetail = col(cols, SHEET.transactions, H.txDetail, false);
    const cNec = col(cols, SHEET.transactions, H.txNecessary, false);
    const cRec = col(cols, SHEET.transactions, H.txReceived, false);
    out.transactions = [];
    if (cMonth && cType && cName && cAmount) {
      for (let r = 2; r <= lastRow(wsTx); r++) {
        const monthRaw = val(wsTx, r, cMonth);
        const typeRaw = val(wsTx, r, cType);
        const name = val(wsTx, r, cName);
        const amountRaw = val(wsTx, r, cAmount);
        const catRaw = val(wsTx, r, cCat);
        const dateRaw = val(wsTx, r, cDate);
        const detail = val(wsTx, r, cDetail);
        const necRaw = val(wsTx, r, cNec);
        const recRaw = val(wsTx, r, cRec);
        if ([monthRaw, typeRaw, name, amountRaw, catRaw, dateRaw, detail, necRaw, recRaw].every((v) => v === null)) continue;
        const before = out.issues.length;

        const monthKey = monthRaw === null ? null : parseMonthKey(monthRaw);
        if (monthRaw === null) err(SHEET.transactions, r, 'Mois manquant.');
        else if (!monthKey) err(SHEET.transactions, r, `Mois illisible : « ${monthRaw} ». Utilise le format AAAA-MM.`);
        const type = typeRaw === null ? null : parseType(typeRaw);
        if (typeRaw === null) err(SHEET.transactions, r, 'Type manquant.');
        else if (!type) err(SHEET.transactions, r, `Type inconnu : « ${typeRaw} ». Valeurs possibles : ${Object.values(TYPE_LABELS).join(', ')}.`);
        if (name === null) err(SHEET.transactions, r, 'Nom manquant.');
        const amount = amountRaw === null ? null : parseAmount(amountRaw);
        if (amount === null) err(SHEET.transactions, r, amountRaw === null ? 'Montant manquant.' : `Montant illisible : « ${amountRaw} ».`);
        else if (amount < 0) err(SHEET.transactions, r, 'Montant négatif : saisis un montant positif, le type donne le sens.');
        let date: string | null = null;
        if (dateRaw !== null) {
          date = parseDate(dateRaw);
          if (!date) err(SHEET.transactions, r, `Date illisible : « ${dateRaw} ». Utilise JJ/MM/AAAA.`);
        }
        const nec = parseBool(necRaw);
        if (nec === 'invalid') err(SHEET.transactions, r, `« Nécessaire ? » doit valoir Oui ou Non, pas « ${necRaw} ».`);
        const rec = parseBool(recRaw);
        if (rec === 'invalid') err(SHEET.transactions, r, `« Reçu ? » doit valoir Oui ou Non, pas « ${recRaw} ».`);
        if (out.issues.length > before) continue;

        if (date && monthKey && date.slice(0, 7) !== monthKey) {
          warn(SHEET.transactions, r, `La date (${date.split('-').reverse().join('/')}) n'est pas dans le mois indiqué (${monthKey}).`);
        }
        const id = val(wsTx, r, cId);
        out.transactions.push({
          row: r,
          id: id === null ? null : String(id),
          monthKey: monthKey as string,
          type: type as TxType,
          name: String(name),
          amount: amount as number,
          categoryName: catRaw === null ? null : String(catRaw),
          date,
          detail: detail === null ? null : String(detail),
          necessary: type === 'income' ? null : (nec as boolean | null),
          received: type === 'income' ? ((rec as boolean | null) ?? false) : null,
        });
      }
    }
  }

  return out;
}

// ------------------------------------------------------------------
// Plan de changements (aperçu)
// ------------------------------------------------------------------

const eur = (n: number) => formatEUR(n);
const frDate = (d: string | null) => (d ? d.split('-').reverse().join('/') : 'sans date');
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compare le fichier à l'état de l'application et décrit ce que l'import ferait.
 * Ne modifie rien. Règles :
 * - ligne avec ID connu : mise à jour si quelque chose a changé ;
 * - ligne sans ID : ajout, sauf si elle ressemble à une ligne existante ("à vérifier", décochée) ;
 * - ligne de l'application absente du fichier : jamais supprimée d'office (option de l'aperçu),
 *   et seulement dans les mois et onglets présents dans le fichier ;
 * - mois et catégories : jamais supprimés par l'import.
 */
export function buildImportPlan(file: ParsedFile, app: AppState): ImportPlan {
  const issues: Issue[] = [...file.issues];
  const lines: PlanLine[] = [];
  const ops: ImportPlan['ops'] = {
    initialBalance: null,
    createCategories: [],
    createMonths: [],
    updateMonths: [],
    createFixed: [],
    updateFixed: [],
    deleteFixed: [],
    createTx: [],
    updateTx: [],
    deleteTx: [],
  };
  let unchanged = 0;
  let n = 0;
  const lineId = () => `l${n++}`;
  const err = (sheet: string, row: number | null, message: string) => issues.push({ level: 'error', sheet, row, message });
  const warn = (sheet: string, row: number | null, message: string) => issues.push({ level: 'warning', sheet, row, message });

  // ---- Réglages
  if (file.initialBalance !== null) {
    const current = app.settings?.initial_balance ?? 0;
    if (round2(current) !== round2(file.initialBalance)) {
      ops.initialBalance = file.initialBalance;
      lines.push({ id: lineId(), entity: 'Réglage', action: 'update', title: 'Solde initial', detail: `${eur(current)} → ${eur(file.initialBalance)}`, sheet: SHEET.settings, row: 2 });
    } else unchanged++;
  }

  // ---- Catégories
  const appCatByName = new Map(app.categories.map((c) => [normalizeText(c.name), c]));
  const appCatNameById = new Map(app.categories.map((c) => [c.id, c.name]));
  const fileCatNames = new Set(file.categories.map((c) => normalizeText(c.name)));
  for (const c of file.categories) {
    if (appCatByName.has(normalizeText(c.name))) {
      unchanged++;
    } else {
      ops.createCategories.push(c.name);
      lines.push({ id: lineId(), entity: 'Catégorie', action: 'create', title: c.name, detail: 'Nouvelle catégorie', sheet: SHEET.categories, row: c.row });
    }
  }
  const categoryExists = (name: string) => appCatByName.has(normalizeText(name)) || fileCatNames.has(normalizeText(name));
  const checkCategory = (sheet: string, row: number, name: string | null): boolean => {
    if (name === null || categoryExists(name)) return true;
    err(sheet, row, `Catégorie inconnue : « ${name} ». Ajoute-la d'abord dans l'onglet ${SHEET.categories}.`);
    return false;
  };

  // ---- Mois
  const appMonthByKey = new Map(app.months.map((m) => [monthKeyOf(m.month_date), m]));
  const appMonthById = new Map(app.months.map((m) => [m.id, m]));
  const fileMonthKeys = new Set<string>();
  const allKeys = new Set<string>([...appMonthByKey.keys(), ...(file.months ?? []).map((m) => m.key)]);
  const lastKey = [...allKeys].sort().pop();
  for (const m of file.months ?? []) {
    fileMonthKeys.add(m.key);
    const existingById = m.id ? appMonthById.get(m.id) : undefined;
    if (existingById && monthKeyOf(existingById.month_date) !== m.key) {
      err(SHEET.months, m.row, `Ne change pas le mois d'une ligne existante (${monthKeyOf(existingById.month_date)} devient ${m.key}) : ajoute plutôt une nouvelle ligne.`);
      continue;
    }
    const existing = existingById ?? appMonthByKey.get(m.key);
    if (!existing) {
      const status = m.status ?? (m.key === lastKey ? 'current' : 'closed');
      ops.createMonths.push({ key: m.key, status, override: m.override, real: m.realBalance });
      lines.push({ id: lineId(), entity: 'Mois', action: 'create', title: m.key, detail: `Nouveau mois (${STATUS_LABELS[status]})`, sheet: SHEET.months, row: m.row });
      continue;
    }
    const patch: Partial<MonthRow> = {};
    const changes: string[] = [];
    if (m.status && m.status !== existing.status) {
      patch.status = m.status;
      changes.push(`statut ${STATUS_LABELS[existing.status]} → ${STATUS_LABELS[m.status]}`);
    }
    const nOver = m.override;
    if ((nOver ?? null) !== (existing.starting_balance_override ?? null)) {
      patch.starting_balance_override = nOver;
      changes.push(`solde de départ forcé ${existing.starting_balance_override === null ? 'vide' : eur(existing.starting_balance_override)} → ${nOver === null ? 'vide' : eur(nOver)}`);
    }
    if ((m.realBalance ?? null) !== (existing.real_balance_check ?? null)) {
      patch.real_balance_check = m.realBalance;
      changes.push(`solde réel ${existing.real_balance_check === null ? 'vide' : eur(existing.real_balance_check)} → ${m.realBalance === null ? 'vide' : eur(m.realBalance)}`);
    }
    if (changes.length === 0) unchanged++;
    else {
      ops.updateMonths.push({ id: existing.id, patch });
      lines.push({ id: lineId(), entity: 'Mois', action: 'update', title: m.key, detail: changes.join(', '), sheet: SHEET.months, row: m.row });
    }
  }
  // Plusieurs mois "Courant" après import ?
  {
    const status = new Map(app.months.map((m) => [monthKeyOf(m.month_date), m.status as string]));
    for (const c of ops.createMonths) status.set(c.key, c.status);
    for (const u of ops.updateMonths) {
      const mm = appMonthById.get(u.id);
      if (mm && u.patch.status) status.set(monthKeyOf(mm.month_date), u.patch.status);
    }
    const current = [...status.entries()].filter(([, s]) => s === 'current').map(([k]) => k).sort();
    if (current.length > 1) {
      warn(SHEET.months, null, `Plusieurs mois sont « Courant » après l'import (${current.join(', ')}) : l'application affichera le plus ancien par défaut.`);
    }
  }
  const monthKnown = (key: string) => appMonthByKey.has(key) || fileMonthKeys.has(key);

  // ---- Dépenses fixes
  if (file.fixed) {
    const appFixedById = new Map(app.fixedExpenses.map((f) => [f.id, f]));
    // Une ligne sans ID qui ressemble à une dépense existante (même nom) est "à vérifier" et
    // désigne cette dépense : elle ne compte alors pas comme "absente du fichier".
    const byName = new Map<string, string[]>();
    for (const f of app.fixedExpenses) {
      const k = normalizeText(f.name);
      byName.set(k, [...(byName.get(k) ?? []), f.id]);
    }
    const seenIds = new Set<string>();
    for (const f of file.fixed) {
      if (!checkCategory(SHEET.fixed, f.row, f.categoryName)) continue;
      const data: FixedData = {
        name: f.name,
        amount: f.amount,
        categoryName: f.categoryName,
        frequency: f.frequency,
        payment_day: f.paymentDay,
        active: f.active,
      };
      const existing = f.id ? appFixedById.get(f.id) : undefined;
      if (f.id) seenIds.add(f.id);
      if (existing) {
        const patch: Partial<FixedData> = {};
        const changes: string[] = [];
        if (existing.name !== f.name) { patch.name = f.name; changes.push(`nom « ${existing.name} » → « ${f.name} »`); }
        if (round2(existing.amount) !== round2(f.amount)) { patch.amount = f.amount; changes.push(`montant ${eur(existing.amount)} → ${eur(f.amount)}`); }
        const oldCat = existing.category_id ? appCatNameById.get(existing.category_id) ?? null : null;
        if (normalizeText(oldCat) !== normalizeText(f.categoryName)) { patch.categoryName = f.categoryName; changes.push(`catégorie ${oldCat ?? 'aucune'} → ${f.categoryName ?? 'aucune'}`); }
        if (existing.frequency !== f.frequency) { patch.frequency = f.frequency; changes.push(`fréquence ${FREQUENCY_LABELS[existing.frequency]} → ${FREQUENCY_LABELS[f.frequency]}`); }
        if (existing.payment_day !== f.paymentDay) { patch.payment_day = f.paymentDay; changes.push(`jour ${existing.payment_day} → ${f.paymentDay}`); }
        if (existing.active !== f.active) { patch.active = f.active; changes.push(`${existing.active ? 'active → inactive' : 'inactive → active'}`); }
        if (changes.length === 0) unchanged++;
        else {
          const id = lineId();
          ops.updateFixed.push({ lineId: id, id: existing.id, patch });
          lines.push({ id, entity: 'Dépense fixe', action: 'update', title: f.name, detail: changes.join(', '), sheet: SHEET.fixed, row: f.row });
        }
        continue;
      }
      if (f.id) warn(SHEET.fixed, f.row, `L'identifiant de « ${f.name} » est inconnu de l'application (ligne supprimée depuis l'export ?) : la ligne est traitée comme nouvelle.`);
      const id = lineId();
      const similar = byName.get(normalizeText(f.name));
      const doubtful = !!similar && similar.length > 0;
      if (doubtful) seenIds.add(similar!.shift()!);
      ops.createFixed.push({ lineId: id, data });
      lines.push({
        id,
        entity: 'Dépense fixe',
        action: doubtful ? 'doubtful' : 'create',
        title: f.name,
        detail: doubtful
          ? `Ressemble à une dépense fixe existante (même nom). ${eur(f.amount)}, ${FREQUENCY_LABELS[f.frequency].toLowerCase()}`
          : `${eur(f.amount)}, ${FREQUENCY_LABELS[f.frequency].toLowerCase()}`,
        sheet: SHEET.fixed,
        row: f.row,
      });
    }
    for (const a of app.fixedExpenses) {
      if (seenIds.has(a.id)) continue;
      const id = lineId();
      ops.deleteFixed.push({ lineId: id, id: a.id });
      lines.push({ id, entity: 'Dépense fixe', action: 'delete', title: a.name, detail: `${eur(a.amount)}, absente du fichier`, sheet: SHEET.fixed, row: null });
    }
  }

  // ---- Transactions
  if (file.transactions) {
    const appTxById = new Map(app.transactions.map((t) => [t.id, t]));
    const keyOfMonthId = (id: string) => {
      const m = appMonthById.get(id);
      return m ? monthKeyOf(m.month_date) : null;
    };
    // Même principe : une ligne sans ID identique à une ligne existante (mois, nom, montant, date, type)
    // est "à vérifier" et désigne cette ligne, qui ne compte plus comme "absente du fichier".
    const lookalike = new Map<string, string[]>();
    for (const t of app.transactions) {
      const k = [keyOfMonthId(t.month_id), normalizeText(t.name), round2(t.amount), t.tx_date ?? '', t.type].join('|');
      lookalike.set(k, [...(lookalike.get(k) ?? []), t.id]);
    }
    const seenIds = new Set<string>();
    for (const t of file.transactions) {
      let ok = true;
      if (!monthKnown(t.monthKey)) {
        err(SHEET.transactions, t.row, `Mois ${t.monthKey} inconnu : ajoute-le d'abord dans l'onglet ${SHEET.months}.`);
        ok = false;
      }
      if (!checkCategory(SHEET.transactions, t.row, t.categoryName)) ok = false;
      if (!ok) continue;

      const data: TxData = {
        monthKey: t.monthKey,
        type: t.type,
        name: t.name,
        amount: t.amount,
        categoryName: t.categoryName,
        tx_date: t.date,
        detail: t.detail,
        necessary: t.necessary,
        received: t.received,
      };
      const existing = t.id ? appTxById.get(t.id) : undefined;
      if (t.id) seenIds.add(t.id);
      if (existing) {
        const patch: Partial<TxData> = {};
        const changes: string[] = [];
        const oldKey = keyOfMonthId(existing.month_id);
        if (oldKey !== t.monthKey) { patch.monthKey = t.monthKey; changes.push(`mois ${oldKey} → ${t.monthKey}`); }
        if (existing.type !== t.type) { patch.type = t.type; changes.push(`type ${TYPE_LABELS[existing.type]} → ${TYPE_LABELS[t.type]}`); }
        if (existing.name !== t.name) { patch.name = t.name; changes.push(`nom « ${existing.name} » → « ${t.name} »`); }
        if (round2(existing.amount) !== round2(t.amount)) { patch.amount = t.amount; changes.push(`montant ${eur(existing.amount)} → ${eur(t.amount)}`); }
        const oldCat = existing.category_id ? appCatNameById.get(existing.category_id) ?? null : null;
        if (normalizeText(oldCat) !== normalizeText(t.categoryName)) { patch.categoryName = t.categoryName; changes.push(`catégorie ${oldCat ?? 'aucune'} → ${t.categoryName ?? 'aucune'}`); }
        if ((existing.tx_date ?? null) !== t.date) { patch.tx_date = t.date; changes.push(`date ${frDate(existing.tx_date)} → ${frDate(t.date)}`); }
        if ((existing.detail ?? null) !== (t.detail ?? null)) { patch.detail = t.detail; changes.push('détail modifié'); }
        if (t.type !== 'income' && (existing.necessary ?? null) !== t.necessary) { patch.necessary = t.necessary; changes.push(`nécessaire ${existing.necessary === null ? 'vide' : existing.necessary ? 'Oui' : 'Non'} → ${t.necessary === null ? 'vide' : t.necessary ? 'Oui' : 'Non'}`); }
        if (t.type === 'income' && Boolean(existing.received) !== Boolean(t.received)) { patch.received = t.received; changes.push(`reçu ${existing.received ? 'Oui' : 'Non'} → ${t.received ? 'Oui' : 'Non'}`); }
        if (changes.length === 0) unchanged++;
        else {
          const id = lineId();
          ops.updateTx.push({ lineId: id, id: existing.id, patch });
          lines.push({ id, entity: 'Transaction', action: 'update', title: `${t.name} (${t.monthKey})`, detail: changes.join(', '), sheet: SHEET.transactions, row: t.row });
        }
        continue;
      }
      if (t.id) warn(SHEET.transactions, t.row, `L'identifiant de « ${t.name} » est inconnu de l'application (ligne supprimée depuis l'export ?) : la ligne est traitée comme nouvelle.`);
      const id = lineId();
      const similar = lookalike.get([t.monthKey, normalizeText(t.name), round2(t.amount), t.date ?? '', t.type].join('|'));
      const doubtful = !!similar && similar.length > 0;
      if (doubtful) seenIds.add(similar!.shift()!);
      ops.createTx.push({ lineId: id, data });
      const base = `${TYPE_LABELS[t.type]}, ${eur(t.amount)}, ${frDate(t.date)}`;
      lines.push({
        id,
        entity: 'Transaction',
        action: doubtful ? 'doubtful' : 'create',
        title: `${t.name} (${t.monthKey})`,
        detail: doubtful ? `Ressemble à une ligne existante (même mois, nom, montant et date). ${base}` : base,
        sheet: SHEET.transactions,
        row: t.row,
      });
    }
    // Absentes du fichier : seulement pour les mois présents dans le fichier
    for (const a of app.transactions) {
      if (seenIds.has(a.id)) continue;
      const key = keyOfMonthId(a.month_id);
      if (!key || !fileMonthKeys.has(key)) continue;
      const id = lineId();
      ops.deleteTx.push({ lineId: id, id: a.id });
      lines.push({ id, entity: 'Transaction', action: 'delete', title: `${a.name} (${key})`, detail: `${TYPE_LABELS[a.type]}, ${eur(a.amount)}, ${frDate(a.tx_date)}, absente du fichier`, sheet: SHEET.transactions, row: null });
    }
  }

  return { lines, issues, unchanged, ops };
}
