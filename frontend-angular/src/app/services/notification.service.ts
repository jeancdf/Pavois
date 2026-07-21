import { Injectable, signal } from '@angular/core';

export type ToastType = 'info' | 'warning' | 'alert';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

const TOAST_DURATION_MS = 4000;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private nextId = 0;
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  push(type: ToastType, message: string): void {
    const id = this.nextId++;
    this._toasts.update((t) => [...t, { id, type, message }]);
    setTimeout(() => this.dismiss(id), TOAST_DURATION_MS);
  }

  dismiss(id: number): void {
    this._toasts.update((t) => t.filter((toast) => toast.id !== id));
  }
}
