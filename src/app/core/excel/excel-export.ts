import type { Workbook, Worksheet } from 'exceljs';
import { Category, FixedExpense, MonthRow, MonthSummary, Transaction } from '../models/models';
import { FREQUENCIES, monthlyShare } from '../services/fixed-expense';
import {
  FORMAT_VERSION,
  FREQUENCY_LABELS,
  H,
  MAX_ROWS,
  MONTH_FORMULA_ROWS,
  NO,
  SHEET,
  STATUS_LABELS,
  TYPE_LABELS,
  XL_COLORS,
  YES,
  monthKeyOf,
  normalizeText,
  q,
  toExcelDate,
} from './excel-format';

export interface ExportSnapshot {
  categories: Category[];
  fixedExpenses: FixedExpense[];
  /** Triés du plus ancien au plus récent. */
  months: MonthRow[];
  transactions: Transaction[];
  initialBalance: number;
  /** Un résumé par mois, dans le même ordre que `months`. */
  summaries: MonthSummary[];
  exportedAt: Date;
}

const FONT = 'Calibri';
const MONEY = '#,##0.00\\ "€"';
const DATE_FMT = 'dd/mm/yyyy';
const EXTRA_ROWS = 300; // lignes vides mises en forme sous les données

/** Génère le classeur d'échange (.xlsx) aux couleurs de l'application. */
export async function buildWorkbookBlob(snapshot: ExportSnapshot): Promise<Blob> {
  // Bibliothèque volumineuse : chargée seulement quand on exporte.
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = 'Suivi Budget';
  wb.title = FORMAT_VERSION;
  wb.created = snapshot.exportedAt;

  const savingsName =
    snapshot.categories.find((c) => normalizeText(c.name) === 'epargne')?.name ?? 'Épargne';
  const catName = new Map(snapshot.categories.map((c) => [c.id, c.name]));
  const monthKeyById = new Map(snapshot.months.map((m) => [m.id, monthKeyOf(m.month_date)]));

  addReadme(wb, snapshot);
  addSettings(wb, snapshot, savingsName);
  addCategories(wb, snapshot);
  addFixedExpenses(wb, snapshot, catName);
  addMonths(wb, snapshot);
  addTransactions(wb, snapshot, catName, monthKeyById);

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ------------------------------------------------------------------
// Mise en forme commune
// ------------------------------------------------------------------

function styleHeader(ws: Worksheet, calculatedFrom?: number) {
  const row = ws.getRow(1);
  row.height = 30;
  row.eachCell((cell, col) => {
    const calc = calculatedFrom !== undefined && col >= calculatedFrom;
    cell.font = { name: FONT, bold: true, size: 11, color: { argb: XL_COLORS.white } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: calc ? XL_COLORS.textSecondary : XL_COLORS.primary },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
  });
  ws.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  ws.properties.tabColor = { argb: XL_COLORS.primary };
}

function styleBody(ws: Worksheet, lastRow: number, lastCol: number, calculatedFrom?: number) {
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    row.height = 20;
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);
      const calc = calculatedFrom !== undefined && c >= calculatedFrom;
      cell.font = {
        name: FONT,
        size: 11,
        color: { argb: calc ? XL_COLORS.primary : XL_COLORS.text },
        italic: calc,
      };
      cell.border = { bottom: { style: 'thin', color: { argb: XL_COLORS.border } } };
      cell.alignment = { vertical: 'middle', horizontal: cell.alignment?.horizontal, indent: 1 };
      if (calc) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_COLORS.primarySoft } };
    }
  }
}

function listValidation(ws: Worksheet, range: string, formula: string, title: string) {
  (ws as any).dataValidations.add(range, {
    type: 'list',
    allowBlank: true,
    formulae: [formula],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: title,
    error: 'Choisis une valeur dans la liste.',
  });
}

// ------------------------------------------------------------------
// Onglets
// ------------------------------------------------------------------

function addReadme(wb: Workbook, s: ExportSnapshot) {
  const ws = wb.addWorksheet(SHEET.readme, { views: [{ showGridLines: false }] });
  ws.properties.tabColor = { argb: XL_COLORS.savings };
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 110;

  const date = s.exportedAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines: { text: string; kind: 'title' | 'sub' | 'h' | 'li' | 'small' | 'gap' }[] = [
    { text: "Suivi Budget, classeur d'échange", kind: 'title' },
    {
      text: `Exporté le ${date}. Ce fichier contient toutes tes données, comme dans l'application. Tu peux le remplir sans connexion, puis le réimporter : Réglages, Importer un fichier Excel.`,
      kind: 'sub',
    },
    { text: '', kind: 'gap' },
    { text: 'Les onglets', kind: 'h' },
    { text: `${SHEET.settings} : le solde initial, avant le premier mois.`, kind: 'li' },
    { text: `${SHEET.categories} : la liste des catégories (la catégorie « Épargne » pilote le calcul de l'épargne).`, kind: 'li' },
    { text: `${SHEET.fixed} : le modèle des charges récurrentes, copié dans chaque mois par le bouton « Ajouter les dépenses fixes ».`, kind: 'li' },
    { text: `${SHEET.months} : un mois par ligne, avec les soldes calculés (colonnes grises).`, kind: 'li' },
    { text: `${SHEET.transactions} : toutes les lignes de tous les mois (revenus, dépenses fixes, dépenses variables).`, kind: 'li' },
    { text: '', kind: 'gap' },
    { text: 'Comment remplir', kind: 'h' },
    { text: "Ajoute une ligne à la suite du tableau. Laisse la colonne ID vide (elle est masquée) : l'application la créera.", kind: 'li' },
    { text: 'Ne supprime pas la colonne ID et ne modifie pas les identifiants existants : ils permettent de retrouver chaque ligne.', kind: 'li' },
    { text: 'Écris le mois au format AAAA-MM (par exemple 2026-10), ou choisis-le dans la liste.', kind: 'li' },
    { text: "Les montants sont positifs, avec la virgule ou le point. C'est le type (Revenu, Dépense fixe, Dépense variable) qui donne le sens.", kind: 'li' },
    { text: `Pour une nouvelle catégorie, ajoute-la d'abord dans l'onglet ${SHEET.categories}, puis choisis-la dans la liste.`, kind: 'li' },
    { text: `Dans l'onglet ${SHEET.months}, garde les mois dans l'ordre chronologique : le solde de fin d'un mois devient le solde de début du suivant. Les colonnes grises sont calculées, ne les modifie pas.`, kind: 'li' },
    { text: `« Solde de départ forcé » est optionnel : laisse-le vide pour reporter automatiquement le solde de fin du mois précédent. « Solde réel constaté » sert au rapprochement bancaire (optionnel aussi).`, kind: 'li' },
    { text: `Les formules et les listes couvrent ${MAX_ROWS} lignes de transactions et ${MONTH_FORMULA_ROWS} mois.`, kind: 'li' },
    { text: '', kind: 'gap' },
    { text: "À l'import", kind: 'h' },
    { text: "L'application affiche d'abord un aperçu : rien n'est modifié avant que tu valides.", kind: 'li' },
    { text: "Une ligne dont l'ID existe est mise à jour. Une ligne sans ID est ajoutée.", kind: 'li' },
    { text: "Une ligne absente du fichier n'est jamais supprimée, sauf si tu coches l'option dans l'aperçu.", kind: 'li' },
    { text: "Après un import, télécharge un nouvel export pour repartir d'un fichier à jour.", kind: 'li' },
    { text: '', kind: 'gap' },
    { text: FORMAT_VERSION, kind: 'small' },
  ];

  lines.forEach((l, i) => {
    const row = ws.getRow(i + 2);
    const cell = row.getCell(2);
    cell.value = l.text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    switch (l.kind) {
      case 'title':
        cell.font = { name: FONT, size: 22, bold: true, color: { argb: XL_COLORS.primary } };
        row.height = 36;
        break;
      case 'sub':
        cell.font = { name: FONT, size: 12, color: { argb: XL_COLORS.textSecondary } };
        row.height = 36;
        break;
      case 'h':
        cell.font = { name: FONT, size: 13, bold: true, color: { argb: XL_COLORS.primary } };
        cell.border = { bottom: { style: 'thin', color: { argb: XL_COLORS.primaryBorder } } };
        row.height = 24;
        break;
      case 'li':
        cell.value = '•  ' + l.text;
        cell.font = { name: FONT, size: 11, color: { argb: XL_COLORS.text } };
        row.height = l.text.length > 105 ? 34 : 20;
        break;
      case 'small':
        cell.font = { name: FONT, size: 9, color: { argb: XL_COLORS.textSecondary } };
        break;
      default:
        row.height = 10;
    }
  });
  // Fond sable sur toute la zone visible, comme la page de l'application
  for (let r = 1; r <= lines.length + 12; r++) {
    for (let c = 1; c <= 3; c++) {
      ws.getRow(r).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_COLORS.sand } };
    }
  }
}

function addSettings(wb: Workbook, s: ExportSnapshot, savingsName: string) {
  const ws = wb.addWorksheet(SHEET.settings);
  ws.columns = [
    { header: H.settingName, key: 'k', width: 34 },
    { header: H.settingValue, key: 'v', width: 22 },
    { header: '', key: 'note', width: 70 },
  ];
  ws.addRow({ k: H.initialBalance, v: s.initialBalance, note: 'Le solde bancaire avant le premier mois enregistré.' });
  ws.addRow({ k: H.savingsCategory, v: savingsName, note: "Nom de la catégorie d'épargne, utilisé par les formules de l'onglet Mois (ne pas modifier)." });
  styleHeader(ws);
  styleBody(ws, 3, 3);
  ws.getCell('B2').numFmt = MONEY;
  ws.getCell('B2').alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
  ws.getCell('C1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_COLORS.sand } };
  for (const a of ['C2', 'C3']) ws.getCell(a).font = { name: FONT, size: 10, italic: true, color: { argb: XL_COLORS.textSecondary } };
  ws.getCell('B2').dataValidation = { type: 'decimal', operator: 'between', formulae: [-1e9, 1e9], allowBlank: false, showErrorMessage: true, error: 'Saisis un montant.' };
}

function addCategories(wb: Workbook, s: ExportSnapshot) {
  const ws = wb.addWorksheet(SHEET.categories);
  ws.columns = [{ header: H.categoryName, key: 'name', width: 34 }];
  for (const c of s.categories) ws.addRow({ name: c.name });
  const last = Math.max(s.categories.length + 1 + 40, 42);
  styleHeader(ws);
  styleBody(ws, last, 1);
}

function addFixedExpenses(wb: Workbook, s: ExportSnapshot, catName: Map<string, string>) {
  const ws = wb.addWorksheet(SHEET.fixed);
  ws.columns = [
    { header: H.id, key: 'id', width: 12, hidden: true },
    { header: H.fixedName, key: 'name', width: 30 },
    { header: H.fixedAmount, key: 'amount', width: 18, style: { numFmt: MONEY } },
    { header: H.fixedCategory, key: 'cat', width: 22 },
    { header: H.fixedFrequency, key: 'freq', width: 20 },
    { header: H.fixedDay, key: 'day', width: 14 },
    { header: H.fixedActive, key: 'active', width: 10 },
    { header: H.fixedShare, key: 'share', width: 18, style: { numFmt: MONEY } },
  ];
  const freqList = FREQUENCIES.map((f) => f.label);
  const last = s.fixedExpenses.length + 1 + EXTRA_ROWS;
  s.fixedExpenses.forEach((f, i) => {
    const r = i + 2;
    ws.addRow({
      id: f.id,
      name: f.name,
      amount: f.amount,
      cat: f.category_id ? catName.get(f.category_id) ?? '' : '',
      freq: FREQUENCY_LABELS[f.frequency],
      day: f.payment_day,
      active: f.active ? YES : NO,
      share: { formula: shareFormula(r), result: monthlyShare(f.amount, f.frequency) },
    });
  });
  styleHeader(ws, 8);
  styleBody(ws, last, 8, 8);
  // Formule de la part mensuelle aussi sur les lignes vides (vide tant que la ligne est vide)
  for (let r = s.fixedExpenses.length + 2; r <= last; r++) {
    ws.getCell(`H${r}`).value = { formula: shareFormula(r), result: '' };
  }
  listValidation(ws, `D2:D${MAX_ROWS}`, `${q(SHEET.categories)}!$A$2:$A$200`, 'Catégorie');
  listValidation(ws, `E2:E${MAX_ROWS}`, `"${freqList.join(',')}"`, 'Fréquence');
  listValidation(ws, `G2:G${MAX_ROWS}`, `"${YES},${NO}"`, 'Active');
  (ws as any).dataValidations.add(`F2:F${MAX_ROWS}`, {
    type: 'whole', operator: 'between', formulae: [1, 28], allowBlank: true,
    showErrorMessage: true, errorTitle: 'Jour de prélèvement', error: 'Saisis un jour entre 1 et 28.',
  });
  (ws as any).dataValidations.add(`C2:C${MAX_ROWS}`, {
    type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true,
    showErrorMessage: true, errorTitle: 'Montant', error: 'Saisis un montant positif.',
  });
  ws.autoFilter = { from: 'B1', to: 'H1' };
}

function shareFormula(r: number): string {
  const labels = FREQUENCIES.map((f) => `"${f.label}"`).join(',');
  const months = FREQUENCIES.map((f) => f.months).join(',');
  return `IF(OR($B${r}="",$C${r}=""),"",ROUND($C${r}/CHOOSE(MATCH($E${r},{${labels}},0),${months}),2))`;
}

function addMonths(wb: Workbook, s: ExportSnapshot) {
  const ws = wb.addWorksheet(SHEET.months);
  ws.columns = [
    { header: H.id, key: 'id', width: 12, hidden: true },
    { header: H.monthKey, key: 'key', width: 16, style: { numFmt: '@' } },
    { header: H.monthStatus, key: 'status', width: 12 },
    { header: H.monthOverride, key: 'override', width: 18, style: { numFmt: MONEY } },
    { header: H.monthRealBalance, key: 'real', width: 18, style: { numFmt: MONEY } },
    { header: H.monthStart, key: 'start', width: 16, style: { numFmt: MONEY } },
    { header: H.monthIncome, key: 'income', width: 16, style: { numFmt: MONEY } },
    { header: H.monthExpenses, key: 'expenses', width: 18, style: { numFmt: MONEY } },
    { header: H.monthSavings, key: 'savings', width: 14, style: { numFmt: MONEY } },
    { header: H.monthRate, key: 'rate', width: 14, style: { numFmt: '0.0%' } },
    { header: H.monthChange, key: 'change', width: 18, style: { numFmt: MONEY } },
    { header: H.monthEnd, key: 'end', width: 20, style: { numFmt: MONEY } },
  ];

  const T = SHEET.transactions;
  const R = MAX_ROWS;
  const tx = (col: string) => `${q(T)}!$${col}$2:$${col}$${R}`;
  const savings = `${q(SHEET.settings)}!$B$3`;
  const last = MONTH_FORMULA_ROWS + 1;

  for (let r = 2; r <= last; r++) {
    const i = r - 2;
    const m = s.months[i];
    const sum = s.summaries[i];
    const start =
      r === 2
        ? `IF($B2="","",IF($D2<>"",$D2,N(${q(SHEET.settings)}!$B$2)))`
        : `IF($B${r}="","",IF($D${r}<>"",$D${r},N($L${r - 1})))`;
    const income = `IF($B${r}="","",SUMPRODUCT(--(${tx('B')}=$B${r}),--(${tx('C')}="${TYPE_LABELS.income}"),${tx('E')}))`;
    const expenses = `IF($B${r}="","",SUMPRODUCT(--(${tx('B')}=$B${r}),--(${tx('C')}<>"${TYPE_LABELS.income}"),--(${tx('F')}<>${savings}),${tx('E')}))`;
    const sav = `IF($B${r}="","",SUMPRODUCT(--(${tx('B')}=$B${r}),--(${tx('F')}=${savings}),${tx('E')}))`;
    const rate = `IF($B${r}="","",IF($G${r}>0,$I${r}/$G${r},0))`;
    const change = `IF($B${r}="","",$G${r}-$H${r}-$I${r})`;
    const end = `IF($B${r}="","",$F${r}+$K${r})`;
    const res = (v: number | undefined) => (m ? v ?? 0 : '');
    ws.addRow({
      id: m?.id ?? null,
      key: m ? monthKeyOf(m.month_date) : null,
      status: m ? STATUS_LABELS[m.status] : null,
      override: m?.starting_balance_override ?? null,
      real: m?.real_balance_check ?? null,
      start: { formula: start, result: res(sum?.startingBalance) },
      income: { formula: income, result: res(sum?.income) },
      expenses: { formula: expenses, result: res(sum?.expensesExcludingSavings) },
      savings: { formula: sav, result: res(sum?.savings) },
      rate: { formula: rate, result: res(sum?.savingsRate) },
      change: { formula: change, result: res(sum ? sum.computedEndingBalance - sum.startingBalance : undefined) },
      end: { formula: end, result: res(sum?.computedEndingBalance) },
    });
  }
  styleHeader(ws, 6);
  styleBody(ws, last, 12, 6);
  listValidation(ws, `C2:C${last}`, `"${STATUS_LABELS.current},${STATUS_LABELS.closed}"`, 'Statut');
  (ws as any).dataValidations.add(`D2:E${last}`, {
    type: 'decimal', operator: 'between', formulae: [-1e9, 1e9], allowBlank: true,
    showErrorMessage: true, errorTitle: 'Montant', error: 'Saisis un montant (ou laisse vide).',
  });
}

function addTransactions(
  wb: Workbook,
  s: ExportSnapshot,
  catName: Map<string, string>,
  monthKeyById: Map<string, string>
) {
  const ws = wb.addWorksheet(SHEET.transactions);
  ws.columns = [
    { header: H.id, key: 'id', width: 12, hidden: true },
    { header: H.txMonth, key: 'month', width: 16, style: { numFmt: '@' } },
    { header: H.txType, key: 'type', width: 18 },
    { header: H.txName, key: 'name', width: 32 },
    { header: H.txAmount, key: 'amount', width: 14, style: { numFmt: MONEY } },
    { header: H.txCategory, key: 'cat', width: 22 },
    { header: H.txDate, key: 'date', width: 13, style: { numFmt: DATE_FMT } },
    { header: H.txDetail, key: 'detail', width: 34 },
    { header: H.txNecessary, key: 'necessary', width: 13 },
    { header: H.txReceived, key: 'received', width: 11 },
  ];

  const order = new Map(s.months.map((m, i) => [m.id, i]));
  const sorted = [...s.transactions].sort(
    (a, b) =>
      (order.get(a.month_id) ?? 0) - (order.get(b.month_id) ?? 0) ||
      (a.tx_date ?? '').localeCompare(b.tx_date ?? '') ||
      (a.created_at ?? '').localeCompare(b.created_at ?? '')
  );
  for (const t of sorted) {
    ws.addRow({
      id: t.id,
      month: monthKeyById.get(t.month_id) ?? '',
      type: TYPE_LABELS[t.type],
      name: t.name,
      amount: t.amount,
      cat: t.category_id ? catName.get(t.category_id) ?? '' : '',
      date: t.tx_date ? toExcelDate(t.tx_date) : null,
      detail: t.detail ?? '',
      necessary: t.type !== 'income' && t.necessary !== null ? (t.necessary ? YES : NO) : null,
      received: t.type === 'income' ? (t.received ? YES : NO) : null,
    });
  }
  const last = sorted.length + 1 + EXTRA_ROWS;
  styleHeader(ws);
  styleBody(ws, last, 10);
  listValidation(ws, `B2:B${MAX_ROWS}`, `${q(SHEET.months)}!$B$2:$B$${MONTH_FORMULA_ROWS + 1}`, 'Mois');
  listValidation(ws, `C2:C${MAX_ROWS}`, `"${Object.values(TYPE_LABELS).join(',')}"`, 'Type');
  listValidation(ws, `F2:F${MAX_ROWS}`, `${q(SHEET.categories)}!$A$2:$A$200`, 'Catégorie');
  listValidation(ws, `I2:J${MAX_ROWS}`, `"${YES},${NO}"`, 'Oui ou Non');
  (ws as any).dataValidations.add(`E2:E${MAX_ROWS}`, {
    type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true,
    showErrorMessage: true, errorTitle: 'Montant', error: 'Saisis un montant positif : le type donne le sens.',
  });
  // Les revenus ressortent en vert clair, comme dans l'application
  ws.addConditionalFormatting({
    ref: `A2:J${MAX_ROWS}`,
    rules: [
      {
        type: 'expression',
        priority: 1,
        formulae: [`$C2="${TYPE_LABELS.income}"`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: XL_COLORS.incomeSoft } } },
      },
    ],
  });
  ws.autoFilter = { from: 'B1', to: 'J1' };
}
