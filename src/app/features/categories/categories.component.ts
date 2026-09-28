import { Component, signal } from '@angular/core';
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

  constructor(public data: DataService) {}

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
