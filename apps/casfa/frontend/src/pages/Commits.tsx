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
} from "@mui/material";
import {
  Add as AddIcon,
  Folder as FolderIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  History as HistoryIcon,
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
                }
              >
                <ListItemButton onClick={() => handleCommitClick(commit)}>
                  <ListItemIcon>
                    <FolderIcon color="primary" />
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
