import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Error captured by boundary — no console.error in production.
    // PostHog or other analytics can be wired here if needed.
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-screen items-center justify-center"
          style={{ background: "hsl(225 25% 4%)" }}
        >
          <div className="text-center px-6">
            <h1
              className="mb-4 font-display text-2xl"
              style={{ fontWeight: 800, color: "hsl(40 20% 95%)" }}
            >
              Something went wrong
            </h1>
            <p className="mb-6 text-base text-muted-foreground font-light">
              An unexpected error occurred.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-block px-8 py-3 rounded-xl bg-primary text-primary-foreground font-display font-semibold text-sm"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
