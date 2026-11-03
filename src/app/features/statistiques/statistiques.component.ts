import { Component, computed, signal } from '@angular/core';
import { DataService } from '../../core/services/data.service';
import { categoryStats, completeMonths } from '../../core/services/stats';
import { formatMonthLabelShort } from '../../core/services/calc';
import { formatEUR } from '../../core/services/format';
import { BudgetSuggestionsComponent } from '../../shared/budget-suggestions/budget-suggestions.component';

@Component({
  selector: 'app-statistiques',
  standalone: true,
  imports: [BudgetSuggestionsComponent],
  templateUrl: './statistiques.component.html',
  styleUrl: './statistiques.component.scss',
})
export class StatistiquesComponent {
  readonly periods = [3, 6, 12];
  period = signal(6);
  formatEUR = formatEUR;

  /** Mois terminés pris en compte, du plus ancien au plus récent. */
  window = computed(() => completeMonths(this.data.sortedMonths()).slice(-this.period()));

  labels = computed(() => this.window().map((m) => formatMonthLabelShort(m.month_date)));

  rows = computed(() => categoryStats(this.window(), this.data.transactions(), this.data.categories()));

  /** Dépenses totales par mois, hors épargne (même définition que « Dépenses (hors épargne) »). */
  totals = computed(() => {
    const byId = new Map(this.data.allSummaries().map((s) => [s.month.id, s.expensesExcludingSavings]));
    return this.window().map((m) => byId.get(m.id) ?? 0);
  });

  constructor(public data: DataService) {}

  isOver(amount: number, budget: number | null): boolean {
    return budget !== null && amount > budget + 0.005;
  }
}
