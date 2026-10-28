import {
  Component,
  signal
} from '@angular/core';

import {
  ActivatedRoute,
  Router
} from '@angular/router';

import {
  ToastController
} from '@ionic/angular/lazy';

import {
  Api
} from '../core/api';

import {
  Auth,
  AuthUser
} from '../core/auth';


interface ResetPasswordResponse {

  ok?: boolean;

  token?: string;

  user?: AuthUser;

  error?: string;

}


@Component({
  selector: 'app-reset-password',

  templateUrl:
    './reset-password.page.html',

  styleUrls: [
    './reset-password.page.scss'
  ],

  standalone: false
})
export class ResetPasswordPage {

  token =
    '';

  password =
    '';

  confirmPassword =
    '';


  loading =
    signal<boolean>(
      false
    );

  success =
    signal<boolean>(
      false
    );

  invalidLink =
    signal<boolean>(
      false
    );


  constructor(

    private route:
      ActivatedRoute,

    private router:
      Router,

    private api:
      Api,

    private auth:
      Auth,

    private toastController:
      ToastController

  ) {}


  ionViewWillEnter():
    void {

    this.token =
      this.route.snapshot
        .queryParamMap
        .get('token')
        ?.trim() ||
      '';


    this.invalidLink.set(
      !this.token
    );

  }


  async resetPassword():
    Promise<void> {

    if (
      this.loading()
    ) {

      return;

    }


    if (
      !this.token
    ) {

      this.invalidLink.set(
        true
      );

      return;

    }


    if (
      !this.password
    ) {

      await this.showToast(
        'Enter your new password.',
        'warning'
      );

      return;

    }


    if (
      this.password.length <
      8
    ) {

      await this.showToast(
        'Password must be at least 8 characters.',
        'warning'
      );

      return;

    }


    if (
      this.password !==
      this.confirmPassword
    ) {

      await this.showToast(
        'Passwords do not match.',
        'warning'
      );

      return;

    }


    this.loading.set(
      true
    );


    this.api
      .post<ResetPasswordResponse>(
        '/auth/reset-password',
        {

          token:
            this.token,

          password:
            this.password

        }
      )
      .subscribe({

        next: async response => {

          this.loading.set(
            false
          );


          /*
           * Backend already returns
           * a fresh token + user after
           * successful reset.
           *
           * Save them so the customer
           * stays signed in.
           */
          if (
            response?.token &&
            response?.user
          ) {

            localStorage.setItem(
              'authToken',
              response.token
            );


            localStorage.setItem(
              'authUser',
              JSON.stringify(
                response.user
              )
            );


            this.auth.currentUser.set(
              response.user
            );

          }


          this.password =
            '';

          this.confirmPassword =
            '';


          this.success.set(
            true
          );


          await this.showToast(
            'Password reset successfully.',
            'success'
          );

        },


        error: async error => {

          console.error(
            'Reset password error:',
            error
          );


          this.loading.set(
            false
          );


          const message =
            error?.error?.error ||
            'Could not reset your password.';


          if (
            message
              .toLowerCase()
              .includes(
                'invalid'
              ) ||
            message
              .toLowerCase()
              .includes(
                'expired'
              )
          ) {

            this.invalidLink.set(
              true
            );

          }


          await this.showToast(
            message,
            'danger'
          );

        }

      });

  }


  continueToApp():
    void {

    this.router.navigateByUrl(
      '/tabs/profile'
    );

  }


  goLogin():
    void {

    this.router.navigateByUrl(
      '/login'
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