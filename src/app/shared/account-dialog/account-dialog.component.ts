import { Component, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { AccountKind } from '../../core/models/models';
import { closureBlocker, closureFixedExpenses, remainingBalance } from '../../core/services/account-closure';
import { formatEUR } from '../../core/services/format';
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
          @if (s.closing && closeView(); as c) {
            <h2 id="acc-title">Clôturer « {{ c.account.name }} »</h2>
            <p class="lead">
              Un compte clôturé sort du total de tes comptes et n'accepte plus de nouvelle opération. Son historique reste
              consultable, et tu peux le rouvrir plus tard.
            </p>

            @if (c.blocker) {
              <p class="error" role="alert">{{ c.blocker }}</p>
              <div class="actions">
                <button type="button" class="primary" (click)="service.close()">Fermer</button>
              </div>
            } @else {
              <p class="balance">
                Solde actuel de « {{ c.account.name }} » : <strong>{{ eur(c.balance) }}</strong>
              </p>

              @if (c.balance > 0.005) {
                <div class="field">
                  <span>Que devient cet argent ?</span>
                  <div class="choices" role="radiogroup" aria-label="Que devient l'argent restant">
                    <label class="choice" [class.on]="closeChoice() === 'transfer'">
                      <input
                        type="radio"
                        name="close-choice"
                        [checked]="closeChoice() === 'transfer'"
                        (change)="closeChoice.set('transfer')"
                      />
                      <span class="c-text">
                        <strong>Je l'ai viré vers un autre de mes comptes</strong>
                        <small>Un virement est enregistré aujourd'hui, des deux côtés. Le total de tes comptes ne change pas.</small>
                      </span>
                    </label>
                    <label class="choice" [class.on]="closeChoice() === 'leave'">
                      <input
                        type="radio"
                        name="close-choice"
                        [checked]="closeChoice() === 'leave'"
                        (change)="closeChoice.set('leave')"
                      />
                      <span class="c-text">
                        <strong>Il est sorti de mon suivi</strong>
                        <small>Retiré, dépensé ou placé ailleurs que dans l'app : rien n'est enregistré, le solde sort du total.</small>
                      </span>
                    </label>
                  </div>
                </div>

                @if (closeChoice() === 'transfer') {
                  <label class="field">
                    <span>Vers quel compte ?</span>
                    <select [value]="closeTarget()" (change)="closeTarget.set($any($event.target).value)">
                      @for (o of c.others; track o.id) {
                        <option [value]="o.id" [selected]="o.id === closeTarget()">{{ o.name }}</option>
                      }
                    </select>
                  </label>
                  <label class="field">
                    <span>Montant viré (€)</span>
                    <input
                      type="number"
                      step="0.01"
                      inputmode="decimal"
                      [value]="closeAmount()"
                      (input)="closeAmount.set($any($event.target).value)"
                    />
                    <small class="hint">Pré-rempli avec le solde calculé. Corrige-le si ta banque affiche autre chose.</small>
                  </label>
                }
              } @else if (c.balance < -0.005) {
                <p class="note">
                  Le compte est à découvert : rien n'est viré. Ce solde négatif sortira du total en clôturant le compte.
                </p>
              } @else {
                <p class="note">Le compte est à zéro : il n'y a rien à déplacer.</p>
              }

              @if (c.fixedNames.length > 0) {
                <p class="note">
                  {{ c.fixedNames.length === 1 ? 'Cette dépense fixe sera arrêtée' : 'Ces ' + c.fixedNames.length + ' dépenses fixes seront arrêtées' }}
                  (désactivée{{ c.fixedNames.length > 1 ? 's' : '' }}, pas supprimée{{ c.fixedNames.length > 1 ? 's' : '' }}) :
                  {{ c.fixedNames.join(', ') }}.
                </p>
              }

              @if (closePreview(); as p) {
                <p class="preview">{{ p }}</p>
              }

              @if (error(); as e) {
                <p class="error" role="alert">{{ e }}</p>
              }

              <div class="actions">
                <button type="button" class="ghost cancel" (click)="service.close()">Annuler</button>
                <button type="submit" class="primary" [disabled]="saving()">
                  {{ saving() ? 'Clôture…' : 'Clôturer le compte' }}
                </button>
              </div>
            }
          } @else {
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
          }
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

      .lead {
        margin: 0 0 0.9rem;
        font-size: 0.88rem;
        line-height: 1.45;
        color: var(--color-text-secondary);
      }

      .balance {
        margin: 0 0 0.85rem;
        font-size: 0.95rem;
      }

      .preview {
        margin: 0 0 0.85rem;
        font-size: 0.85rem;
        line-height: 1.4;
        font-weight: 600;
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

  readonly eur = formatEUR;

  name = signal('');
  kind = signal<AccountKind>('checking');
  closeChoice = signal<'transfer' | 'leave'>('transfer');
  closeTarget = signal('');
  closeAmount = signal('');
  balance = signal('0');
  startMonth = signal(toMonthDateString(new Date()));
  error = signal<string | null>(null);
  saving = signal(false);

  /** Données de la fenêtre de clôture : solde, autres comptes, dépenses fixes arrêtées, et ce qui empêche la clôture. */
  readonly closeView = computed(() => {
    const s = this.service.state();
    if (!s?.closing || !s.account) return null;
    const account = this.data.accounts().find((a) => a.id === s.account!.id) ?? s.account;
    const today = new Date();
    const others = this.data.accounts().filter((a) => a.status === 'active' && a.id !== account.id);
    return {
      account,
      others,
      balance: remainingBalance(account, this.data.summariesByAccount().get(account.id) ?? [], today),
      blocker: closureBlocker({
        account,
        accounts: this.data.accounts(),
        months: this.data.allMonths(),
        transactions: this.data.allTransactions(),
        today,
      }),
      fixedNames: closureFixedExpenses(account.id, this.data.allFixedExpenses()).map((f) => f.name),
    };
  });

  /** Ce que la clôture va faire, dit en une phrase avant de confirmer. */
  readonly closePreview = computed(() => {
    const c = this.closeView();
    if (!c || c.blocker) return '';
    if (c.balance > 0.005 && this.closeChoice() === 'transfer') {
      const amount = Number(this.closeAmount());
      const target = c.others.find((o) => o.id === this.closeTarget());
      if (!target || !Number.isFinite(amount) || amount <= 0) return '';
      const left = Math.round((c.balance - amount) * 100) / 100;
      return (
        `${formatEUR(amount)} seront virés vers « ${target.name} » aujourd'hui.` +
        (Math.abs(left) >= 0.005
          ? ` Il restera ${formatEUR(left)} dans « ${c.account.name} », qui sortiront du total de tes comptes.`
          : " Le total de tes comptes ne change pas.")
      );
    }
    if (c.balance > 0.005) return `Le total de tes comptes baissera de ${formatEUR(c.balance)}.`;
    if (c.balance < -0.005) return `Le total de tes comptes augmentera de ${formatEUR(-c.balance)}.`;
    return '';
  });

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
          const c = this.closeView();
          if (c) {
            this.closeChoice.set(c.balance > 0.005 ? 'transfer' : 'leave');
            this.closeTarget.set(c.others[0]?.id ?? '');
            this.closeAmount.set(c.balance > 0.005 ? c.balance.toFixed(2) : '');
          }
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

    if (s.closing && s.account) {
      await this.submitClose(s.account.id);
      return;
    }

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

  private async submitClose(accountId: string) {
    const c = this.closeView();
    if (!c || c.blocker) return;
    let transferToId: string | null = null;
    let amount: number | undefined;
    if (c.balance > 0.005 && this.closeChoice() === 'transfer') {
      transferToId = this.closeTarget();
      amount = Number(this.closeAmount());
      if (!transferToId) {
        this.error.set('Choisis le compte qui reçoit l\'argent.');
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        this.error.set('Saisis le montant à virer (supérieur à 0).');
        return;
      }
      if (amount > c.balance + 0.005) {
        this.error.set(`Le montant dépasse le solde du compte (${formatEUR(c.balance)}).`);
        return;
      }
    }
    this.saving.set(true);
    try {
      await this.data.closeAccount(accountId, { transferToId, amount });
      this.service.close();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Impossible de clôturer le compte.');
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
