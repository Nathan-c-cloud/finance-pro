import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  /** Plusieurs paragraphes possibles : les retours à la ligne séparent les paragraphes. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action destructive : le bouton de confirmation passe en rouge et le focus va sur "Annuler". */
  danger?: boolean;
}

/** Fenêtre qui demande aussi un montant (ex. le solde réel du compte avant un recalage). */
export interface AmountPromptOptions extends ConfirmOptions {
  amountLabel: string;
  /** Valeur pré-remplie, modifiable. */
  amount: number | null;
  /** Texte affiché sous le champ, recalculé à chaque frappe (un paragraphe par ligne). */
  preview?: (amount: number) => string;
}

export interface ChoiceOption {
  value: string;
  label: string;
  hint?: string;
}

/** Fenêtre avec liste d'éléments, choix unique et montant facultatif (ex. création du mois suivant). */
export interface ChoiceDialogOptions extends ConfirmOptions {
  /** Lignes affichées dans un encadré (par exemple les opérations concernées). */
  items?: string[];
  choices?: ChoiceOption[];
  /** Choix sélectionné à l'ouverture (le premier par défaut). */
  defaultChoice?: string;
  /** Champ montant facultatif : s'il est absent, la fenêtre n'en affiche pas. */
  amountLabel?: string;
  amountHint?: string;
  /** Texte sous les choix, recalculé quand le choix ou le montant change (un paragraphe par ligne). */
  preview?: (choice: string | null, amount: number | null) => string;
}

export interface ChoiceResult {
  choice: string | null;
  amount: number | null;
}

interface OpenDialog extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
  prompt?: { label: string; preview?: (amount: number) => string };
  choice?: ChoiceDialogOptions;
}

/**
 * Remplace le confirm() du navigateur par une fenêtre au style de l'application
 * (affichée par <app-confirm-dialog>, monté une seule fois à la racine).
 * Usage : if (await this.dialog.confirm({ title: '...', message: '...' })) { ... }
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly current = signal<OpenDialog | null>(null);
  /** Montant saisi dans une fenêtre avec champ (voir promptAmount). */
  readonly amount = signal<number | null>(null);

  confirm(options: ConfirmOptions): Promise<boolean> {
    // Une seule fenêtre à la fois : une éventuelle fenêtre ouverte est annulée.
    this.current()?.resolve(false);
    return new Promise<boolean>((resolve) => this.current.set({ ...options, resolve }));
  }

  /** Comme confirm(), avec un champ montant. Renvoie le montant validé, ou null si la fenêtre est annulée. */
  promptAmount(options: AmountPromptOptions): Promise<number | null> {
    this.current()?.resolve(false);
    this.amount.set(options.amount);
    return new Promise<number | null>((resolve) =>
      this.current.set({
        ...options,
        prompt: { label: options.amountLabel, preview: options.preview },
        resolve: (ok) => resolve(ok ? this.amount() : null),
      })
    );
  }

  /** Choix sélectionné dans une fenêtre à choix (voir promptChoice). */
  readonly choice = signal<string | null>(null);

  /** Renvoie le choix et le montant saisi (facultatif), ou null si la fenêtre est annulée. */
  promptChoice(options: ChoiceDialogOptions): Promise<ChoiceResult | null> {
    this.current()?.resolve(false);
    this.amount.set(null);
    this.choice.set(options.defaultChoice ?? options.choices?.[0]?.value ?? null);
    return new Promise<ChoiceResult | null>((resolve) =>
      this.current.set({
        ...options,
        choice: options,
        resolve: (ok) => resolve(ok ? { choice: this.choice(), amount: this.amount() } : null),
      })
    );
  }

  close(confirmed: boolean) {
    const open = this.current();
    if (!open) return;
    // Un montant est obligatoire pour valider une fenêtre avec champ.
    if (confirmed && open.prompt && this.amount() === null) return;
    this.current.set(null);
    open.resolve(confirmed);
  }
}
