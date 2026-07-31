import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/layout/Shell";
import { RequireSubscription } from "./components/layout/RequireSubscription";
import { RootRoute } from "./components/layout/RootRoute";
import { Spinner } from "./components/ui/Spinner";
import { captureReferralFromUrl } from "./lib/referral";

const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const BillingPage = lazy(() => import("./pages/BillingPage").then((m) => ({ default: m.BillingPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const RankingsPage = lazy(() => import("./pages/RankingsPage").then((m) => ({ default: m.RankingsPage })));
const CompanyPage = lazy(() => import("./pages/CompanyPage").then((m) => ({ default: m.CompanyPage })));
const ComparePage = lazy(() => import("./pages/ComparePage").then((m) => ({ default: m.ComparePage })));
const SectorsOverviewPage = lazy(() =>
  import("./pages/SectorsOverviewPage").then((m) => ({ default: m.SectorsOverviewPage })),
);
const SectorDetailPage = lazy(() =>
  import("./pages/SectorDetailPage").then((m) => ({ default: m.SectorDetailPage })),
);
const WatchlistPage = lazy(() => import("./pages/WatchlistPage").then((m) => ({ default: m.WatchlistPage })));
const SentimentPage = lazy(() => import("./pages/SentimentPage").then((m) => ({ default: m.SentimentPage })));
const PreviewPage = lazy(() => import("./pages/PreviewPage").then((m) => ({ default: m.PreviewPage })));
const ComparisonPage = lazy(() => import("./pages/ComparisonPage").then((m) => ({ default: m.ComparisonPage })));

function PageFallback() {
  return (
    <div className="flex h-[50vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

export default function App() {
  useEffect(() => {
    captureReferralFromUrl();
  }, []);

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Not wrapped in Shell — these have their own minimal header/footer, no app sidebar. */}
        <Route path="/" element={<RootRoute />} />
        <Route path="/preview" element={<PreviewPage />} />
        <Route path="/vs/:competitor" element={<ComparisonPage />} />

        <Route element={<Shell />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/admin" element={<AdminPage />} />

          <Route element={<RequireSubscription />}>
            <Route path="/rankings" element={<RankingsPage />} />
            <Route path="/company/:ticker" element={<CompanyPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/sectors" element={<SectorsOverviewPage />} />
            <Route path="/sectors/:sector" element={<SectorDetailPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/sentiment" element={<SentimentPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
