import { NgModule } from '@angular/core';

import {
  RouterModule,
  Routes
} from '@angular/router';

import { TabsPage } from './tabs.page';

const routes: Routes = [
  {
    path: 'tabs',

    component: TabsPage,

    children: [
      {
        path: 'home',

        loadChildren: () =>
          import('../tab1/tab1.module').then(
            m => m.Tab1PageModule
          )
      },

      {
        path: 'devices',

        loadChildren: () =>
          import('../tab2/tab2.module').then(
            m => m.Tab2PageModule
          )
      },

      {
        path: 'device/:id',

        loadChildren: () =>
          import('../device-detail/device-detail.module').then(
            m => m.DeviceDetailPageModule
          )
      },

      {
        path: 'wishlist',

        loadChildren: () =>
          import('../wishlist/wishlist.module').then(
            m => m.WishlistPageModule
          )
      },

      {
        path: 'cart',

        loadChildren: () =>
          import('../tab3/tab3.module').then(
            m => m.Tab3PageModule
          )
      },

      {
        path: 'profile',

        loadChildren: () =>
          import('../profile/profile.module').then(
            m => m.ProfilePageModule
          )
      },

      {
        path: 'checkout',

        loadChildren: () =>
          import('../checkout/checkout.module').then(
            m => m.CheckoutPageModule
          )
      },

      {
        path: 'orders',

        loadChildren: () =>
          import('../orders/orders.module').then(
            m => m.OrdersPageModule
          )
      },

      {
        path: 'order/:id',

        loadChildren: () =>
          import('../order/order.module').then(
            m => m.OrderPageModule
          )
      },

      {
        path: 'notifications',

        loadChildren: () =>
          import('../notifications/notifications.module').then(
            m => m.NotificationsPageModule
          )
      },

      {
        path: 'support',

        loadChildren: () =>
          import('../support/support.module').then(
            m => m.SupportPageModule
          )
      },

      {
        path: '',

        redirectTo: '/tabs/home',

        pathMatch: 'full'
      }
    ]
  },

  {
    path: '',

    redirectTo: '/tabs/home',

    pathMatch: 'full'
  }
];

@NgModule({
  imports: [
    RouterModule.forChild(routes)
  ]
})
export class TabsPageRoutingModule {}