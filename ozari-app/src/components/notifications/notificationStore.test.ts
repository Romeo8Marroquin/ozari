import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DURATION } from './notificationConfig';
import { useNotificationStore } from './notificationStore';

const reset = (): void => useNotificationStore.setState({ notifications: [] });
const list = () => useNotificationStore.getState().notifications;

beforeEach(reset);

describe('notificationStore', () => {
  it('push adds an item, returns its id, and applies defaults', () => {
    const id = useNotificationStore.getState().push({ message: 'Hola' });
    expect(id).toMatch(/^ntf-/);
    expect(list()).toHaveLength(1);
    expect(list()[0]).toMatchObject({ id, message: 'Hola', variant: 'success', duration: DEFAULT_DURATION });
  });

  it('push honours explicit variant + duration', () => {
    useNotificationStore.getState().push({ message: 'Err', variant: 'error', duration: 0 });
    expect(list()[0]).toMatchObject({ variant: 'error', duration: 0 });
  });

  it('push generates unique ids and appends in order', () => {
    const a = useNotificationStore.getState().push({ message: 'A' });
    const b = useNotificationStore.getState().push({ message: 'B' });
    expect(a).not.toBe(b);
    expect(list().map((n) => n.message)).toEqual(['A', 'B']);
  });

  it('dismiss removes only the matching id', () => {
    const a = useNotificationStore.getState().push({ message: 'A' });
    useNotificationStore.getState().push({ message: 'B' });
    useNotificationStore.getState().dismiss(a);
    expect(list().map((n) => n.message)).toEqual(['B']);
  });

  it('clear empties the queue', () => {
    useNotificationStore.getState().push({ message: 'A' });
    useNotificationStore.getState().clear();
    expect(list()).toHaveLength(0);
  });
});
