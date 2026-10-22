import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class Api {
  readonly siteUrl = 'https://dialux-phone-rental.onrender.com';
  private readonly baseUrl = `${this.siteUrl}/api`;

  constructor(private http: HttpClient) {}

  private getToken(): string | null {
    return localStorage.getItem('authToken');
  }

  private getHeaders(): HttpHeaders {
    let headers = new HttpHeaders({ 'Content-Type': 'application/json' });
    const token = this.getToken();
    if (token) headers = headers.set('Authorization', `Bearer ${token}`);
    return headers;
  }

  get<T>(path: string): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}${path}`, { headers: this.getHeaders() });
  }

  post<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${path}`, body, { headers: this.getHeaders() });
  }

  put<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.put<T>(`${this.baseUrl}${path}`, body, { headers: this.getHeaders() });
  }

  patch<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${path}`, body, { headers: this.getHeaders() });
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${path}`, { headers: this.getHeaders() });
  }

  deleteWithBody<T>(path: string, body: unknown): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${path}`, { headers: this.getHeaders(), body });
  }

  imageUrl(path?: string): string {
    if (!path) return 'assets/icon/favicon.png';
    if (/^https?:\/\//i.test(path) || path.startsWith('data:')) return path;
    return `${this.siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }
}
