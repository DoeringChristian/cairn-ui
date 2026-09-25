/**
 * Embed entry — renders ONE viewer card standalone in an iframe.
 *
 * A second vite entry (alongside main.tsx / index.html), wired into
 * vite.config.ts as a rollup input so `vite build` emits `embed.html`
 * beside `index.html`. Minimal by design: a `QueryClientProvider` plus a
 * single `ComparisonCardView` — no App chrome, nav, or router.
 *
 * The card is described by a spec fetched from `/api/embed/specs/:sid`
 * (`?sid=` in the URL). A spec is a viewer `ComparisonCard`
 * (`{type, series:[{runId, name}]}`), rendered by the same
 * `ComparisonCardView` comparisons and reports use, so `three` stays lazy.
 *
 * Auto-height: cards take a fixed px height from `CardShell`, so a host that
 * wants to size its iframe to the content needs a signal. We emit the same
 * `{type:"cairn:resize", height, protocolVersion:1}` postMessage the HTML /
 * plugin cards use (see `card-kit/use-iframe-auto-height.ts` for the host
 * side), measuring the rendered card via a `ResizeObserver`.
 *
 * Local / same-origin only: cross-origin hosts would need a per-sid
 * capability token, a server CORS allowlist, and a narrowed
 * `postMessage("*")` target.
 */

import React, { Component, useMemo, useRef, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ComparisonCardView from "./components/comparison/ComparisonCardView";
import { cardSettingsKeyForScope } from "./lib/comparisons";
import type { CardSpec } from "./lib/cards/card-spec";
import { CardMutationContext, saveCardOverrides, type CardOverrides } from "./lib/card-settings";
import { CascadeScopeContext } from "./lib/settings-scope";
import { useEmitAutoHeight } from "./lib/use-emit-auto-height";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Synthetic scope id for the embed's per-card settings key (mirrors the
// report scope's use of the report id — see cardSettingsKeyForScope).
const EMBED_SCOPE = "embed";

interface EmbedSpecResponse {
  sid: string;
  spec: CardSpec;
}

/**
 * Error boundary so a card render failure surfaces a readable message inside
 * the iframe instead of a blank page (and still lets the host size to it).
 */
class EmbedErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div data-cairn-card className="card p-4 text-sm text-red-400">
          Embed render error: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

/** Render one card from its spec. */
function EmbeddedCard({ card }: { card: CardSpec }) {
  // Give the card a stable id for its settings key, and seed its stored
  // overrides from `spec.settings` synchronously, here in the parent's
  // render, so the card's first render already reads them.
  // `cardSettingsKeyForScope(EMBED_SCOPE, ...)` is the embed's own scope and
  // never touches a user's comparison/report settings.
  const cardWithId = useMemo<CardSpec>(() => {
    const withId: CardSpec = card.id ? card : { ...card, id: `${EMBED_SCOPE}-card` };
    saveCardOverrides(cardSettingsKeyForScope(EMBED_SCOPE, withId), (card.settings ?? null) as CardOverrides | null);
    return withId;
  }, [card]);

  // Read-only, and built-in defaults only: an embed looks the same to every
  // viewer, who can still explore it (session-only, see lib/card-settings.ts).
  return (
    <CardMutationContext.Provider value={false}>
      <CascadeScopeContext.Provider value="builtin-only">
        <ComparisonCardView card={cardWithId} settingsKey={cardSettingsKeyForScope(EMBED_SCOPE, cardWithId)} />
      </CascadeScopeContext.Provider>
    </CardMutationContext.Provider>
  );
}

function EmbedApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  useEmitAutoHeight(containerRef);

  const sid = useMemo(
    () => new URLSearchParams(window.location.search).get("sid"),
    [],
  );

  const query = useQuery({
    queryKey: ["embed-spec", sid],
    enabled: !!sid,
    queryFn: async (): Promise<EmbedSpecResponse> => {
      const res = await fetch(`/api/embed/specs/${sid}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as EmbedSpecResponse;
    },
  });

  let body: React.ReactNode;
  if (!sid) {
    body = <div className="card p-4 text-sm text-fg-muted">Missing ?sid= parameter.</div>;
  } else if (query.isLoading) {
    body = <div className="card p-4 text-sm text-fg-muted">Loading…</div>;
  } else if (query.isError || !query.data) {
    body = <div className="card p-4 text-sm text-red-400">Failed to load embed spec.</div>;
  } else {
    body = (
      <EmbedErrorBoundary>
        <EmbeddedCard card={query.data.spec} />
      </EmbedErrorBoundary>
    );
  }

  // Single-column CSS grid: a card's `gridColumn: span N` (from CardShell)
  // is clamped to the available track count, so one column makes the card
  // full-width regardless of its persisted colSpan.
  return (
    <div
      ref={containerRef}
      className="p-2"
      style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }}
    >
      {body}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("embed-root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/*
       * MemoryRouter (not BrowserRouter): cards reuse viewer components that
       * call react-router hooks deep in the tree (e.g. AddToComparisonButton),
       * which throw without a Router context. The embed shows
       * NO nav/routing — this just satisfies that context in memory so the
       * card renders. In the SPA these hooks get their context from the
       * app's RouterProvider; the embed provides an equivalent here.
       */}
      <MemoryRouter>
        <EmbedApp />
      </MemoryRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
