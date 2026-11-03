import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import { Account } from '../../core/models/models';
import { consolidate } from '../../core/services/consolidated';
import { DataService } from '../../core/services/data.service';
import { formatEUR, formatPercent } from '../../core/services/format';
import { SEMANTIC_COLORS } from '../../core/theme/chart-colors';
import { IconComponent } from '../../shared/icon/icon.component';

Chart.register(...registerables);

const VISIBLE_MONTHS = 12;

/**
 * Vue « Tous les comptes » : synthèse de l'ensemble des comptes actifs (solde total, chaque compte, revenus, dépenses,
 * épargne et taux d'épargne global par mois). Lecture seule : on agit toujours sur un compte à la fois.
 */
@Component({
  selector: 'app-ensemble',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './ensemble.component.html',
  styleUrl: './ensemble.component.scss',
})
export class EnsembleComponent {
  private router = inject(Router);
  private canvas = viewChild<ElementRef<HTMLCanvasElement>>('balanceCanvas');
  private chart?: Chart;

  eur = formatEUR;
  pct = formatPercent;

  /** Tous les mois affichés, ou seulement les plus récents. */
  showAll = signal(false);

  data = inject(DataService);

  consolidated = computed(() => consolidate(this.data.accounts(), this.data.summariesByAccount()));

  /** Mois du plus récent au plus ancien, limités aux 12 derniers sauf demande contraire. */
  rows = computed(() => {
    const all = [...this.consolidated().months].reverse();
    return this.showAll() ? all : all.slice(0, VISIBLE_MONTHS);
  });
  hiddenCount = computed(() => Math.max(this.consolidated().months.length - VISIBLE_MONTHS, 0));

  currentLabel = computed(() => {
    const m = this.consolidated().current;
    return m ? this.data.monthLabel(m.monthDate) : '';
  });

  constructor() {
    effect(() => {
      const months = this.consolidated().months;
      const canvas = this.canvas();
      if (!canvas) {
        this.chart?.destroy();
        this.chart = undefined;
        return;
      }
      this.chart?.destroy();
      this.chart = new Chart(canvas.nativeElement, {
        type: 'line',
        data: {
          labels: months.map((m) => this.data.monthLabel(m.monthDate)),
          datasets: [
            {
              label: 'Solde total de fin de mois',
              data: months.map((m) => m.totalBalance),
              borderColor: SEMANTIC_COLORS.primary,
              backgroundColor: 'rgba(36,91,99,0.15)',
              fill: true,
              tension: 0.25,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: (v) => formatEUR(Number(v)) } } },
        },
      });
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  kindLabel(a: Account): string {
    return a.kind === 'savings' ? "Compte d'épargne" : 'Compte courant';
  }

  /** Ouvre le compte (ses mois, ses transactions) : la vue d'ensemble ne se modifie pas. */
  async open(account: Account) {
    await this.data.selectAccount(account.id);
    await this.router.navigateByUrl('/mois');
  }
}
