import { AfterViewInit, Component, ElementRef, Injector, ViewChild, effect } from '@angular/core';
import { Chart, registerables } from 'chart.js';
import { DataService } from '../../core/services/data.service';
import { formatEUR } from '../../core/services/format';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements AfterViewInit {
  @ViewChild('balanceCanvas') balanceCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('flowCanvas') flowCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('rateCanvas') rateCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('breakdownCanvas') breakdownCanvas!: ElementRef<HTMLCanvasElement>;

  private balanceChart?: Chart;
  private flowChart?: Chart;
  private rateChart?: Chart;
  private breakdownChart?: Chart;

  constructor(
    public data: DataService,
    private injector: Injector
  ) {}

  ngAfterViewInit() {
    effect(
      () => {
        const summaries = this.data.allSummaries();
        const current = this.data.currentSummary();
        this.renderBalanceChart(summaries);
        this.renderFlowChart(summaries);
        this.renderRateChart(summaries);
        this.renderBreakdownChart(current);
      },
      { injector: this.injector }
    );
  }

  private labels(summaries: ReturnType<DataService['allSummaries']>) {
    return summaries.map((s) => this.data.monthLabel(s.month.month_date));
  }

  private renderBalanceChart(summaries: ReturnType<DataService['allSummaries']>) {
    if (!this.balanceCanvas) return;
    this.balanceChart?.destroy();
    this.balanceChart = new Chart(this.balanceCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: this.labels(summaries),
        datasets: [
          {
            label: 'Solde de fin de mois',
            data: summaries.map((s) => s.endingBalance),
            borderColor: '#2f6feb',
            backgroundColor: 'rgba(47,111,235,0.15)',
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

  private renderFlowChart(summaries: ReturnType<DataService['allSummaries']>) {
    if (!this.flowCanvas) return;
    this.flowChart?.destroy();
    this.flowChart = new Chart(this.flowCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels: this.labels(summaries),
        datasets: [
          {
            label: 'Revenus',
            data: summaries.map((s) => s.income),
            backgroundColor: '#2e7d32',
          },
          {
            label: 'Dépenses',
            data: summaries.map((s) => s.expensesExcludingSavings),
            backgroundColor: '#c0392b',
          },
          {
            label: 'Épargne',
            data: summaries.map((s) => s.savings),
            backgroundColor: '#2f6feb',
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

  private renderRateChart(summaries: ReturnType<DataService['allSummaries']>) {
    if (!this.rateCanvas) return;
    this.rateChart?.destroy();
    this.rateChart = new Chart(this.rateCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: this.labels(summaries),
        datasets: [
          {
            label: "Taux d'épargne",
            data: summaries.map((s) => s.savingsRate * 100),
            borderColor: '#8e44ad',
            backgroundColor: 'rgba(142,68,173,0.15)',
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

  private renderBreakdownChart(current: ReturnType<DataService['currentSummary']>) {
    if (!this.breakdownCanvas || !current) return;
    this.breakdownChart?.destroy();

    const entries = current.byCategory.filter((b) => b.amount > 0);
    const labels = [...entries.map((e) => e.categoryName)];
    const values = [...entries.map((e) => e.amount)];
    const palette = [
      '#2f6feb',
      '#c0392b',
      '#2e7d32',
      '#f39c12',
      '#8e44ad',
      '#16a085',
      '#d35400',
      '#7f8c8d',
      '#2980b9',
      '#c2185b',
    ];

    this.breakdownChart = new Chart(this.breakdownCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: labels.map((_, i) => palette[i % palette.length]),
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
      },
    });
  }
}
