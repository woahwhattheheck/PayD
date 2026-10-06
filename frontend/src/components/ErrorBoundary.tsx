import React from 'react';
import * as Sentry from '@sentry/react';

type ErrorBoundaryFallback =
  | React.ReactNode
  | ((props: { onReset: () => void }) => React.ReactNode);

type ErrorBoundaryProps = {
  fallback: ErrorBoundaryFallback;
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    Sentry.captureException(error, {
      extra: {
        componentStack: errorInfo.componentStack,
      },
    });
  }

  resetErrorBoundary = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback({ onReset: this.resetErrorBoundary })
        : this.props.fallback;
    }

    return this.props.children;
  }
}
