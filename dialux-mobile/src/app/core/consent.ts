import {
  Injectable
} from '@angular/core';

import {
  Router
} from '@angular/router';

import {
  ModalController
} from '@ionic/angular/lazy';

import {
  firstValueFrom
} from 'rxjs';

import {
  Api
} from './api';

import {
  Auth
} from './auth';

import {
  ConsentModalComponent,
  ConsentStatus
} from '../consent-modal/consent-modal.component';


@Injectable({
  providedIn: 'root'
})
export class UserConsentService {

  private openPromise:
    Promise<boolean> |
    null =
      null;


  constructor(
    private api:
      Api,

    private auth:
      Auth,

    private modalController:
      ModalController,

    private router:
      Router
  ) {}


  async ensureAccepted(
    preferencesOnly =
      false
  ):
    Promise<boolean> {

    if (
      !this.auth.isLoggedIn() ||
      this.auth.currentUser()
        ?.role !==
        'user'
    ) {

      return true;

    }


    if (
      this.openPromise
    ) {

      return this.openPromise;

    }


    this.openPromise =
      this.presentConsent(
        preferencesOnly
      );


    try {

      return await this.openPromise;

    } finally {

      this.openPromise =
        null;

    }

  }


  async openPreferences():
    Promise<boolean> {

    return this.ensureAccepted(
      true
    );

  }


  private async presentConsent(
    preferencesOnly:
      boolean
  ):
    Promise<boolean> {

    let status:
      ConsentStatus;


    try {

      status =
        await firstValueFrom(
          this.api
            .get<ConsentStatus>(
              '/users/me/consent'
            )
        );

    } catch (error) {

      console.error(
        'Consent status error:',
        error
      );


      return false;

    }


    if (
      !preferencesOnly &&
      status.termsAccepted
    ) {

      return true;

    }


    const modal =
      await this.modalController
        .create({

          component:
            ConsentModalComponent,

          componentProps: {

            status,

            preferencesOnly

          },

          backdropDismiss:
            preferencesOnly,

          cssClass:
            'dialux-consent-modal'

        });


    await modal.present();


    const result =
      await modal.onDidDismiss();


    if (
      result.role ===
      'signout'
    ) {

      this.auth.logout();


      await this.router
        .navigateByUrl(
          '/login',
          {
            replaceUrl:
              true
          }
        );


      return false;

    }


    return Boolean(
      result.data?.accepted
    );

  }

}
