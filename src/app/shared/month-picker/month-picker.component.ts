import { Component, ElementRef, HostListener, computed, inject, input, model, output } from '@angular/core';
import { MonthRow } from '../../core/models/models';
import { formatMonthLabel, formatMonthLabelShort } from '../../core/services/calc';
import { IconComponent } from '../icon/icon.component';

/**
 * Sélecteur de mois : flèches précédent et suivant, plus une liste de tous les mois avec leur statut.
 * Utilisé par le header (page Mois) et par la carte "Répartition par catégorie" du Dashboard.
 * Il ne change rien tout seul : il annonce le mois choisi et laisse le parent décider quoi en faire.
 */
@Component({
  selector: 'app-month-picker',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './month-picker.component.html',
  styleUrl: './month-picker.component.scss',
})
export class MonthPickerComponent {
  /** Les mois, du plus ancien au plus récent. */
  months = input.required<MonthRow[]>();
  selectedId = input<string | null>(null);
  /** Liste ouverte ou non. Le parent peut la piloter (le header n'ouvre qu'un menu à la fois). */
  open = model(false);
  monthSelected = output<string>();

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  monthsDesc = computed(() => [...this.months()].reverse());
  private index = computed(() => this.months().findIndex((m) => m.id === this.selectedId()));
  selected = computed(() => this.months()[this.index()] ?? null);
  prev = computed(() => (this.index() > 0 ? this.months()[this.index() - 1] : null));
  next = computed(() =>
    this.index() >= 0 && this.index() < this.months().length - 1 ? this.months()[this.index() + 1] : null
  );

  full = formatMonthLabel;
  short = formatMonthLabelShort;

  toggle() {
    this.open.update((v) => !v);
  }

  choose(id: string) {
    this.monthSelected.emit(id);
    this.open.set(false);
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
