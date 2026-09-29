import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/**
 * Champ de recherche partagé par les listes de l'application (transactions, dépenses fixes).
 * Le parent garde le texte saisi via `[(value)]` et filtre sa liste ; `info` affiche le nombre de résultats.
 */
@Component({
  selector: 'app-search-box',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="search" role="search">
      <app-icon class="lens" name="search" />
      <input
        type="text"
        autocomplete="off"
        enterkeyhint="search"
        [value]="value()"
        [placeholder]="placeholder()"
        [attr.aria-label]="placeholder()"
        (input)="value.set($any($event.target).value)"
        (keydown.escape)="clear($event)"
      />
      @if (value()) {
        <button type="button" class="clear" aria-label="Effacer la recherche" (click)="clear()">
          <app-icon name="x" />
        </button>
      }
    </div>
    @if (value() && info()) {
      <span class="result-count" aria-live="polite">{{ info() }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.4rem 0.75rem;
        margin-bottom: 0.6rem;
      }
      .search {
        position: relative;
        flex: 1 1 220px;
        max-width: 360px;
      }
      .lens {
        position: absolute;
        left: 0.7rem;
        top: 50%;
        transform: translateY(-50%);
        color: var(--color-text-secondary);
        pointer-events: none;
      }
      input {
        width: 100%;
        padding-left: 2.2rem;
        padding-right: 2.2rem;
      }
      .clear {
        position: absolute;
        right: 0.25rem;
        top: 50%;
        transform: translateY(-50%);
        display: grid;
        place-items: center;
        width: 1.8rem;
        height: 1.8rem;
        padding: 0;
        border: none;
        background: none;
        color: var(--color-text-secondary);
        font-size: 0.9rem;
      }
      .result-count {
        font-size: 0.8rem;
        color: var(--color-text-secondary);
      }
    `,
  ],
})
export class SearchBoxComponent {
  value = model('');
  placeholder = input('Rechercher par nom');
  /** Texte de résultat, par exemple "3 sur 25" (affiché seulement quand une recherche est en cours). */
  info = input('');

  clear(event?: Event) {
    // Échap ne vide que s'il y a du texte : sinon il reste disponible pour fermer les menus.
    if (event && !this.value()) return;
    this.value.set('');
  }
}
