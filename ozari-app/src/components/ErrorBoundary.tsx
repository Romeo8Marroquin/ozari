import { Component, type ErrorInfo, type ReactNode } from 'react';
import ErrorScreen from './ErrorScreen';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * The app's last line of defense against **render-time** crashes (a component throwing during
 * render/commit) — distinct from HTTP errors, which the axios interceptor handles. When a subtree
 * throws, React unmounts it and we show the on-brand {@link ErrorScreen} instead of a white page.
 *
 * Recovery is a full reload: a render crash usually leaves state inconsistent, so a clean boot is
 * the honest reset. (Route *loader* errors are handled separately by the router's error slot, which
 * can retry in place without a reload.)
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorScreen variant="crash" onAction={this.handleReset} />;
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
