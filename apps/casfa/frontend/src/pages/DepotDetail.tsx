import { useState, useEffect, useCallback, useRef } from "react";
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
  Menu,
  MenuItem,
  Fab,
  Snackbar,
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
  Delete as DeleteIcon,
  CreateNewFolder as NewFolderIcon,
  Upload as UploadIcon,
  DriveFileMove as MoveIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Undo as UndoIcon,
  History as HistoryIcon,
  MoreVert as MoreVertIcon,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest, API_URL } from "../utils/api";
import { createCasfaSession, VirtualFS } from "@agent-web-portal/casfa-client-browser";

// Tree node from API
interface TreeNode {
  kind: "collection" | "file" | "chunk";
  key: string;
  size: number;
  contentType?: string;
  children?: Record<string, TreeNode>;
}

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

// Navigation path item
interface PathItem {
  key: string;
  name: string;
}

// Pending edit operation
interface PendingEdit {
  type: "upload" | "delete" | "mkdir" | "move";
  path: string;
  data?: File;
  destPath?: string;
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

function getCurrentPathString(path: PathItem[]): string {
  return path.map((p) => p.name).join("/");
}

export default function DepotDetail() {
  const { depotId } = useParams<{ depotId: string }>();
  const decodedDepotId = depotId ? decodeURIComponent(depotId) : "";
  const { getAccessToken, realm } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [depot, setDepot] = useState<DepotRecord | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [currentPath, setCurrentPath] = useState<PathItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  // Context menu state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuItem, setMenuItem] = useState<{ name: string; node: TreeNode } | null>(null);

  // Dialog states
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [movePath, setMovePath] = useState("");

  // Fetch depot and tree
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

      // Fetch tree
      const treeResponse = await apiRequest(
        `/api/realm/${realm}/tree/${encodeURIComponent(depotData.root)}`,
        {},
        accessToken
      );

      if (treeResponse.ok) {
        const treeData = await treeResponse.json();
        setTree(treeData);
      } else {
        const errData = await treeResponse.json().catch(() => ({}));
        setError(errData.error || "Failed to load tree");
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

  // Get current node based on path
  const getCurrentNode = useCallback((): TreeNode | null => {
    if (!tree) return null;
    if (currentPath.length === 0) return tree;

    let current: TreeNode | undefined = tree;
    for (const item of currentPath) {
      if (!current?.children) return null;
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
      navigate("/depots");
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
        { headers: { Authorization: `Bearer ${accessToken}` } }
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

  // Context menu
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, name: string, node: TreeNode) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setMenuItem({ name, node });
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuItem(null);
  };

  // Edit operations
  const addPendingEdit = (edit: PendingEdit) => {
    setPendingEdits((prev) => [...prev, edit]);
    setEditMode(true);
  };

  // Handle file upload
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const currentPathStr = getCurrentPathString(currentPath);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      const filePath = currentPathStr ? `${currentPathStr}/${file.name}` : file.name;
      addPendingEdit({ type: "upload", path: filePath, data: file });
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Create folder
  const handleNewFolder = () => {
    if (!newFolderName.trim()) return;

    const currentPathStr = getCurrentPathString(currentPath);
    const folderPath = currentPathStr
      ? `${currentPathStr}/${newFolderName.trim()}`
      : newFolderName.trim();

    addPendingEdit({ type: "mkdir", path: folderPath });
    setNewFolderDialogOpen(false);
    setNewFolderName("");
  };

  // Delete item
  const handleDeleteItem = () => {
    if (!menuItem) return;

    const currentPathStr = getCurrentPathString(currentPath);
    const itemPath = currentPathStr ? `${currentPathStr}/${menuItem.name}` : menuItem.name;

    addPendingEdit({ type: "delete", path: itemPath });
    setDeleteDialogOpen(false);
    handleMenuClose();
  };

  // Rename/Move item
  const handleMoveItem = () => {
    if (!menuItem || !movePath.trim()) return;

    const currentPathStr = getCurrentPathString(currentPath);
    const srcPath = currentPathStr ? `${currentPathStr}/${menuItem.name}` : menuItem.name;

    addPendingEdit({ type: "move", path: srcPath, destPath: movePath.trim() });
    setMoveDialogOpen(false);
    setMovePath("");
    handleMenuClose();
  };

  // Rename item (shortcut for move)
  const handleRenameItem = () => {
    if (!menuItem || !renameName.trim()) return;

    const currentPathStr = getCurrentPathString(currentPath);
    const srcPath = currentPathStr ? `${currentPathStr}/${menuItem.name}` : menuItem.name;
    const destPath = currentPathStr ? `${currentPathStr}/${renameName.trim()}` : renameName.trim();

    addPendingEdit({ type: "move", path: srcPath, destPath });
    setRenameDialogOpen(false);
    setRenameName("");
    handleMenuClose();
  };

  // Discard changes
  const handleDiscard = () => {
    setPendingEdits([]);
    setEditMode(false);
  };

  // Save changes
  const handleSave = async () => {
    if (!realm || !depot || pendingEdits.length === 0) return;

    try {
      setSaving(true);
      setError("");

      const accessToken = await getAccessToken();
      if (!accessToken) return;

      // Create CasfaSession and get endpoint for VirtualFS operations
      const session = createCasfaSession(API_URL, { type: "user", token: accessToken });
      const endpoint = await session.getEndpoint(realm);

      // Create VirtualFS from current depot root
      const vfs = await VirtualFS.fromDict(endpoint, depot.root);

      // Apply all pending edits
      for (const edit of pendingEdits) {
        if (edit.type === "upload" && edit.data) {
          const buffer = await edit.data.arrayBuffer();
          await vfs.writeFile(edit.path, new Uint8Array(buffer), {
            contentType: edit.data.type || "application/octet-stream",
          });
        } else if (edit.type === "delete") {
          await vfs.delete(edit.path);
        } else if (edit.type === "mkdir") {
          await vfs.mkdir(edit.path);
        } else if (edit.type === "move" && edit.destPath) {
          await vfs.move(edit.path, edit.destPath);
        }
      }

      // Build the new root
      const newRoot = await vfs.build();

      // Update depot with new root
      const response = await apiRequest(
        `/api/realm/${realm}/depots/${encodeURIComponent(depot.depotId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: newRoot,
            message: `Edit: ${pendingEdits.length} operations`,
          }),
        },
        accessToken
      );

      if (response.ok) {
        const result = await response.json();
        setDepot(result);
        setPendingEdits([]);
        setEditMode(false);
        setSuccessMessage(`Saved! Now at version ${result.version}`);
        // Reload tree
        fetchData();
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to save changes");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
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
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        multiple
        onChange={handleFileSelect}
      />

      {/* Header */}
      <Box sx={{ mb: 2, display: "flex", alignItems: "center", gap: 2 }}>
        <IconButton onClick={goBack}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flexGrow: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="h5" fontWeight={600}>
              {depot?.name || "Loading..."}
            </Typography>
            {depot && (
              <Chip label={`v${depot.version}`} size="small" color="primary" variant="outlined" />
            )}
            {editMode && (
              <Chip
                label={`${pendingEdits.length} pending`}
                size="small"
                color="warning"
                variant="filled"
              />
            )}
          </Box>
          {depot && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
              <Chip
                label={truncateKey(depot.root, 40)}
                size="small"
                variant="outlined"
                sx={{ fontFamily: "monospace" }}
              />
              <Tooltip title={copiedKey === depot.root ? "Copied!" : "Copy root key"}>
                <IconButton size="small" onClick={() => handleCopyKey(depot.root)}>
                  {copiedKey === depot.root ? (
                    <CheckIcon fontSize="small" color="success" />
                  ) : (
                    <CopyIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>

        {/* Action buttons */}
        {editMode ? (
          <>
            <Button
              variant="outlined"
              startIcon={<UndoIcon />}
              onClick={handleDiscard}
              disabled={saving}
            >
              Discard
            </Button>
            <Button
              variant="contained"
              color="primary"
              startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || pendingEdits.length === 0}
            >
              Save ({pendingEdits.length})
            </Button>
          </>
        ) : (
          <>
            <Tooltip title="View History">
              <IconButton onClick={() => navigate(`/depots/${decodedDepotId}/history`)}>
                <HistoryIcon />
              </IconButton>
            </Tooltip>
            <IconButton onClick={fetchData} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </>
        )}
      </Box>

      {/* Toolbar */}
      <Box sx={{ mb: 2, display: "flex", gap: 1, alignItems: "center" }}>
        {/* Breadcrumb */}
        <Breadcrumbs sx={{ flexGrow: 1 }}>
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

        {/* Edit actions */}
        <Tooltip title="Upload files">
          <IconButton onClick={handleUploadClick}>
            <UploadIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="New folder">
          <IconButton onClick={() => setNewFolderDialogOpen(true)}>
            <NewFolderIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Error alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Pending edits preview */}
      {pendingEdits.length > 0 && (
        <Paper variant="outlined" sx={{ mb: 2, p: 1.5, bgcolor: "warning.light", color: "warning.contrastText" }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Pending Changes:
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {pendingEdits.map((edit, i) => (
              <Chip
                key={i}
                size="small"
                label={`${edit.type}: ${edit.path}`}
                onDelete={() => setPendingEdits((prev) => prev.filter((_, j) => j !== i))}
                sx={{ bgcolor: "background.paper" }}
              />
            ))}
          </Box>
        </Paper>
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
            <Typography variant="body2" sx={{ mt: 1 }}>
              Upload files or create a folder to get started
            </Typography>
          </Box>
        ) : (
          <List>
            {/* Folders first */}
            {folders.map(([name, node]) => (
              <ListItem
                key={node.key}
                disablePadding
                secondaryAction={
                  <Box sx={{ display: "flex", gap: 0.5 }}>
                    <IconButton size="small" onClick={(e) => handleMenuOpen(e, name, node)}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Box>
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
                    <IconButton size="small" onClick={(e) => handleMenuOpen(e, name, node)}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
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

      {/* Context Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem
          onClick={() => {
            setRenameName(menuItem?.name || "");
            setRenameDialogOpen(true);
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Rename</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            const currentPathStr = getCurrentPathString(currentPath);
            setMovePath(currentPathStr ? `${currentPathStr}/${menuItem?.name}` : menuItem?.name || "");
            setMoveDialogOpen(true);
          }}
        >
          <ListItemIcon>
            <MoveIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Move</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => setDeleteDialogOpen(true)} sx={{ color: "error.main" }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* New Folder Dialog */}
      <Dialog open={newFolderDialogOpen} onClose={() => setNewFolderDialogOpen(false)}>
        <DialogTitle>New Folder</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNewFolder();
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewFolderDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleNewFolder} disabled={!newFolderName.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)}>
        <DialogTitle>Rename</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="New name"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameItem();
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleRenameItem} disabled={!renameName.trim()}>
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* Move Dialog */}
      <Dialog open={moveDialogOpen} onClose={() => setMoveDialogOpen(false)}>
        <DialogTitle>Move</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Destination path"
            value={movePath}
            onChange={(e) => setMovePath(e.target.value)}
            placeholder="path/to/destination"
            helperText="Enter the full path including the new filename"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleMoveItem} disabled={!movePath.trim()}>
            Move
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete "{menuItem?.name}"?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This will add a delete operation to your pending changes.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDeleteItem}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage("")}
        message={successMessage}
      />
    </Box>
  );
}
