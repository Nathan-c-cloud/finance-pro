import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type SortDir = 'asc' | 'desc';

/**
 * Barre "Trier par" partagée par les listes de l'application : une pastille par critère,
 * la flèche indique le sens (croissant ou décroissant). Le parent garde l'état du tri et
 * réagit à `toggled` : un clic sélectionne le critère, un second clic inverse le sens.
 */
@Component({
  selector: 'app-sort-bar',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sort-bar" role="group" aria-label="Trier la liste">
      <span class="sort-label">Trier par</span>
      @for (o of options(); track o.key) {
        <button
          type="button"
          class="sort-chip"
          [class.active]="sortKey() === o.key"
          [attr.aria-pressed]="sortKey() === o.key"
          (click)="toggled.emit(o.key)"
        >
          {{ o.label }}
          @if (sortKey() === o.key) {
            <app-icon [name]="dir() === 'asc' ? 'arrow-up' : 'arrow-down'" [strokeWidth]="2.4" />
          }
        </button>
      }
      @if (hint()) {
        <span class="sort-hint">{{ hint() }}</span>
      }
    </div>
  `,
  styles: [
    `
      .sort-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.4rem;
        margin-bottom: 0.6rem;
        font-size: 0.8rem;
      }
      .sort-label {
        color: var(--color-text-secondary);
        margin-right: 0.1rem;
      }
      .sort-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.3rem 0.65rem;
        border-radius: 999px;
        font-size: 0.8rem;
        color: var(--color-text-secondary);
      }
      .sort-chip.active {
        background: var(--color-primary-soft);
        border-color: var(--color-primary-border);
        color: var(--color-primary);
        font-weight: 600;
      }
      .sort-chip app-icon {
        width: 1em;
        height: 1em;
      }
      .sort-hint {
        color: var(--color-text-secondary);
        margin-left: 0.25rem;
      }
    `,
  ],
})
export class SortBarComponent {
  options = input.required<{ key: string; label: string }[]>();
  /** Critère actif (null = aucun, ordre d'origine). */
  sortKey = input<string | null>(null);
  dir = input<SortDir>('asc');
  hint = input('');
  toggled = output<string>();
}
