import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';

import {
  IonicModule,
  IonicRouteStrategy,
} from '@ionic/angular/lazy';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ConsentModalComponent } from './consent-modal/consent-modal.component';

@NgModule({
  declarations: [
    AppComponent,
    ConsentModalComponent,
  ],
  imports: [
    BrowserModule,
    HttpClientModule,
    IonicModule.forRoot(),
    AppRoutingModule,
  ],
  providers: [
    {
      provide: RouteReuseStrategy,
      useClass: IonicRouteStrategy,
    },
  ],
  bootstrap: [
    AppComponent,
  ],
})
export class AppModule {}