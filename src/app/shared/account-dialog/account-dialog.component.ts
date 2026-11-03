import { Component, ElementRef, HostListener, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { AccountKind } from '../../core/models/models';
import { ACCOUNT_NAME_MAX, accountNameError, startMonthOptions } from '../../core/services/account-scope';
import { formatMonthLabel, toMonthDateString } from '../../core/services/calc';
import { DataService } from '../../core/services/data.service';
import { AccountDialogService } from './account-dialog.service';

@Component({
  selector: 'app-account-dialog',
  standalone: true,
  template: `
    @if (service.state(); as s) {
      <div class="backdrop" (click)="onBackdrop($event)">
        <form
          #box
          class="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="acc-title"
          (keydown.tab)="trapFocus($event)"
          (submit)="$event.preventDefault(); submit()"
        >
          <h2 id="acc-title">{{ s.account ? 'Modifier le compte' : 'Nouveau compte' }}</h2>

          <label class="field">
            <span>Nom du compte</span>
            <input
              #nameInput
              type="text"
              [maxLength]="nameMax"
              placeholder="Ex. BNP, Trade Republic"
              autocomplete="off"
              [value]="name()"
              (input)="name.set($any($event.target).value)"
            />
          </label>

          <div class="field">
            <span>Type de compte</span>
            <div class="choices" role="radiogroup" aria-label="Type de compte">
              @for (o of kinds; track o.value) {
                <label class="choice" [class.on]="kind() === o.value">
                  <input
                    type="radio"
                    name="acc-kind"
                    [value]="o.value"
                    [checked]="kind() === o.value"
                    (change)="kind.set(o.value)"
                  />
                  <span class="c-text">
                    <strong>{{ o.label }}</strong>
                    <small>{{ o.hint }}</small>
                  </span>
                </label>
              }
            </div>
            <small class="hint">
              C'est toi qui décides : le type suit l'usage que tu fais du compte, pas la façon dont la banque l'a ouvert.
            </small>
          </div>

          @if (!s.account) {
            <label class="field">
              <span>Solde de départ (€)</span>
              <input
                type="number"
                step="0.01"
                inputmode="decimal"
                [value]="balance()"
                (input)="balance.set($any($event.target).value)"
              />
              <small class="hint">Le solde du compte au début du mois de départ. Mets 0 si le compte est vide.</small>
            </label>

            <label class="field">
              <span>Mois de départ</span>
              <select [value]="startMonth()" (change)="startMonth.set($any($event.target).value)">
                @for (m of monthOptions; track m) {
                  <option [value]="m" [selected]="m === startMonth()">{{ label(m) }}</option>
                }
              </select>
              <small class="hint">Le suivi de ce compte commence à ce mois. Les mois d'avant ne sont pas reconstitués.</small>
            </label>
          } @else if (kind() !== s.account.kind) {
            <p class="note">
              Changer le type modifie l'affichage de tout l'historique de ce compte : le taux d'épargne apparaît ou disparaît
              pour tous ses mois, passés compris.
            </p>
          }

          @if (error(); as e) {
            <p class="error" role="alert">{{ e }}</p>
          }

          <div class="actions">
            <button type="button" class="ghost cancel" (click)="service.close()">Annuler</button>
            <button type="submit" class="primary" [disabled]="saving()">
              {{ saving() ? 'Enregistrement…' : s.account ? 'Enregistrer' : 'Créer le compte' }}
            </button>
          </div>
        </form>
      </div>
    }
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: grid;
        place-items: center;
        padding: 1rem;
        background: rgba(23, 32, 28, 0.42);
        backdrop-filter: blur(2px);
        animation: fade 0.15s ease;
      }

      .dialog {
        width: min(480px, 100%);
        max-height: calc(100vh - 2rem);
        overflow-y: auto;
        background: var(--color-surface);
        border-radius: var(--radius-lg);
        padding: 1.4rem 1.4rem 1.2rem;
        box-shadow:
          0 2px 6px rgba(23, 32, 28, 0.08),
          0 18px 48px rgba(23, 32, 28, 0.22);
        animation: pop 0.18s ease;
      }

      h2 {
        margin: 0 0 0.9rem;
        font-size: 1.05rem;
        font-weight: 700;
      }

      .field {
        display: grid;
        gap: 0.3rem;
        margin: 0 0 0.85rem;
        font-size: 0.85rem;
        font-weight: 600;
      }

      .field > input,
      .field > select {
        font-size: 1rem;
      }

      .hint {
        font-size: 0.78rem;
        font-weight: 400;
        line-height: 1.35;
        color: var(--color-text-secondary);
      }

      .choices {
        display: grid;
        gap: 0.4rem;
      }

      .choice {
        display: flex;
        align-items: flex-start;
        gap: 0.65rem;
        padding: 0.6rem 0.75rem;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md, 10px);
        cursor: pointer;
        font-weight: 400;
        transition:
          border-color 0.12s ease,
          background 0.12s ease;
      }

      .choice:hover {
        background: var(--color-hover);
      }

      .choice.on {
        border-color: var(--color-primary);
        background: var(--color-primary-soft);
      }

      .choice input {
        margin-top: 0.2rem;
        accent-color: var(--color-primary);
      }

      .c-text {
        display: grid;
        gap: 0.1rem;
      }

      .c-text strong {
        font-size: 0.9rem;
      }

      .c-text small {
        font-size: 0.78rem;
        line-height: 1.35;
        color: var(--color-text-secondary);
      }

      .note {
        margin: 0 0 0.85rem;
        padding: 0.65rem 0.8rem;
        border-radius: var(--radius-md, 10px);
        background: var(--color-note-soft);
        color: var(--color-note-text);
        font-size: 0.85rem;
        line-height: 1.4;
      }

      .error {
        margin: 0 0 0.6rem;
        padding: 0.55rem 0.8rem;
        border-radius: var(--radius-md, 10px);
        background: var(--color-expense-soft);
        color: var(--color-expense);
        font-size: 0.85rem;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        margin-top: 1.1rem;
      }

      button.cancel {
        border-color: var(--color-border-strong);
        color: var(--color-text);
      }

      @media (max-width: 480px) {
        .actions {
          flex-direction: column-reverse;
        }

        .actions button {
          width: 100%;
          padding: 0.7rem;
        }
      }

      @keyframes fade {
        from {
          opacity: 0;
        }
      }

      @keyframes pop {
        from {
          opacity: 0;
          transform: translateY(6px) scale(0.98);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .backdrop,
        .dialog {
          animation: none;
        }
      }
    `,
  ],
})
export class AccountDialogComponent {
  service = inject(AccountDialogService);
  private data = inject(DataService);

  readonly nameMax = ACCOUNT_NAME_MAX;
  readonly kinds: { value: AccountKind; label: string; hint: string }[] = [
    { value: 'checking', label: 'Compte courant', hint: 'Salaire, dépenses du quotidien, prélèvements.' },
    { value: 'savings', label: "Compte d'épargne", hint: "Argent mis de côté. Le taux d'épargne n'y est pas affiché." },
  ];
  readonly monthOptions = startMonthOptions(new Date());
  readonly label = formatMonthLabel;

  name = signal('');
  kind = signal<AccountKind>('checking');
  balance = signal('0');
  startMonth = signal(toMonthDateString(new Date()));
  error = signal<string | null>(null);
  saving = signal(false);

  private nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private box = viewChild<ElementRef<HTMLElement>>('box');
  private previouslyFocused: HTMLElement | null = null;
  private wasOpen = false;

  constructor() {
    // À chaque ouverture : le formulaire repart de zéro (création) ou du compte modifié (modification).
    effect(() => {
      const s = this.service.state();
      untracked(() => {
        if (s) {
          this.name.set(s.account?.name ?? '');
          this.kind.set(s.account?.kind ?? 'checking');
          this.balance.set('0');
          this.startMonth.set(toMonthDateString(new Date()));
          this.error.set(null);
          this.saving.set(false);
        }
      });
    });

    // Le focus va sur le champ nom à l'ouverture et revient où il était à la fermeture.
    effect(() => {
      const open = !!this.service.state();
      const input = this.nameInput();
      if (open && input && !this.wasOpen) {
        this.previouslyFocused = document.activeElement as HTMLElement | null;
        this.wasOpen = true;
        input.nativeElement.focus();
        input.nativeElement.select();
      } else if (!open && this.wasOpen) {
        this.wasOpen = false;
        this.previouslyFocused?.focus?.();
        this.previouslyFocused = null;
      }
    });
  }

  async submit() {
    const s = this.service.state();
    if (!s || this.saving()) return;
    this.error.set(null);

    const name = this.name().trim();
    const problem = accountNameError(name, this.data.accounts(), s.account?.id);
    if (problem) {
      this.error.set(problem);
      return;
    }

    let openingBalance = 0;
    if (!s.account) {
      const raw = this.balance().trim();
      const n = raw === '' ? NaN : Number(raw);
      if (!Number.isFinite(n)) {
        this.error.set('Saisis le solde de départ (0 si le compte est vide).');
        return;
      }
      openingBalance = n;
    }

    this.saving.set(true);
    try {
      if (s.account) {
        await this.data.updateAccount(s.account.id, { name, kind: this.kind() });
      } else {
        await this.data.createAccount({ name, kind: this.kind(), openingBalance, startMonth: this.startMonth() });
      }
      this.service.close();
    } catch (e: any) {
      this.error.set(e?.message ?? "Impossible d'enregistrer le compte.");
    } finally {
      this.saving.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.service.state()) this.service.close();
  }

  onBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) this.service.close();
  }

  /** Le focus reste dans la fenêtre : Tab fait le tour des éléments actifs, sans en sortir. */
  trapFocus(event: Event) {
    const e = event as KeyboardEvent;
    const box = this.box()?.nativeElement;
    if (!box) return;
    const focusables = Array.from(
      box.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select')
    ).filter((el) => !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
