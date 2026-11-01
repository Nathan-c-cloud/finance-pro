import { Component, ElementRef, HostListener, computed, effect, inject, viewChild } from '@angular/core';
import { DialogService } from './dialog.service';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  template: `
    @if (dialog.current(); as d) {
      <div class="backdrop" (click)="onBackdrop($event)">
        <div
          #box
          class="dialog"
          [class.wide]="!!d.choice"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="dlg-title"
          aria-describedby="dlg-message"
          (keydown.tab)="trapFocus($event)"
        >
          <h2 id="dlg-title">{{ d.title }}</h2>
          <div id="dlg-message" class="message">
            @for (p of paragraphs(); track $index) {
              <p>{{ p }}</p>
            }
          </div>
          @if (d.prompt; as p) {
            <label class="amount">
              <span>{{ p.label }}</span>
              <input
                #amountInput
                type="number"
                step="0.01"
                inputmode="decimal"
                (input)="onAmount($event)"
                (keydown.enter)="dialog.close(true)"
              />
            </label>
            @if (previewParagraphs().length) {
              <div class="preview">
                @for (line of previewParagraphs(); track $index) {
                  <p>{{ line }}</p>
                }
              </div>
            }
          }
          @if (d.choice; as c) {
            @if (c.items?.length) {
              <ul class="items">
                @for (line of c.items; track $index) {
                  <li>{{ line }}</li>
                }
              </ul>
            }
            @if (c.choices?.length) {
              <div class="choices" role="radiogroup">
                @for (o of c.choices; track o.value) {
                  <label class="choice" [class.on]="dialog.choice() === o.value">
                    <input
                      type="radio"
                      name="dlg-choice"
                      [value]="o.value"
                      [checked]="dialog.choice() === o.value"
                      (change)="dialog.choice.set(o.value)"
                    />
                    <span class="c-text">
                      <strong>{{ o.label }}</strong>
                      @if (o.hint) {
                        <small>{{ o.hint }}</small>
                      }
                    </span>
                  </label>
                }
              </div>
            }
            @if (c.amountLabel) {
              <label class="amount">
                <span>{{ c.amountLabel }}</span>
                <input
                  type="number"
                  step="0.01"
                  inputmode="decimal"
                  (input)="onAmount($event)"
                  (keydown.enter)="dialog.close(true)"
                />
                @if (c.amountHint) {
                  <small class="amount-hint">{{ c.amountHint }}</small>
                }
              </label>
            }
            @if (choicePreview().length) {
              <div class="preview">
                @for (line of choicePreview(); track $index) {
                  <p>{{ line }}</p>
                }
              </div>
            }
          }
          <div class="actions">
            <button #cancelBtn type="button" class="ghost cancel" (click)="dialog.close(false)">
              {{ d.cancelLabel ?? 'Annuler' }}
            </button>
            <button
              #confirmBtn
              type="button"
              class="primary"
              [class.danger]="d.danger"
              [disabled]="!!d.prompt && dialog.amount() === null"
              (click)="dialog.close(true)"
            >
              {{ d.confirmLabel ?? 'Confirmer' }}
            </button>
          </div>
        </div>
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
        width: min(440px, 100%);
        background: var(--color-surface);
        border-radius: var(--radius-lg);
        padding: 1.4rem 1.4rem 1.2rem;
        box-shadow:
          0 2px 6px rgba(23, 32, 28, 0.08),
          0 18px 48px rgba(23, 32, 28, 0.22);
        animation: pop 0.18s ease;
      }

      .dialog.wide {
        width: min(520px, 100%);
        max-height: calc(100vh - 2rem);
        overflow-y: auto;
      }

      .items {
        list-style: none;
        margin: 0.2rem 0 0.8rem;
        padding: 0.55rem 0.8rem;
        border-radius: var(--radius-md, 10px);
        background: var(--color-surface-muted);
        border: 1px solid var(--color-border);
        font-size: 0.84rem;
        line-height: 1.4;
        max-height: 11rem;
        overflow-y: auto;
      }

      .items li {
        padding: 0.18rem 0;
      }

      .choices {
        display: grid;
        gap: 0.4rem;
        margin: 0 0 0.8rem;
      }

      .choice {
        display: flex;
        align-items: flex-start;
        gap: 0.65rem;
        padding: 0.6rem 0.75rem;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md, 10px);
        cursor: pointer;
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

      .c-text small,
      .amount-hint {
        font-size: 0.78rem;
        font-weight: 400;
        line-height: 1.35;
        color: var(--color-text-secondary);
      }

      h2 {
        margin: 0 0 0.6rem;
        font-size: 1.05rem;
        font-weight: 700;
      }

      .message p {
        margin: 0 0 0.5rem;
        font-size: 0.9rem;
        line-height: 1.45;
        color: var(--color-text-secondary);
      }

      .amount {
        display: grid;
        gap: 0.3rem;
        margin: 0.4rem 0 0.7rem;
        font-size: 0.85rem;
        font-weight: 600;
      }

      .amount input {
        font-size: 1.1rem;
        font-weight: 700;
      }

      .preview {
        padding: 0.65rem 0.8rem;
        border-radius: var(--radius-md, 10px);
        background: var(--color-note-soft);
        color: var(--color-note-text);
      }

      .preview p {
        margin: 0 0 0.3rem;
        font-size: 0.85rem;
        line-height: 1.4;
        color: inherit;
      }

      .preview p:last-child {
        margin-bottom: 0;
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

      button.danger {
        background: var(--color-expense);
        border-color: var(--color-expense);
      }

      button.danger:hover:not(:disabled) {
        background: #a83232;
        border-color: #a83232;
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
export class ConfirmDialogComponent {
  dialog = inject(DialogService);

  private cancelBtn = viewChild<ElementRef<HTMLButtonElement>>('cancelBtn');
  private confirmBtn = viewChild<ElementRef<HTMLButtonElement>>('confirmBtn');
  private amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');
  private box = viewChild<ElementRef<HTMLElement>>('box');
  private previouslyFocused: HTMLElement | null = null;
  private wasOpen = false;
  private selected = false;

  paragraphs = computed(() =>
    (this.dialog.current()?.message ?? '')
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)
  );

  previewParagraphs = computed(() => {
    const preview = this.dialog.current()?.prompt?.preview;
    const amount = this.dialog.amount();
    if (!preview || amount === null) return [];
    return preview(amount)
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);
  });

  choicePreview = computed(() => {
    const preview = this.dialog.current()?.choice?.preview;
    if (!preview) return [];
    return preview(this.dialog.choice(), this.dialog.amount())
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);
  });

  onAmount(event: Event) {
    const raw = (event.target as HTMLInputElement).value;
    const n = raw === '' ? NaN : Number(raw);
    this.dialog.amount.set(Number.isFinite(n) ? n : null);
  }

  constructor() {
    // Ouverture : le focus va sur un bouton (Annuler si l'action est destructive) ; fermeture : il revient où il était.
    effect(() => {
      const open = this.dialog.current();
      const target = open?.prompt
        ? this.amountInput()
        : open?.danger
          ? this.cancelBtn()
          : this.confirmBtn();
      if (open && target) {
        if (!this.wasOpen) {
          this.previouslyFocused = document.activeElement as HTMLElement | null;
          this.wasOpen = true;
        }
        target.nativeElement.focus();
        const input = this.amountInput()?.nativeElement;
        if (input && !this.selected) {
          // Valeur de départ posée une seule fois : lier [value] effacerait un "-" tapé en cours de saisie.
          input.value = this.dialog.amount() === null ? '' : String(this.dialog.amount());
          input.select();
          this.selected = true;
        }
      } else if (!open && this.wasOpen) {
        this.wasOpen = false;
        this.selected = false;
        this.previouslyFocused?.focus?.();
        this.previouslyFocused = null;
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.dialog.current()) this.dialog.close(false);
  }

  onBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) this.dialog.close(false);
  }

  /** Le focus reste dans la fenêtre : Tab fait le tour des éléments actifs, sans en sortir. */
  trapFocus(event: Event) {
    const e = event as KeyboardEvent;
    const box = this.box()?.nativeElement;
    if (!box) return;
    // Dans un groupe de boutons radio, seul le choix coché est atteignable au clavier.
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
