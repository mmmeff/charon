import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  componentStack: string;
  crashedAt: string | null;
};

function formatError(error: Error, componentStack: string, crashedAt: string | null) {
  const sections = [
    `Time: ${crashedAt ?? "unknown"}`,
    `Name: ${error.name || "Error"}`,
    `Message: ${error.message || "(no message)"}`,
  ];
  if (error.stack) sections.push(`Stack:\n${error.stack}`);
  if (componentStack.trim()) sections.push(`React component stack:${componentStack}`);
  return sections.join("\n\n");
}

function CrashFallback({
  error,
  componentStack,
  crashedAt,
}: {
  error: Error;
  componentStack: string;
  crashedAt: string | null;
}) {
  return (
    <main className="crash-screen" role="alert" aria-live="assertive">
      <div className="crash-panel">
        <div className="crash-kicker">render failure</div>
        <h1>Sorry, Charon crashed.</h1>
        <p>
          The app hit an unexpected UI error. Reloading is the fastest way back, and the crash
          details below can help debug what happened.
        </p>
        <div className="crash-actions">
          <button className="primary" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </div>
        <details className="crash-details">
          <summary>Show crash details</summary>
          <pre>{formatError(error, componentStack, crashedAt)}</pre>
        </details>
      </div>
    </main>
  );
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
    componentStack: "",
    crashedAt: null,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, crashedAt: new Date().toISOString() };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught render error", error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack ?? "" });
  }

  render() {
    if (this.state.error) {
      return (
        <CrashFallback
          error={this.state.error}
          componentStack={this.state.componentStack}
          crashedAt={this.state.crashedAt}
        />
      );
    }
    return this.props.children;
  }
}
