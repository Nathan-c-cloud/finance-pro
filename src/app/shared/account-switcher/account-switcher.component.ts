import { Component, ElementRef, HostListener, computed, inject, input, model } from '@angular/core';
import { Router } from '@angular/router';
import { Account } from '../../core/models/models';
import { DataService } from '../../core/services/data.service';
import { AccountDialogService } from '../account-dialog/account-dialog.service';
import { IconComponent } from '../icon/icon.component';

/**
 * Sélecteur de compte du header : le compte affiché, la liste de tous les comptes et "Nouveau compte".
 * Changer de compte remplace les mois, les dépenses fixes et le solde affichés partout dans l'application.
 */
@Component({
  selector: 'app-account-switcher',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './account-switcher.component.html',
  styleUrl: './account-switcher.component.scss',
})
export class AccountSwitcherComponent {
  /** Liste ouverte ou non. Le parent peut la piloter (le header n'ouvre qu'un menu à la fois). */
  open = model(false);
  /** Vrai sur la vue « Tous les comptes » : le bouton l'indique au lieu d'un compte. */
  overview = input(false);

  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private data = inject(DataService);
  private dialog = inject(AccountDialogService);
  private router = inject(Router);

  accounts = this.data.accounts;
  current = this.data.currentAccount;
  isSavings = computed(() => this.current()?.kind === 'savings');

  toggle() {
    this.open.update((v) => !v);
  }

  async choose(account: Account) {
    this.open.set(false);
    await this.data.selectAccount(account.id);
    // Depuis la vue d'ensemble, choisir un compte l'ouvre.
    if (this.overview()) await this.router.navigateByUrl('/mois');
  }

  showOverview() {
    this.open.set(false);
    this.router.navigateByUrl('/ensemble');
  }

  create() {
    this.open.set(false);
    this.dialog.openCreate();
  }

  kindLabel(a: Account): string {
    return a.kind === 'savings' ? 'Épargne' : 'Courant';
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.open.set(false);
  }
}
