import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Chart, registerables } from 'chart.js';
import { DataService } from '../../core/services/data.service';
import { formatEUR } from '../../core/services/format';
import { buildBreakdown } from '../../core/services/breakdown';
import { SEMANTIC_COLORS } from '../../core/theme/chart-colors';
import { MonthPickerComponent } from '../../shared/month-picker/month-picker.component';

Chart.register(...registerables);
Chart.defaults.font.family = "'Figtree Variable', -apple-system, 'Segoe UI', sans-serif";
Chart.defaults.color = '#68736d';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [MonthPickerComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  // Requêtes "signal" : les canvas n'existent qu'une fois les données chargées (bloc @else du
  // template). L'effet ci-dessous se relance dès qu'un canvas apparaît, ce qui évite des
  // graphiques vides quand la page est rechargée directement.
  private balanceCanvas = viewChild<ElementRef<HTMLCanvasElement>>('balanceCanvas');
  private flowCanvas = viewChild<ElementRef<HTMLCanvasElement>>('flowCanvas');
  private rateCanvas = viewChild<ElementRef<HTMLCanvasElement>>('rateCanvas');
  private breakdownCanvas = viewChild<ElementRef<HTMLCanvasElement>>('breakdownCanvas');

  private balanceChart?: Chart;
  private flowChart?: Chart;
  private rateChart?: Chart;
  private breakdownChart?: Chart;

  /**
   * Mois affiché dans la carte "Répartition par catégorie". Propre à cette carte : le changer ici
   * ne change pas le mois de la page Mois. Sans choix, on prend le mois marqué "Courant".
   */
  private chosenMonthId = signal<string | null>(null);
  private defaultMonthId = computed(() => {
    const months = this.data.sortedMonths();
    return (months.find((m) => m.status === 'current') ?? months[months.length - 1])?.id ?? null;
  });
  breakdownMonthId = computed(() => {
    const id = this.chosenMonthId();
    return id && this.data.sortedMonths().some((m) => m.id === id) ? id : this.defaultMonthId();
  });
  private breakdownSummary = computed(
    () => this.data.allSummaries().find((s) => s.month.id === this.breakdownMonthId()) ?? null
  );
  breakdown = computed(() => buildBreakdown(this.breakdownSummary()?.byCategory ?? []));
  hasBreakdown = computed(() => this.breakdown().slices.length > 0);
  breakdownMonthLabel = computed(() => {
    const s = this.breakdownSummary();
    return s ? this.data.monthLabel(s.month.month_date) : '';
  });

  chooseBreakdownMonth(id: string) {
    this.chosenMonthId.set(id);
  }

  constructor(public data: DataService) {
    effect(() => {
      const summaries = this.data.allSummaries();
      this.renderBalanceChart(summaries, this.balanceCanvas());
      this.renderFlowChart(summaries, this.flowCanvas());
      this.renderRateChart(summaries, this.rateCanvas());
      this.renderBreakdownChart(this.breakdown(), this.breakdownCanvas());
    });

    inject(DestroyRef).onDestroy(() => {
      this.balanceChart?.destroy();
      this.flowChart?.destroy();
      this.rateChart?.destroy();
      this.breakdownChart?.destroy();
    });
  }

  private labels(summaries: ReturnType<DataService['allSummaries']>) {
    return summaries.map((s) => this.data.monthLabel(s.month.month_date));
  }

  private renderBalanceChart(
    summaries: ReturnType<DataService['allSummaries']>,
    canvas: ElementRef<HTMLCanvasElement> | undefined
  ) {
    if (!canvas) return;
    this.balanceChart?.destroy();
    this.balanceChart = new Chart(canvas.nativeElement, {
      type: 'line',
      data: {
        labels: this.labels(summaries),
        datasets: [
          {
            label: 'Solde de fin de mois',
            data: summaries.map((s) => s.endingBalance),
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
  }

  private renderFlowChart(
    summaries: ReturnType<DataService['allSummaries']>,
    canvas: ElementRef<HTMLCanvasElement> | undefined
  ) {
    if (!canvas) return;
    this.flowChart?.destroy();
    this.flowChart = new Chart(canvas.nativeElement, {
      type: 'bar',
      data: {
        labels: this.labels(summaries),
        datasets: [
          {
            label: 'Revenus',
            data: summaries.map((s) => s.income),
            backgroundColor: SEMANTIC_COLORS.income,
          },
          {
            label: 'Dépenses',
            data: summaries.map((s) => s.expensesExcludingSavings),
            backgroundColor: SEMANTIC_COLORS.expense,
          },
          {
            label: 'Épargne',
            data: summaries.map((s) => s.savings),
            backgroundColor: SEMANTIC_COLORS.savings,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { ticks: { callback: (v) => formatEUR(Number(v)) } } },
      },
    });
  }

  private renderRateChart(
    summaries: ReturnType<DataService['allSummaries']>,
    canvas: ElementRef<HTMLCanvasElement> | undefined
  ) {
    if (!canvas) return;
    this.rateChart?.destroy();
    this.rateChart = new Chart(canvas.nativeElement, {
      type: 'line',
      data: {
        labels: this.labels(summaries),
        datasets: [
          {
            label: "Taux d'épargne",
            data: summaries.map((s) => s.savingsRate * 100),
            borderColor: SEMANTIC_COLORS.savings,
            backgroundColor: 'rgba(176,122,46,0.15)',
            fill: true,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: (v) => v + ' %' } } },
      },
    });
  }

  private renderBreakdownChart(
    breakdown: ReturnType<typeof buildBreakdown>,
    canvas: ElementRef<HTMLCanvasElement> | undefined
  ) {
    // Le canvas disparaît quand le mois choisi n'a aucune dépense : on détruit alors l'ancien graphique.
    this.breakdownChart?.destroy();
    this.breakdownChart = undefined;
    const slices = breakdown.slices;
    if (!canvas || slices.length === 0) return;

    this.breakdownChart = new Chart(canvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: slices.map((s) => s.name),
        datasets: [
          {
            data: slices.map((s) => s.amount),
            backgroundColor: slices.map((s) => s.color),
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => formatEUR(Number(ctx.parsed)),
              // Pour la part "Petites catégories" : le détail des catégories regroupées
              afterLabel: (ctx) =>
                (slices[ctx.dataIndex].grouped ?? []).map(
                  (g) => `  ${g.categoryName} : ${formatEUR(g.amount)}`
                ),
            },
          },
        },
      },
    });
  }
}
