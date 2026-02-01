import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
  Snackbar,
} from "@mui/material";
import {
  Key as KeyIcon,
  Storage as StorageIcon,
  TrendingUp as TrendingUpIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Link as LinkIcon,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest } from "../utils/api";

interface DashboardStats {
  agentTokenCount: number;
  nodeCount: number | string;
  totalSize: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ title, value, icon, color }: StatCardProps) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 2,
              background: `${color}15`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color,
            }}
          >
            {icon}
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              {title}
            </Typography>
            <Typography variant="h5" fontWeight={600}>
              {value}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { getAccessToken, userRole, realm } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Get the endpoint URL (current origin + /api/)
  // Note: trailing slash is required for CloudFront routing
  const endpointUrl = `${window.location.origin}/api/`;

  const handleCopyEndpoint = async () => {
    try {
      await navigator.clipboard.writeText(endpointUrl);
      setCopied(true);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const fetchStats = useCallback(async () => {
    if (!realm) return; // Wait for realm to be loaded
    
    try {
      setLoading(true);
      setError("");

      const token = await getAccessToken();
      if (!token) {
        setError("Not authenticated");
        return;
      }

      // Fetch agent tokens count
      const tokensResponse = await apiRequest("/api/auth/tokens", {}, token);

      let agentTokenCount = 0;
      if (tokensResponse.ok) {
        const tokensData = await tokensResponse.json();
        agentTokenCount = tokensData.tokens?.length || 0;
      }

      // Fetch nodes stats - get first page to count
      const nodesResponse = await apiRequest(`/api/realm/${realm}/nodes?limit=100`, {}, token);

      let nodeCount: number | string = 0;
      let totalSize = 0;
      if (nodesResponse.ok) {
        const nodesData = await nodesResponse.json();
        const nodes = nodesData.nodes || [];
        nodeCount = nodes.length;
        totalSize = nodes.reduce(
          (sum: number, node: { size?: number }) => sum + (node.size || 0),
          0
        );
        // Note: This is an approximation - only counts first 100 nodes
        if (nodesData.nextKey) {
          nodeCount = `${nodeCount}+`; // Indicate there are more
        }
      }

      setStats({
        agentTokenCount,
        nodeCount,
        totalSize,
      });
    } catch (err) {
      console.error("Failed to fetch stats:", err);
      setError("Failed to load dashboard statistics");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, realm]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={600} gutterBottom>
          Dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Overview of your Content Addressable Storage
        </Typography>
      </Box>

      {/* Endpoint URL Card */}
      <Card
        sx={{
          mb: 3,
          background: "linear-gradient(135deg, #1976d2 0%, #7c4dff 100%)",
          color: "white",
        }}
      >
        <CardContent sx={{ py: 3 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
            <LinkIcon />
            <Typography variant="h6" fontWeight={600}>
              CAS API Endpoint
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ opacity: 0.9, mb: 2 }}>
            Use this URL to configure your AI agent for content-addressable storage
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              bgcolor: "rgba(255,255,255,0.15)",
              borderRadius: 2,
              px: 2,
              py: 1.5,
            }}
          >
            <Typography
              variant="body1"
              sx={{
                fontFamily: "monospace",
                fontSize: "1.1rem",
                flexGrow: 1,
                wordBreak: "break-all",
              }}
            >
              {endpointUrl}
            </Typography>
            <Tooltip title={copied ? "Copied!" : "Copy to clipboard"}>
              <IconButton
                onClick={handleCopyEndpoint}
                sx={{
                  color: "white",
                  bgcolor: "rgba(255,255,255,0.2)",
                  "&:hover": { bgcolor: "rgba(255,255,255,0.3)" },
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </CardContent>
      </Card>

      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message="Endpoint URL copied to clipboard"
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />

      {userRole === "unauthorized" && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Your account is not authorized. Some features are unavailable. Please contact an administrator.
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={4}>
          <StatCard
            title="Agent Tokens"
            value={stats?.agentTokenCount || 0}
            icon={<KeyIcon sx={{ fontSize: 28 }} />}
            color="#1976d2"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <StatCard
            title="Total Nodes"
            value={stats?.nodeCount || 0}
            icon={<StorageIcon sx={{ fontSize: 28 }} />}
            color="#7c4dff"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <StatCard
            title="Total Size"
            value={formatBytes(stats?.totalSize || 0)}
            icon={<TrendingUpIcon sx={{ fontSize: 28 }} />}
            color="#4caf50"
          />
        </Grid>
      </Grid>

      <Box sx={{ mt: 4 }}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Quick Start
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Welcome to the CAS Management Console. Here you can:
            </Typography>
            <Box component="ul" sx={{ pl: 2, mb: 0 }}>
              <Typography component="li" variant="body2" color="text.secondary">
                <strong>Agent Tokens</strong> - Create and manage API tokens for
                your agents
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                <strong>Nodes</strong> - Browse and manage stored content nodes
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
