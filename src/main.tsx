import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { LiveUpdatesProvider } from "./api/live-updates";
import { setSeriesSizeHint } from "./api/client";
import { qk } from "./api/query-keys";
import { catalogueSizeHint } from "./api/series-batch";
import type { SequenceMeta } from "./api/types";
import App from "./App";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectLayout from "./pages/ProjectLayout";
import RunsTablePage from "./pages/RunsTablePage";
import ComparePage from "./pages/compare/ComparePage";
import RunDetailPage from "./pages/RunDetailPage";
import RunOverviewTab from "./pages/RunOverviewTab";
import RunMetricsTab from "./pages/RunMetricsTab";
import RunLogsTab from "./pages/RunLogsTab";
import RunSourceTab from "./pages/RunSourceTab";
import RunEnvTab from "./pages/RunEnvTab";
import ReportsListPage from "./pages/ReportsListPage";
import ReportEditorPage from "./pages/ReportEditorPage";
import SweepsListPage from "./pages/SweepsListPage";
import SweepDetailPage from "./pages/SweepDetailPage";
import LoginPage from "./pages/LoginPage";
import ReportViewPage, { ShareRedeemPage } from "./pages/ReportViewPage";
import RouteError from "./components/RouteError";
import { installStaleBuildReload } from "./lib/stale-build";
import "./index.css";

// A page of an older build asks for chunks the server no longer has: reload once into the new build.
installStaleBuildReload();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Batched sequence reads size their requests by the run catalogues already loaded.
setSeriesSizeHint(catalogueSizeHint((runId) => queryClient.getQueryData<{ sequences: SequenceMeta[] }>(qk.sequences(runId))));

const router = createBrowserRouter([
  // Outside <App>'s Outlet on purpose: it must render usefully even when
  // every /api/* route except /api/auth/* and /api/health 401s.
  { path: "/login", element: <LoginPage /> },
  // Share links: outside <App> too — a share viewer gets the report alone,
  // with no app chrome, and can read nothing but that report's runs.
  { path: "/share/:secret", element: <ShareRedeemPage /> },
  { path: "/s/:reportId", element: <ReportViewPage /> },
  {
    path: "/",
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <ProjectsPage /> },
      // The settings-palette gallery (dev reference), code-split.
      { path: "_ui", lazy: () => import("./pages/UiGalleryPage").then((m) => ({ Component: m.default })) },
      {
        path: "p/:projectId",
        element: <ProjectLayout />,
        children: [
          { index: true, element: <RunsTablePage /> },
          { path: "compare", element: <ComparePage /> },
          // The artifact explorer and the lineage viewer are code-split
          // (React Flow loads only when a graph is shown).
          {
            path: "artifacts",
            lazy: () => import("./pages/artifacts/ExplorerLayout").then((m) => ({ Component: m.default })),
            children: [
              { index: true, lazy: () => import("./pages/artifacts/ExplorerLayout").then((m) => ({ Component: m.ArtifactsHome })) },
              { path: ":name", lazy: () => import("./pages/artifacts/ExplorerLayout").then((m) => ({ Component: m.FamilyRedirect })) },
              { path: ":name/:versionSeg", lazy: () => import("./pages/artifacts/VersionPage").then((m) => ({ Component: m.default })) },
              { path: ":name/:versionSeg/:tab", lazy: () => import("./pages/artifacts/VersionPage").then((m) => ({ Component: m.default })) },
            ],
          },
          { path: "lineage", lazy: () => import("./pages/LineagePage").then((m) => ({ Component: m.default })) },
          { path: "reports", element: <ReportsListPage /> },
          { path: "reports/:reportId", element: <ReportEditorPage /> },
          { path: "sweeps", element: <SweepsListPage /> },
          { path: "sweeps/:sweepId", element: <SweepDetailPage /> },
          { path: "defaults", lazy: () => import("./pages/DefaultsPage").then((m) => ({ Component: m.default })) },
          {
            path: "r/:runId",
            element: <RunDetailPage />,
            children: [
              { index: true, element: <RunOverviewTab /> },
              { path: "overview", element: <RunOverviewTab /> },
              { path: "metrics", element: <RunMetricsTab /> },
              { path: "logs", element: <RunLogsTab /> },
              { path: "source", element: <RunSourceTab /> },
              { path: "env", element: <RunEnvTab /> },
              { path: "artifacts", lazy: () => import("./pages/RunArtifactsTab").then((m) => ({ Component: m.default })) },
            ],
          },
        ],
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Above the router on purpose: ONE poller for the whole app, so
          navigating between pages never restarts it or doubles it up. */}
      <LiveUpdatesProvider>
        <RouterProvider router={router} />
      </LiveUpdatesProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
