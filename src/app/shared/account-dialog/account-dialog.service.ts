import { Injectable, signal } from '@angular/core';
import { Account } from '../../core/models/models';

/**
 * Ouvre la fenêtre de création, de modification ou de clôture d'un compte (affichée par <app-account-dialog>,
 * monté une seule fois à la racine). Créer : openCreate(). Modifier : openEdit(compte). Clôturer : openClose(compte).
 */
@Injectable({ providedIn: 'root' })
export class AccountDialogService {
  /** null = fermée ; account null = création, sinon modification (ou clôture si `closing`) de ce compte. */
  readonly state = signal<{ account: Account | null; closing?: boolean } | null>(null);

  openCreate() {
    this.state.set({ account: null });
  }

  openEdit(account: Account) {
    this.state.set({ account });
  }

  openClose(account: Account) {
    this.state.set({ account, closing: true });
  }

  close() {
    this.state.set(null);
  }
}
