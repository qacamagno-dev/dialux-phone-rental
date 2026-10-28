import {
  Component,
  NgZone,
  signal
} from '@angular/core';

import {
  Router
} from '@angular/router';

import {
  ToastController
} from '@ionic/angular/lazy';

import {
  Capacitor
} from '@capacitor/core';

import {
  SocialLogin,
  type GoogleLoginOptions,
  type GoogleLoginResponseOnline
} from '@capgo/capacitor-social-login';

import {
  Auth,
  AuthResponse
} from '../core/auth';


@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage {

  private readonly googleWebClientId =
    '807409726791-spvai3mdu194n9l2tt2hoh3r5uan2mvf.apps.googleusercontent.com';

  email = '';

  password = '';

  showPassword = false;

  submitting =
    signal<boolean>(false);

  googleSubmitting =
    signal<boolean>(false);

  private nativeGoogleReady =
    false;


  constructor(
    private auth: Auth,
    private router: Router,
    private toastController:
      ToastController,
    private zone: NgZone
  ) {}


  ionViewDidEnter():
    void {

    if (
      Capacitor.isNativePlatform()
    ) {

      void this.prepareNativeGoogle();

      this.mountNativeGoogleButton();

      return;
    }


    void this.mountWebGoogleButton();

  }


  async submit():
    Promise<void> {

    const email =
      this.email
        .trim()
        .toLowerCase();

    const password =
      this.password;


    if (
      !email ||
      !password
    ) {

      await this.showToast(
        'Enter your email and password.',
        'warning'
      );

      return;
    }


    if (
      this.submitting() ||
      this.googleSubmitting()
    ) {

      return;
    }


    this.submitting.set(
      true
    );


    this.auth
      .login(
        email,
        password
      )
      .subscribe({

        next: async response => {

          this.submitting.set(
            false
          );


          await this.finishLogin(
            response
          );

        },


        error: async err => {

          this.submitting.set(
            false
          );


          console.error(
            'Login error:',
            err
          );


          const message =
            err?.error?.error ||
            err?.message ||
            'Unable to sign in.';


          await this.showToast(
            message,
            'danger'
          );

        }

      });

  }


  togglePassword():
    void {

    this.showPassword =
      !this.showPassword;

  }


  openRegister():
    void {

    this.router.navigateByUrl(
      '/register'
    );

  }


  goHome():
    void {

    this.router.navigateByUrl(
      '/tabs/home'
    );

  }


  // =========================================================
  // NATIVE GOOGLE LOGIN
  // =========================================================

  private async prepareNativeGoogle():
    Promise<void> {

    if (
      this.nativeGoogleReady
    ) {

      return;
    }


    try {

      await SocialLogin.initialize({

        google: {

          webClientId:
            this.googleWebClientId,

          mode:
            'online'

        }

      });


      this.nativeGoogleReady =
        true;


      console.log(
        'Native Google login ready.'
      );

    } catch (error) {

      this.nativeGoogleReady =
        false;


      console.error(
        'Native Google initialization error:',
        error
      );

    }

  }


  private mountNativeGoogleButton():
    void {

    const container =
      document.getElementById(
        'googleBtn'
      );


    if (!container) {

      return;
    }


    container.replaceChildren();


    const button =
      document.createElement(
        'button'
      );


    button.type =
      'button';


    button.className =
      'native-google-button';


    button.innerHTML = `
      <span class="native-google-logo">
        G
      </span>

      <span>
        Continue with Google
      </span>
    `;


    button.addEventListener(
      'click',
      () => {

        this.zone.run(
          () => {

            void this.nativeGoogleLogin();

          }
        );

      }
    );


    container.appendChild(
      button
    );

  }


  private async nativeGoogleLogin():
    Promise<void> {

    if (
      this.googleSubmitting() ||
      this.submitting()
    ) {

      return;
    }


    this.googleSubmitting.set(
      true
    );


    try {

      if (
        !this.nativeGoogleReady
      ) {

        await this.prepareNativeGoogle();

      }


      if (
        !this.nativeGoogleReady
      ) {

        throw new Error(
          'Google sign-in could not be initialized.'
        );

      }


      const login =
        await SocialLogin.login({

          provider:
            'google',

          options: {} as GoogleLoginOptions

        });


      if (
        login.result.responseType !==
        'online'
      ) {

        throw new Error(
          'Google did not return an online authentication result.'
        );

      }


      const googleResult =
        login.result as
          GoogleLoginResponseOnline;


      const idToken =
        String(
          googleResult.idToken ||
          ''
        ).trim();


      if (!idToken) {

        throw new Error(
          'Google did not return an ID token.'
        );

      }


      this.auth
        .googleLogin(
          idToken
        )
        .subscribe({

          next: async authResponse => {

            this.googleSubmitting.set(
              false
            );


            await this.finishLogin(
              authResponse
            );

          },


          error: async err => {

            this.googleSubmitting.set(
              false
            );


            console.error(
              'Native Google backend login error:',
              err
            );


            const message =
              err?.error?.error ||
              err?.message ||
              'Google sign-in failed.';


            await this.showToast(
              message,
              'danger'
            );

          }

        });

    } catch (error: any) {

      this.googleSubmitting.set(
        false
      );


      console.error(
        'Native Google login error:',
        error
      );


      const rawMessage =
        String(
          error?.message ||
          error ||
          ''
        );


      const lowerMessage =
        rawMessage
          .toLowerCase();


      if (
        lowerMessage.includes(
          'cancel'
        ) ||
        lowerMessage.includes(
          'canceled'
        ) ||
        lowerMessage.includes(
          'cancelled'
        )
      ) {

        return;

      }


      await this.showToast(
        rawMessage ||
        'Google sign-in failed.',
        'danger'
      );

    }

  }


  // =========================================================
  // WEB GOOGLE LOGIN
  // =========================================================

  private async mountWebGoogleButton():
    Promise<void> {

    const clientId =
      document
        .querySelector(
          'meta[name="google-client-id"]'
        )
        ?.getAttribute(
          'content'
        )
        ?.trim() ||
      this.googleWebClientId;


    const container =
      document.getElementById(
        'googleBtn'
      );


    if (
      !clientId ||
      !container
    ) {

      return;
    }


    const available =
      await this.waitForGoogleIdentity();


    if (
      !available
    ) {

      container.innerHTML =
        '<p class="google-unavailable">Google sign-in is unavailable right now.</p>';

      return;
    }


    const google =
      (window as any).google;


    container.replaceChildren();


    google.accounts.id.initialize({

      client_id:
        clientId,


      callback: (
        response: any
      ) => {

        this.zone.run(
          () => {

            void this.handleWebGoogleCredential(
              response
            );

          }
        );

      },


      cancel_on_tap_outside:
        true

    });


    google.accounts.id.renderButton(
      container,
      {

        type:
          'standard',

        theme:
          'outline',

        size:
          'large',

        text:
          'signin_with',

        shape:
          'rectangular',

        logo_alignment:
          'left',

        width:
          320

      }
    );

  }


  private waitForGoogleIdentity(
    timeoutMs = 8000
  ):
    Promise<boolean> {

    return new Promise(
      resolve => {

        const google =
          (window as any).google;


        if (
          google?.accounts?.id
        ) {

          resolve(
            true
          );

          return;

        }


        const startedAt =
          Date.now();


        const timer =
          window.setInterval(
            () => {

              const currentGoogle =
                (window as any).google;


              if (
                currentGoogle
                  ?.accounts
                  ?.id
              ) {

                window.clearInterval(
                  timer
                );


                resolve(
                  true
                );


                return;

              }


              if (
                Date.now() -
                  startedAt >
                timeoutMs
              ) {

                window.clearInterval(
                  timer
                );


                resolve(
                  false
                );

              }

            },

            100

          );

      }

    );

  }


  private async handleWebGoogleCredential(
    response: any
  ):
    Promise<void> {

    const credential =
      String(
        response?.credential ||
        ''
      ).trim();


    if (!credential) {

      await this.showToast(
        'Google did not return a credential.',
        'danger'
      );


      return;

    }


    if (
      this.googleSubmitting() ||
      this.submitting()
    ) {

      return;
    }


    this.googleSubmitting.set(
      true
    );


    this.auth
      .googleLogin(
        credential
      )
      .subscribe({

        next: async authResponse => {

          this.googleSubmitting.set(
            false
          );


          await this.finishLogin(
            authResponse
          );

        },


        error: async err => {

          this.googleSubmitting.set(
            false
          );


          console.error(
            'Web Google login error:',
            err
          );


          const message =
            err?.error?.error ||
            err?.message ||
            'Google sign-in failed.';


          await this.showToast(
            message,
            'danger'
          );

        }

      });

  }


  // =========================================================
  // COMMON SUCCESS
  // =========================================================

  private async finishLogin(
    response: AuthResponse
  ):
    Promise<void> {

    if (
      response.user?.role &&
      response.user.role !==
        'user'
    ) {

      this.auth.logout();


      await this.showToast(
        'Please use the web dashboard for staff accounts.',
        'warning'
      );


      return;

    }


    await this.showToast(
      `Welcome back, ${
        response.user?.name ||
        'customer'
      }!`,
      'success'
    );


    await this.router.navigateByUrl(
      '/tabs/home',
      {

        replaceUrl:
          true

      }
    );

  }


  private async showToast(
    message: string,

    color:
      | 'success'
      | 'danger'
      | 'warning'
      | 'primary'
  ):
    Promise<void> {

    const toast =
      await this.toastController
        .create({

          message,

          duration:
            2200,

          position:
            'bottom',

          color

        });


    await toast.present();

  }

}