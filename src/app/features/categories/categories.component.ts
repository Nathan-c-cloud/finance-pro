import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/services/data.service';

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

  /** Teinte stable calculée à partir du nom : la couleur d'une catégorie ne change jamais. */
  private hue(name: string): number {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
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
    const msg = inUse
      ? 'Cette catégorie est utilisée par des dépenses fixes ou des transactions existantes, qui resteront mais deviendront "sans catégorie" visuellement. Continuer ?'
      : 'Supprimer cette catégorie ?';
    if (confirm(msg)) {
      await this.data.deleteCategory(id);
    }
  }
}
