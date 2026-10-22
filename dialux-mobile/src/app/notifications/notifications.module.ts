import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';
import { NotificationsPageRoutingModule } from './notifications-routing.module';
import { NotificationsPage } from './notifications.page';
@NgModule({ imports:[CommonModule,FormsModule,IonicModule,NotificationsPageRoutingModule], declarations:[NotificationsPage] }) export class NotificationsPageModule {}
