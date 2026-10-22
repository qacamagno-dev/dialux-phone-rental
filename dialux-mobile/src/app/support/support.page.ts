import {
  Component,
  signal
} from '@angular/core';

import {
  ActivatedRoute
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

interface ChatMessage {
  me: boolean;
  text: string;
}

@Component({
  selector: 'app-support',
  templateUrl: './support.page.html',
  styleUrls: ['./support.page.scss'],
  standalone: false
})
export class SupportPage {

  tickets =
    signal<any[]>([]);

  ticketsLoading =
    signal<boolean>(false);

  ticketsError =
    signal<string>('');

  sending =
    signal<boolean>(false);

  asking =
    signal<boolean>(false);

  chatMessages =
    signal<ChatMessage[]>([
      {
        me: false,
        text:
          'Hi! I’m DiaLux Support. Ask me about rentals, payments, delivery, returns, or your account.'
      }
    ]);

  subject = '';

  message = '';

  category:
    | 'order'
    | 'payment'
    | 'return'
    | 'technical'
    | 'other' =
    'other';

  orderRef = '';

  chat = '';

  constructor(
    private api: Api,
    public auth: Auth,
    route: ActivatedRoute,
    private toastController: ToastController
  ) {

    this.orderRef =
      route.snapshot
        .queryParamMap
        .get('order') || '';
  }

  ionViewWillEnter(): void {

    if (
      this.auth.isLoggedIn()
    ) {

      this.loadTickets();
    }
  }

  loadTickets(): void {

    if (
      !this.auth.isLoggedIn()
    ) {

      this.tickets.set([]);

      return;
    }

    this.ticketsLoading.set(
      true
    );

    this.ticketsError.set('');

    this.api
      .get<any>(
        '/support/mine'
      )
      .subscribe({

        next: response => {

          this.tickets.set(
            response?.tickets || []
          );

          this.ticketsLoading.set(
            false
          );
        },

        error: error => {

          console.error(
            'Support tickets load error:',
            error
          );

          this.ticketsLoading.set(
            false
          );

          this.ticketsError.set(
            error?.error?.error ||
            'Unable to load your support tickets.'
          );
        }
      });
  }

  async send(): Promise<void> {

    const user =
      this.auth.currentUser();

    if (!user) {

      await this.showToast(
        'Sign in first to submit a support ticket.',
        'warning'
      );

      return;
    }

    const cleanMessage =
      this.message.trim();

    if (
      cleanMessage.length < 10
    ) {

      await this.showToast(
        'Please enter a little more detail about your concern.',
        'warning'
      );

      return;
    }

    if (
      this.sending()
    ) {
      return;
    }

    this.sending.set(
      true
    );

    this.api
      .post<any>(
        '/support',
        {
          name:
            user.name,

          email:
            user.email,

          subject:
            this.subject.trim() ||
            'Mobile app support',

          message:
            cleanMessage,

          category:
            this.category,

          orderRef:
            this.orderRef.trim(),

          phone:
            user.profile?.phone ||
            ''
        }
      )
      .subscribe({

        next: async response => {

          this.sending.set(
            false
          );

          this.subject = '';

          this.message = '';

          await this.showToast(
            response?.ref
              ? `Ticket ${response.ref} opened.`
              : 'Support ticket submitted.',
            'success'
          );

          this.loadTickets();
        },

        error: async error => {

          console.error(
            'Support ticket error:',
            error
          );

          this.sending.set(
            false
          );

          await this.showToast(
            error?.error?.error ||
            'Could not submit your support ticket.',
            'danger'
          );
        }
      });
  }

  ask(): void {

    const question =
      this.chat.trim();

    if (
      !question ||
      this.asking()
    ) {
      return;
    }

    this.chatMessages.update(
      messages => [
        ...messages,
        {
          me: true,
          text: question
        }
      ]
    );

    this.chat = '';

    this.asking.set(
      true
    );

    this.api
      .post<any>(
        '/chat',
        {
          messages: [
            {
              role: 'user',
              content: question
            }
          ]
        }
      )
      .subscribe({

        next: response => {

          this.asking.set(
            false
          );

          this.chatMessages.update(
            messages => [
              ...messages,
              {
                me: false,
                text:
                  response?.result ||
                  'How else can I help?'
              }
            ]
          );
        },

        error: error => {

          console.error(
            'Support chat error:',
            error
          );

          this.asking.set(
            false
          );

          this.chatMessages.update(
            messages => [
              ...messages,
              {
                me: false,
                text:
                  'Chat is temporarily unavailable. You can still submit a support ticket below.'
              }
            ]
          );
        }
      });
  }

  statusLabel(
    status?: string
  ): string {

    if (!status) {
      return 'Open';
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

      case 'resolved':
      case 'closed':
        return 'success';

      case 'pending':
      case 'waiting':
        return 'warning';

      case 'escalated':
        return 'danger';

      default:
        return 'primary';
    }
  }

  categoryLabel(
    category?: string
  ): string {

    switch (
      category
    ) {

      case 'order':
        return 'Order';

      case 'payment':
        return 'Payment';

      case 'return':
        return 'Return';

      case 'technical':
        return 'Technical';

      default:
        return 'Other';
    }
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
        duration: 2200,
        position: 'bottom',
        color
      });

    await toast.present();
  }
}