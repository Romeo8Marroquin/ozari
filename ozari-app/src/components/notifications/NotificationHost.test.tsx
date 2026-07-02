import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Isolate the host from the toast's animation internals (the toast has its own test).
vi.mock('./NotificationToast', () => ({
  default: ({ item }: { item: { message: string } }) => <div data-testid="toast">{item.message}</div>,
}));

import NotificationHost from './NotificationHost';
import { useNotificationStore } from './notificationStore';

beforeEach(() => useNotificationStore.setState({ notifications: [] }));

describe('NotificationHost', () => {
  it('renders a toast for each queued notification', () => {
    useNotificationStore.setState({
      notifications: [
        { id: '1', message: 'Uno', variant: 'success', duration: 0 },
        { id: '2', message: 'Dos', variant: 'error', duration: 0 },
      ],
    });
    render(<NotificationHost />);
    expect(screen.getAllByTestId('toast')).toHaveLength(2);
    expect(screen.getByText('Uno')).toBeInTheDocument();
    expect(screen.getByText('Dos')).toBeInTheDocument();
  });

  it('renders no toasts when the queue is empty', () => {
    render(<NotificationHost />);
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });
});
