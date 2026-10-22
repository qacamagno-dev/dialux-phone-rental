import {
  Injectable,
  signal
} from '@angular/core';

import {
  Observable,
  tap
} from 'rxjs';

import {
  Api
} from './api';

export interface AuthUser {
  id?: string;
  _id?: string;

  name: string;
  email: string;

  role?: string;

  avatar?: string;

  profile?: any;
}

interface AuthResponse {
  token: string;
  user: AuthUser;
}

@Injectable({
  providedIn: 'root'
})
export class Auth {

  private readonly tokenKey =
    'authToken';

  private readonly userKey =
    'authUser';

  currentUser =
    signal<AuthUser | null>(
      this.readStoredUser()
    );

  constructor(
    private api: Api
  ) {}

  login(
    email: string,
    password: string
  ): Observable<AuthResponse> {

    return this.api
      .post<AuthResponse>(
        '/auth/login',
        {
          email,
          password
        }
      )
      .pipe(
        tap(response => {
          this.saveSession(
            response
          );
        })
      );
  }

  register(
    name: string,
    email: string,
    password: string
  ): Observable<AuthResponse> {

    return this.api
      .post<AuthResponse>(
        '/auth/register',
        {
          name,
          email,
          password
        }
      )
      .pipe(
        tap(response => {
          this.saveSession(
            response
          );
        })
      );
  }

  loadCurrentUser():
    Observable<AuthUser> {

    return this.api
      .get<AuthUser>(
        '/auth/me'
      )
      .pipe(
        tap(user => {

          this.currentUser.set(
            user
          );

          localStorage.setItem(
            this.userKey,
            JSON.stringify(user)
          );
        })
      );
  }

  logout(): void {

    localStorage.removeItem(
      this.tokenKey
    );

    localStorage.removeItem(
      this.userKey
    );

    this.currentUser.set(
      null
    );
  }

  isLoggedIn(): boolean {

    return Boolean(
      localStorage.getItem(
        this.tokenKey
      )
    );
  }

  getToken(): string | null {

    return localStorage.getItem(
      this.tokenKey
    );
  }

  private saveSession(
    response: AuthResponse
  ): void {

    if (
      !response?.token ||
      !response?.user
    ) {

      throw new Error(
        'Invalid authentication response.'
      );
    }

    localStorage.setItem(
      this.tokenKey,
      response.token
    );

    localStorage.setItem(
      this.userKey,
      JSON.stringify(
        response.user
      )
    );

    this.currentUser.set(
      response.user
    );
  }

  private readStoredUser():
    AuthUser | null {

    const raw =
      localStorage.getItem(
        this.userKey
      );

    if (!raw) {

      return null;
    }

    try {

      return JSON.parse(
        raw
      ) as AuthUser;

    } catch {

      localStorage.removeItem(
        this.userKey
      );

      return null;
    }
  }
}