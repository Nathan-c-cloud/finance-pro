import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  /** Plusieurs paragraphes possibles : les retours à la ligne séparent les paragraphes. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action destructive : le bouton de confirmation passe en rouge et le focus va sur "Annuler". */
  danger?: boolean;
}

interface OpenDialog extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/**
 * Remplace le confirm() du navigateur par une fenêtre au style de l'application
 * (affichée par <app-confirm-dialog>, monté une seule fois à la racine).
 * Usage : if (await this.dialog.confirm({ title: '...', message: '...' })) { ... }
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly current = signal<OpenDialog | null>(null);

  confirm(options: ConfirmOptions): Promise<boolean> {
    // Une seule fenêtre à la fois : une éventuelle fenêtre ouverte est annulée.
    this.current()?.resolve(false);
    return new Promise<boolean>((resolve) => this.current.set({ ...options, resolve }));
  }

  close(confirmed: boolean) {
    const open = this.current();
    if (!open) return;
    this.current.set(null);
    open.resolve(confirmed);
  }
}
