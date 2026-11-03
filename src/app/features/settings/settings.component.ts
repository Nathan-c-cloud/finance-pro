import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Account } from '../../core/models/models';
import { DataService } from '../../core/services/data.service';
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

  newAccount() {
    this.accountDialog.openCreate();
  }

  editAccount(account: Account) {
    this.accountDialog.openEdit(account);
  }

  kindLabel(account: Account): string {
    return account.kind === 'savings' ? "Compte d'épargne" : 'Compte courant';
  }

  async logout() {
    await this.supabase.signOut();
    this.router.navigateByUrl('/connexion');
  }
}
