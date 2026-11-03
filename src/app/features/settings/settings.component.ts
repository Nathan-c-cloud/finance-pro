import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Account } from '../../core/models/models';
import { DataService } from '../../core/services/data.service';
import { formatDateFr } from '../../core/services/date-fr';
import { SupabaseService } from '../../core/services/supabase.service';
import { AccountDialogService } from '../../shared/account-dialog/account-dialog.service';
import { ExcelExchangeComponent } from './excel-exchange.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, ExcelExchangeComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private accountDialog = inject(AccountDialogService);

  constructor(
    public data: DataService,
    public supabase: SupabaseService,
    private router: Router
  ) {}

  readonly activeAccounts = computed(() => this.data.accounts().filter((a) => a.status === 'active'));
  readonly closedAccounts = computed(() => this.data.accounts().filter((a) => a.status === 'closed'));
  readonly formatDateFr = formatDateFr;
  accountError = signal<string | null>(null);

  newAccount() {
    this.accountDialog.openCreate();
  }

  editAccount(account: Account) {
    this.accountDialog.openEdit(account);
  }

  closeAccount(account: Account) {
    this.accountError.set(null);
    this.accountDialog.openClose(account);
  }

  async reopenAccount(account: Account) {
    this.accountError.set(null);
    try {
      await this.data.reopenAccount(account.id);
    } catch (e: any) {
      this.accountError.set(e?.message ?? 'Impossible de rouvrir le compte.');
    }
  }

  kindLabel(account: Account): string {
    return account.kind === 'savings' ? "Compte d'épargne" : 'Compte courant';
  }

  async logout() {
    await this.supabase.signOut();
    this.router.navigateByUrl('/connexion');
  }
}
