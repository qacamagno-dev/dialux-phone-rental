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

interface Address {
  id?: string;
  _id?: string;

  label?: string;
  address?: string;
  city?: string;
  zip?: string;

  isDefault?: boolean;
}

interface Cart {
  lines: any[];

  startDate?: string;
  endDate?: string;

  protection?: boolean;

  rent: number;
  deposit: number;
  delivery: number;

  protectionFee?: number;

  total: number;
}

type PaymentMethod =
  | 'cash'
  | 'gcash'
  | 'maya'
  | 'card'
  | 'bank-transfer';

@Component({
  selector: 'app-checkout',
  templateUrl: './checkout.page.html',
  styleUrls: ['./checkout.page.scss'],
  standalone: false
})
export class CheckoutPage {

  cart =
    signal<Cart | null>(null);

  addresses =
    signal<Address[]>([]);

  loading =
    signal<boolean>(true);

  error =
    signal<string>('');

  submitting =
    signal<boolean>(false);

  addressId = '';

  startDate = '';

  endDate = '';

  minStartDate = '';

  minEndDate = '';

  protection = false;

  orderType:
    | 'delivery'
    | 'pickup'
    | 'meetup' =
    'delivery';

  pickupHub =
    'cubao';

  meetupLocation =
    'Quezon City';

  timeSlot =
    '2:00 PM - 5:00 PM';

  paymentMethod:
    PaymentMethod =
    'cash';

  constructor(
    private api: Api,
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

    if (
      !this.auth.isLoggedIn()
    ) {

      this.router.navigateByUrl(
        '/login'
      );

      return;
    }

    this.loading.set(
      true
    );

    this.error.set('');

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

          this.protection =
            Boolean(
              cart.protection
            );

          this.updateEndDateLimit();

          this.loadAddresses();
        },

        error: error => {

          console.error(
            'Checkout cart error:',
            error
          );

          this.loading.set(
            false
          );

          this.error.set(
            error?.error?.error ||
            'Unable to load checkout.'
          );
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

          const list =
            response?.addresses || [];

          this.addresses.set(
            list
          );

          const preferred =
            list.find(
              address =>
                address.isDefault
            ) ||
            list[0];

          this.addressId =
            preferred?.id ||
            preferred?._id ||
            '';

          this.loading.set(
            false
          );
        },

        error: error => {

          console.error(
            'Address load error:',
            error
          );

          this.addresses.set([]);

          this.loading.set(
            false
          );
        }
      });
  }

  onStartDateChange(): void {

    if (
      this.startDate &&
      this.startDate <
      this.minStartDate
    ) {

      this.startDate =
        this.minStartDate;
    }

    this.updateEndDateLimit();

    if (
      this.endDate &&
      this.endDate <
      this.minEndDate
    ) {

      this.endDate = '';
    }
  }

  onEndDateChange(): void {

    if (
      this.endDate &&
      this.endDate <
      this.minEndDate
    ) {

      this.endDate = '';
    }
  }

  async place(): Promise<void> {

    if (
      this.submitting()
    ) {
      return;
    }

    const currentCart =
      this.cart();

    if (
      !currentCart ||
      !currentCart.lines?.length
    ) {

      await this.showToast(
        'Your cart is empty.',
        'warning'
      );

      return;
    }

    this.setDateLimits();

    if (
      !this.startDate ||
      !this.endDate
    ) {

      await this.showToast(
        'Select both rental dates.',
        'warning'
      );

      return;
    }

    if (
      this.startDate <
      this.minStartDate
    ) {

      await this.showToast(
        'Start date cannot be in the past.',
        'warning'
      );

      return;
    }

    if (
      this.endDate <
      this.startDate
    ) {

      await this.showToast(
        'Return date cannot be before the start date.',
        'warning'
      );

      return;
    }

    if (
      this.orderType ===
        'delivery' &&
      !this.addressId
    ) {

      await this.showToast(
        'Add a delivery address in Profile first.',
        'warning'
      );

      return;
    }

    if (
      this.orderType ===
        'meetup' &&
      !this.meetupLocation.trim()
    ) {

      await this.showToast(
        'Enter a meet-up location.',
        'warning'
      );

      return;
    }

    if (
      this.orderType !==
        'delivery' &&
      !this.timeSlot.trim()
    ) {

      await this.showToast(
        'Enter your preferred time.',
        'warning'
      );

      return;
    }

    this.submitting.set(
      true
    );

    const body: any = {
      startDate:
        this.startDate,

      endDate:
        this.endDate,

      protection:
        this.protection,

      orderType:
        this.orderType,

      timeSlot:
        this.timeSlot
    };

    if (
      this.orderType ===
      'delivery'
    ) {

      body.addressId =
        this.addressId;
    }

    if (
      this.orderType ===
      'pickup'
    ) {

      body.pickupHub =
        this.pickupHub;
    }

    if (
      this.orderType ===
      'meetup'
    ) {

      body.meetupLocation =
        this.meetupLocation.trim();
    }

    this.api
      .post<any>(
        '/orders',
        body
      )
      .subscribe({

        next: order => {

          if (
            sessionStorage.getItem(
              'dialuxBuyNowActive'
            ) === '1'
          ) {

            this.restoreBuyNowCart(
              () => {

                this.setupPayment(
                  order
                );
              }
            );

            return;
          }

          this.setupPayment(
            order
          );
        },

        error: async error => {

          console.error(
            'Place order error:',
            error
          );

          this.submitting.set(
            false
          );

          await this.showToast(
            error?.error?.error ||
            'Could not place order.',
            'danger'
          );
        }
      });
  }

  private setupPayment(
    order: any
  ): void {

    const orderId =
      order?.id ||
      order?._id;

    if (!orderId) {

      this.submitting.set(
        false
      );

      this.showToast(
        'Order was created but no order ID was returned.',
        'danger'
      );

      return;
    }

    const returnUrl =
      window.location.origin;

    this.api
      .post<any>(
        '/payments/method',
        {
          orderId,

          method:
            this.paymentMethod,

          returnUrl
        }
      )
      .subscribe({

        next: async response => {

          this.submitting.set(
            false
          );

          if (
            response?.checkoutUrl
          ) {

            sessionStorage.setItem(
              'dialuxPendingPaymentOrderId',
              String(
                orderId
              )
            );

            sessionStorage.setItem(
              'dialuxPendingPaymentMethod',
              this.paymentMethod
            );

            window.location.href =
              response.checkoutUrl;

            return;
          }

          if (
            this.paymentMethod ===
            'cash'
          ) {

            await this.showToast(
              'Order placed. Pay the rider upon delivery.',
              'success'
            );

          } else if (
            this.paymentMethod ===
            'bank-transfer'
          ) {

            await this.showToast(
              'Order placed. Bank transfer instructions are available in your order.',
              'success'
            );

          } else {

            await this.showToast(
              'Order placed successfully.',
              'success'
            );
          }

          this.router.navigate([
            '/order',
            orderId
          ]);
        },

        error: async error => {

          console.error(
            'Payment setup error:',
            error
          );

          this.submitting.set(
            false
          );

          await this.showToast(
            error?.error?.error ||
            'Order created, but payment setup failed.',
            'danger'
          );

          this.router.navigate([
            '/order',
            orderId
          ]);
        }
      });
  }

  private restoreBuyNowCart(
    done: () => void
  ): void {

    const raw =
      sessionStorage.getItem(
        'dialuxBuyNowBackup'
      );

    let backup: any = null;

    try {

      backup =
        raw
          ? JSON.parse(
              raw
            )
          : null;

    } catch (error) {

      console.error(
        'Buy now backup parse error:',
        error
      );

      backup = null;
    }

    const finish =
      (): void => {

        sessionStorage.removeItem(
          'dialuxBuyNowActive'
        );

        sessionStorage.removeItem(
          'dialuxBuyNowBackup'
        );

        done();
      };

    this.api
      .delete<any>(
        '/cart'
      )
      .subscribe({

        next: () => {

          const lines =
            Array.isArray(
              backup?.lines
            )
              ? backup.lines
              : [];

          this.restoreCartLines(
            lines,
            0,
            backup,
            finish
          );
        },

        error: error => {

          console.error(
            'Clear temporary buy now cart error:',
            error
          );

          const lines =
            Array.isArray(
              backup?.lines
            )
              ? backup.lines
              : [];

          this.restoreCartLines(
            lines,
            0,
            backup,
            finish
          );
        }
      });
  }

  private restoreCartLines(
    lines: any[],
    index: number,
    backup: any,
    done: () => void
  ): void {

    if (
      index >=
      lines.length
    ) {

      this.restoreCartSettings(
        backup,
        done
      );

      return;
    }

    const line =
      lines[index];

    if (
      !line?.productId
    ) {

      this.restoreCartLines(
        lines,
        index + 1,
        backup,
        done
      );

      return;
    }

    this.api
      .post<any>(
        '/cart/items',
        {
          productId:
            line.productId,

          plan:
            line.plan ||
            'Weekly',

          qty:
            Number(
              line.qty || 1
            )
        }
      )
      .subscribe({

        next: () => {

          this.restoreCartLines(
            lines,
            index + 1,
            backup,
            done
          );
        },

        error: error => {

          console.error(
            'Cart restore item error:',
            error
          );

          this.restoreCartLines(
            lines,
            index + 1,
            backup,
            done
          );
        }
      });
  }

  private restoreCartSettings(
    backup: any,
    done: () => void
  ): void {

    if (!backup) {

      done();

      return;
    }

    const body: any = {
      protection:
        Boolean(
          backup.protection
        )
    };

    if (
      backup.startDate
    ) {

      body.startDate =
        backup.startDate;
    }

    if (
      backup.endDate
    ) {

      body.endDate =
        backup.endDate;
    }

    this.api
      .patch<any>(
        '/cart',
        body
      )
      .subscribe({

        next: () => {

          done();
        },

        error: error => {

          console.error(
            'Cart restore settings error:',
            error
          );

          done();
        }
      });
  }

  getSelectedAddress():
    Address | null {

    return (
      this.addresses()
        .find(
          address =>
            (
              address.id ||
              address._id
            ) ===
            this.addressId
        ) ||
      null
    );
  }

  goToProfile(): void {

    this.router.navigateByUrl(
      '/tabs/profile'
    );
  }

  money(
    value?: number
  ): string {

    return new Intl.NumberFormat(
      'en-PH',
      {
        style:
          'currency',

        currency:
          'PHP',

        maximumFractionDigits:
          0
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
        duration:
          2300,
        position:
          'bottom',
        color
      });

    await toast.present();
  }
}