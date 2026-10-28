import {
  Component,
  signal
} from '@angular/core';

import {
  ActivatedRoute,
  Router
} from '@angular/router';

import {
  Api
} from '../core/api';

import {
  Auth
} from '../core/auth';


interface DeliveryCheckpoint {

  status?: string;

  label?: string;

  note?: string;

  message?: string;

  at?: string;

  createdAt?: string;

}


interface DeliveryLeg {

  id?: string;

  status?: string;

  riderName?: string;

  riderPhone?: string;

  eta?: string | null;

  checkpoints?: DeliveryCheckpoint[];

}


interface OrderLegs {

  delivery?: DeliveryLeg;

  return?: DeliveryLeg;

}


interface OrderItem {

  id?: string;

  product?: string;

  name?: string;

  image?: string;

  cardImage?: string;

  images?: string[];

  plan?: string;

  qty?: number;

  quantity?: number;

  price?: number;

  total?: number;

}


interface OrderPayment {

  method?: string;

  status?: string;

  referenceNo?: string;

  gateway?: string;

  paidAt?: string;

}


interface Order {

  id?: string;

  _id?: string;

  invoiceNo?: string;

  status?: string;

  orderType?: string;

  startDate?: string;

  endDate?: string;

  createdAt?: string;

  updatedAt?: string;

  total?: number;

  rent?: number;

  deposit?: number;

  delivery?: number;

  protectionFee?: number;

  items?: OrderItem[];

  payment?: OrderPayment;

  legs?: OrderLegs;

  deliveryAddress?: any;

  address?: any;

  rentalClock?: any;

}


@Component({
  selector: 'app-order-detail',
  templateUrl:
    './order-detail.page.html',
  styleUrls: [
    './order-detail.page.scss'
  ],
  standalone: false
})
export class OrderDetailPage {

  order =
    signal<Order | null>(
      null
    );

  loading =
    signal<boolean>(
      true
    );

  refreshing =
    signal<boolean>(
      false
    );

  error =
    signal<string>(
      ''
    );


  private orderId =
    '';

  private pollTimer:
    ReturnType<
      typeof setInterval
    > | null = null;


  private itemImageOverrides =
    signal<Record<string, string>>({});

  private failedItemImageUrls =
    new Set<string>();

  private requestedItemProducts =
    new Set<string>();


  constructor(

    private route:
      ActivatedRoute,

    private router:
      Router,

    public api:
      Api,

    public auth:
      Auth

  ) {}


  ionViewWillEnter():
    void {

    if (
      !this.auth.isLoggedIn()
    ) {

      this.router.navigateByUrl(
        '/login'
      );

      return;
    }


    this.orderId =
      this.route
        .snapshot
        .paramMap
        .get('id') ||
      '';


    if (
      !this.orderId
    ) {

      this.loading.set(
        false
      );

      this.error.set(
        'Order ID is missing.'
      );

      return;
    }


    this.startPolling();

    const paymentResult =
      this.route.snapshot.queryParamMap.get(
        'payment'
      );

    if (
      paymentResult ===
      'success'
    ) {

      this.reconcilePayment();

      return;
    }

    this.load();
  }


  ionViewDidLeave():
    void {

    this.stopPolling();
  }


  load(
    silent = false
  ): void {

    if (
      !this.orderId
    ) {

      return;
    }


    if (
      !silent
    ) {

      this.loading.set(
        true
      );

      this.error.set(
        ''
      );

    }


    this.api
      .get<Order>(
        `/orders/${this.orderId}`
      )
      .subscribe({

        next: response => {

          this.order.set(
            response
          );

          this.hydrateItemImages(
            response
          );

          this.loading.set(
            false
          );

          this.refreshing.set(
            false
          );


          if (
            this.isClosed(
              response?.status
            )
          ) {

            this.stopPolling();
          }

        },


        error: error => {

          console.error(
            'Order detail load error:',
            error
          );


          this.loading.set(
            false
          );

          this.refreshing.set(
            false
          );


          if (
            !silent
          ) {

            this.error.set(
              error?.error?.error ||
              'Unable to load this order.'
            );

          }

        }

      });

  }


  refresh(
    event: any
  ): void {

    this.refreshing.set(
      true
    );


    this.api
      .get<Order>(
        `/orders/${this.orderId}`
      )
      .subscribe({

        next: response => {

          this.order.set(
            response
          );

          this.error.set(
            ''
          );

          this.refreshing.set(
            false
          );


          event?.target
            ?.complete();


          if (
            this.isClosed(
              response?.status
            )
          ) {

            this.stopPolling();
          }

        },


        error: error => {

          console.error(
            'Order refresh error:',
            error
          );


          this.refreshing.set(
            false
          );


          event?.target
            ?.complete();

        }

      });

  }


  goOrders():
    void {

    this.router.navigateByUrl(
      '/tabs/orders'
    );
  }


  browseDevices():
    void {

    this.router.navigateByUrl(
      '/tabs/devices'
    );
  }


  statusLabel(
    status?: string
  ): string {

    if (
      !status
    ) {

      return 'Pending';
    }


    const special:
      Record<
        string,
        string
      > = {

      'payment-confirmed':
        'Payment Confirmed',

      'out-for-delivery':
        'Out for Delivery',

      'return-requested':
        'Return Requested',

      'return-scheduled':
        'Return Scheduled',

      'return-assigned':
        'Return Rider Assigned',

      'return-picked-up':
        'Return Picked Up',

      'return-in-transit':
        'Return In Transit'

    };


    if (
      special[status]
    ) {

      return special[
        status
      ];
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

      case 'completed':

      case 'delivered':

      case 'received':

      case 'paid':

        return 'success';


      case 'cancelled':

      case 'rejected':

      case 'failed':

      case 'overdue':

        return 'danger';


      case 'assigned':

      case 'picked-up':

      case 'in-transit':

      case 'arriving':

      case 'out-for-delivery':

      case 'return-requested':

      case 'return-scheduled':

      case 'return-assigned':

      case 'return-picked-up':

      case 'return-in-transit':

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

        return 'Not selected';

    }

  }


  paymentStatusLabel(
    status?: string
  ): string {

    if (
      !status
    ) {

      return 'Pending';
    }


    return this.statusLabel(
      status
    );
  }


  itemQuantity(
    item: OrderItem
  ): number {

    return Number(
      item?.qty ||
      item?.quantity ||
      1
    );
  }


  itemImage(
    item: OrderItem
  ): string {

    const key =
      this.itemKey(
        item
      );

    const raw =
      this.itemImageOverrides()[key] ||
      item?.image ||
      '';

    if (!raw) {
      return '';
    }

    const url =
      this.api.imageUrl(
        raw
      );

    return this.failedItemImageUrls.has(
      url
    )
      ? ''
      : url;
  }


  onItemImageError(
    item: OrderItem
  ): void {

    const failed =
      this.itemImage(
        item
      );

    if (failed) {
      this.failedItemImageUrls.add(
        failed
      );
    }

    const key =
      this.itemKey(
        item
      );

    if (key) {
      const next = {
        ...this.itemImageOverrides()
      };

      delete next[key];

      this.itemImageOverrides.set(
        next
      );
    }

    this.loadCurrentProductImage(
      item,
      true
    );
  }


  private hydrateItemImages(
    order: Order
  ): void {

    for (
      const item of
      order.items || []
    ) {
      this.loadCurrentProductImage(
        item
      );
    }
  }


  private loadCurrentProductImage(
    item: OrderItem,
    force = false
  ): void {

    const productId =
      String(
        item?.product ||
        ''
      ).trim();

    if (!productId) {
      return;
    }

    if (
      this.requestedItemProducts.has(
        productId
      ) &&
      !force
    ) {
      return;
    }

    this.requestedItemProducts.add(
      productId
    );

    this.api
      .get<any>(
        `/products/${productId}`
      )
      .subscribe({

        next: product => {

          const candidates = [
            product?.image,
            product?.cardImage,
            ...(Array.isArray(
              product?.images
            )
              ? product.images
              : [])
          ]
            .map(value =>
              String(
                value ||
                ''
              ).trim()
            )
            .filter(Boolean);

          const image =
            candidates.find(
              value =>
                !this.failedItemImageUrls.has(
                  this.api.imageUrl(
                    value
                  )
                )
            ) ||
            '';

          const key =
            this.itemKey(
              item
            );

          if (
            image &&
            key
          ) {
            this.itemImageOverrides.set({
              ...this.itemImageOverrides(),
              [key]: image
            });
          }
        },

        error: error => {
          console.warn(
            'Order item image refresh failed:',
            error
          );
        }

      });
  }


  private itemKey(
    item: OrderItem
  ): string {

    return String(
      item?.product ||
      item?.id ||
      item?.name ||
      ''
    );
  }


  private reconcilePayment():
    void {

    this.api
      .get<any>(
        `/payments/${this.orderId}/status`
      )
      .subscribe({

        next: () => {
          sessionStorage.removeItem(
            'dialuxPendingPaymentOrderId'
          );

          sessionStorage.removeItem(
            'dialuxPendingPaymentMethod'
          );

          this.load();
        },

        error: error => {
          console.error(
            'Payment reconciliation error:',
            error
          );

          this.load();
        }

      });
  }


  checkpointLabel(
    checkpoint:
      DeliveryCheckpoint
  ): string {

    return this.statusLabel(
      checkpoint?.status ||
      checkpoint?.label ||
      'Update'
    );
  }


  checkpointNote(
    checkpoint:
      DeliveryCheckpoint
  ): string {

    return (
      checkpoint?.note ||
      checkpoint?.message ||
      ''
    );
  }


  checkpointDate(
    checkpoint:
      DeliveryCheckpoint
  ): string {

    return this.dateTime(
      checkpoint?.at ||
      checkpoint?.createdAt
    );
  }


  formatDate(
    value?: string
  ): string {

    if (
      !value
    ) {

      return '—';
    }


    const date =
      this.parseDate(
        value
      );


    if (
      !date
    ) {

      return value;
    }


    return new Intl.DateTimeFormat(
      'en-PH',
      {
        month:
          'short',

        day:
          'numeric',

        year:
          'numeric'
      }
    ).format(
      date
    );
  }


  dateTime(
    value?: string | null
  ): string {

    if (
      !value
    ) {

      return '';
    }


    const date =
      this.parseDate(
        value
      );


    if (
      !date
    ) {

      return String(
        value
      );
    }


    return new Intl.DateTimeFormat(
      'en-PH',
      {
        month:
          'short',

        day:
          'numeric',

        hour:
          'numeric',

        minute:
          '2-digit'
      }
    ).format(
      date
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
      Number(
        value || 0
      )
    );
  }


  private startPolling():
    void {

    this.stopPolling();


    this.pollTimer =
      setInterval(
        () => {

          const current =
            this.order();


          if (
            current &&
            this.isClosed(
              current.status
            )
          ) {

            this.stopPolling();

            return;
          }


          this.load(
            true
          );

        },
        15000
      );

  }


  private stopPolling():
    void {

    if (
      this.pollTimer
    ) {

      clearInterval(
        this.pollTimer
      );

      this.pollTimer =
        null;

    }

  }


  private isClosed(
    status?: string
  ): boolean {

    return [
      'completed',
      'cancelled',
      'rejected'
    ].includes(
      String(
        status || ''
      )
    );
  }


  private parseDate(
    value: string
  ): Date | null {

    const normalized =
      /^\d{4}-\d{2}-\d{2}$/
        .test(
          value
        )
        ? `${value}T00:00:00`
        : value;


    const date =
      new Date(
        normalized
      );


    if (
      Number.isNaN(
        date.getTime()
      )
    ) {

      return null;
    }


    return date;
  }

}   