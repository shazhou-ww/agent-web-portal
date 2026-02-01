import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
  Fab,
  CircularProgress,
  Alert,
  Tooltip,
  Chip,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
} from "@mui/material";
import {
  Add as AddIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Refresh as RefreshIcon,
  MoreVert as MoreVertIcon,
  Delete as DeleteIcon,
  Inventory as DepotIcon,
  History as HistoryIcon,
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

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

function truncateKey(key: string, maxLength = 20): string {
  if (key.length <= maxLength) return key;
  return `${key.slice(0, 12)}...${key.slice(-6)}`;
}

export default function Depots() {
  const { getAccessToken, realm } = useAuth();
  const navigate = useNavigate();

  const [depots, setDepots] = useState<DepotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // New depot dialog
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // Context menu state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuDepot, setMenuDepot] = useState<DepotRecord | null>(null);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fetch depots
  const fetchDepots = useCallback(async () => {
    if (!realm) return;

    try {
      setLoading(true);
      setError("");

      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      const response = await apiRequest(`/api/realm/${realm}/depots`, {}, accessToken);
      if (response.ok) {
        const data = await response.json();
        setDepots(data.depots || []);
      } else if (response.status === 404) {
        setDepots([]);
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to load depots");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, realm]);

  useEffect(() => {
    fetchDepots();
  }, [fetchDepots]);

  // Copy key to clipboard
  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Ignore clipboard errors
    }
  };

  // Navigate to depot details (tree view)
  const handleDepotClick = (depot: DepotRecord) => {
    navigate(`/depots/${encodeURIComponent(depot.depotId)}`);
  };

  // Open context menu
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, depot: DepotRecord) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setMenuDepot(depot);
  };

  // Close context menu
  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuDepot(null);
  };

  // View history
  const handleHistoryClick = () => {
    if (menuDepot) {
      navigate(`/depots/${encodeURIComponent(menuDepot.depotId)}/history`);
    }
    handleMenuClose();
  };

  // Open delete dialog
  const handleDeleteClick = () => {
    setDeleteDialogOpen(true);
    setMenuAnchor(null);
  };

  // Submit delete
  const handleDeleteSubmit = async () => {
    if (!menuDepot || !realm) return;

    try {
      setDeleting(true);
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      const response = await apiRequest(
        `/api/realm/${realm}/depots/${encodeURIComponent(menuDepot.depotId)}`,
        { method: "DELETE" },
        accessToken
      );

      if (response.ok) {
        setDepots((prev) => prev.filter((d) => d.depotId !== menuDepot.depotId));
        setDeleteDialogOpen(false);
        setMenuDepot(null);
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to delete depot");
      }
    } catch {
      setError("Network error");
    } finally {
      setDeleting(false);
    }
  };

  // Create new depot
  const handleCreateDepot = async () => {
    if (!realm || !newName.trim()) return;

    try {
      setCreating(true);
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      const response = await apiRequest(
        `/api/realm/${realm}/depots`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newName.trim(),
            description: newDescription.trim() || undefined,
          }),
        },
        accessToken
      );

      if (response.ok) {
        const newDepot = await response.json();
        setDepots((prev) => [...prev, newDepot]);
        setShowNewDialog(false);
        setNewName("");
        setNewDescription("");
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to create depot");
      }
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  };

  // Filter depots (currently no search, but could add)
  const filteredDepots = depots;

  return (
    <Box>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="h4" fontWeight={600} gutterBottom>
            Depots
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Persistent named storage trees with version history
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={fetchDepots} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Error Alert */}
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

      {/* Empty State */}
      {!loading && filteredDepots.length === 0 && (
        <Paper
          sx={{
            p: 4,
            textAlign: "center",
            bgcolor: "background.paper",
          }}
        >
          <DepotIcon sx={{ fontSize: 48, color: "text.secondary", mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            No depots yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Create your first depot to start organizing files
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowNewDialog(true)}
          >
            Create Depot
          </Button>
        </Paper>
      )}

      {/* Depots List */}
      {!loading && filteredDepots.length > 0 && (
        <Paper sx={{ overflow: "hidden" }}>
          <List disablePadding>
            {filteredDepots.map((depot, index) => (
              <ListItem
                key={depot.depotId}
                disablePadding
                divider={index < filteredDepots.length - 1}
                secondaryAction={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Tooltip title={copiedKey === depot.root ? "Copied!" : "Copy root key"}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyKey(depot.root);
                        }}
                      >
                        {copiedKey === depot.root ? (
                          <CheckIcon fontSize="small" color="success" />
                        ) : (
                          <CopyIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                    <IconButton
                      size="small"
                      onClick={(e) => handleMenuOpen(e, depot)}
                      disabled={depot.name === "main"}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Box>
                }
              >
                <ListItemButton onClick={() => handleDepotClick(depot)}>
                  <ListItemIcon>
                    <DepotIcon color={depot.name === "main" ? "primary" : "action"} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="subtitle1" fontWeight={500}>
                          {depot.name}
                        </Typography>
                        {depot.name === "main" && (
                          <Chip label="default" size="small" color="primary" variant="outlined" />
                        )}
                        <Chip
                          label={`v${depot.version}`}
                          size="small"
                          variant="outlined"
                          sx={{ ml: 1 }}
                        />
                      </Box>
                    }
                    secondary={
                      <Box
                        component="span"
                        sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 0.5 }}
                      >
                        {depot.description && (
                          <Typography variant="body2" color="text.secondary">
                            {depot.description}
                          </Typography>
                        )}
                        <Typography variant="caption" color="text.secondary">
                          Root: {truncateKey(depot.root)} • Updated {formatDate(depot.updatedAt)}
                        </Typography>
                      </Box>
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      {/* FAB for new depot */}
      <Fab
        color="primary"
        aria-label="create depot"
        sx={{ position: "fixed", bottom: 24, right: 24 }}
        onClick={() => setShowNewDialog(true)}
      >
        <AddIcon />
      </Fab>

      {/* Context Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={handleHistoryClick}>
          <ListItemIcon>
            <HistoryIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View History</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleDeleteClick} sx={{ color: "error.main" }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* New Depot Dialog */}
      <Dialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create New Depot</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Name"
            fullWidth
            variant="outlined"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g., backup, workspace"
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Description (optional)"
            fullWidth
            variant="outlined"
            multiline
            rows={2}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="What is this depot for?"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowNewDialog(false)}>Cancel</Button>
          <Button
            onClick={handleCreateDepot}
            variant="contained"
            disabled={creating || !newName.trim()}
          >
            {creating ? <CircularProgress size={20} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Depot</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete depot "{menuDepot?.name}"?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This will remove the depot reference. The actual files will remain until garbage
            collected.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDeleteSubmit}
            color="error"
            variant="contained"
            disabled={deleting}
          >
            {deleting ? <CircularProgress size={20} /> : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
