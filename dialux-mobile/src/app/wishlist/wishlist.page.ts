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

interface Product {
  id: string;
  _id?: string;

  name: string;
  brand?: string;
  grade?: string;

  image?: string;
  cardImage?: string;

  daily?: number;
  weekly?: number;
  monthly?: number;

  stock?: number;
}

@Component({
  selector: 'app-wishlist',
  templateUrl: './wishlist.page.html',
  styleUrls: ['./wishlist.page.scss'],
  standalone: false
})
export class WishlistPage {

  products =
    signal<Product[]>([]);

  loading =
    signal<boolean>(true);

  error =
    signal<string>('');

  removingId =
    signal<string | null>(null);

  movingId =
    signal<string | null>(null);

  constructor(
    public api: Api,
    public auth: Auth,
    private router: Router,
    private toastController: ToastController
  ) {}

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {

    this.error.set('');

    if (
      !this.auth.isLoggedIn()
    ) {

      this.products.set([]);

      this.loading.set(false);

      return;
    }

    this.loading.set(true);

    this.api
      .get<{
        products: Product[];
        count?: number;
      }>(
        '/wishlist'
      )
      .subscribe({

        next: response => {

          this.products.set(
            response?.products || []
          );

          this.loading.set(false);
        },

        error: error => {

          console.error(
            'Wishlist load error:',
            error
          );

          this.products.set([]);

          this.loading.set(false);

          this.error.set(
            error?.error?.error ||
            'Unable to load your wishlist.'
          );
        }
      });
  }

  open(
    product: Product
  ): void {

    const id =
      this.getProductId(
        product
      );

    if (!id) {
      return;
    }

    this.router.navigate([
      '/tabs/device',
      id
    ]);
  }

  remove(
    product: Product
  ): void {

    const id =
      this.getProductId(
        product
      );

    if (
      !id ||
      this.removingId()
    ) {
      return;
    }

    this.removingId.set(
      id
    );

    this.api
      .delete<{
        products?: Product[];
      }>(
        `/wishlist/${id}`
      )
      .subscribe({

        next: async response => {

          if (
            Array.isArray(
              response?.products
            )
          ) {

            this.products.set(
              response.products
            );

          } else {

            this.removeFromLocalList(
              id
            );
          }

          this.removingId.set(
            null
          );

          await this.showToast(
            'Removed from wishlist.',
            'success'
          );
        },

        error: async error => {

          console.error(
            'Wishlist remove error:',
            error
          );

          this.removingId.set(
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

  moveToCart(
    product: Product
  ): void {

    const id =
      this.getProductId(
        product
      );

    if (
      !id ||
      this.movingId() ||
      this.isOutOfStock(product)
    ) {
      return;
    }

    this.movingId.set(
      id
    );

    this.api
      .post(
        '/cart/items',
        {
          productId: id,
          plan: 'Weekly',
          qty: 1
        }
      )
      .subscribe({

        next: () => {

          this.api
            .delete(
              `/wishlist/${id}`
            )
            .subscribe({

              next: async () => {

                this.removeFromLocalList(
                  id
                );

                this.movingId.set(
                  null
                );

                await this.showToast(
                  `${product.name} moved to cart.`,
                  'success'
                );
              },

              error: async error => {

                console.error(
                  'Wishlist removal after cart error:',
                  error
                );

                this.movingId.set(
                  null
                );

                await this.showToast(
                  `${product.name} was added to cart, but could not be removed from wishlist.`,
                  'warning'
                );
              }
            });
        },

        error: async error => {

          console.error(
            'Move to cart error:',
            error
          );

          this.movingId.set(
            null
          );

          await this.showToast(
            error?.error?.error ||
            'Could not move item to cart.',
            'danger'
          );
        }
      });
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

  getProductId(
    product: Product
  ): string {

    return (
      product.id ||
      product._id ||
      ''
    );
  }

  isOutOfStock(
    product: Product
  ): boolean {

    return Number(
      product.stock || 0
    ) <= 0;
  }

  isRemoving(
    product: Product
  ): boolean {

    return (
      this.removingId() ===
      this.getProductId(product)
    );
  }

  isMoving(
    product: Product
  ): boolean {

    return (
      this.movingId() ===
      this.getProductId(product)
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

  private removeFromLocalList(
    productId: string
  ): void {

    this.products.update(
      products =>
        products.filter(
          product =>
            this.getProductId(
              product
            ) !== productId
        )
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