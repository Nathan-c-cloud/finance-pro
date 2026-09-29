import { Component, ElementRef, HostListener, computed, effect, inject, viewChild } from '@angular/core';
import { DialogService } from './dialog.service';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  template: `
    @if (dialog.current(); as d) {
      <div class="backdrop" (click)="onBackdrop($event)">
        <div
          class="dialog"
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
          <div class="actions">
            <button #cancelBtn type="button" class="ghost cancel" (click)="dialog.close(false)">
              {{ d.cancelLabel ?? 'Annuler' }}
            </button>
            <button
              #confirmBtn
              type="button"
              class="primary"
              [class.danger]="d.danger"
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
  private previouslyFocused: HTMLElement | null = null;
  private wasOpen = false;

  paragraphs = computed(() =>
    (this.dialog.current()?.message ?? '')
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)
  );

  constructor() {
    // Ouverture : le focus va sur un bouton (Annuler si l'action est destructive) ; fermeture : il revient où il était.
    effect(() => {
      const open = this.dialog.current();
      const target = open?.danger ? this.cancelBtn() : this.confirmBtn();
      if (open && target) {
        if (!this.wasOpen) {
          this.previouslyFocused = document.activeElement as HTMLElement | null;
          this.wasOpen = true;
        }
        target.nativeElement.focus();
      } else if (!open && this.wasOpen) {
        this.wasOpen = false;
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

  /** Le focus reste dans la fenêtre : Tab alterne entre les deux boutons. */
  trapFocus(event: Event) {
    const e = event as KeyboardEvent;
    const first = this.cancelBtn()?.nativeElement;
    const last = this.confirmBtn()?.nativeElement;
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
