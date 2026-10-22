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
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: false
})
export class NotificationsPage {

  items =
    signal<any[]>([]);

  loading =
    signal<boolean>(true);

  error =
    signal<string>('');

  unread =
    signal<number>(0);

  markingAll =
    signal<boolean>(false);

  readingId =
    signal<string | null>(null);

  constructor(
    private api: Api,
    public auth: Auth,
    private router: Router
  ) {}

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {

    if (
      !this.auth.isLoggedIn()
    ) {

      this.items.set([]);

      this.unread.set(0);

      this.loading.set(false);

      return;
    }

    this.loading.set(true);

    this.error.set('');

    this.api
      .get<any>(
        '/notifications?limit=50'
      )
      .subscribe({

        next: response => {

          this.items.set(
            response?.notifications || []
          );

          this.unread.set(
            Number(
              response?.unread || 0
            )
          );

          this.loading.set(false);
        },

        error: error => {

          console.error(
            'Notifications load error:',
            error
          );

          this.loading.set(false);

          this.error.set(
            error?.error?.error ||
            'Unable to load notifications.'
          );
        }
      });
  }

  read(
    notification: any
  ): void {

    const id =
      notification?.id ||
      notification?._id;

    if (!id) {
      this.openLink(notification);
      return;
    }

    if (
      notification.read
    ) {

      this.openLink(
        notification
      );

      return;
    }

    if (
      this.readingId()
    ) {
      return;
    }

    this.readingId.set(
      id
    );

    this.api
      .patch<any>(
        `/notifications/${id}/read`,
        {}
      )
      .subscribe({

        next: () => {

          this.items.update(
            notifications =>
              notifications.map(
                item => {

                  const itemId =
                    item?.id ||
                    item?._id;

                  if (
                    itemId === id
                  ) {

                    return {
                      ...item,
                      read: true
                    };
                  }

                  return item;
                }
              )
          );

          this.unread.update(
            count =>
              Math.max(
                0,
                count - 1
              )
          );

          this.readingId.set(
            null
          );

          this.openLink(
            notification
          );
        },

        error: error => {

          console.error(
            'Notification read error:',
            error
          );

          this.readingId.set(
            null
          );

          this.openLink(
            notification
          );
        }
      });
  }

  readAll(): void {

    if (
      this.markingAll() ||
      this.unread() === 0
    ) {
      return;
    }

    this.markingAll.set(
      true
    );

    this.api
      .post(
        '/notifications/read-all',
        {}
      )
      .subscribe({

        next: () => {

          this.items.update(
            notifications =>
              notifications.map(
                item => ({
                  ...item,
                  read: true
                })
              )
          );

          this.unread.set(
            0
          );

          this.markingAll.set(
            false
          );
        },

        error: error => {

          console.error(
            'Read all notifications error:',
            error
          );

          this.markingAll.set(
            false
          );
        }
      });
  }

  getIcon(
    type?: string
  ): string {

    switch (
      type
    ) {

      case 'payment':
        return 'card-outline';

      case 'support':
        return 'chatbubble-ellipses-outline';

      case 'account':
        return 'person-circle-outline';

      case 'order':
        return 'receipt-outline';

      case 'delivery':
        return 'bicycle-outline';

      case 'return':
        return 'return-down-back-outline';

      default:
        return 'notifications-outline';
    }
  }

  getTypeLabel(
    type?: string
  ): string {

    switch (
      type
    ) {

      case 'payment':
        return 'Payment';

      case 'support':
        return 'Support';

      case 'account':
        return 'Account';

      case 'order':
        return 'Order';

      case 'delivery':
        return 'Delivery';

      case 'return':
        return 'Return';

      default:
        return 'Update';
    }
  }

  isReading(
    notification: any
  ): boolean {

    const id =
      notification?.id ||
      notification?._id;

    return (
      this.readingId() === id
    );
  }

  login(): void {

    this.router.navigateByUrl(
      '/login'
    );
  }

  private openLink(
    notification: any
  ): void {

    const link =
      String(
        notification?.link || ''
      );

    if (
      link.includes(
        'order.html?id='
      )
    ) {

      const id =
        link
          .split('id=')[1]
          ?.split('&')[0];

      if (id) {

        this.router.navigate([
          '/order',
          id
        ]);

        return;
      }
    }

    if (
      link.includes(
        '/profile'
      )
    ) {

      this.router.navigateByUrl(
        '/tabs/profile'
      );

      return;
    }

    if (
      link.includes(
        'support'
      )
    ) {

      this.router.navigateByUrl(
        '/support'
      );
    }
  }
}