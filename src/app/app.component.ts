import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialogComponent } from './shared/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmDialogComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'budget-app';
}
