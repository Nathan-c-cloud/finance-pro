import { Component, HostListener, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { DataService } from '../../core/services/data.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { MonthPickerComponent } from '../../shared/month-picker/month-picker.component';

type OpenMenu = 'nav' | 'months' | 'account' | null;

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MonthPickerComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  /** Vrai dès qu'on a scrollé : le header renforce son ombre et se compacte. */
  scrolled = signal(false);

  /** Un seul menu ouvert à la fois (burger, liste des mois, menu du compte). */
  open = signal<OpenMenu>(null);

  private url = signal('');

  /** Le sélecteur de mois n'a de sens que sur la page Mois. */
  isMoisPage = computed(() => this.url().startsWith('/mois'));
  /** Pages qui profitent d'une largeur étendue (deux colonnes, grille de cartes). */
  isWidePage = computed(() => this.isMoisPage() || this.url().startsWith('/categories'));
  showMonthPicker = computed(() => this.isMoisPage() && !!this.data.currentMonth());

  initial = computed(() => (this.supabase.user()?.email ?? '?').charAt(0).toUpperCase());

  constructor(
    public supabase: SupabaseService,
    public data: DataService,
    private router: Router
  ) {
    this.url.set(this.router.url);
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe((e) => {
        this.url.set(e.urlAfterRedirects);
        this.open.set(null);
      });
    this.onScroll();
  }

  @HostListener('window:scroll')
  onScroll() {
    this.scrolled.set(window.scrollY > 8);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (this.open() && !target?.closest('.pill')) this.open.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.open.set(null);
  }

  toggle(menu: Exclude<OpenMenu, null>) {
    this.open.update((current) => (current === menu ? null : menu));
  }

  /** Un seul menu ouvert à la fois : la liste des mois s'ouvre ou se ferme via le sélecteur. */
  onMonthsOpenChange(isOpen: boolean) {
    if (isOpen) this.open.set('months');
    else if (this.open() === 'months') this.open.set(null);
  }

  goToMonth(id: string) {
    this.data.selectMonth(id);
    this.open.set(null);
  }

  async logout() {
    this.open.set(null);
    await this.supabase.signOut();
    this.router.navigateByUrl('/connexion');
  }
}
