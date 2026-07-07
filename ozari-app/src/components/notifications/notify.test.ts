import { beforeEach, describe, expect, it } from 'vitest';
import { notify } from './notify';
import { useNotificationStore } from './notificationStore';

const list = () => useNotificationStore.getState().notifications;

beforeEach(() => useNotificationStore.setState({ notifications: [] }));

describe('notify', () => {
  it.each(['success', 'error', 'warning', 'info'] as const)(
    'notify.%s pushes a %s-variant toast with the message',
    (variant) => {
      notify[variant]('Mensaje');
      expect(list()[0]).toMatchObject({ variant, message: 'Mensaje' });
    },
  );

  it('forwards options (e.g. title)', () => {
    notify.success('Listo', { title: 'Título' });
    expect(list()[0]).toMatchObject({ title: 'Título', variant: 'success' });
  });

  it('push/dismiss/clear delegate to the store', () => {
    const id = notify.push({ message: 'A', variant: 'info' });
    expect(list()).toHaveLength(1);
    notify.dismiss(id);
    expect(list()).toHaveLength(0);

    notify.error('B');
    notify.clear();
    expect(list()).toHaveLength(0);
  });
});
