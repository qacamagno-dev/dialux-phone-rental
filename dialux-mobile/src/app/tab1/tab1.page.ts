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

interface Product {
  id?: string;
  _id?: string;

  name: string;
  brand?: string;
  grade?: string;

  image?: string;
  cardImage?: string;

  daily?: number;
  weekly?: number;

  stock?: number;
}

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: false
})
export class Tab1Page {

  featured =
    signal<Product[]>([]);

  loading =
    signal<boolean>(true);

  constructor(
    public api: Api,
    public auth: Auth,
    private router: Router
  ) {}

  ionViewWillEnter(): void {
    this.loadFeatured();
  }

  loadFeatured(): void {

    this.loading.set(
      true
    );

    this.api
      .get<{
        products: Product[];
      }>(
        '/products'
      )
      .subscribe({

        next: response => {

          const products =
            response?.products || [];

          this.featured.set(
            products
              .filter(
                product =>
                  Number(
                    product.stock || 0
                  ) > 0
              )
              .slice(
                0,
                6
              )
          );

          this.loading.set(
            false
          );
        },

        error: error => {

          console.error(
            'Home products error:',
            error
          );

          this.featured.set([]);

          this.loading.set(
            false
          );
        }
      });
  }

  openDevice(
    product: Product
  ): void {

    const id =
      product.id ||
      product._id;

    if (!id) {
      return;
    }

    this.router.navigate([
      '/tabs/device',
      id
    ]);
  }

  go(
    path: string
  ): void {

    this.router.navigateByUrl(
      path
    );
  }

  greetingName(): string {

    const name =
      this.auth.currentUser()?.name;

    if (!name) {
      return '';
    }

    return (
      name
        .trim()
        .split(/\s+/)[0] ||
      ''
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