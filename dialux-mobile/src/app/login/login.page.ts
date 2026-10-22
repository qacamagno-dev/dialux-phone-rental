import {
  Component,
  signal
} from '@angular/core';

import {
  Router
} from '@angular/router';

import {
  ToastController
} from '@ionic/angular/lazy';

import {
  Auth
} from '../core/auth';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage {

  email = '';

  password = '';

  showPassword = false;

  submitting =
    signal<boolean>(false);

  constructor(
    private auth: Auth,
    private router: Router,
    private toastController:
      ToastController
  ) {}

  async submit(): Promise<void> {

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
      this.submitting()
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

          if (
            response.user?.role &&
            response.user.role !== 'user'
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
              replaceUrl: true
            }
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

  togglePassword(): void {

    this.showPassword =
      !this.showPassword;
  }

  openRegister(): void {

    this.router.navigateByUrl(
      '/register'
    );
  }

  goHome(): void {

    this.router.navigateByUrl(
      '/tabs/home'
    );
  }

  private async showToast(
    message: string,
    color:
      | 'success'
      | 'danger'
      | 'warning'
      | 'primary'
  ): Promise<void> {

    const toast =
      await this.toastController.create({
        message,
        duration: 2200,
        position: 'bottom',
        color
      });

    await toast.present();
  }
}