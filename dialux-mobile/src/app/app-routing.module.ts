import {
  NgModule
} from '@angular/core';

import {
  PreloadAllModules,
  RouterModule,
  Routes
} from '@angular/router';


const routes: Routes = [

  {
    path: 'login',

    loadChildren: () =>
      import(
        './login/login.module'
      ).then(
        m => m.LoginPageModule
      )
  },

  {
    path: 'register',

    loadChildren: () =>
      import(
        './register/register.module'
      ).then(
        m => m.RegisterPageModule
      )
  },

  {
    path: 'reset-password',

    loadChildren: () =>
      import(
        './reset-password/reset-password.module'
      ).then(
        m => m.ResetPasswordPageModule
      )
  },

  {
    path: 'order/:id',

    loadChildren: () =>
      import(
        './order-detail/order-detail.module'
      ).then(
        m => m.OrderDetailPageModule
      )
  },

  {
    path: 'checkout',
    redirectTo: '/tabs/checkout',
    pathMatch: 'full'
  },

  {
    path: 'orders',
    redirectTo: '/tabs/orders',
    pathMatch: 'full'
  },

  {
    path: 'notifications',
    redirectTo: '/tabs/notifications',
    pathMatch: 'full'
  },

  {
    path: 'support',
    redirectTo: '/tabs/support',
    pathMatch: 'full'
  },

  {
    path: 'splash',

    loadChildren: () =>
      import(
        './splash/splash.module'
      ).then(
        m => m.SplashPageModule
      )
  },

  {
    path: '',

    loadChildren: () =>
      import(
        './tabs/tabs.module'
      ).then(
        m => m.TabsPageModule
      )
  }

];


@NgModule({

  imports: [

    RouterModule.forRoot(
      routes,
      {
        preloadingStrategy:
          PreloadAllModules
      }
    )

  ],

  exports: [
    RouterModule
  ]

})
export class AppRoutingModule {}