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
  desc?: string;

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

  avgRating?: number;
  reviewCount?: number;

}


interface Review {

  id?: string;
  _id?: string;

  product?: string;

  user?:
    | string
    | {
        id?: string;
        _id?: string;
      };

  userName?: string;

  rating?: number;

  comment?: string;

  createdAt?: string;
  updatedAt?: string;

}


interface ReviewsResponse {

  reviews?: Review[];

  count?: number;

  avgRating?: number;

  distribution?: {
    [key: string]: number;
  };

}


interface ReviewSubmitResponse {

  review?: Review;

  avgRating?: number;

  reviewCount?: number;

}


@Component({
  selector: 'app-device-detail',

  templateUrl:
    './device-detail.page.html',

  styleUrls: [
    './device-detail.page.scss'
  ],

  standalone: false
})
export class DeviceDetailPage {

  product =
    signal<Product | null>(
      null
    );

  loading =
    signal<boolean>(
      true
    );

  error =
    signal<string>(
      ''
    );


  addingCart =
    signal<boolean>(
      false
    );

  orderingNow =
    signal<boolean>(
      false
    );

  addingWishlist =
    signal<boolean>(
      false
    );


  selectedPlan =
    signal<RentalPlan>(
      'Weekly'
    );


  // =========================================================
  // REVIEWS
  // =========================================================

  reviews =
    signal<Review[]>(
      []
    );

  reviewsLoading =
    signal<boolean>(
      false
    );

  reviewsError =
    signal<string>(
      ''
    );

  reviewCount =
    signal<number>(
      0
    );

  averageRating =
    signal<number>(
      0
    );

  reviewDistribution =
    signal<{
      [key: string]: number;
    }>({
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0
    });


  selectedRating =
    signal<number>(
      0
    );

  reviewComment =
    '';

  submittingReview =
    signal<boolean>(
      false
    );

  editingOwnReview =
    signal<boolean>(
      false
    );


  readonly stars =
    [
      1,
      2,
      3,
      4,
      5
    ];


  constructor(

    private route:
      ActivatedRoute,

    private router:
      Router,

    public api:
      Api,

    public auth:
      Auth,

    private toastController:
      ToastController

  ) {}


  ionViewWillEnter():
    void {

    const id =
      this.route.snapshot
        .paramMap
        .get(
          'id'
        );


    if (!id) {

      this.loading.set(
        false
      );


      this.error.set(
        'Device not found.'
      );


      return;

    }


    this.loadProduct(
      id
    );

  }


  // =========================================================
  // PRODUCT
  // =========================================================

  loadProduct(
    id: string
  ):
    void {

    this.loading.set(
      true
    );

    this.error.set(
      ''
    );


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


          this.averageRating.set(
            Number(
              product.avgRating ||
              0
            )
          );


          this.reviewCount.set(
            Number(
              product.reviewCount ||
              0
            )
          );


          this.loading.set(
            false
          );


          this.loadReviews(
            id
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


  // =========================================================
  // REVIEWS
  // =========================================================

  loadReviews(
    productId?: string
  ):
    void {

    const current =
      this.product();


    const id =
      productId ||
      current?.id ||
      current?._id;


    if (!id) {

      return;

    }


    this.reviewsLoading.set(
      true
    );

    this.reviewsError.set(
      ''
    );


    this.api
      .get<ReviewsResponse>(
        `/products/${id}/reviews`
      )
      .subscribe({

        next: response => {

          const reviews =
            response?.reviews ||
            [];


          this.reviews.set(
            reviews
          );


          this.reviewCount.set(
            Number(
              response?.count ||
              0
            )
          );


          this.averageRating.set(
            Number(
              response?.avgRating ||
              0
            )
          );


          this.reviewDistribution.set(
            response?.distribution ||
            {
              1: 0,
              2: 0,
              3: 0,
              4: 0,
              5: 0
            }
          );


          this.prefillOwnReview(
            reviews
          );


          this.reviewsLoading.set(
            false
          );

        },


        error: error => {

          console.error(
            'Reviews load error:',
            error
          );


          this.reviewsLoading.set(
            false
          );


          this.reviewsError.set(
            error?.error?.error ||
            'Unable to load reviews.'
          );

        }

      });

  }


  selectRating(
    rating: number
  ):
    void {

    if (
      rating < 1 ||
      rating > 5
    ) {

      return;

    }


    this.selectedRating.set(
      rating
    );

  }


  async submitReview():
    Promise<void> {

    if (
      !this.auth.isLoggedIn()
    ) {

      await this.showToast(
        'Please sign in before submitting a review.',
        'warning'
      );


      this.router.navigateByUrl(
        '/login'
      );


      return;

    }


    if (
      this.submittingReview()
    ) {

      return;

    }


    const product =
      this.product();


    const productId =
      product?.id ||
      product?._id;


    if (!productId) {

      await this.showToast(
        'Device ID is missing.',
        'danger'
      );


      return;

    }


    const rating =
      this.selectedRating();


    if (
      rating < 1 ||
      rating > 5
    ) {

      await this.showToast(
        'Choose a rating from 1 to 5 stars.',
        'warning'
      );


      return;

    }


    const comment =
      this.reviewComment
        .trim();


    if (
      comment.length >
      1000
    ) {

      await this.showToast(
        'Review must be 1000 characters or less.',
        'warning'
      );


      return;

    }


    this.submittingReview.set(
      true
    );


    this.api
      .post<ReviewSubmitResponse>(
        `/products/${productId}/reviews`,
        {

          rating,

          comment

        }
      )
      .subscribe({

        next: async response => {

          this.submittingReview.set(
            false
          );


          if (
            response?.avgRating !==
            undefined
          ) {

            this.averageRating.set(
              Number(
                response.avgRating
              )
            );

          }


          if (
            response?.reviewCount !==
            undefined
          ) {

            this.reviewCount.set(
              Number(
                response.reviewCount
              )
            );

          }


          await this.showToast(
            this.editingOwnReview()
              ? 'Review updated successfully.'
              : 'Review submitted successfully.',
            'success'
          );


          this.loadReviews(
            productId
          );

        },


        error: async error => {

          console.error(
            'Submit review error:',
            error
          );


          this.submittingReview.set(
            false
          );


          await this.showToast(
            error?.error?.error ||
            'Could not submit review.',
            error?.status === 403
              ? 'warning'
              : 'danger'
          );

        }

      });

  }


  private prefillOwnReview(
    reviews: Review[]
  ):
    void {

    if (
      !this.auth.isLoggedIn()
    ) {

      this.selectedRating.set(
        0
      );

      this.reviewComment =
        '';

      this.editingOwnReview.set(
        false
      );


      return;

    }


    const currentUser =
      this.auth.currentUser();


    const currentUserId =
      String(
        currentUser?.id ||
        currentUser?._id ||
        ''
      );


    if (!currentUserId) {

      return;

    }


    const ownReview =
      reviews.find(
        review => {

          const reviewUser =
            review.user;


          const reviewUserId =
            typeof reviewUser ===
              'string'
              ? reviewUser
              : String(
                  reviewUser?.id ||
                  reviewUser?._id ||
                  ''
                );


          return (
            reviewUserId ===
            currentUserId
          );

        }
      );


    if (!ownReview) {

      this.selectedRating.set(
        0
      );

      this.reviewComment =
        '';

      this.editingOwnReview.set(
        false
      );


      return;

    }


    this.selectedRating.set(
      Number(
        ownReview.rating ||
        0
      )
    );


    this.reviewComment =
      String(
        ownReview.comment ||
        ''
      );


    this.editingOwnReview.set(
      true
    );

  }


  isReviewMine(
    review: Review
  ):
    boolean {

    const currentUser =
      this.auth.currentUser();


    const currentUserId =
      String(
        currentUser?.id ||
        currentUser?._id ||
        ''
      );


    if (
      !currentUserId
    ) {

      return false;

    }


    const reviewUser =
      review.user;


    const reviewUserId =
      typeof reviewUser ===
        'string'
        ? reviewUser
        : String(
            reviewUser?.id ||
            reviewUser?._id ||
            ''
          );


    return (
      currentUserId ===
      reviewUserId
    );

  }


  starFilled(
    star: number,
    rating?: number
  ):
    boolean {

    return (
      star <=
      Number(
        rating ||
        0
      )
    );

  }


  ratingPercent(
    star: number
  ):
    number {

    const total =
      this.reviewCount();


    if (
      total <= 0
    ) {

      return 0;

    }


    const count =
      Number(
        this.reviewDistribution()?.[
          String(star)
        ] ||
        0
      );


    return Math.round(
      (
        count /
        total
      ) *
      100
    );

  }


  ratingCount(
    star: number
  ):
    number {

    return Number(
      this.reviewDistribution()?.[
        String(star)
      ] ||
      0
    );

  }


  displayReviewerName(
    review: Review
  ):
    string {

    if (
      this.isReviewMine(
        review
      )
    ) {

      return 'You';

    }


    return (
      review.userName ||
      'DiaLux Customer'
    );

  }


  // =========================================================
  // RENTAL PLAN
  // =========================================================

  selectPlan(
    plan: RentalPlan
  ):
    void {

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
  ):
    boolean {

    return (
      this.selectedPlan() ===
      plan
    );

  }


  isPlanAvailable(
    plan: RentalPlan
  ):
    boolean {

    return (
      this.planPrice(
        plan
      ) >
      0
    );

  }


  planPrice(
    plan: RentalPlan
  ):
    number {

    const product =
      this.product();


    if (!product) {

      return 0;

    }


    switch (plan) {

      case 'Daily':

        return Number(
          product.daily ||
          0
        );


      case 'Weekly':

        return Number(
          product.weekly ||
          0
        );


      case 'Monthly':

        return Number(
          product.monthly ||
          0
        );


      default:

        return 0;

    }

  }


  selectedPrice():
    number {

    return this.planPrice(
      this.selectedPlan()
    );

  }


  // =========================================================
  // CART
  // =========================================================

  async addToCart():
    Promise<void> {

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


  async orderNow():
    Promise<void> {

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
                cart?.lines ||
                []
              ),

            startDate:
              cart?.startDate ||
              '',

            endDate:
              cart?.endDate ||
              '',

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
  ):
    void {

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
  ):
    void {

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
  ):
    any[] {

    return lines

      .map(
        line => {

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

        }
      )

      .filter(
        Boolean
      );

  }


  // =========================================================
  // WISHLIST
  // =========================================================

  async addToWishlist():
    Promise<void> {

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


  // =========================================================
  // HELPERS
  // =========================================================

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
        product.stock ||
        0
      ) <=
      0
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
      Array.isArray(
        specs
      )
    ) {

      return specs

        .map(
          (
            item:
              any
          ) => {

            if (
              typeof item ===
              'string'
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
      typeof specs ===
      'object'
    ) {

      return Object

        .entries(
          specs
        )

        .map(
          (
            [
              key,
              value
            ]
          ) => ({

            label:
              this.prettyLabel(
                key
              ),

            value:
              String(
                value ??
                ''
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


  includedItems():
    string[] {

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
  ):
    string {

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
        value ||
        0
      )
    );

  }


  private chooseInitialPlan(
    product: Product
  ):
    void {

    if (
      Number(
        product.weekly ||
        0
      ) >
      0
    ) {

      this.selectedPlan.set(
        'Weekly'
      );


      return;

    }


    if (
      Number(
        product.daily ||
        0
      ) >
      0
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
  ):
    string {

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
  ):
    Promise<void> {

    const toast =
      await this.toastController
        .create({

          message,

          duration:
            2200,

          position:
            'bottom',

          color

        });


    await toast.present();

  }

}