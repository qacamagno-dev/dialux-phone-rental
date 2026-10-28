import {
  Injectable,
  NgZone
} from '@angular/core';

import {
  Router
} from '@angular/router';

import {
  Capacitor
} from '@capacitor/core';

import {
  PushNotifications,
  PushNotificationSchema,
  ActionPerformed,
  Token
} from '@capacitor/push-notifications';


@Injectable({
  providedIn: 'root'
})
export class PushNotificationsService {

  private readonly apiUrl =
    'https://dialux-phone-rental.onrender.com/api';

  private readonly cachedFcmTokenKey =
    'dialux_fcm_token';

  private initialized =
    false;

  private registeredWithBackend =
    false;


  constructor(
    private router: Router,
    private zone: NgZone
  ) {}


  async initialize():
    Promise<void> {

    if (
      this.initialized ||
      !Capacitor.isNativePlatform()
    ) {

      return;

    }

    this.initialized =
      true;


    try {

      await this.createAndroidChannel();

      await this.addListeners();


      let permission =
        await PushNotifications
          .checkPermissions();


      if (
        permission.receive ===
        'prompt'
      ) {

        permission =
          await PushNotifications
            .requestPermissions();

      }


      if (
        permission.receive !==
        'granted'
      ) {

        console.warn(
          'Push notification permission was not granted.'
        );

        return;

      }


      await PushNotifications
        .register();


      /*
       * If we already received an FCM token
       * during a previous app launch, attempt
       * to attach it to the currently logged-in
       * account again.
       */
      await this.syncStoredToken();

    } catch (error) {

      console.error(
        'Push initialization error:',
        error
      );

    }

  }


  private async createAndroidChannel():
    Promise<void> {

    if (
      Capacitor.getPlatform() !==
      'android'
    ) {

      return;

    }


    try {

      await PushNotifications
        .createChannel({
          id:
            'dialux-updates',

          name:
            'DiaLux Updates',

          description:
            'Booking, payment, delivery and account updates',

          importance:
            5,

          visibility:
            1,

          vibration:
            true
        });

    } catch (error) {

      console.warn(
        'Could not create notification channel:',
        error
      );

    }

  }


  private async addListeners():
    Promise<void> {

    await PushNotifications
      .addListener(
        'registration',
        (
          token: Token
        ) => {

          console.log(
            'FCM token received:',
            token.value
          );


          localStorage.setItem(
            this.cachedFcmTokenKey,
            token.value
          );


          void this.registerTokenWithBackend(
            token.value
          );

        }
      );


    await PushNotifications
      .addListener(
        'registrationError',
        error => {

          console.error(
            'Push registration error:',
            error
          );

        }
      );


    await PushNotifications
      .addListener(
        'pushNotificationReceived',
        (
          notification:
            PushNotificationSchema
        ) => {

          console.log(
            'Push received:',
            notification
          );

        }
      );


    await PushNotifications
      .addListener(
        'pushNotificationActionPerformed',
        (
          action:
            ActionPerformed
        ) => {

          const data =
            action.notification
              .data ||
            {};


          this.zone.run(
            () => {

              this.navigateFromPush(
                data
              );

            }
          );

        }
      );

  }


  async syncStoredToken():
    Promise<void> {

    const token =
      localStorage.getItem(
        this.cachedFcmTokenKey
      );


    if (!token) {

      return;

    }


    await this.registerTokenWithBackend(
      token
    );

  }


  private async registerTokenWithBackend(
    fcmToken: string
  ):
    Promise<void> {

    if (
      !fcmToken ||
      this.registeredWithBackend
    ) {

      return;

    }


    const authToken =
      this.findAuthToken();


    /*
     * User may still be on the login page.
     * The token stays cached and can be
     * synced again after login/app resume.
     */
    if (!authToken) {

      console.log(
        'FCM token cached. Waiting for authenticated session.'
      );

      return;

    }


    try {

      const response =
        await fetch(
          `${this.apiUrl}/push/register`,
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${authToken}`
            },

            body:
              JSON.stringify({
                token:
                  fcmToken
              })
          }
        );


      if (
        !response.ok
      ) {

        const body =
          await response
            .json()
            .catch(
              () => ({})
            );


        console.warn(
          'Push token backend registration failed:',
          response.status,
          body
        );

        return;

      }


      this.registeredWithBackend =
        true;


      console.log(
        '✅ FCM token linked to DiaLux account'
      );

    } catch (error) {

      console.error(
        'Push token sync error:',
        error
      );

    }

  }


  /*
   * Supports the usual token names.
   *
   * We do not create or modify the auth
   * token here — we only read the one
   * your existing login system already
   * stores.
   */
  private findAuthToken():
    string | null {

    const possibleKeys = [
      'token',
      'authToken',
      'accessToken',
      'access_token',
      'jwt',
      'dialux_token'
    ];


    for (
      const key
      of possibleKeys
    ) {

      const value =
        localStorage.getItem(
          key
        );


      if (
        value &&
        value !==
          'null' &&
        value !==
          'undefined'
      ) {

        return value;

      }

    }


    /*
     * Some apps store the whole auth
     * response as JSON.
     */
    const possibleObjects = [
      'auth',
      'user',
      'currentUser',
      'session'
    ];


    for (
      const key
      of possibleObjects
    ) {

      const raw =
        localStorage.getItem(
          key
        );


      if (!raw) {

        continue;

      }


      try {

        const parsed =
          JSON.parse(
            raw
          );


        const value =
          parsed?.token ||
          parsed?.authToken ||
          parsed?.accessToken ||
          parsed?.access_token ||
          parsed?.jwt;


        if (value) {

          return String(
            value
          );

        }

      } catch {

        // Not JSON. Ignore.

      }

    }


    return null;

  }


  private navigateFromPush(
    data: Record<
      string,
      any
    >
  ):
    void {

const link =
  String(
    data?.['link'] ||
    ''
  );

    /*
     * Backend order notifications use:
     *
     * /order.html?id=<order id>
     */
    if (
      link.includes(
        'order.html'
      )
    ) {

      try {

        const parsed =
          new URL(
            link,
            'https://dialux-phone-rental.onrender.com'
          );


        const orderId =
          parsed.searchParams.get(
            'id'
          );


        if (orderId) {

          void this.router.navigate(
            [
              '/order',
              orderId
            ]
          );

          return;

        }

      } catch (error) {

        console.error(
          'Invalid order push link:',
          error
        );

      }

    }


    if (
      link.includes(
        'support'
      )
    ) {

      void this.router.navigate(
        [
          '/support'
        ]
      );

      return;

    }


    if (
      link.includes(
        'profile'
      )
    ) {

      void this.router.navigate(
        [
          '/tabs/profile'
        ]
      );

      return;

    }


    /*
     * Default destination for
     * broadcasts/system notifications.
     */
    void this.router.navigate(
      [
        '/notifications'
      ]
    );

  }

}