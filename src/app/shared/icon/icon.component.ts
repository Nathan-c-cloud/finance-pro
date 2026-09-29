import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

/**
 * Icônes Lucide (https://lucide.dev, licence ISC) embarquées en SVG pour ne pas
 * ajouter de dépendance. Pour en ajouter une : copier le contenu de son fichier
 * .svg (sans la balise <svg> englobante) dans ICONS.
 */
const ICONS: Record<string, string> = {
  'wallet': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />',
  'arrow-up-right': '<path d="M7 7h10v10" /><path d="M7 17 17 7" />',
  'arrow-up': '<path d="m5 12 7-7 7 7" /><path d="M12 19V5" />',
  'trending-up': '<path d="M16 7h6v6" /><path d="m22 7-8.5 8.5-5-5L2 17" />',
  'arrow-down': '<path d="M12 5v14" /><path d="m19 12-7 7-7-7" />',
  'piggy-bank': '<path d="M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z" /><path d="M16 10h.01" /><path d="M2 8v1a2 2 0 0 0 2 2h1" />',
  'chart-pie': '<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" /><path d="M21.21 15.89A10 10 0 1 1 8 2.83" />',
  'coins': '<path d="M13.744 17.736a6 6 0 1 1-7.48-7.48" /><path d="M15 6h1v4" /><path d="m6.134 14.768.866-.5 2 3.464" /><circle cx="16" cy="8" r="6" />',
  'calendar': '<path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" />',
  'chevron-left': '<path d="m15 18-6-6 6-6" />',
  'chevron-right': '<path d="m9 18 6-6-6-6" />',
  'plus': '<path d="M5 12h14" /><path d="M12 5v14" />',
};

export type IconName = keyof typeof ICONS;

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    [attr.stroke-width]="strokeWidth()"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    [innerHTML]="markup()"
  ></svg>`,
  styles: [
    `
      :host {
        display: inline-flex;
        width: 1.25em;
        height: 1.25em;
        flex: none;
      }
      svg {
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class IconComponent {
  name = input.required<IconName>();
  strokeWidth = input(2);

  private sanitizer = inject(DomSanitizer);

  // Le contenu vient uniquement de la constante ICONS ci-dessus, jamais d'une saisie utilisateur.
  markup = computed(() => this.sanitizer.bypassSecurityTrustHtml(ICONS[this.name()] ?? ''));
}
