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

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false
})
export class ProfilePage {

  user =
    signal<AuthUser | null>(null);

  addresses =
    signal<Address[]>([]);

  loading =
    signal<boolean>(true);

  editing =
    signal<boolean>(false);

  savingProfile =
    signal<boolean>(false);

  savingAddress =
    signal<boolean>(false);

  busyAddressId =
    signal<string | null>(null);

  name = '';

  phone = '';

  addressLabel =
    'Home';

  address = '';

  city = '';

  zip = '';

  constructor(
    public auth: Auth,
    private api: Api,
    private router: Router,
    private toastController: ToastController
  ) {}

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {

    if (
      !this.auth.isLoggedIn()
    ) {

      this.user.set(null);

      this.addresses.set([]);

      this.loading.set(false);

      return;
    }

    this.loading.set(true);

    this.auth
      .loadCurrentUser()
      .subscribe({

        next: user => {

          this.user.set(
            user
          );

          this.name =
            user.name || '';

          this.phone =
            user.profile?.phone || '';

          this.loadAddresses();
        },

        error: error => {

          console.error(
            'Profile load error:',
            error
          );

          this.loading.set(false);
        }
      });
  }

  private loadAddresses(): void {

    this.api
      .get<{
        addresses: Address[];
      }>(
        '/users/me/addresses'
      )
      .subscribe({

        next: response => {

          this.addresses.set(
            response?.addresses || []
          );

          this.loading.set(false);
        },

        error: error => {

          console.error(
            'Addresses load error:',
            error
          );

          this.addresses.set([]);

          this.loading.set(false);
        }
      });
  }

  async save(): Promise<void> {

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
          name: cleanName,
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

  async addAddress(): Promise<void> {

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
            this.addresses().length === 0
        }
      )
      .subscribe({

        next: async () => {

          this.addressLabel =
            'Home';

          this.address = '';

          this.city = '';

          this.zip = '';

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
  ): void {

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
  ): void {

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
  ): string {

    return (
      address.id ||
      address._id ||
      ''
    );
  }

  isAddressBusy(
    address: Address
  ): boolean {

    return (
      this.busyAddressId() ===
      this.getAddressId(address)
    );
  }

  cancelEdit(): void {

    const current =
      this.user();

    this.name =
      current?.name || '';

    this.phone =
      current?.profile?.phone || '';

    this.editing.set(
      false
    );
  }

  logout(): void {

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
  ): void {

    this.router.navigateByUrl(
      path
    );
  }

  login(): void {

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
  ): Promise<void> {

    const toast =
      await this.toastController.create({
        message,
        duration: 1800,
        position: 'bottom',
        color
      });

    await toast.present();
  }
}