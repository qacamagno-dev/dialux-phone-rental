import {
  Component,
  Input,
  signal
} from '@angular/core';

import {
  ModalController
} from '@ionic/angular/lazy';

import {
  Api
} from '../core/api';

import {
  Auth,
  AuthUser
} from '../core/auth';


export interface ConsentStatus {

  currentTermsVersion:
    string;

  termsAccepted:
    boolean;

  termsVersion?:
    string;

  termsAcceptedAt?:
    string |
    null;

  marketingEmails:
    boolean;

  marketingUpdatedAt?:
    string |
    null;

}


interface ConsentSaveResponse
  extends ConsentStatus {

  ok:
    boolean;

  user?:
    AuthUser;

}


@Component({
  selector:
    'app-consent-modal',

  templateUrl:
    './consent-modal.component.html',

  styleUrls: [
    './consent-modal.component.scss'
  ],

  standalone:
    false
})
export class ConsentModalComponent {

  @Input()
  status!:
    ConsentStatus;


  @Input()
  preferencesOnly =
    false;


  marketingEmails =
    false;


  saving =
    signal<boolean>(
      false
    );


  errorMessage =
    signal<string>(
      ''
    );


  readonly termsUrl:
    string;


  readonly privacyUrl:
    string;


  constructor(
    public api:
      Api,

    private auth:
      Auth,

    private modalController:
      ModalController
  ) {

    this.termsUrl =
      `${this.api.siteUrl}/terms.html`;


    this.privacyUrl =
      `${this.api.siteUrl}/privacy.html`;

  }


  ngOnInit():
    void {

    this.marketingEmails =
      Boolean(
        this.status
          ?.marketingEmails
      );

  }


  setMarketing(
    event:
      CustomEvent
  ):
    void {

    this.marketingEmails =
      Boolean(
        event.detail
          ?.checked
      );

  }


  async save():
    Promise<void> {

    if (
      this.saving()
    ) {

      return;

    }


    this.saving.set(
      true
    );


    this.errorMessage.set(
      ''
    );


    this.api
      .patch<ConsentSaveResponse>(
        '/users/me/consent',
        {

          acceptTerms:
            true,

          marketingEmails:
            this.marketingEmails

        }
      )
      .subscribe({

        next:
          async response => {

            this.saving.set(
              false
            );


            if (
              response.user
            ) {

              this.auth
                .replaceCurrentUser(
                  response.user
                );

            }


            await this.modalController
              .dismiss(
                {
                  accepted:
                    true,

                  marketingEmails:
                    response
                      .marketingEmails
                },
                'accepted'
              );

          },


        error:
          error => {

            this.saving.set(
              false
            );


            this.errorMessage.set(

              error?.error?.error ||
              error?.message ||
              'Could not save your choices.'

            );

          }

      });

  }


  async cancel():
    Promise<void> {

    await this.modalController
      .dismiss(
        {
          accepted:
            false
        },
        'cancel'
      );

  }


  async signOut():
    Promise<void> {

    await this.modalController
      .dismiss(
        {
          accepted:
            false
        },
        'signout'
      );

  }

}
