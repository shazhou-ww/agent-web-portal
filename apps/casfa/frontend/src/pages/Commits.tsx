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
  TextField,
  InputAdornment,
  Tooltip,
  Chip,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from "@mui/material";
import {
  Add as AddIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  History as HistoryIcon,
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Commit as CommitIcon,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest } from "../utils/api";
import NewCommitDialog from "../components/NewCommitDialog";

// Commit record from API
interface CommitRecord {
  root: string;
  title?: string;
  createdAt: string;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

function truncateKey(key: string, maxLength = 20): string {
  if (key.length <= maxLength) return key;
  return `${key.slice(0, 12)}...${key.slice(-6)}`;
}

export default function Commits() {
  const { getAccessToken, realm } = useAuth();
  const navigate = useNavigate();

  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // New commit dialog
  const [showNewCommitDialog, setShowNewCommitDialog] = useState(false);

  // Context menu state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuCommit, setMenuCommit] = useState<CommitRecord | null>(null);

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fetch commits
  const fetchCommits = useCallback(async () => {
    if (!realm) return;

    try {
      setLoading(true);
      setError("");

      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      const response = await apiRequest(`/api/realm/${realm}/commits?limit=100`, {}, accessToken);
      if (response.ok) {
        const data = await response.json();
        setCommits(data.commits || []);
      } else if (response.status === 404) {
        setCommits([]);
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to load commits");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, realm]);

  useEffect(() => {
    fetchCommits();
  }, [fetchCommits]);

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

  // Navigate to commit details (tree view)
  const handleCommitClick = (commit: CommitRecord) => {
    navigate(`/commits/${encodeURIComponent(commit.root)}`);
  };

  // Open context menu
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, commit: CommitRecord) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setMenuCommit(commit);
  };

  // Close context menu
  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuCommit(null);
  };

  // Open rename dialog
  const handleRenameClick = () => {
    if (menuCommit) {
      setRenameTitle(menuCommit.title || "");
      setRenameDialogOpen(true);
    }
    handleMenuClose();
  };

  // Submit rename
  const handleRenameSubmit = async () => {
    if (!menuCommit || !realm) return;

    try {
      setRenaming(true);
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      const response = await apiRequest(
        `/api/realm/${realm}/commits/${encodeURIComponent(menuCommit.root)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: renameTitle.trim() || null }),
        },
        accessToken
      );

      if (response.ok) {
        // Update local state
        setCommits((prev) =>
          prev.map((c) =>
            c.root === menuCommit.root ? { ...c, title: renameTitle.trim() || undefined } : c
          )
        );
        setRenameDialogOpen(false);
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to rename commit");
      }
    } catch {
      setError("Network error");
    } finally {
      setRenaming(false);
    }
  };

  // Open delete dialog
  const handleDeleteClick = () => {
    setDeleteDialogOpen(true);
    handleMenuClose();
  };

  // Submit delete
  const handleDeleteSubmit = async () => {
    if (!menuCommit || !realm) return;

    try {
      setDeleting(true);
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      const response = await apiRequest(
        `/api/realm/${realm}/commits/${encodeURIComponent(menuCommit.root)}`,
        { method: "DELETE" },
        accessToken
      );

      if (response.ok) {
        // Remove from local state
        setCommits((prev) => prev.filter((c) => c.root !== menuCommit.root));
        setDeleteDialogOpen(false);
        setMenuCommit(null);
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to delete commit");
      }
    } catch {
      setError("Network error");
    } finally {
      setDeleting(false);
    }
  };

  // Filter commits by search
  const filteredCommits = commits.filter(
    (c) =>
      !searchQuery ||
      c.root.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.title?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
  );

  return (
    <Box sx={{ height: "calc(100vh - 140px)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={600} gutterBottom>
          Commits
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Browse and manage your committed content
        </Typography>
      </Box>

      {/* Toolbar */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        {/* Search */}
        <TextField
          size="small"
          placeholder="Search commits..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ width: 300 }}
        />

        <Box sx={{ flexGrow: 1 }} />

        {/* Refresh button */}
        <IconButton onClick={fetchCommits} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {/* Error alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Commits list */}
      <Paper variant="outlined" sx={{ flex: 1, overflow: "auto" }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: 200 }}>
            <CircularProgress />
          </Box>
        ) : filteredCommits.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: 300,
              color: "text.secondary",
            }}
          >
            <HistoryIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
            <Typography variant="h6" gutterBottom>
              {commits.length === 0 ? "No commits yet" : "No matching commits"}
            </Typography>
            <Typography variant="body2">
              {commits.length === 0
                ? "Click the + button to create your first commit"
                : "Try a different search term"}
            </Typography>
          </Box>
        ) : (
          <List>
            {filteredCommits.map((commit) => (
              <ListItem
                key={commit.root}
                disablePadding
                secondaryAction={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Tooltip title={copiedKey === commit.root ? "Copied!" : "Copy key"}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyKey(commit.root);
                        }}
                      >
                        {copiedKey === commit.root ? (
                          <CheckIcon fontSize="small" color="success" />
                        ) : (
                          <CopyIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="More actions">
                      <IconButton
                        size="small"
                        onClick={(e) => handleMenuOpen(e, commit)}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                }
              >
                <ListItemButton onClick={() => handleCommitClick(commit)}>
                  <ListItemIcon>
                    <CommitIcon color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="body1" fontWeight={500}>
                          {commit.title || "Untitled Commit"}
                        </Typography>
                        <Chip
                          label={truncateKey(commit.root)}
                          size="small"
                          variant="outlined"
                          sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}
                        />
                      </Box>
                    }
                    secondary={formatDate(commit.createdAt)}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

      {/* Context menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleRenameClick}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Rename</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleDeleteClick} sx={{ color: "error.main" }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Rename dialog */}
      <Dialog open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Rename Commit</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Title"
            placeholder="Enter a title for this commit"
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !renaming) handleRenameSubmit();
            }}
            disabled={renaming}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)} disabled={renaming}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleRenameSubmit} disabled={renaming}>
            {renaming ? "Saving..." : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Commit?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this commit?
          </Typography>
          {menuCommit && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {menuCommit.title || "Untitled Commit"}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
            Note: This only removes the commit record. The underlying data will not be deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteSubmit}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* FAB for new commit */}
      <Fab
        color="primary"
        sx={{
          position: "fixed",
          bottom: 32,
          right: 32,
        }}
        onClick={() => setShowNewCommitDialog(true)}
      >
        <AddIcon />
      </Fab>

      {/* New commit dialog */}
      <NewCommitDialog
        open={showNewCommitDialog}
        onClose={() => setShowNewCommitDialog(false)}
        onSuccess={fetchCommits}
      />
    </Box>
  );
}
