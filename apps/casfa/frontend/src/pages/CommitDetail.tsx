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
  Breadcrumbs,
  Link,
  Chip,
  Tooltip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Home as HomeIcon,
  ArrowBack as ArrowBackIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest, API_URL } from "../utils/api";

// Tree node from API
interface TreeNode {
  kind: "collection" | "file" | "chunk";
  key: string;
  size: number;
  contentType?: string;
  children?: Record<string, TreeNode>;
}

// Navigation path item
interface PathItem {
  key: string;
  name: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

function truncateKey(key: string, maxLength = 20): string {
  if (key.length <= maxLength) return key;
  return `${key.slice(0, 12)}...${key.slice(-6)}`;
}

function getContentTypeColor(
  contentType: string
): "default" | "primary" | "secondary" | "success" | "warning" | "error" | "info" {
  if (contentType.startsWith("image/")) return "success";
  if (contentType.startsWith("video/")) return "secondary";
  if (contentType.startsWith("audio/")) return "warning";
  if (contentType.startsWith("text/")) return "info";
  if (contentType === "application/json") return "primary";
  return "default";
}

export default function CommitDetail() {
  const { root } = useParams<{ root: string }>();
  const decodedRoot = root ? decodeURIComponent(root) : "";
  const { getAccessToken, realm } = useAuth();
  const navigate = useNavigate();

  const [tree, setTree] = useState<TreeNode | null>(null);
  const [currentPath, setCurrentPath] = useState<PathItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Commit metadata
  const [commitTitle, setCommitTitle] = useState<string>("");

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fetch tree and commit metadata
  const fetchTree = useCallback(async () => {
    if (!realm || !decodedRoot) return;

    try {
      setLoading(true);
      setError("");

      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      // Fetch tree and commit details in parallel
      const [treeResponse, commitResponse] = await Promise.all([
        apiRequest(
          `/api/realm/${realm}/tree/${encodeURIComponent(decodedRoot)}`,
          {},
          accessToken
        ),
        apiRequest(
          `/api/realm/${realm}/commits/${encodeURIComponent(decodedRoot)}`,
          {},
          accessToken
        ),
      ]);

      if (treeResponse.ok) {
        const data = await treeResponse.json();
        setTree(data);
      } else {
        const errData = await treeResponse.json().catch(() => ({}));
        setError(errData.error || "Failed to load tree");
      }

      if (commitResponse.ok) {
        const commitData = await commitResponse.json();
        setCommitTitle(commitData.title || "");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, realm, decodedRoot]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Get current node based on path
  const getCurrentNode = useCallback((): TreeNode | null => {
    if (!tree) return null;
    if (currentPath.length === 0) return tree;

    let current: TreeNode | undefined = tree;
    for (const item of currentPath) {
      if (!current?.children) return null;
      // Find child by key
      let foundNode: TreeNode | undefined;
      for (const [, node] of Object.entries(current.children)) {
        if (node.key === item.key) {
          foundNode = node;
          break;
        }
      }
      if (!foundNode) return null;
      current = foundNode;
    }
    return current || null;
  }, [tree, currentPath]);

  // Navigate into folder
  const navigateToFolder = (name: string, node: TreeNode) => {
    setCurrentPath((prev) => [...prev, { key: node.key, name }]);
  };

  // Navigate to path index
  const navigateToPathIndex = (index: number) => {
    if (index < 0) {
      setCurrentPath([]);
    } else {
      setCurrentPath((prev) => prev.slice(0, index + 1));
    }
  };

  // Go back
  const goBack = () => {
    if (currentPath.length > 0) {
      setCurrentPath((prev) => prev.slice(0, -1));
    } else {
      navigate("/commits");
    }
  };

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

  // Download file
  const handleDownload = async (name: string, node: TreeNode) => {
    if (!realm) return;

    try {
      setDownloading(node.key);

      const accessToken = await getAccessToken();
      if (!accessToken) return;

      const response = await fetch(
        `${API_URL}/api/realm/${realm}/chunks/${encodeURIComponent(node.key)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch {
      // Ignore download errors
    } finally {
      setDownloading(null);
    }
  };

  // Open rename dialog
  const handleRenameClick = () => {
    setRenameTitle(commitTitle);
    setRenameDialogOpen(true);
  };

  // Submit rename
  const handleRenameSubmit = async () => {
    if (!realm || !decodedRoot) return;

    try {
      setRenaming(true);
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      const response = await apiRequest(
        `/api/realm/${realm}/commits/${encodeURIComponent(decodedRoot)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: renameTitle.trim() || null }),
        },
        accessToken
      );

      if (response.ok) {
        setCommitTitle(renameTitle.trim());
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

  // Submit delete
  const handleDeleteSubmit = async () => {
    if (!realm || !decodedRoot) return;

    try {
      setDeleting(true);
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      const response = await apiRequest(
        `/api/realm/${realm}/commits/${encodeURIComponent(decodedRoot)}`,
        { method: "DELETE" },
        accessToken
      );

      if (response.ok) {
        // Navigate back to commits list
        navigate("/commits");
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

  const currentNode = getCurrentNode();
  const children = currentNode?.children
    ? Object.entries(currentNode.children).sort(([a], [b]) => a.localeCompare(b))
    : [];

  // Separate folders and files
  const folders = children.filter(([, node]) => node.kind === "collection");
  const files = children.filter(([, node]) => node.kind !== "collection");

  return (
    <Box sx={{ height: "calc(100vh - 140px)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <Box sx={{ mb: 2, display: "flex", alignItems: "center", gap: 2 }}>
        <IconButton onClick={goBack}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flexGrow: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="h5" fontWeight={600}>
              {commitTitle || "Untitled Commit"}
            </Typography>
            <Tooltip title="Rename">
              <IconButton size="small" onClick={handleRenameClick}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Chip
              label={truncateKey(decodedRoot, 40)}
              size="small"
              variant="outlined"
              sx={{ fontFamily: "monospace" }}
            />
            <Tooltip title={copiedKey === decodedRoot ? "Copied!" : "Copy key"}>
              <IconButton size="small" onClick={() => handleCopyKey(decodedRoot)}>
                {copiedKey === decodedRoot ? (
                  <CheckIcon fontSize="small" color="success" />
                ) : (
                  <CopyIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        <Tooltip title="Delete commit">
          <IconButton onClick={() => setDeleteDialogOpen(true)} color="error">
            <DeleteIcon />
          </IconButton>
        </Tooltip>
        <IconButton onClick={fetchTree} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {/* Breadcrumb navigation */}
      <Box sx={{ mb: 2 }}>
        <Breadcrumbs>
          <Link
            component="button"
            underline="hover"
            color={currentPath.length === 0 ? "text.primary" : "inherit"}
            onClick={() => navigateToPathIndex(-1)}
            sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
          >
            <HomeIcon fontSize="small" />
            Root
          </Link>
          {currentPath.map((item, index) => (
            <Link
              key={item.key}
              component="button"
              underline="hover"
              color={index === currentPath.length - 1 ? "text.primary" : "inherit"}
              onClick={() => navigateToPathIndex(index)}
            >
              {item.name}
            </Link>
          ))}
        </Breadcrumbs>
      </Box>

      {/* Error alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Content */}
      <Paper variant="outlined" sx={{ flex: 1, overflow: "auto" }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: 200 }}>
            <CircularProgress />
          </Box>
        ) : !currentNode ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              color: "text.secondary",
            }}
          >
            <Typography variant="body1">Failed to load content</Typography>
          </Box>
        ) : children.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              color: "text.secondary",
            }}
          >
            <FolderIcon sx={{ fontSize: 48, mb: 1, opacity: 0.5 }} />
            <Typography variant="body1">This folder is empty</Typography>
          </Box>
        ) : (
          <List>
            {/* Folders first */}
            {folders.map(([name, node]) => (
              <ListItem
                key={node.key}
                disablePadding
                secondaryAction={
                  <Tooltip title={copiedKey === node.key ? "Copied!" : "Copy key"}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyKey(node.key);
                      }}
                    >
                      {copiedKey === node.key ? (
                        <CheckIcon fontSize="small" color="success" />
                      ) : (
                        <CopyIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemButton onClick={() => navigateToFolder(name, node)}>
                  <ListItemIcon>
                    <FolderIcon color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary={name}
                    secondary={`${Object.keys(node.children || {}).length} items`}
                  />
                </ListItemButton>
              </ListItem>
            ))}
            {/* Files */}
            {files.map(([name, node]) => (
              <ListItem
                key={node.key}
                secondaryAction={
                  <Box sx={{ display: "flex", gap: 0.5 }}>
                    <Tooltip title="Download">
                      <IconButton
                        size="small"
                        onClick={() => handleDownload(name, node)}
                        disabled={downloading === node.key}
                      >
                        {downloading === node.key ? (
                          <CircularProgress size={16} />
                        ) : (
                          <DownloadIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={copiedKey === node.key ? "Copied!" : "Copy key"}>
                      <IconButton size="small" onClick={() => handleCopyKey(node.key)}>
                        {copiedKey === node.key ? (
                          <CheckIcon fontSize="small" color="success" />
                        ) : (
                          <CopyIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Box>
                }
              >
                <ListItemIcon>
                  <FileIcon />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body1">{name}</Typography>
                      {node.contentType && (
                        <Chip
                          label={node.contentType}
                          size="small"
                          color={getContentTypeColor(node.contentType)}
                          sx={{ fontSize: "0.7rem" }}
                        />
                      )}
                    </Box>
                  }
                  secondary={formatBytes(node.size)}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

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
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {commitTitle || "Untitled Commit"}
          </Typography>
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
    </Box>
  );
}
