import { Injectable, signal } from '@angular/core';
import { Account } from '../../core/models/models';

/**
 * Ouvre la fenêtre de création ou de modification d'un compte (affichée par <app-account-dialog>,
 * monté une seule fois à la racine). Créer : openCreate(). Modifier : openEdit(compte).
 */
@Injectable({ providedIn: 'root' })
export class AccountDialogService {
  /** null = fermée ; account null = création, sinon modification de ce compte. */
  readonly state = signal<{ account: Account | null } | null>(null);

  openCreate() {
    this.state.set({ account: null });
  }

  openEdit(account: Account) {
    this.state.set({ account });
  }

  close() {
    this.state.set(null);
  }
}
