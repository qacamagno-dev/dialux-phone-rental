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
  Auth
} from '../core/auth';

interface Line {
  productId: string;

  name: string;
  image?: string;

  brand?: string;
  grade?: string;

  plan: string;

  qty: number;
  stock: number;

  rate: number;

  deposit: number;

  rentSubtotal: number;
  depositSubtotal: number;

  days?: number;
}

interface Cart {
  lines: Line[];

  count: number;

  startDate: string;
  endDate: string;

  days: number;

  rent: number;
  deposit: number;
  delivery: number;

  protection: boolean;
  protectionFee: number;
  protectionQuote: number;
  protectionPct?: number;

  total: number;

  currencySymbol?: string;
}

@Component({
  selector: 'app-tab3',
  templateUrl: 'tab3.page.html',
  styleUrls: ['tab3.page.scss'],
  standalone: false
})
export class Tab3Page {

  cart =
    signal<Cart | null>(null);

  loading =
    signal<boolean>(true);

  error =
    signal<string>('');

  updatingId =
    signal<string | null>(null);

  datesUpdating =
    signal<boolean>(false);

  protectionUpdating =
    signal<boolean>(false);

  startDate = '';

  endDate = '';

  minStartDate = '';

  minEndDate = '';

  constructor(
    public api: Api,
    public auth: Auth,
    private router: Router,
    private toastController: ToastController
  ) {
    this.setDateLimits();
  }

  ionViewWillEnter(): void {
    this.setDateLimits();
    this.load();
  }

  load(): void {

    this.error.set('');

    if (
      !this.auth.isLoggedIn()
    ) {

      this.cart.set(null);

      this.loading.set(false);

      return;
    }

    this.loading.set(true);

    this.api
      .get<Cart>(
        '/cart'
      )
      .subscribe({

        next: cart => {

          this.cart.set(
            cart
          );

          this.startDate =
            cart.startDate || '';

          this.endDate =
            cart.endDate || '';

          this.updateEndDateLimit();

          this.loading.set(false);
        },

        error: error => {

          console.error(
            'Cart load error:',
            error
          );

          this.loading.set(false);

          this.error.set(
            error?.error?.error ||
            'Unable to load your cart.'
          );
        }
      });
  }

  onStartDateChange(): void {

    if (
      this.startDate &&
      this.startDate < this.minStartDate
    ) {

      this.startDate =
        this.minStartDate;
    }

    this.updateEndDateLimit();

    if (
      this.endDate &&
      this.endDate < this.minEndDate
    ) {

      this.endDate = '';
    }
  }

  onEndDateChange(): void {

    if (
      this.endDate &&
      this.endDate < this.minEndDate
    ) {

      this.endDate = '';
    }
  }

  changeQuantity(
    line: Line,
    delta: number
  ): void {

    const newQuantity =
      Math.max(
        1,
        Math.min(
          line.stock,
          line.qty + delta
        )
      );

    if (
      newQuantity === line.qty
    ) {
      return;
    }

    const key =
      this.lineKey(line);

    this.updatingId.set(
      key
    );

    this.api
      .patch<Cart>(
        '/cart/items',
        {
          productId:
            line.productId,

          plan:
            line.plan,

          qty:
            newQuantity
        }
      )
      .subscribe({

        next: cart => {

          this.cart.set(
            cart
          );

          this.syncDates(cart);

          this.updatingId.set(
            null
          );
        },

        error: async error => {

          console.error(
            'Quantity update error:',
            error
          );

          this.updatingId.set(
            null
          );

          await this.showToast(
            error?.error?.error ||
            'Could not update quantity.',
            'danger'
          );
        }
      });
  }

  changePlan(
    line: Line,
    newPlan: string
  ): void {

    if (
      !newPlan ||
      newPlan === line.plan
    ) {
      return;
    }

    const key =
      this.lineKey(line);

    this.updatingId.set(
      key
    );

    this.api
      .patch<Cart>(
        '/cart/items',
        {
          productId:
            line.productId,

          plan:
            line.plan,

          newPlan
        }
      )
      .subscribe({

        next: cart => {

          this.cart.set(
            cart
          );

          this.syncDates(cart);

          this.updatingId.set(
            null
          );
        },

        error: async error => {

          console.error(
            'Plan update error:',
            error
          );

          this.updatingId.set(
            null
          );

          await this.showToast(
            error?.error?.error ||
            'Could not change rental plan.',
            'danger'
          );
        }
      });
  }

  remove(
    line: Line
  ): void {

    const key =
      this.lineKey(line);

    this.updatingId.set(
      key
    );

    this.api
      .deleteWithBody<Cart>(
        '/cart/items',
        {
          productId:
            line.productId,

          plan:
            line.plan
        }
      )
      .subscribe({

        next: cart => {

          this.cart.set(
            cart
          );

          this.syncDates(cart);

          this.updatingId.set(
            null
          );
        },

        error: async error => {

          console.error(
            'Cart remove error:',
            error
          );

          this.updatingId.set(
            null
          );

          await this.showToast(
            error?.error?.error ||
            'Could not remove item.',
            'danger'
          );
        }
      });
  }

  updateRentalDates(): void {

    this.setDateLimits();

    if (
      !this.startDate ||
      !this.endDate
    ) {

      this.showToast(
        'Select both start and end dates.',
        'warning'
      );

      return;
    }

    if (
      this.startDate <
      this.minStartDate
    ) {

      this.showToast(
        'Start date cannot be in the past.',
        'warning'
      );

      return;
    }

    if (
      this.endDate <
      this.minStartDate
    ) {

      this.showToast(
        'End date cannot be in the past.',
        'warning'
      );

      return;
    }

    if (
      this.endDate <
      this.startDate
    ) {

      this.showToast(
        'End date cannot be before start date.',
        'warning'
      );

      return;
    }

    this.datesUpdating.set(
      true
    );

    this.api
      .patch<Cart>(
        '/cart',
        {
          startDate:
            this.startDate,

          endDate:
            this.endDate
        }
      )
      .subscribe({

        next: cart => {

          this.cart.set(
            cart
          );

          this.syncDates(cart);

          this.datesUpdating.set(
            false
          );
        },

        error: async error => {

          console.error(
            'Rental dates error:',
            error
          );

          this.datesUpdating.set(
            false
          );

          await this.showToast(
            error?.error?.error ||
            'Could not update rental dates.',
            'danger'
          );
        }
      });
  }

  toggleProtection(
    enabled: boolean
  ): void {

    this.protectionUpdating.set(
      true
    );

    this.api
      .patch<Cart>(
        '/cart',
        {
          protection:
            enabled
        }
      )
      .subscribe({

        next: cart => {

          this.cart.set(
            cart
          );

          this.syncDates(cart);

          this.protectionUpdating.set(
            false
          );
        },

        error: async error => {

          console.error(
            'Protection update error:',
            error
          );

          this.protectionUpdating.set(
            false
          );

          await this.showToast(
            error?.error?.error ||
            'Could not update protection.',
            'danger'
          );
        }
      });
  }

  isUpdating(
    line: Line
  ): boolean {

    return (
      this.updatingId() ===
      this.lineKey(line)
    );
  }

  lineKey(
    line: Line
  ): string {

    return (
      `${line.productId}:${line.plan}`
    );
  }

  browseDevices(): void {

    this.router.navigateByUrl(
      '/tabs/devices'
    );
  }

  checkout(): void {

    const current =
      this.cart();

    if (
      !current ||
      current.lines.length === 0
    ) {
      return;
    }

    if (
      !current.startDate ||
      !current.endDate
    ) {

      this.showToast(
        'Choose your rental dates before checkout.',
        'warning'
      );

      return;
    }

    this.router.navigateByUrl(
      '/checkout'
    );
  }

  login(): void {

    this.router.navigateByUrl(
      '/login'
    );
  }

  money(
    value?: number
  ): string {

    return new Intl.NumberFormat(
      'en-PH',
      {
        style: 'currency',
        currency: 'PHP',
        maximumFractionDigits: 0
      }
    ).format(
      value || 0
    );
  }

  private setDateLimits(): void {

    const today =
      new Date();

    const year =
      today.getFullYear();

    const month =
      String(
        today.getMonth() + 1
      ).padStart(
        2,
        '0'
      );

    const day =
      String(
        today.getDate()
      ).padStart(
        2,
        '0'
      );

    this.minStartDate =
      `${year}-${month}-${day}`;

    this.updateEndDateLimit();
  }

  private updateEndDateLimit(): void {

    this.minEndDate =
      this.startDate ||
      this.minStartDate;
  }

  private syncDates(
    cart: Cart
  ): void {

    this.startDate =
      cart.startDate || '';

    this.endDate =
      cart.endDate || '';

    this.updateEndDateLimit();
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
        duration: 2000,
        position: 'bottom',
        color
      });

    await toast.present();
  }
}   