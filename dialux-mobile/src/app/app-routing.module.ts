import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
const routes: Routes = [
  { path:'login', loadChildren:()=>import('./login/login.module').then(m=>m.LoginPageModule) },
  { path:'register', loadChildren:()=>import('./register/register.module').then(m=>m.RegisterPageModule) },
  { path:'checkout', loadChildren:()=>import('./checkout/checkout.module').then(m=>m.CheckoutPageModule) },
  { path:'orders', loadChildren:()=>import('./orders/orders.module').then(m=>m.OrdersPageModule) },
  { path:'order/:id', loadChildren:()=>import('./order/order.module').then(m=>m.OrderPageModule) },
  { path:'notifications', loadChildren:()=>import('./notifications/notifications.module').then(m=>m.NotificationsPageModule) },
  { path:'support', loadChildren:()=>import('./support/support.module').then(m=>m.SupportPageModule) },
  { path:'', loadChildren:()=>import('./tabs/tabs.module').then(m=>m.TabsPageModule) }
];
@NgModule({imports:[RouterModule.forRoot(routes,{preloadingStrategy:PreloadAllModules})],exports:[RouterModule]}) export class AppRoutingModule {}
