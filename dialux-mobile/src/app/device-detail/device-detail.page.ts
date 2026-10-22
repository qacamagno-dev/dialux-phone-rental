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

import {
  Auth
} from '../core/auth';

type RentalPlan =
  | 'Daily'
  | 'Weekly'
  | 'Monthly';

interface Product {
  id?: string;
  _id?: string;

  name?: string;
  brand?: string;
  grade?: string;
  description?: string;

  image?: string;
  cardImage?: string;

  daily?: number;
  weekly?: number;
  monthly?: number;

  stock?: number;
  deposit?: number;
  securityDeposit?: number;

  specs?: any;
  specifications?: any;

  included?: string[];
  inclusions?: string[];
}

@Component({
  selector: 'app-device-detail',
  templateUrl: './device-detail.page.html',
  styleUrls: ['./device-detail.page.scss'],
  standalone: false
})
export class DeviceDetailPage {

  product =
    signal<Product | null>(null);

  loading =
    signal<boolean>(true);

  error =
    signal<string>('');

  addingCart =
    signal<boolean>(false);

  orderingNow =
    signal<boolean>(false);

  addingWishlist =
    signal<boolean>(false);

  selectedPlan =
    signal<RentalPlan>('Weekly');

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public api: Api,
    public auth: Auth,
    private toastController: ToastController
  ) {}

  ionViewWillEnter(): void {

    const id =
      this.route.snapshot
        .paramMap
        .get('id');

    if (!id) {

      this.loading.set(false);

      this.error.set(
        'Device not found.'
      );

      return;
    }

    this.loadProduct(id);
  }

  loadProduct(
    id: string
  ): void {

    this.loading.set(true);

    this.error.set('');

    this.api
      .get<Product>(
        `/products/${id}`
      )
      .subscribe({

        next: product => {

          this.product.set(
            product
          );

          this.chooseInitialPlan(
            product
          );

          this.loading.set(
            false
          );
        },

        error: error => {

          console.error(
            'Device detail error:',
            error
          );

          this.loading.set(
            false
          );

          this.error.set(
            error?.error?.error ||
            'Unable to load this device.'
          );
        }
      });
  }

  selectPlan(
    plan: RentalPlan
  ): void {

    if (
      !this.isPlanAvailable(
        plan
      )
    ) {
      return;
    }

    this.selectedPlan.set(
      plan
    );
  }

  isSelected(
    plan: RentalPlan
  ): boolean {

    return (
      this.selectedPlan() ===
      plan
    );
  }

  isPlanAvailable(
    plan: RentalPlan
  ): boolean {

    return (
      this.planPrice(plan) > 0
    );
  }

  planPrice(
    plan: RentalPlan
  ): number {

    const product =
      this.product();

    if (!product) {
      return 0;
    }

    switch (plan) {

      case 'Daily':
        return Number(
          product.daily || 0
        );

      case 'Weekly':
        return Number(
          product.weekly || 0
        );

      case 'Monthly':
        return Number(
          product.monthly || 0
        );

      default:
        return 0;
    }
  }

  selectedPrice(): number {

    return this.planPrice(
      this.selectedPlan()
    );
  }

  async addToCart(): Promise<void> {

    const info =
      await this.validateProduct();

    if (!info) {
      return;
    }

    if (
      this.addingCart() ||
      this.orderingNow()
    ) {
      return;
    }

    const plan =
      this.selectedPlan();

    this.addingCart.set(
      true
    );

    this.api
      .post(
        '/cart/items',
        {
          productId:
            info.id,

          plan,

          qty:
            1
        }
      )
      .subscribe({

        next: async () => {

          this.addingCart.set(
            false
          );

          await this.showToast(
            `${plan} rental added to cart.`,
            'success'
          );
        },

        error: async error => {

          console.error(
            'Add to cart error:',
            error
          );

          this.addingCart.set(
            false
          );

          await this.showToast(
            error?.error?.error ||
            'Could not add device to cart.',
            'danger'
          );
        }
      });
  }

  async orderNow(): Promise<void> {

    const info =
      await this.validateProduct();

    if (!info) {
      return;
    }

    if (
      this.addingCart() ||
      this.orderingNow()
    ) {
      return;
    }

    this.orderingNow.set(
      true
    );

    const plan =
      this.selectedPlan();

    this.api
      .get<any>(
        '/cart'
      )
      .subscribe({

        next: cart => {

          const backup = {
            lines:
              this.backupCartLines(
                cart?.lines || []
              ),

            startDate:
              cart?.startDate || '',

            endDate:
              cart?.endDate || '',

            protection:
              Boolean(
                cart?.protection
              )
          };

          sessionStorage.setItem(
            'dialuxBuyNowBackup',
            JSON.stringify(
              backup
            )
          );

          sessionStorage.setItem(
            'dialuxBuyNowActive',
            '1'
          );

          this.clearCartForBuyNow(
            info.id,
            plan
          );
        },

        error: async error => {

          console.error(
            'Buy now cart backup error:',
            error
          );

          this.orderingNow.set(
            false
          );

          await this.showToast(
            'Could not prepare Order Now.',
            'danger'
          );
        }
      });
  }

  private clearCartForBuyNow(
    productId: string,
    plan: RentalPlan
  ): void {

    this.api
      .delete<any>(
        '/cart'
      )
      .subscribe({

        next: () => {

          this.addBuyNowItem(
            productId,
            plan
          );
        },

        error: error => {

          console.error(
            'Buy now clear cart error:',
            error
          );

          this.addBuyNowItem(
            productId,
            plan
          );
        }
      });
  }

  private addBuyNowItem(
    productId: string,
    plan: RentalPlan
  ): void {

    this.api
      .post<any>(
        '/cart/items',
        {
          productId,
          plan,
          qty:
            1
        }
      )
      .subscribe({

        next: () => {

          this.orderingNow.set(
            false
          );

          this.router.navigateByUrl(
            '/checkout'
          );
        },

        error: async error => {

          console.error(
            'Order now add item error:',
            error
          );

          this.orderingNow.set(
            false
          );

          sessionStorage.removeItem(
            'dialuxBuyNowActive'
          );

          await this.showToast(
            error?.error?.error ||
            'Could not start checkout.',
            'danger'
          );
        }
      });
  }

  private backupCartLines(
    lines: any[]
  ): any[] {

    return lines
      .map(line => {

        const productId =
          line?.productId ||
          line?.product?.id ||
          line?.product?._id ||
          line?.device?.id ||
          line?.device?._id;

        if (!productId) {
          return null;
        }

        return {
          productId:
            String(
              productId
            ),

          plan:
            line?.plan ||
            'Weekly',

          qty:
            Number(
              line?.qty ||
              line?.quantity ||
              1
            )
        };
      })
      .filter(
        Boolean
      );
  }

  async addToWishlist(): Promise<void> {

    const product =
      this.product();

    if (!product) {
      return;
    }

    if (
      !this.auth.isLoggedIn()
    ) {

      await this.showToast(
        'Please sign in first.',
        'warning'
      );

      this.router.navigateByUrl(
        '/login'
      );

      return;
    }

    const id =
      product.id ||
      product._id;

    if (!id) {
      return;
    }

    if (
      this.addingWishlist()
    ) {
      return;
    }

    this.addingWishlist.set(
      true
    );

    this.api
      .post(
        `/wishlist/${id}`,
        {}
      )
      .subscribe({

        next: async () => {

          this.addingWishlist.set(
            false
          );

          await this.showToast(
            'Added to wishlist.',
            'success'
          );
        },

        error: async error => {

          console.error(
            'Wishlist error:',
            error
          );

          this.addingWishlist.set(
            false
          );

          await this.showToast(
            error?.error?.error ||
            'Could not update wishlist.',
            'danger'
          );
        }
      });
  }

  private async validateProduct():
    Promise<{
      id: string;
    } | null> {

    const product =
      this.product();

    if (!product) {
      return null;
    }

    if (
      !this.auth.isLoggedIn()
    ) {

      await this.showToast(
        'Please sign in first.',
        'warning'
      );

      this.router.navigateByUrl(
        '/login'
      );

      return null;
    }

    const id =
      product.id ||
      product._id;

    if (!id) {

      await this.showToast(
        'Device ID is missing.',
        'danger'
      );

      return null;
    }

    if (
      Number(
        product.stock || 0
      ) <= 0
    ) {

      await this.showToast(
        'This device is currently unavailable.',
        'warning'
      );

      return null;
    }

    return {
      id
    };
  }

  specsList(): {
    label: string;
    value: string;
  }[] {

    const product =
      this.product();

    const specs =
      product?.specifications ||
      product?.specs;

    if (!specs) {
      return [];
    }

    if (
      Array.isArray(specs)
    ) {

      return specs
        .map(
          (item: any) => {

            if (
              typeof item === 'string'
            ) {

              return {
                label:
                  'Specification',

                value:
                  item
              };
            }

            return {
              label:
                item?.label ||
                item?.name ||
                'Specification',

              value:
                String(
                  item?.value ||
                  item?.description ||
                  ''
                )
            };
          }
        )
        .filter(
          item =>
            Boolean(
              item.value
            )
        );
    }

    if (
      typeof specs === 'object'
    ) {

      return Object
        .entries(specs)
        .map(
          ([key, value]) => ({
            label:
              this.prettyLabel(
                key
              ),

            value:
              String(
                value ?? ''
              )
          })
        )
        .filter(
          item =>
            Boolean(
              item.value
            )
        );
    }

    return [];
  }

  includedItems(): string[] {

    const product =
      this.product();

    return (
      product?.included ||
      product?.inclusions ||
      []
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

  private chooseInitialPlan(
    product: Product
  ): void {

    if (
      Number(
        product.weekly || 0
      ) > 0
    ) {

      this.selectedPlan.set(
        'Weekly'
      );

      return;
    }

    if (
      Number(
        product.daily || 0
      ) > 0
    ) {

      this.selectedPlan.set(
        'Daily'
      );

      return;
    }

    this.selectedPlan.set(
      'Monthly'
    );
  }

  private prettyLabel(
    value: string
  ): string {

    return value
      .replace(
        /([A-Z])/g,
        ' $1'
      )
      .replace(
        /[_-]/g,
        ' '
      )
      .replace(
        /\b\w/g,
        char =>
          char.toUpperCase()
      )
      .trim();
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
          1800,
        position:
          'bottom',
        color
      });

    await toast.present();
  }
}