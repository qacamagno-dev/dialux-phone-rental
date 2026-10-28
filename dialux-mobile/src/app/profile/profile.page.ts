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
  Api
} from '../core/api';

import {
  Auth,
  AuthUser
} from '../core/auth';


interface Address {

  id?: string;
  _id?: string;

  label?: string;
  phone?: string;

  address?: string;
  city?: string;
  zip?: string;

  isDefault?: boolean;

}


interface PasswordResponse {

  ok?: boolean;

  hasPassword?: boolean;

  message?: string;

}


interface ForgotPasswordResponse {

  ok?: boolean;

  message?: string;

  emailed?: boolean;

  transport?: string;

  devResetUrl?: string;

}


@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: [
    './profile.page.scss'
  ],
  standalone: false
})
export class ProfilePage {

  user =
    signal<AuthUser | null>(
      null
    );

  addresses =
    signal<Address[]>(
      []
    );

  loading =
    signal<boolean>(
      true
    );

  editing =
    signal<boolean>(
      false
    );

  savingProfile =
    signal<boolean>(
      false
    );

  savingAddress =
    signal<boolean>(
      false
    );

  busyAddressId =
    signal<string | null>(
      null
    );

  passwordFormOpen =
    signal<boolean>(
      false
    );

  changingPassword =
    signal<boolean>(
      false
    );

  sendingReset =
    signal<boolean>(
      false
    );


  name =
    '';

  phone =
    '';

  addressLabel =
    'Home';

  address =
    '';

  city =
    '';

  zip =
    '';

  currentPassword =
    '';

  newPassword =
    '';

  confirmPassword =
    '';


  constructor(

    public auth:
      Auth,

    private api:
      Api,

    private router:
      Router,

    private toastController:
      ToastController

  ) {}


  ionViewWillEnter():
    void {

    this.load();

  }


  load():
    void {

    if (
      !this.auth.isLoggedIn()
    ) {

      this.user.set(
        null
      );

      this.addresses.set(
        []
      );

      this.loading.set(
        false
      );

      return;

    }


    this.loading.set(
      true
    );


    this.auth
      .loadCurrentUser()
      .subscribe({

        next: user => {

          this.user.set(
            user
          );


          this.name =
            user.name ||
            '';


          this.phone =
            user.profile
              ?.phone ||
            '';


          this.loadAddresses();

        },


        error: error => {

          console.error(
            'Profile load error:',
            error
          );


          this.loading.set(
            false
          );

        }

      });

  }


  private loadAddresses():
    void {

    this.api
      .get<{
        addresses: Address[];
      }>(
        '/users/me/addresses'
      )
      .subscribe({

        next: response => {

          this.addresses.set(
            response?.addresses ||
            []
          );


          this.loading.set(
            false
          );

        },


        error: error => {

          console.error(
            'Addresses load error:',
            error
          );


          this.addresses.set(
            []
          );


          this.loading.set(
            false
          );

        }

      });

  }


  async save():
    Promise<void> {

    if (
      this.savingProfile()
    ) {

      return;

    }


    const cleanName =
      this.name.trim();


    if (!cleanName) {

      await this.showToast(
        'Name is required.',
        'warning'
      );

      return;

    }


    this.savingProfile.set(
      true
    );


    this.api
      .patch<AuthUser>(
        '/users/me',
        {

          name:
            cleanName,

          phone:
            this.phone.trim()

        }
      )
      .subscribe({

        next: async user => {

          this.user.set(
            user
          );


          localStorage.setItem(
            'authUser',
            JSON.stringify(
              user
            )
          );


          this.auth.currentUser.set(
            user
          );


          this.editing.set(
            false
          );


          this.savingProfile.set(
            false
          );


          await this.showToast(
            'Profile saved.',
            'success'
          );

        },


        error: async error => {

          console.error(
            'Profile save error:',
            error
          );


          this.savingProfile.set(
            false
          );


          await this.showToast(
            error?.error?.error ||
            'Could not save profile.',
            'danger'
          );

        }

      });

  }


  hasPassword():
    boolean {

    const current =
      this.user() as
        (
          AuthUser & {
            hasPassword?: boolean;
          }
        ) |
        null;


    return Boolean(
      current?.hasPassword
    );

  }


  openPasswordForm():
    void {

    this.currentPassword =
      '';

    this.newPassword =
      '';

    this.confirmPassword =
      '';


    this.passwordFormOpen.set(
      true
    );

  }


  closePasswordForm():
    void {

    if (
      this.changingPassword()
    ) {

      return;

    }


    this.currentPassword =
      '';

    this.newPassword =
      '';

    this.confirmPassword =
      '';


    this.passwordFormOpen.set(
      false
    );

  }


  async changePassword():
    Promise<void> {

    if (
      this.changingPassword()
    ) {

      return;

    }


    if (
      this.hasPassword() &&
      !this.currentPassword
    ) {

      await this.showToast(
        'Enter your current password.',
        'warning'
      );

      return;

    }


    if (
      !this.newPassword
    ) {

      await this.showToast(
        'Enter a new password.',
        'warning'
      );

      return;

    }


    if (
      this.newPassword !==
      this.confirmPassword
    ) {

      await this.showToast(
        'New passwords do not match.',
        'warning'
      );

      return;

    }


    if (
      this.hasPassword() &&
      this.currentPassword ===
      this.newPassword
    ) {

      await this.showToast(
        'Choose a different new password.',
        'warning'
      );

      return;

    }


    this.changingPassword.set(
      true
    );


    this.api
      .patch<PasswordResponse>(
        '/users/me/password',
        {

          currentPassword:
            this.currentPassword,

          newPassword:
            this.newPassword,

          confirmPassword:
            this.confirmPassword

        }
      )
      .subscribe({

        next: async response => {

          this.changingPassword.set(
            false
          );


          const current =
            this.user();


          if (current) {

            const updated =
              {
                ...current,
                hasPassword: true
              } as AuthUser;


            this.user.set(
              updated
            );


            this.auth.currentUser.set(
              updated
            );


            localStorage.setItem(
              'authUser',
              JSON.stringify(
                updated
              )
            );

          }


          this.currentPassword =
            '';

          this.newPassword =
            '';

          this.confirmPassword =
            '';


          this.passwordFormOpen.set(
            false
          );


          await this.showToast(
            response?.message ||
            'Password updated successfully.',
            'success'
          );

        },


        error: async error => {

          console.error(
            'Password change error:',
            error
          );


          this.changingPassword.set(
            false
          );


          await this.showToast(
            error?.error?.error ||
            'Could not update password.',
            'danger'
          );

        }

      });

  }


  async forgotPassword():
    Promise<void> {

    if (
      this.sendingReset()
    ) {

      return;

    }


    const current =
      this.user();


    const email =
      current?.email
        ?.trim() ||
      '';


    if (!email) {

      await this.showToast(
        'No email address is available for this account.',
        'danger'
      );

      return;

    }


    this.sendingReset.set(
      true
    );


    this.api
      .post<ForgotPasswordResponse>(
        '/auth/forgot-password',
        {
          email
        }
      )
      .subscribe({

        next: async response => {

          this.sendingReset.set(
            false
          );


          await this.showToast(
            response?.message ||
            'Password reset instructions were sent to your email.',
            'success'
          );

        },


        error: async error => {

          console.error(
            'Forgot password error:',
            error
          );


          this.sendingReset.set(
            false
          );


          await this.showToast(
            error?.error?.error ||
            'Could not send password reset instructions.',
            'danger'
          );

        }

      });

  }


  async addAddress():
    Promise<void> {

    if (
      this.savingAddress()
    ) {

      return;

    }


    if (
      !this.address.trim() ||
      !this.city.trim()
    ) {

      await this.showToast(
        'Enter your street address and city.',
        'warning'
      );

      return;

    }


    this.savingAddress.set(
      true
    );


    this.api
      .post<AuthUser>(
        '/users/me/addresses',
        {

          label:
            this.addressLabel.trim() ||
            'Home',

          phone:
            this.phone.trim(),

          address:
            this.address.trim(),

          city:
            this.city.trim(),

          zip:
            this.zip.trim(),

          isDefault:
            this.addresses().length ===
            0

        }
      )
      .subscribe({

        next: async () => {

          this.addressLabel =
            'Home';

          this.address =
            '';

          this.city =
            '';

          this.zip =
            '';


          this.savingAddress.set(
            false
          );


          this.loadAddresses();


          await this.showToast(
            'Address saved.',
            'success'
          );

        },


        error: async error => {

          console.error(
            'Address save error:',
            error
          );


          this.savingAddress.set(
            false
          );


          await this.showToast(
            error?.error?.error ||
            'Could not save address.',
            'danger'
          );

        }

      });

  }


  setDefault(
    address: Address
  ):
    void {

    const id =
      this.getAddressId(
        address
      );


    if (
      !id ||
      this.busyAddressId()
    ) {

      return;

    }


    this.busyAddressId.set(
      id
    );


    this.api
      .post(
        `/users/me/addresses/${id}/default`,
        {}
      )
      .subscribe({

        next: async () => {

          this.busyAddressId.set(
            null
          );


          this.loadAddresses();


          await this.showToast(
            'Default address updated.',
            'success'
          );

        },


        error: async error => {

          console.error(
            'Set default address error:',
            error
          );


          this.busyAddressId.set(
            null
          );


          await this.showToast(
            error?.error?.error ||
            'Could not update default address.',
            'danger'
          );

        }

      });

  }


  remove(
    address: Address
  ):
    void {

    const id =
      this.getAddressId(
        address
      );


    if (
      !id ||
      this.busyAddressId()
    ) {

      return;

    }


    this.busyAddressId.set(
      id
    );


    this.api
      .delete(
        `/users/me/addresses/${id}`
      )
      .subscribe({

        next: async () => {

          this.busyAddressId.set(
            null
          );


          this.loadAddresses();


          await this.showToast(
            'Address removed.',
            'success'
          );

        },


        error: async error => {

          console.error(
            'Address remove error:',
            error
          );


          this.busyAddressId.set(
            null
          );


          await this.showToast(
            error?.error?.error ||
            'Could not remove address.',
            'danger'
          );

        }

      });

  }


  getAddressId(
    address: Address
  ):
    string {

    return (
      address.id ||
      address._id ||
      ''
    );

  }


  isAddressBusy(
    address: Address
  ):
    boolean {

    return (
      this.busyAddressId() ===
      this.getAddressId(
        address
      )
    );

  }


  cancelEdit():
    void {

    const current =
      this.user();


    this.name =
      current?.name ||
      '';


    this.phone =
      current?.profile?.phone ||
      '';


    this.editing.set(
      false
    );

  }


  logout():
    void {

    this.auth.logout();


    this.user.set(
      null
    );


    this.addresses.set(
      []
    );


    this.router.navigateByUrl(
      '/tabs/home'
    );

  }


  go(
    path: string
  ):
    void {

    this.router.navigateByUrl(
      path
    );

  }


  login():
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