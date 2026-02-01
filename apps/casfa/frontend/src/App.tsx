import { Routes, Route, Navigate } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import Clients from "./pages/Clients";
import Commits from "./pages/Commits";
import CommitDetail from "./pages/CommitDetail";
import Depots from "./pages/Depots";
import DepotDetail from "./pages/DepotDetail";
import DepotHistory from "./pages/DepotHistory";
import Tokens from "./pages/Tokens";
import Tickets from "./pages/Tickets";
import Users from "./pages/Users";
import AwpAuth from "./pages/AwpAuth";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    const returnUrl = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    return <Navigate to={`/login?returnUrl=${returnUrl}`} replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/auth/awp" element={<AwpAuth />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="agents" element={<Clients />} />
          <Route path="commits" element={<Commits />} />
          <Route path="commits/:root" element={<CommitDetail />} />
          <Route path="depots" element={<Depots />} />
          <Route path="depots/:depotId" element={<DepotDetail />} />
          <Route path="depots/:depotId/history" element={<DepotHistory />} />
          <Route path="tokens" element={<Tokens />} />
          <Route path="tickets" element={<Tickets />} />
          <Route path="users" element={<Users />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Box>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
