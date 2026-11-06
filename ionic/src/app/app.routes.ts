import { Routes } from '@angular/router'

export const routes: Routes = [
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then((module) => module.HomePage),
  },
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: '**', redirectTo: 'home' },
]
