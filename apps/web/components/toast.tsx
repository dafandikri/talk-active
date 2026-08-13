'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export const TOAST_VARIANTS = ['positive', 'negative', 'warning', 'info'] as const;
export type ToastVariant = typeof TOAST_VARIANTS[number];

export type ToastOptions = Readonly<{
  variant: ToastVariant;
  message: string;
  title?: string;
  duration?: number | null;
}>;

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => number;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);
const DEFAULT_DURATION_MS = 5_000;
const MAX_VISIBLE_TOASTS = 3;
const TOAST_MARKS: Record<ToastVariant, string> = {
  positive: '+',
  negative: '!',
  warning: '!',
  info: 'i',
};

let nextToastId = 0;

function createToastId() {
  nextToastId += 1;
  return nextToastId;
}

function ToastItem({ toast, dismissToast }: Readonly<{ toast: ToastRecord; dismissToast: (id: number) => void }>) {
  useEffect(() => {
    if (toast.duration === null) return;
    const timeout = window.setTimeout(
      () => dismissToast(toast.id),
      toast.duration ?? DEFAULT_DURATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [dismissToast, toast.duration, toast.id]);

  return <article
    aria-atomic="true"
    className={`toast toast--${toast.variant}`}
    data-toast-variant={toast.variant}
    role={toast.variant === 'negative' ? 'alert' : 'status'}
  >
    <span className="toast__icon" aria-hidden="true">{TOAST_MARKS[toast.variant]}</span>
    <div className="toast__content">
      {toast.title ? <strong className="toast__title">{toast.title}</strong> : null}
      <p className="toast__message">{toast.message}</p>
    </div>
    <button
      aria-label="Dismiss notification"
      className="toast__close"
      type="button"
      onClick={() => dismissToast(toast.id)}
    >
      <span aria-hidden="true">x</span>
    </button>
  </article>;
}

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((options: ToastOptions) => {
    const toast = { ...options, id: createToastId() };
    setToasts((current) => [...current, toast].slice(-MAX_VISIBLE_TOASTS));
    return toast.id;
  }, []);

  return <ToastContext.Provider value={{ dismissToast, showToast }}>
    {children}
    <div className="toast-viewport" aria-label="Notifications">
      {toasts.map((toast) => <ToastItem dismissToast={dismissToast} key={toast.id} toast={toast} />)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider.');
  return context;
}
