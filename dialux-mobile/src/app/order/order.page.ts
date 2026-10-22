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

@Component({
  selector: 'app-order',
  templateUrl: './order.page.html',
  styleUrls: ['./order.page.scss'],
  standalone: false
})
export class OrderPage {

  o =
    signal<any | null>(null);

  loading =
    signal<boolean>(true);

  updating =
    signal<boolean>(false);

  uploadingProof =
    signal<boolean>(false);

  proofFileName =
    signal<string>('');

  proofPreview =
    signal<string>('');

  error =
    signal<string>('');

  private orderId = '';

  constructor(
    private api: Api,
    private route: ActivatedRoute,
    private router: Router,
    private toastController: ToastController
  ) {

    const id =
      this.route.snapshot.paramMap.get(
        'id'
      );

    if (!id) {

      this.loading.set(
        false
      );

      this.error.set(
        'Invalid order ID.'
      );

      return;
    }

    this.orderId = id;

    const paymentResult =
      this.route.snapshot.queryParamMap.get(
        'payment'
      );

    if (
      paymentResult ===
      'success'
    ) {

      this.reconcilePayment(
        id
      );

      return;
    }

    if (
      paymentResult ===
      'cancelled'
    ) {

      this.showToast(
        'Payment was cancelled. You can try again.',
        'warning'
      );

      this.load(
        id
      );

      return;
    }

    this.load(
      id
    );
  }

  ionViewWillEnter(): void {

    if (
      !this.orderId
    ) {
      return;
    }

    const paymentResult =
      this.route.snapshot.queryParamMap.get(
        'payment'
      );

    if (
      paymentResult ===
      'success'
    ) {

      this.reconcilePayment(
        this.orderId
      );

      return;
    }

    this.load(
      this.orderId
    );
  }

  private reconcilePayment(
    id: string
  ): void {

    this.loading.set(
      true
    );

    this.error.set('');

    this.api
      .get<any>(
        `/payments/${id}/status`
      )
      .subscribe({

        next: async response => {

          console.log(
            'Payment reconciliation:',
            response
          );

          if (
            response?.status ===
            'paid'
          ) {

            sessionStorage.removeItem(
              'dialuxPendingPaymentOrderId'
            );

            sessionStorage.removeItem(
              'dialuxPendingPaymentMethod'
            );

            await this.showToast(
              'Payment confirmed successfully.',
              'success'
            );

          } else {

            await this.showToast(
              'Payment is still being confirmed.',
              'warning'
            );
          }

          this.clearPaymentQuery();

          this.load(
            id
          );
        },

        error: async error => {

          console.error(
            'Payment reconciliation error:',
            error
          );

          await this.showToast(
            error?.error?.error ||
            'Could not verify payment status yet.',
            'warning'
          );

          this.clearPaymentQuery();

          this.load(
            id
          );
        }
      });
  }

  private clearPaymentQuery(): void {

    this.router.navigate(
      [],
      {
        relativeTo:
          this.route,

        queryParams: {
          payment:
            null
        },

        queryParamsHandling:
          'merge',

        replaceUrl:
          true
      }
    );
  }

  load(
    id: string = this.orderId
  ): void {

    if (!id) {
      return;
    }

    this.loading.set(
      true
    );

    this.error.set('');

    this.api
      .get<any>(
        `/orders/${id}`
      )
      .subscribe({

        next: response => {

          this.o.set(
            response
          );

          if (
            response?.payment?.proofUrl
          ) {

            this.proofPreview.set(
              response.payment.proofUrl
            );
          }

          this.loading.set(
            false
          );
        },

        error: error => {

          console.error(
            'Order load error:',
            error
          );

          this.loading.set(
            false
          );

          this.error.set(
            error?.error?.error ||
            'Unable to load this order.'
          );
        }
      });
  }

  async onProofSelected(
    event: Event
  ): Promise<void> {

    const input =
      event.target as HTMLInputElement;

    const file =
      input.files?.[0];

    if (!file) {
      return;
    }

    if (
      ![
        'image/jpeg',
        'image/png',
        'image/webp'
      ].includes(
        file.type
      )
    ) {

      input.value = '';

      await this.showToast(
        'Please choose a JPG, PNG, or WebP image.',
        'warning'
      );

      return;
    }

    if (
      file.size >
      8 * 1024 * 1024
    ) {

      input.value = '';

      await this.showToast(
        'Image must be smaller than 8 MB.',
        'warning'
      );

      return;
    }

    try {

      const optimized =
        await this.optimizeProofImage(
          file
        );

      if (
        optimized.length >
        680000
      ) {

        input.value = '';

        await this.showToast(
          'Proof image is still too large. Please use a smaller screenshot.',
          'warning'
        );

        return;
      }

      this.proofFileName.set(
        file.name
      );

      this.proofPreview.set(
        optimized
      );

    } catch (error) {

      console.error(
        'Proof image error:',
        error
      );

      input.value = '';

      await this.showToast(
        'Could not read this image.',
        'danger'
      );
    }
  }

  async uploadProof(): Promise<void> {

    const order =
      this.o();

    if (
      !order ||
      this.uploadingProof()
    ) {
      return;
    }

    const proofUrl =
      this.proofPreview();

    if (!proofUrl) {

      await this.showToast(
        'Choose your proof of payment first.',
        'warning'
      );

      return;
    }

    const id =
      order.id ||
      order._id ||
      this.orderId;

    if (!id) {

      await this.showToast(
        'Order ID is missing.',
        'danger'
      );

      return;
    }

    this.uploadingProof.set(
      true
    );

    this.api
      .post<any>(
        `/payments/${id}/proof`,
        {
          proofUrl
        }
      )
      .subscribe({

        next: async response => {

          this.o.set(
            response
          );

          this.proofPreview.set(
            response?.payment?.proofUrl ||
            proofUrl
          );

          this.proofFileName.set('');

          this.uploadingProof.set(
            false
          );

          await this.showToast(
            'Proof submitted for verification.',
            'success'
          );
        },

        error: async error => {

          console.error(
            'Proof upload error:',
            error
          );

          this.uploadingProof.set(
            false
          );

          await this.showToast(
            error?.error?.error ||
            'Could not upload proof of payment.',
            'danger'
          );
        }
      });
  }

  paymentStatusLabel(
    order: any
  ): string {

    if (
      order?.payment?.status ===
      'paid'
    ) {
      return 'Paid';
    }

    if (
      order?.payment?.method ===
        'bank-transfer' &&
      order?.payment?.proofUrl
    ) {
      return 'For Verification';
    }

    return this.statusLabel(
      order?.payment?.status ||
      'pending'
    );
  }

  async action(
    kind: string
  ): Promise<void> {

    const order =
      this.o();

    if (
      !order ||
      this.updating()
    ) {
      return;
    }

    let path = '';

    let body: any = {};

    if (
      kind ===
      'receipt'
    ) {

      path =
        `/orders/${order.id}/confirm-receipt`;
    }

    if (
      kind ===
      'cancel'
    ) {

      path =
        `/orders/${order.id}/cancel`;
    }

    if (
      kind ===
      'return'
    ) {

      path =
        `/orders/${order.id}/return`;

      body = {
        method:
          'rider',

        date:
          order.endDate,

        slot:
          '2:00 PM - 5:00 PM'
      };
    }

    if (!path) {
      return;
    }

    this.updating.set(
      true
    );

    this.api
      .post<any>(
        path,
        body
      )
      .subscribe({

        next: async response => {

          this.o.set(
            response?.order ||
            response
          );

          this.updating.set(
            false
          );

          await this.showToast(
            'Order updated successfully.',
            'success'
          );
        },

        error: async error => {

          console.error(
            'Order action error:',
            error
          );

          this.updating.set(
            false
          );

          await this.showToast(
            error?.error?.error ||
            'Could not update order.',
            'danger'
          );
        }
      });
  }

  apiUrl(
    path: string
  ): string {

    return this.api.imageUrl(
      path
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
        return 'Debit / Credit Card';

      case 'bank-transfer':
        return 'Bank Transfer';

      default:
        return 'Not selected';
    }
  }

  support(): void {

    this.router.navigate(
      [
        '/support'
      ],
      {
        queryParams: {
          order:
            this.o()?.invoiceNo
        }
      }
    );
  }

  private optimizeProofImage(
    file: File
  ): Promise<string> {

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const reader =
          new FileReader();

        reader.onerror =
          () =>
            reject(
              new Error(
                'Unable to read image.'
              )
            );

        reader.onload =
          () => {

            const source =
              String(
                reader.result ||
                ''
              );

            if (
              source.length <=
              650000
            ) {

              resolve(
                source
              );

              return;
            }

            const image =
              new Image();

            image.onerror =
              () =>
                reject(
                  new Error(
                    'Unable to decode image.'
                  )
                );

            image.onload =
              () => {

                let width =
                  image.width;

                let height =
                  image.height;

                const maxDimension =
                  1600;

                if (
                  width >
                    maxDimension ||
                  height >
                    maxDimension
                ) {

                  const ratio =
                    Math.min(
                      maxDimension /
                        width,

                      maxDimension /
                        height
                    );

                  width =
                    Math.round(
                      width *
                      ratio
                    );

                  height =
                    Math.round(
                      height *
                      ratio
                    );
                }

                const canvas =
                  document.createElement(
                    'canvas'
                  );

                canvas.width =
                  width;

                canvas.height =
                  height;

                const context =
                  canvas.getContext(
                    '2d'
                  );

                if (!context) {

                  reject(
                    new Error(
                      'Canvas unavailable.'
                    )
                  );

                  return;
                }

                context.drawImage(
                  image,
                  0,
                  0,
                  width,
                  height
                );

                let quality =
                  0.82;

                let result =
                  canvas.toDataURL(
                    'image/jpeg',
                    quality
                  );

                while (
                  result.length >
                    650000 &&
                  quality >
                    0.35
                ) {

                  quality -=
                    0.08;

                  result =
                    canvas.toDataURL(
                      'image/jpeg',
                      quality
                    );
                }

                resolve(
                  result
                );
              };

            image.src =
              source;
          };

        reader.readAsDataURL(
          file
        );
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
  ): Promise<void> {

    const toast =
      await this.toastController.create({
        message,
        duration:
          2000,
        position:
          'bottom',
        color
      });

    await toast.present();
  }
}