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
  selector: 'app-register',
  templateUrl:
    './register.page.html',
  styleUrls: [
    './register.page.scss'
  ],
  standalone: false
})
export class RegisterPage {

  name = '';

  email = '';

  password = '';

  confirmPassword = '';

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

    const name =
      this.name.trim();

    const email =
      this.email
        .trim()
        .toLowerCase();

    const password =
      this.password;

    const confirmPassword =
      this.confirmPassword;

    if (
      !name ||
      !email ||
      !password ||
      !confirmPassword
    ) {

      await this.showToast(
        'Complete all fields.',
        'warning'
      );

      return;
    }

    if (
      password !==
      confirmPassword
    ) {

      await this.showToast(
        'Passwords do not match.',
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
      .register(
        name,
        email,
        password
      )
      .subscribe({

        next: async response => {

          this.submitting.set(
            false
          );

          await this.showToast(
            `Welcome to DiaLux, ${
              response.user?.name ||
              name
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
            'Registration error:',
            err
          );

          const message =
            err?.error?.error ||
            err?.message ||
            'Unable to create account.';

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

  openLogin(): void {

    this.router.navigateByUrl(
      '/login'
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