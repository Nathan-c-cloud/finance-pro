import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

/**
 * Bloque l'accès aux pages tant que l'utilisateur n'est pas connecté.
 * Attend que le client Supabase ait fini de vérifier la session existante
 * (ready()) avant de décider, pour éviter un redirect vers /connexion
 * au premier chargement alors qu'une session valide existe déjà.
 */
export const authGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  if (!supabase.ready()) {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (supabase.ready()) {
          resolve();
        } else {
          setTimeout(check, 30);
        }
      };
      check();
    });
  }

  if (supabase.session()) {
    return true;
  }

  return router.createUrlTree(['/connexion']);
};

/**
 * Empêche un utilisateur déjà connecté de revoir l'écran de connexion.
 */
export const guestGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  if (!supabase.ready()) {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (supabase.ready()) {
          resolve();
        } else {
          setTimeout(check, 30);
        }
      };
      check();
    });
  }

  if (supabase.session()) {
    return router.createUrlTree(['/mois']);
  }

  return true;
};
