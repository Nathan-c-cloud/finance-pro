import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ExcelExchangeComponent } from './excel-exchange.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, ExcelExchangeComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  constructor(
    public data: DataService,
    public supabase: SupabaseService,
    private router: Router
  ) {}

  async logout() {
    await this.supabase.signOut();
    this.router.navigateByUrl('/connexion');
  }
}
