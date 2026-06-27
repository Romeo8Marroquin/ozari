import { useNotificationStore, type NotificationInput } from './notificationStore';

type Options = Omit<NotificationInput, 'message' | 'variant'>;

/**
 * Imperative notification API usable from anywhere — React components, React Query
 * `onSuccess`/`onError`, the axios interceptor, etc. It reads the store via
 * `getState()`, so it does not need to be called inside a component.
 *
 * @example
 * notify.success(t('modules.sesion.register.api.registerSuccessToast'), {
 *   title: t('modules.sesion.register.api.registerSuccessTitle'),
 * });
 */
export const notify = {
  push: (input: NotificationInput): string => useNotificationStore.getState().push(input),
  success: (message: string, options?: Options): string =>
    useNotificationStore.getState().push({ ...options, message, variant: 'success' }),
  error: (message: string, options?: Options): string =>
    useNotificationStore.getState().push({ ...options, message, variant: 'error' }),
  warning: (message: string, options?: Options): string =>
    useNotificationStore.getState().push({ ...options, message, variant: 'warning' }),
  info: (message: string, options?: Options): string =>
    useNotificationStore.getState().push({ ...options, message, variant: 'info' }),
  dismiss: (id: string): void => useNotificationStore.getState().dismiss(id),
  clear: (): void => useNotificationStore.getState().clear(),
};
