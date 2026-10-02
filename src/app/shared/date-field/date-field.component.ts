import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, model, signal, untracked, viewChild } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { formatDateFr, parseDateFr } from '../../core/services/date-fr';

/**
 * Champ date de l'application : toujours jj/mm/aaaa, quelle que soit la langue du navigateur
 * (le <input type="date"> natif suit la langue du système, ce qui donnait mm/dd/yyyy chez certains).
 *
 * - On tape les chiffres, les "/" se placent tout seuls.
 * - `value` est la date au format ISO (aaaa-mm-jj) ou null (champ vide) ; elle n'est mise à jour que pour une date complète et valide.
 * - Le bouton calendrier ouvre le sélecteur natif du navigateur (via un champ date caché).
 */
@Component({
  selector: 'app-date-field',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <input
        #text
        type="text"
        inputmode="numeric"
        autocomplete="off"
        maxlength="10"
        placeholder="jj/mm/aaaa"
        [attr.aria-label]="label()"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        [attr.title]="invalid() ? 'Date invalide : écris-la sous la forme jj/mm/aaaa' : null"
        [class.invalid]="invalid()"
        (input)="onInput($event)"
        (paste)="onPaste($event)"
        (blur)="onBlur()"
      />
      <button type="button" class="cal" tabindex="-1" aria-label="Ouvrir le calendrier" (click)="openPicker()">
        <app-icon name="calendar" />
      </button>
      <input
        #picker
        class="native"
        type="date"
        tabindex="-1"
        aria-hidden="true"
        [value]="value() ?? ''"
        (change)="onPicked($any($event.target).value)"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .wrap {
        position: relative;
      }
      input.text,
      input[type='text'] {
        width: 100%;
        padding-right: 2.1rem;
      }
      input.invalid {
        border-color: var(--color-expense);
        box-shadow: 0 0 0 2px rgba(192, 57, 57, 0.15);
      }
      .cal {
        position: absolute;
        right: 0.2rem;
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
      }
      .cal:hover {
        color: var(--color-primary);
      }
      /* Champ natif caché : sert uniquement à ouvrir le calendrier du navigateur. */
      .native {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 1px;
        height: 1px;
        padding: 0;
        border: 0;
        opacity: 0;
        pointer-events: none;
      }
    `,
  ],
})
export class DateFieldComponent {
  /** Date au format ISO (aaaa-mm-jj), ou null si le champ est vide. */
  value = model<string | null>(null);
  label = input('Date');

  private text = viewChild<ElementRef<HTMLInputElement>>('text');
  private picker = viewChild<ElementRef<HTMLInputElement>>('picker');

  /** Texte invalide en cours de saisie (date complète impossible, par exemple 31/02/2026). */
  private typed = signal('');
  invalid = computed(() => {
    const t = this.typed();
    return t.length === 10 && parseDateFr(t) === null;
  });

  constructor() {
    // Le texte affiché suit la valeur : changement venu de l'extérieur, du calendrier ou d'une saisie validée.
    effect(() => {
      const v = this.value();
      const el = this.text()?.nativeElement;
      if (!el) return;
      untracked(() => {
        // On ne touche pas au champ pendant qu'on y tape.
        if (document.activeElement === el && this.typed() !== '') return;
        el.value = v ? formatDateFr(v) : '';
      });
    });
  }

  onInput(event: Event) {
    const el = event.target as HTMLInputElement;
    const caret = el.selectionStart ?? el.value.length;
    const digitsBefore = el.value.slice(0, caret).replace(/\D/g, '').length;
    const digits = el.value.replace(/\D/g, '').slice(0, 8);
    const masked = mask(digits);
    el.value = masked;
    // Le curseur reste devant le même chiffre après l'ajout des "/".
    let pos = 0;
    let seen = 0;
    while (pos < masked.length && seen < digitsBefore) {
      if (/\d/.test(masked[pos])) seen++;
      pos++;
    }
    el.setSelectionRange(pos, pos);
    this.typed.set(masked);
    this.commit(masked);
  }

  onPaste(event: ClipboardEvent) {
    const raw = event.clipboardData?.getData('text')?.trim() ?? '';
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const fr = raw.match(/^(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{4})$/);
    const parts = iso ? [iso[3], iso[2], iso[1]] : fr ? [fr[1], fr[2], fr[3]] : null;
    if (!parts) return; // collage libre : traité comme une saisie normale par onInput
    event.preventDefault();
    const text = `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
    this.text()!.nativeElement.value = text;
    this.typed.set(text);
    this.commit(text);
  }

  /** En quittant le champ, une saisie incomplète ou invalide est abandonnée : on revient à la dernière date valide. */
  onBlur() {
    const v = this.value();
    this.text()!.nativeElement.value = v ? formatDateFr(v) : '';
    this.typed.set('');
  }

  openPicker() {
    const el = this.picker()!.nativeElement;
    el.value = this.value() ?? '';
    if (typeof el.showPicker === 'function') el.showPicker();
    else el.click();
  }

  onPicked(iso: string) {
    this.value.set(iso || null);
  }

  private commit(text: string) {
    if (text === '') {
      if (this.value() !== null) this.value.set(null);
      return;
    }
    const iso = parseDateFr(text);
    if (iso !== null && iso !== this.value()) this.value.set(iso);
  }
}

function mask(digits: string): string {
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += '/' + digits.slice(2, 4);
  if (digits.length > 4) out += '/' + digits.slice(4, 8);
  return out;
}
