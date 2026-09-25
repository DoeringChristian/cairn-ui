import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Where the error is shown: inside a card's body, or as a whole card. */
  variant?: "body" | "card";
  /** A label for the console message. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Keeps one card's render error inside that card. Without it, an exception
 * from a chart library (e.g. Plotly's "Something went wrong with axis
 * scaling") reaches the route's error boundary and blanks the whole page.
 * "Retry" re-mounts the children.
 */
export default class CardErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[cairn] card error${this.props.label ? ` (${this.props.label})` : ""}`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const body = (
      <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center text-xs text-fg-muted">
        <span className="text-status-failed">This card failed to render.</span>
        <span className="mono max-w-full break-words text-fg-subtle">{error.message}</span>
        <button
          type="button"
          className="rounded border border-border px-2 py-0.5 text-fg hover:bg-bg-hover"
          onClick={() => this.setState({ error: null })}
        >
          Retry
        </button>
      </div>
    );
    return this.props.variant === "card" ? <div className="card flex min-h-[160px] flex-col p-4">{body}</div> : body;
  }
}
