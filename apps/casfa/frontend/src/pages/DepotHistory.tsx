import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  CircularProgress,
  Alert,
  Chip,
  Tooltip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import {
  ArrowBack as ArrowBackIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Refresh as RefreshIcon,
  History as HistoryIcon,
  Restore as RestoreIcon,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest } from "../utils/api";

// Depot record from API
interface DepotRecord {
  depotId: string;
  name: string;
  root: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  description?: string;
}

// History entry from API
interface HistoryEntry {
  version: number;
  root: string;
  createdAt: string;
  message?: string;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

function truncateKey(key: string, maxLength = 20): string {
  if (key.length <= maxLength) return key;
  return `${key.slice(0, 12)}...${key.slice(-6)}`;
}

export default function DepotHistory() {
  const { depotId } = useParams<{ depotId: string }>();
  const decodedDepotId = depotId ? decodeURIComponent(depotId) : "";
  const { getAccessToken, realm } = useAuth();
  const navigate = useNavigate();

  const [depot, setDepot] = useState<DepotRecord | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Rollback state
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);

  // Fetch depot and history
  const fetchData = useCallback(async () => {
    if (!realm || !decodedDepotId) return;

    try {
      setLoading(true);
      setError("");

      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      // Fetch depot info
      const depotResponse = await apiRequest(
        `/api/realm/${realm}/depots/${encodeURIComponent(decodedDepotId)}`,
        {},
        accessToken
      );

      if (!depotResponse.ok) {
        const errData = await depotResponse.json().catch(() => ({}));
        setError(errData.error || "Failed to load depot");
        return;
      }

      const depotData = await depotResponse.json();
      setDepot(depotData);

      // Fetch history
      const historyResponse = await apiRequest(
        `/api/realm/${realm}/depots/${encodeURIComponent(decodedDepotId)}/history?limit=50`,
        {},
        accessToken
      );

      if (historyResponse.ok) {
        const historyData = await historyResponse.json();
        setHistory(historyData.history || []);
      } else {
        const errData = await historyResponse.json().catch(() => ({}));
        setError(errData.error || "Failed to load history");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, realm, decodedDepotId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Copy key
  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Ignore clipboard errors
    }
  };

  // Rollback to version
  const handleRollback = async () => {
    if (!realm || !depot || rollbackVersion === null) return;

    try {
      setRolling(true);
      setError("");

      const accessToken = await getAccessToken();
      if (!accessToken) return;

      const response = await apiRequest(
        `/api/realm/${realm}/depots/${encodeURIComponent(depot.depotId)}/rollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: rollbackVersion }),
        },
        accessToken
      );

      if (response.ok) {
        const result = await response.json();
        setDepot(result);
        setRollbackDialogOpen(false);
        setRollbackVersion(null);
        // Reload history
        fetchData();
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to rollback");
      }
    } catch {
      setError("Network error");
    } finally {
      setRolling(false);
    }
  };

  // Navigate to tree view for a specific version
  const handleViewVersion = (entry: HistoryEntry) => {
    // Navigate to commit detail view with that root
    navigate(`/commits/${encodeURIComponent(entry.root)}`);
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3, display: "flex", alignItems: "center", gap: 2 }}>
        <IconButton onClick={() => navigate(`/depots/${decodedDepotId}`)}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flexGrow: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <HistoryIcon color="primary" />
            <Typography variant="h5" fontWeight={600}>
              {depot?.name || "Loading..."} - History
            </Typography>
            {depot && (
              <Chip
                label={`Current: v${depot.version}`}
                size="small"
                color="primary"
                variant="filled"
              />
            )}
          </Box>
          {depot?.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {depot.description}
            </Typography>
          )}
        </Box>
        <IconButton onClick={fetchData} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {/* Error alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Loading */}
      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* History list */}
      {!loading && history.length === 0 && (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <HistoryIcon sx={{ fontSize: 48, color: "text.secondary", mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            No history yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            History will appear here as you make changes to the depot.
          </Typography>
        </Paper>
      )}

      {!loading && history.length > 0 && (
        <Paper>
          <List disablePadding>
            {history.map((entry, index) => {
              const isCurrent = depot && entry.version === depot.version;
              return (
                <ListItem
                  key={entry.version}
                  disablePadding
                  divider={index < history.length - 1}
                  secondaryAction={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Tooltip title={copiedKey === entry.root ? "Copied!" : "Copy root key"}>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyKey(entry.root);
                          }}
                        >
                          {copiedKey === entry.root ? (
                            <CheckIcon fontSize="small" color="success" />
                          ) : (
                            <CopyIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                      {!isCurrent && (
                        <Tooltip title="Rollback to this version">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRollbackVersion(entry.version);
                              setRollbackDialogOpen(true);
                            }}
                          >
                            <RestoreIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  }
                >
                  <ListItemButton onClick={() => handleViewVersion(entry)}>
                    <ListItemIcon>
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          bgcolor: isCurrent ? "primary.main" : "grey.300",
                          color: isCurrent ? "primary.contrastText" : "text.secondary",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 600,
                          fontSize: "0.875rem",
                        }}
                      >
                        {entry.version}
                      </Box>
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Typography variant="subtitle1" fontWeight={isCurrent ? 600 : 400}>
                            Version {entry.version}
                          </Typography>
                          {isCurrent && (
                            <Chip label="current" size="small" color="primary" variant="outlined" />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box component="span" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                          {entry.message && (
                            <Typography variant="body2">{entry.message}</Typography>
                          )}
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(entry.createdAt)} • {truncateKey(entry.root, 30)}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Paper>
      )}

      {/* Rollback confirmation dialog */}
      <Dialog open={rollbackDialogOpen} onClose={() => setRollbackDialogOpen(false)}>
        <DialogTitle>Rollback to Version {rollbackVersion}?</DialogTitle>
        <DialogContent>
          <Typography>
            This will create a new version with the same content as version {rollbackVersion}.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            The current version will remain in history.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackDialogOpen(false)} disabled={rolling}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleRollback} disabled={rolling}>
            {rolling ? <CircularProgress size={20} /> : "Rollback"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
