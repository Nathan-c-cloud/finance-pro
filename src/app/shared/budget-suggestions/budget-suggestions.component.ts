import { Component, computed, inject, signal } from '@angular/core';
import { DataService } from '../../core/services/data.service';
import { BudgetSuggestion } from '../../core/services/stats';
import { formatEUR } from '../../core/services/format';

/**
 * Suggestions de budget, avec les faits qui les justifient. Rien n'est appliqué sans ton clic :
 * « Ajuster » change le budget, « Garder » l'écarte jusqu'au prochain mois terminé.
 */
@Component({
  selector: 'app-budget-suggestions',
  standalone: true,
  template: `
    @if (data.budgetSuggestions().length > 0) {
      <div class="box">
        <h4>Suggestions de budget</h4>
        <p class="scope">
          D'après tes {{ data.suggestionResult().months.length }} derniers mois terminés. « Ajuster » change le budget par
          défaut et celui de {{ latestLabel() }}.
        </p>
        <ul>
          @for (s of data.budgetSuggestions(); track s.categoryId) {
            <li>
              <strong>{{ s.categoryName }}</strong>
              <span class="kind">{{ kindLabel(s) }}</span>
              <small>{{ s.facts }}</small>
              <div class="btns">
                <button class="primary" [disabled]="busy() === s.categoryId" (click)="apply(s)">
                  Ajuster à {{ eur(s.suggested) }}
                </button>
                <button class="ghost" (click)="data.dismissSuggestion(s)">
                  {{ s.current === null ? 'Pas de budget' : 'Garder ' + eur(s.current) }}
                </button>
              </div>
            </li>
          }
        </ul>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
      </div>
    }
  `,
  styles: [
    `
      .box {
        margin: 0 0 0.9rem;
        padding: 0.7rem 0.8rem;
        border-radius: 14px;
        background: var(--color-note-soft);
        color: var(--color-note-text);
      }

      h4 {
        margin: 0 0 0.2rem;
        font-size: 0.9rem;
      }

      .scope {
        margin: 0 0 0.6rem;
        font-size: 0.75rem;
        line-height: 1.4;
      }

      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.7rem;
      }

      li {
        display: grid;
        gap: 0.15rem;
        padding-top: 0.6rem;
        border-top: 1px solid rgba(176, 122, 46, 0.25);
      }

      li:first-child {
        padding-top: 0;
        border-top: 0;
      }

      .kind {
        font-size: 0.8rem;
      }

      small {
        font-size: 0.75rem;
        line-height: 1.4;
      }

      .btns {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-top: 0.3rem;
      }

      .btns button {
        padding: 0.35rem 0.7rem;
        font-size: 0.78rem;
      }

      .error {
        margin: 0.5rem 0 0;
      }
    `,
  ],
})
export class BudgetSuggestionsComponent {
  data = inject(DataService);
  busy = signal<string | null>(null);
  error = signal<string | null>(null);

  latestLabel = computed(() => {
    const m = this.data.sortedMonths();
    return m.length ? this.data.monthLabel(m[m.length - 1].month_date) : 'ce mois';
  });

  eur = formatEUR;

  kindLabel(s: BudgetSuggestion): string {
    if (s.kind === 'raise') return 'Relever le budget ?';
    if (s.kind === 'lower') return 'Baisser le budget ?';
    return 'Fixer un budget ?';
  }

  async apply(s: BudgetSuggestion) {
    this.busy.set(s.categoryId);
    this.error.set(null);
    try {
      await this.data.applySuggestion(s);
    } catch (e: any) {
      this.error.set(e?.message ?? "Erreur lors de l'ajustement du budget.");
    } finally {
      this.busy.set(null);
    }
  }
}
