import {
  ChangeDetectorRef,
  Component,
  OnInit
} from '@angular/core';

import {
  Router
} from '@angular/router';

import {
  Api
} from '../core/api';

interface Product {
  id?: string;
  _id?: string;

  name: string;

  brand?: string;
  cat?: string;
  grade?: string;
  desc?: string;

  daily?: number;
  weekly?: number;
  monthly?: number;

  deposit?: number;
  stock?: number;

  avgRating?: number;
  reviewCount?: number;

  image?: string;
  cardImage?: string;
  images?: string[];
}

interface ProductResponse {
  products: Product[];
  count: number;
}

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: [
    'tab2.page.scss'
  ],
  standalone: false
})
export class Tab2Page implements OnInit {

  products: Product[] = [];

  filteredProducts: Product[] = [];

  loading = true;

  error = '';

  searchTerm = '';

  selectedBrand = 'all';

  selectedGrade = 'all';

  selectedSort = 'featured';

  brands: string[] = [];

  grades: string[] = [
    'Like New',
    'Excellent',
    'Good',
    'Fair'
  ];

  private readonly siteBaseUrl =
    'https://dialux-phone-rental.onrender.com';

  constructor(
    private api: Api,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadProducts();
  }

  loadProducts(): void {

    this.loading = true;

    this.error = '';

    this.cdr.detectChanges();

    this.api
      .get<ProductResponse>(
        '/products'
      )
      .subscribe({

        next: response => {

          this.products =
            response?.products || [];

          this.updateBrands();

          this.applyFilters();

          this.loading = false;

          this.cdr.detectChanges();
        },

        error: error => {

          console.error(
            'Products error:',
            error
          );

          this.error =
            'Unable to load devices.';

          this.loading = false;

          this.cdr.detectChanges();
        }
      });
  }

  refresh(
    event: any
  ): void {

    this.api
      .get<ProductResponse>(
        '/products'
      )
      .subscribe({

        next: response => {

          this.products =
            response?.products || [];

          this.updateBrands();

          this.applyFilters();

          event.target.complete();

          this.cdr.detectChanges();
        },

        error: error => {

          console.error(
            'Refresh error:',
            error
          );

          event.target.complete();

          this.cdr.detectChanges();
        }
      });
  }

  applyFilters(): void {

    const term =
      this.searchTerm
        .trim()
        .toLowerCase();

    let result =
      this.products.filter(
        product => {

          const matchesSearch =
            !term ||
            product.name
              ?.toLowerCase()
              .includes(term) ||
            product.brand
              ?.toLowerCase()
              .includes(term) ||
            product.desc
              ?.toLowerCase()
              .includes(term);

          const matchesBrand =
            this.selectedBrand ===
              'all' ||
            product.brand ===
              this.selectedBrand;

          const matchesGrade =
            this.selectedGrade ===
              'all' ||
            product.grade ===
              this.selectedGrade;

          return (
            matchesSearch &&
            matchesBrand &&
            matchesGrade
          );
        }
      );

    switch (
      this.selectedSort
    ) {

      case 'price-asc':

        result = [
          ...result
        ].sort(
          (a, b) =>
            (a.weekly || 0) -
            (b.weekly || 0)
        );

        break;

      case 'price-desc':

        result = [
          ...result
        ].sort(
          (a, b) =>
            (b.weekly || 0) -
            (a.weekly || 0)
        );

        break;

      case 'name':

        result = [
          ...result
        ].sort(
          (a, b) =>
            a.name.localeCompare(
              b.name
            )
        );

        break;

      case 'stock':

        result = [
          ...result
        ].sort(
          (a, b) =>
            (b.stock || 0) -
            (a.stock || 0)
        );

        break;

      case 'rating':

        result = [
          ...result
        ].sort(
          (a, b) =>
            (b.avgRating || 0) -
            (a.avgRating || 0)
        );

        break;

      default:
        break;
    }

    this.filteredProducts =
      result;

    this.cdr.detectChanges();
  }

  clearFilters(): void {

    this.searchTerm = '';

    this.selectedBrand =
      'all';

    this.selectedGrade =
      'all';

    this.selectedSort =
      'featured';

    this.applyFilters();
  }

  hasActiveFilters(): boolean {

    return (
      Boolean(
        this.searchTerm.trim()
      ) ||
      this.selectedBrand !==
        'all' ||
      this.selectedGrade !==
        'all' ||
      this.selectedSort !==
        'featured'
    );
  }

  getProductId(
    product: Product
  ): string | null {

    return (
      product.id ||
      product._id ||
      null
    );
  }

  openDevice(
    product: Product
  ): void {

    const productId =
      this.getProductId(
        product
      );

    if (!productId) {

      console.error(
        'Product has no id or _id:',
        product
      );

      return;
    }

    this.router.navigate([
      '/tabs/device',
      productId
    ]);
  }

  getImage(
    product: Product
  ): string {

    let image = '';

    if (
      Array.isArray(
        product.images
      ) &&
      product.images.length > 0
    ) {

      image =
        product.images[0];

    } else if (
      product.image
    ) {

      image =
        product.image;

    } else if (
      product.cardImage
    ) {

      image =
        product.cardImage;
    }

    if (!image) {

      return (
        'assets/icon/favicon.png'
      );
    }

    if (
      image.startsWith(
        'http://'
      ) ||
      image.startsWith(
        'https://'
      ) ||
      image.startsWith(
        'data:'
      )
    ) {

      return image;
    }

    if (
      image.startsWith(
        'assets/'
      )
    ) {

      return (
        `${this.siteBaseUrl}/${image}`
      );
    }

    const cleanPath =
      image.startsWith('/')
        ? image
        : `/${image}`;

    return (
      `${this.siteBaseUrl}${cleanPath}`
    );
  }

  formatPrice(
    value?: number
  ): string {

    if (
      value === undefined ||
      value === null
    ) {

      return '-';
    }

    return new Intl.NumberFormat(
      'en-PH',
      {
        style: 'currency',
        currency: 'PHP',
        maximumFractionDigits: 0
      }
    ).format(value);
  }

  isOutOfStock(
    product: Product
  ): boolean {

    return (
      Number(
        product.stock || 0
      ) <= 0
    );
  }

  getRating(
    product: Product
  ): string {

    return Number(
      product.avgRating || 0
    ).toFixed(1);
  }

  private updateBrands(): void {

    this.brands =
      Array.from(
        new Set(
          this.products
            .map(
              product =>
                product.brand
            )
            .filter(
              (
                brand
              ): brand is string =>
                Boolean(brand)
            )
        )
      ).sort();
  }

  trackByProductId = (
    index: number,
    product: Product
  ): string => {

    return (
      product.id ||
      product._id ||
      String(index)
    );
  };
}