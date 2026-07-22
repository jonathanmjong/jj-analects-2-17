import { Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/layout/Shell";
import { RequireSubscription } from "./components/layout/RequireSubscription";
import { LoginPage } from "./pages/LoginPage";
import { BillingPage } from "./pages/BillingPage";
import { HomePage } from "./pages/HomePage";
import { RankingsPage } from "./pages/RankingsPage";
import { CompanyPage } from "./pages/CompanyPage";
import { ComparePage } from "./pages/ComparePage";
import { SectorsOverviewPage } from "./pages/SectorsOverviewPage";
import { SectorDetailPage } from "./pages/SectorDetailPage";
import { AdminPage } from "./pages/AdminPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/admin" element={<AdminPage />} />

        <Route element={<RequireSubscription />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="/company/:ticker" element={<CompanyPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/sectors" element={<SectorsOverviewPage />} />
          <Route path="/sectors/:sector" element={<SectorDetailPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
