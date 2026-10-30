import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import ScrollToTop from "@/components/ScrollToTop";
import ScrollToHash from "@/components/ScrollToHash";
import Index from "./pages/Index";
import { PUBLIC_PAGES } from "./lib/seo";
import { createMetricsFilter } from "./lib/metrics-privacy.js";

const Pricing = lazy(() => import("./pages/Pricing"));
const Shared = lazy(() => import("./pages/Shared"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Open = lazy(() => import("./pages/Open"));
const Download = lazy(() => import("./pages/Download"));
const Billing = lazy(() => import("./pages/Billing"));
const CheckoutSuccess = lazy(() => import("./pages/CheckoutSuccess"));
const Compare = lazy(() => import("./pages/Compare"));
const Legal = lazy(() => import("./pages/Legal"));
const DeepDive = lazy(() => import("./pages/DeepDive"));

const publicMetricPaths = Object.keys(PUBLIC_PAGES);
const beforeSend = createMetricsFilter(publicMetricPaths);

/** Only public pages load metrics; the filter also protects later SDK history and pagehide events. */
export const Metrics = () => {
  const { pathname } = useLocation();
  if (!publicMetricPaths.includes(pathname)) return null;
  return (
    <>
      <Analytics beforeSend={beforeSend} />
      <SpeedInsights beforeSend={beforeSend} />
    </>
  );
};

const App = () => (
  <HelmetProvider>
    <BrowserRouter>
      <ScrollToTop />
      <ScrollToHash />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/checkout/success" element={<CheckoutSuccess />} />
          <Route path="/s/:id" element={<Shared />} />
          <Route path="/open/*" element={<Open />} />
          <Route path="/download" element={<Download />} />
          <Route path="/inside" element={<DeepDive />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/compare/superpowers" element={<Compare />} />
          <Route path="/compare/bmad-method" element={<Compare />} />
          <Route path="/compare/gsd" element={<Compare />} />
          <Route path="/compare/traycer" element={<Compare />} />
          <Route path="/compare/compound-engineering" element={<Compare />} />
          <Route path="/compare/claude-code-plan-mode" element={<Compare />} />
          <Route path="/compare/cursor-plan-mode" element={<Compare />} />
          <Route path="/compare/codex-plan-mode" element={<Compare />} />
          <Route path="/compare/humanlayer" element={<Compare />} />
          <Route path="/compare/spec-kit" element={<Compare />} />
          <Route path="/compare/openspec" element={<Compare />} />
          <Route path="/compare/kiro" element={<Compare />} />
          <Route path="/compare/task-master" element={<Compare />} />
          <Route path="/compare/cline" element={<Compare />} />
          <Route path="/compare/aider" element={<Compare />} />
          <Route path="/compare/github-copilot-coding-agent" element={<Compare />} />
          <Route path="/compare/devin" element={<Compare />} />
          <Route path="/compare/claude-squad" element={<Compare />} />
          <Route path="/compare/conductor" element={<Compare />} />
          <Route path="/best-spec-driven-development-tools" element={<Compare />} />
          <Route path="/imprint" element={<Legal />} />
          <Route path="/privacy" element={<Legal />} />
          <Route path="/terms" element={<Legal />} />
          {/* /docs is served by Docusaurus static files */}
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <Metrics />
    </BrowserRouter>
  </HelmetProvider>
);

export default App;
