import {
  Component,
  signal
} from '@angular/core';

import {
  Router
} from '@angular/router';

import {
  Api
} from '../core/api';

import {
  Auth
} from '../core/auth';

@Component({
  selector: 'app-orders',
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  standalone: false
})
export class OrdersPage {

  orders =
    signal<any[]>([]);

  loading =
    signal<boolean>(true);

  error =
    signal<string>('');

  constructor(
    private api: Api,
    public auth: Auth,
    private router: Router
  ) {}

  ionViewWillEnter(): void {

    if (
      !this.auth.isLoggedIn()
    ) {

      this.loading.set(false);

      return;
    }

    this.load();
  }

  load(): void {

    this.loading.set(true);

    this.error.set('');

    this.api
      .get<any>(
        '/orders/mine'
      )
      .subscribe({

        next: response => {

          this.orders.set(
            response?.orders || []
          );

          this.loading.set(
            false
          );
        },

        error: error => {

          console.error(
            'Orders load error:',
            error
          );

          this.loading.set(
            false
          );

          this.error.set(
            error?.error?.error ||
            'Unable to load your orders.'
          );
        }
      });
  }

  open(
    order: any
  ): void {

    const id =
      order?.id ||
      order?._id;

    if (!id) {
      return;
    }

    this.router.navigate([
      '/order',
      id
    ]);
  }

  login(): void {

    this.router.navigateByUrl(
      '/login'
    );
  }

  browseDevices(): void {

    this.router.navigateByUrl(
      '/tabs/devices'
    );
  }

  apiUrl(
    path: string
  ): string {

    return this.api.imageUrl(
      path
    );
  }

  statusLabel(
    status?: string
  ): string {

    if (!status) {
      return 'Pending';
    }

    return status
      .replace(
        /-/g,
        ' '
      )
      .replace(
        /\b\w/g,
        char =>
          char.toUpperCase()
      );
  }

  statusClass(
    status?: string
  ): string {

    switch (
      status
    ) {

      case 'approved':
      case 'payment-confirmed':
      case 'received':
      case 'active':
      case 'completed':
        return 'success';

      case 'cancelled':
      case 'rejected':
      case 'overdue':
        return 'danger';

      case 'delivered':
      case 'out-for-delivery':
      case 'return-requested':
        return 'primary';

      default:
        return 'warning';
    }
  }

  paymentLabel(
    method?: string
  ): string {

    switch (
      method
    ) {

      case 'cash':
        return 'Cash on Delivery';

      case 'gcash':
        return 'GCash';

      case 'maya':
        return 'Maya';

      case 'card':
        return 'Card';

      case 'bank-transfer':
        return 'Bank Transfer';

      default:
        return 'Payment pending';
    }
  }

  itemSummary(
    order: any
  ): string {

    const items =
      order?.items || [];

    if (
      items.length === 0
    ) {
      return 'Rental order';
    }

    if (
      items.length === 1
    ) {
      return (
        items[0]?.name ||
        'Rental device'
      );
    }

    return (
      `${items[0]?.name || 'Device'} +${items.length - 1} more`
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
}