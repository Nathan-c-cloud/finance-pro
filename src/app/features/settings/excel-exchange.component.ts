import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../core/services/data.service';
import { DialogService } from '../../shared/confirm-dialog/dialog.service';
import { buildWorkbookBlob } from '../../core/excel/excel-export';
import { ImportPlan, Issue, PlanLine, buildImportPlan, parseWorkbook } from '../../core/excel/excel-import';

/**
 * Échange avec Excel : export du classeur aux couleurs de l'application, import avec aperçu.
 * L'import ne change rien tant que l'utilisateur n'a pas validé l'aperçu.
 */
@Component({
  selector: 'app-excel-exchange',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './excel-exchange.component.html',
  styleUrl: './excel-exchange.component.scss',
})
export class ExcelExchangeComponent {
  exporting = signal(false);
  exportError = signal<string | null>(null);

  reading = signal(false);
  readError = signal<string | null>(null);
  fileName = signal('');
  plan = signal<ImportPlan | null>(null);

  applying = signal(false);
  applyError = signal<string | null>(null);
  done = signal<string | null>(null);

  /** Lignes "à vérifier" cochées par l'utilisateur (décochées par défaut). */
  includeDoubtful = signal<ReadonlySet<string>>(new Set());
  deleteMissing = signal(false);

  errors = computed<Issue[]>(() => this.plan()?.issues.filter((i) => i.level === 'error') ?? []);
  warnings = computed<Issue[]>(() => this.plan()?.issues.filter((i) => i.level === 'warning') ?? []);
  private byAction = (a: PlanLine['action']) => computed(() => this.plan()?.lines.filter((l) => l.action === a) ?? []);
  creates = this.byAction('create');
  updates = this.byAction('update');
  doubtful = this.byAction('doubtful');
  deletes = this.byAction('delete');

  /** Nombre de changements qui seront réellement appliqués avec les choix actuels. */
  toApply = computed(
    () =>
      this.creates().length +
      this.updates().length +
      this.doubtful().filter((l) => this.includeDoubtful().has(l.id)).length +
      (this.deleteMissing() ? this.deletes().length : 0)
  );

  private dialog = inject(DialogService);

  constructor(private data: DataService) {}

  async exportExcel() {
    this.exporting.set(true);
    this.exportError.set(null);
    this.done.set(null);
    try {
      const blob = await buildWorkbookBlob({
        categories: this.data.categories(),
        fixedExpenses: this.data.fixedExpenses(),
        months: this.data.sortedMonths(),
        transactions: this.data.transactions(),
        initialBalance: this.data.settings()?.initial_balance ?? 0,
        summaries: this.data.allSummaries(),
        exportedAt: new Date(),
      });
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `suivi-budget-${stamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e: any) {
      this.exportError.set(e?.message ?? "Erreur lors de la création du fichier Excel.");
    } finally {
      this.exporting.set(false);
    }
  }

  async onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.reading.set(true);
    this.readError.set(null);
    this.applyError.set(null);
    this.done.set(null);
    this.plan.set(null);
    this.includeDoubtful.set(new Set());
    this.deleteMissing.set(false);
    this.fileName.set(file.name);
    try {
      const parsed = await parseWorkbook(await file.arrayBuffer());
      this.plan.set(
        buildImportPlan(parsed, {
          categories: this.data.categories(),
          fixedExpenses: this.data.fixedExpenses(),
          months: this.data.sortedMonths(),
          transactions: this.data.transactions(),
          settings: this.data.settings(),
        })
      );
    } catch (e: any) {
      this.readError.set(e?.message ?? 'Impossible de lire ce fichier.');
    } finally {
      this.reading.set(false);
      input.value = '';
    }
  }

  toggleDoubtful(id: string) {
    this.includeDoubtful.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleAllDoubtful(checked: boolean) {
    this.includeDoubtful.set(new Set(checked ? this.doubtful().map((l) => l.id) : []));
  }

  where(i: { sheet: string; row: number | null }): string {
    return i.row ? `${i.sheet}, ligne ${i.row}` : i.sheet;
  }

  cancel() {
    this.plan.set(null);
    this.readError.set(null);
    this.applyError.set(null);
  }

  async apply() {
    const plan = this.plan();
    if (!plan || this.errors().length > 0) return;
    const deleting = this.deleteMissing() ? this.deletes().length : 0;
    if (deleting > 0) {
      const ok = await this.dialog.confirm({
        title: `Supprimer ${deleting} ligne(s) ?`,
        message: "Ces lignes seront supprimées définitivement de l'application. Cette action est irréversible.",
        confirmLabel: 'Supprimer et importer',
        danger: true,
      });
      if (!ok) return;
    }

    this.applying.set(true);
    this.applyError.set(null);
    try {
      const r = await this.data.applyImportPlan(plan, {
        includeDoubtful: this.includeDoubtful(),
        deleteMissing: this.deleteMissing(),
      });
      const skipped = r.skipped > 0 ? `, ${r.skipped} ligne(s) à vérifier laissée(s) de côté` : '';
      this.done.set(
        `Import terminé : ${r.created} ajouté(s), ${r.updated} modifié(s), ${r.deleted} supprimé(s)${skipped}. Télécharge un nouvel export pour repartir d'un fichier à jour.`
      );
      this.plan.set(null);
    } catch (e: any) {
      this.applyError.set(e?.message ?? "Erreur lors de l'import.");
    } finally {
      this.applying.set(false);
    }
  }
}
