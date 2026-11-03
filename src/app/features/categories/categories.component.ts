import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/services/data.service';
import { Category } from '../../core/models/models';
import { DialogService } from '../../shared/confirm-dialog/dialog.service';

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss',
})
export class CategoriesComponent {
  newName = signal('');
  saving = signal(false);
  error = signal<string | null>(null);

  /** Nombre d'opérations (transactions et dépenses fixes) rattachées à chaque catégorie. */
  usage = computed(() => {
    const counts = new Map<string, number>();
    for (const t of this.data.transactions()) {
      if (t.category_id) counts.set(t.category_id, (counts.get(t.category_id) ?? 0) + 1);
    }
    for (const f of this.data.fixedExpenses()) {
      if (f.category_id) counts.set(f.category_id, (counts.get(f.category_id) ?? 0) + 1);
    }
    return counts;
  });

  private dialog = inject(DialogService);

  activeList = computed(() => this.data.categories().filter((c) => !c.archived));
  archivedList = computed(() => this.data.categories().filter((c) => c.archived));
  showArchived = signal(false);

  constructor(public data: DataService) {}

  usageLabel(id: string): string {
    const n = this.usage().get(id) ?? 0;
    if (n === 0) return 'Aucune opération';
    return n === 1 ? '1 opération' : `${n} opérations`;
  }

  /** La catégorie "Épargne" pilote le calcul de l'épargne (voir calc.ts) : on la protège. */
  isSavings(name: string): boolean {
    return (
      name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase() === 'epargne'
    );
  }

  initial(name: string): string {
    return (name.trim().charAt(0) || '?').toUpperCase();
  }

  /**
   * Teinte stable calculée à partir du nom : la couleur d'une catégorie ne change jamais.
   * Elle est choisie parmi les 6 teintes de la palette de l'app (pétrole, terracotta,
   * bleu, or, prune, vert) pour rester harmonieuse avec le reste de l'interface.
   */
  private static readonly HUES = [189, 14, 220, 43, 313, 150];

  private hue(name: string): number {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return CategoriesComponent.HUES[h % CategoriesComponent.HUES.length];
  }

  dotBackground(name: string): string {
    return `hsl(${this.hue(name)} 70% 92%)`;
  }

  dotColor(name: string): string {
    return `hsl(${this.hue(name)} 55% 32%)`;
  }

  async add() {
    const name = this.newName().trim();
    if (!name) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.data.addCategory(name);
      this.newName.set('');
    } catch (e: any) {
      this.error.set(e?.message ?? "Erreur lors de l'ajout.");
    } finally {
      this.saving.set(false);
    }
  }

  async rename(id: string, value: string) {
    if (value.trim()) await this.data.renameCategory(id, value.trim());
  }

  async remove(id: string) {
    const inUse =
      this.data.fixedExpenses().some((f) => f.category_id === id) ||
      this.data.transactions().some((t) => t.category_id === id);
    const ok = await this.dialog.confirm({
      title: 'Supprimer cette catégorie ?',
      message: inUse
        ? 'Elle est utilisée par des dépenses fixes ou des transactions existantes. Elles resteront, mais deviendront "sans catégorie" dans tous les mois, y compris les mois passés : leur historique par catégorie sera perdu.\nSi tu veux seulement ne plus l\'utiliser, archive la catégorie : elle disparaît des listes mais garde son historique.'
        : 'Cette catégorie n\'est utilisée par aucune dépense.',
      confirmLabel: inUse ? 'Supprimer quand même' : 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    });
    if (ok) await this.run(() => this.data.deleteCategory(id));
  }

  async archive(id: string) {
    await this.run(() => this.data.setCategoryArchived(id, true));
  }

  async restore(id: string) {
    await this.run(() => this.data.setCategoryArchived(id, false));
  }

  /** Budget par défaut : champ vide ou négatif = aucun budget. */
  async saveBudget(c: Category, raw: string) {
    const n = raw.trim() === '' ? null : Number(raw.replace(',', '.'));
    const amount = n === null || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100;
    if (amount === (c.budget_default ?? null)) return;
    await this.run(() => this.data.setCategoryBudget(c.id, amount, c.budget_include_fixed !== false));
  }

  async toggleIncludeFixed(c: Category, excludeFixed: boolean) {
    await this.run(() => this.data.setCategoryBudget(c.id, c.budget_default ?? null, !excludeFixed));
  }

  private async run(action: () => Promise<void>) {
    this.error.set(null);
    try {
      await action();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Erreur lors de l\'enregistrement.');
    }
  }
}
