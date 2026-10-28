import {
  Component,
  NgZone,
  OnDestroy
} from '@angular/core';

import {
  Router
} from '@angular/router';

import {
  App,
  URLOpenListenerEvent
} from '@capacitor/app';

import type {
  PluginListenerHandle
} from '@capacitor/core';

import {
  PushNotificationsService
} from './core/push-notifications.service';


@Component({
  selector:
    'app-root',

  templateUrl:
    'app.component.html',

  styleUrls: [
    'app.component.scss'
  ],

  standalone:
    false
})
export class AppComponent
  implements OnDestroy {

  private urlListener:
    PluginListenerHandle |
    null =
      null;


  private appStateListener:
    PluginListenerHandle |
    null =
      null;


  constructor(
    private router: Router,
    private zone: NgZone,
    private pushNotifications:
      PushNotificationsService
  ) {

    void this.initializeApp();

  }


  private async initializeApp():
    Promise<void> {

    await this.setupDeepLinks();

    await this.pushNotifications
      .initialize();


    /*
     * Whenever the user returns to
     * DiaLux, retry syncing the stored
     * FCM token.
     *
     * Useful if notification permission
     * was granted before login.
     */
    this.appStateListener =
      await App.addListener(
        'appStateChange',
        state => {

          if (
            state.isActive
          ) {

            void this.pushNotifications
              .syncStoredToken();

          }

        }
      );

  }


  private async setupDeepLinks():
    Promise<void> {

    this.urlListener =
      await App.addListener(
        'appUrlOpen',
        (
          event:
            URLOpenListenerEvent
        ) => {

          this.handleUrl(
            event.url
          );

        }
      );


    /*
     * Handles the case where DiaLux
     * was completely closed before
     * the user tapped the email link.
     */
    const launch =
      await App.getLaunchUrl();


    if (
      launch?.url
    ) {

      this.handleUrl(
        launch.url
      );

    }

  }


  private handleUrl(
    rawUrl: string
  ):
    void {

    try {

      const url =
        new URL(
          rawUrl
        );


      /*
       * Existing password-reset
       * email URL:
       *
       * https://dialux-phone-rental.onrender.com/
       * reset-password.html?token=...
       */
      const isWebsiteReset =
        url.protocol ===
          'https:' &&
        url.hostname ===
          'dialux-phone-rental.onrender.com' &&
        url.pathname ===
          '/reset-password.html';


      const isWebsitePayment =
        url.protocol ===
          'https:' &&
        url.hostname ===
          'dialux-phone-rental.onrender.com' &&
        url.pathname ===
          '/payment-return.html';


      const isCustomPayment =
        url.protocol ===
          'dialux:' &&
        url.hostname ===
          'payment';


      if (
        isWebsitePayment ||
        isCustomPayment
      ) {

        const orderId =
          url.searchParams.get(
            'orderId'
          );

        const payment =
          url.searchParams.get(
            'payment'
          ) ||
          'success';

        if (!orderId) {
          return;
        }

        this.zone.run(
          () => {

            void this.router.navigate(
              [
                '/order',
                orderId
              ],
              {
                queryParams: {
                  payment
                }
              }
            );

          }
        );

        return;
      }


      /*
       * Also support our own scheme:
       *
       * dialux://reset-password?token=...
       */
      const isCustomReset =
        url.protocol ===
          'dialux:' &&
        url.hostname ===
          'reset-password';


      if (
        !isWebsiteReset &&
        !isCustomReset
      ) {

        return;

      }


      const token =
        url.searchParams.get(
          'token'
        );


      if (!token) {

        return;

      }


      this.zone.run(
        () => {

          void this.router.navigate(
            [
              '/reset-password'
            ],
            {
              queryParams: {
                token
              }
            }
          );

        }
      );

    } catch (error) {

      console.error(
        'Deep link error:',
        error
      );

    }

  }


  ngOnDestroy():
    void {

    if (
      this.urlListener
    ) {

      void this.urlListener
        .remove();

      this.urlListener =
        null;

    }


    if (
      this.appStateListener
    ) {

      void this.appStateListener
        .remove();

      this.appStateListener =
        null;

    }

  }

}