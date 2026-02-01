import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  TextField,
  LinearProgress,
  Alert,
  Breadcrumbs,
  Link,
  Paper,
  Tooltip,
  CircularProgress,
} from "@mui/material";
import {
  Add as AddIcon,
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Delete as DeleteIcon,
  CreateNewFolder as CreateNewFolderIcon,
  UploadFile as UploadFileIcon,
  Home as HomeIcon,
  ArrowBack as ArrowBackIcon,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest } from "../utils/api";

// Staged file/folder structure
interface StagedItem {
  id: string;
  name: string;
  type: "file" | "folder";
  // For files
  file?: File;
  content?: ArrayBuffer;
  contentType?: string;
  size?: number;
  // For folders
  children?: StagedItem[];
}

interface NewCommitDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// Compute SHA-256 hash of content
async function computeHash(content: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", content);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

export default function NewCommitDialog({ open, onClose, onSuccess }: NewCommitDialogProps) {
  const { getAccessToken, realm } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Commit metadata
  const [title, setTitle] = useState("");

  // Staged items (root level)
  const [stagedItems, setStagedItems] = useState<StagedItem[]>([]);

  // Current folder path for navigation within staged items
  const [currentPath, setCurrentPath] = useState<string[]>([]);

  // New folder dialog
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Submitting state
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");

  // Generate unique ID
  const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // Get items at current path
  const getCurrentItems = useCallback((): StagedItem[] => {
    if (currentPath.length === 0) {
      return stagedItems;
    }

    let current: StagedItem[] = stagedItems;
    for (const pathId of currentPath) {
      const folder = current.find((item) => item.id === pathId && item.type === "folder");
      if (!folder || !folder.children) {
        return [];
      }
      current = folder.children;
    }
    return current;
  }, [stagedItems, currentPath]);

  // Get folder at current path (for modification)
  const getParentFolder = useCallback((): StagedItem | null => {
    if (currentPath.length === 0) {
      return null;
    }

    let current: StagedItem[] = stagedItems;
    let parent: StagedItem | null = null;

    for (const pathId of currentPath) {
      const folder = current.find((item) => item.id === pathId && item.type === "folder");
      if (!folder) {
        return null;
      }
      parent = folder;
      current = folder.children || [];
    }
    return parent;
  }, [stagedItems, currentPath]);

  // Add items at current path
  const addItemsAtCurrentPath = (newItems: StagedItem[]) => {
    if (currentPath.length === 0) {
      setStagedItems((prev) => [...prev, ...newItems]);
      return;
    }

    setStagedItems((prev) => {
      const clone = JSON.parse(JSON.stringify(prev)) as StagedItem[];
      let current = clone;
      for (const pathId of currentPath) {
        const folder = current.find((item) => item.id === pathId && item.type === "folder");
        if (folder) {
          if (!folder.children) folder.children = [];
          if (pathId === currentPath[currentPath.length - 1]) {
            folder.children.push(...newItems);
          }
          current = folder.children;
        }
      }
      return clone;
    });
  };

  // Remove item at current path
  const removeItem = (itemId: string) => {
    if (currentPath.length === 0) {
      setStagedItems((prev) => prev.filter((item) => item.id !== itemId));
      return;
    }

    setStagedItems((prev) => {
      const clone = JSON.parse(JSON.stringify(prev)) as StagedItem[];
      let current = clone;
      for (const pathId of currentPath) {
        const folder = current.find((item) => item.id === pathId && item.type === "folder");
        if (folder) {
          if (pathId === currentPath[currentPath.length - 1]) {
            folder.children = folder.children?.filter((item) => item.id !== itemId) || [];
          }
          current = folder.children || [];
        }
      }
      return clone;
    });
  };

  // Handle file selection
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newItems: StagedItem[] = [];
    for (const file of Array.from(files)) {
      const content = await file.arrayBuffer();
      newItems.push({
        id: generateId(),
        name: file.name,
        type: "file",
        file,
        content,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      });
    }

    addItemsAtCurrentPath(newItems);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Create new folder
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;

    const newFolder: StagedItem = {
      id: generateId(),
      name: newFolderName.trim(),
      type: "folder",
      children: [],
    };

    addItemsAtCurrentPath([newFolder]);
    setNewFolderName("");
    setShowNewFolderInput(false);
  };

  // Navigate into folder
  const navigateToFolder = (folderId: string) => {
    setCurrentPath((prev) => [...prev, folderId]);
  };

  // Navigate to path index
  const navigateToPathIndex = (index: number) => {
    if (index < 0) {
      setCurrentPath([]);
    } else {
      setCurrentPath((prev) => prev.slice(0, index + 1));
    }
  };

  // Get path names for breadcrumb
  const getPathNames = (): { id: string; name: string }[] => {
    const names: { id: string; name: string }[] = [];
    let current = stagedItems;
    for (const pathId of currentPath) {
      const folder = current.find((item) => item.id === pathId);
      if (folder) {
        names.push({ id: folder.id, name: folder.name });
        current = folder.children || [];
      }
    }
    return names;
  };

  // Count total files
  const countFiles = (items: StagedItem[]): number => {
    let count = 0;
    for (const item of items) {
      if (item.type === "file") {
        count++;
      } else if (item.children) {
        count += countFiles(item.children);
      }
    }
    return count;
  };

  // Build CAS collection structure and upload
  const submitCommit = async () => {
    if (stagedItems.length === 0) {
      setError("Please add at least one file or folder");
      return;
    }

    setSubmitting(true);
    setProgress(0);
    setError("");

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      // Collect all files and build structure
      const allFiles: { path: string[]; item: StagedItem }[] = [];
      const collectFiles = (items: StagedItem[], path: string[]) => {
        for (const item of items) {
          if (item.type === "file") {
            allFiles.push({ path, item });
          } else if (item.children) {
            collectFiles(item.children, [...path, item.name]);
          }
        }
      };
      collectFiles(stagedItems, []);

      const totalFiles = allFiles.length;
      if (totalFiles === 0) {
        setError("Please add at least one file");
        return;
      }

      // Upload all chunks first
      setProgressMessage("Uploading files...");
      const chunkKeys: Map<string, string> = new Map(); // file path -> chunk key

      for (let i = 0; i < allFiles.length; i++) {
        const { path, item } = allFiles[i]!;
        const fullPath = [...path, item.name].join("/");

        if (!item.content) continue;

        // Compute hash
        const hash = await computeHash(item.content);
        const chunkKey = `sha256:${hash}`;

        // Upload chunk
        const uploadResponse = await apiRequest(
          `/api/realm/${realm}/chunks/${encodeURIComponent(chunkKey)}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": item.contentType || "application/octet-stream",
            },
            body: item.content,
          },
          accessToken
        );

        if (!uploadResponse.ok) {
          const err = await uploadResponse.json().catch(() => ({}));
          throw new Error(err.error || `Failed to upload ${item.name}`);
        }

        chunkKeys.set(fullPath, chunkKey);
        setProgress(Math.round(((i + 1) / totalFiles) * 70));
      }

      // Build collection structure
      setProgressMessage("Building collection...");
      setProgress(75);

      // Build the tree structure for commit
      const buildTree = (items: StagedItem[], path: string[]): Record<string, unknown> => {
        const tree: Record<string, unknown> = {};
        for (const item of items) {
          if (item.type === "file") {
            const fullPath = [...path, item.name].join("/");
            const chunkKey = chunkKeys.get(fullPath);
            if (chunkKey) {
              tree[item.name] = {
                chunks: [chunkKey],
                contentType: item.contentType || "application/octet-stream",
                size: item.size || 0,
              };
            }
          } else if (item.children) {
            tree[item.name] = buildTree(item.children, [...path, item.name]);
          }
        }
        return tree;
      };

      const treeStructure = buildTree(stagedItems, []);

      // Create commit
      setProgressMessage("Creating commit...");
      setProgress(85);

      const commitResponse = await apiRequest(
        `/api/realm/${realm}/commit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: title.trim() || undefined,
            tree: treeStructure,
          }),
        },
        accessToken
      );

      if (!commitResponse.ok) {
        const err = await commitResponse.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create commit");
      }

      setProgress(100);
      setProgressMessage("Done!");

      // Reset and close
      setTimeout(() => {
        setStagedItems([]);
        setTitle("");
        setCurrentPath([]);
        setSubmitting(false);
        setProgress(0);
        setProgressMessage("");
        onSuccess?.();
        onClose();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create commit");
      setSubmitting(false);
    }
  };

  // Reset state when closing
  const handleClose = () => {
    if (submitting) return;
    setStagedItems([]);
    setTitle("");
    setCurrentPath([]);
    setError("");
    setShowNewFolderInput(false);
    setNewFolderName("");
    onClose();
  };

  const currentItems = getCurrentItems();
  const pathNames = getPathNames();
  const totalFileCount = countFiles(stagedItems);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <AddIcon color="primary" />
          <Typography variant="h6">Create New Commit</Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Commit title */}
        <TextField
          fullWidth
          label="Commit Title (optional)"
          placeholder="Enter a descriptive title for this commit"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={submitting}
          sx={{ mb: 3, mt: 1 }}
        />

        {/* Breadcrumb navigation */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          {currentPath.length > 0 && (
            <IconButton size="small" onClick={() => navigateToPathIndex(currentPath.length - 2)}>
              <ArrowBackIcon />
            </IconButton>
          )}
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
            {pathNames.map((item, index) => (
              <Link
                key={item.id}
                component="button"
                underline="hover"
                color={index === pathNames.length - 1 ? "text.primary" : "inherit"}
                onClick={() => navigateToPathIndex(index)}
              >
                {item.name}
              </Link>
            ))}
          </Breadcrumbs>
        </Box>

        {/* Actions */}
        <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={handleFileSelect}
            multiple
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={<UploadFileIcon />}
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting}
          >
            Add Files
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<CreateNewFolderIcon />}
            onClick={() => setShowNewFolderInput(true)}
            disabled={submitting}
          >
            New Folder
          </Button>
        </Box>

        {/* New folder input */}
        {showNewFolderInput && (
          <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
            <TextField
              size="small"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") {
                  setShowNewFolderInput(false);
                  setNewFolderName("");
                }
              }}
              autoFocus
              sx={{ flexGrow: 1 }}
            />
            <Button variant="contained" size="small" onClick={handleCreateFolder}>
              Create
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                setShowNewFolderInput(false);
                setNewFolderName("");
              }}
            >
              Cancel
            </Button>
          </Box>
        )}

        {/* File/folder list */}
        <Paper variant="outlined" sx={{ minHeight: 200, maxHeight: 400, overflow: "auto" }}>
          {currentItems.length === 0 ? (
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
              <UploadFileIcon sx={{ fontSize: 48, mb: 1, opacity: 0.5 }} />
              <Typography variant="body2">No files or folders yet</Typography>
              <Typography variant="caption">Click "Add Files" or "New Folder" to get started</Typography>
            </Box>
          ) : (
            <List dense>
              {/* Folders first */}
              {currentItems
                .filter((item) => item.type === "folder")
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((item) => (
                  <ListItem key={item.id} disablePadding>
                    <ListItemIcon sx={{ minWidth: 40, pl: 2 }}>
                      <FolderIcon color="primary" />
                    </ListItemIcon>
                    <ListItemText
                      primary={item.name}
                      secondary={`${item.children?.length || 0} items`}
                      onClick={() => navigateToFolder(item.id)}
                      sx={{ cursor: "pointer" }}
                    />
                    <ListItemSecondaryAction>
                      <Tooltip title="Remove folder">
                        <IconButton
                          size="small"
                          onClick={() => removeItem(item.id)}
                          disabled={submitting}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              {/* Files */}
              {currentItems
                .filter((item) => item.type === "file")
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((item) => (
                  <ListItem key={item.id} disablePadding>
                    <ListItemIcon sx={{ minWidth: 40, pl: 2 }}>
                      <FileIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary={item.name}
                      secondary={formatBytes(item.size || 0)}
                    />
                    <ListItemSecondaryAction>
                      <Tooltip title="Remove file">
                        <IconButton
                          size="small"
                          onClick={() => removeItem(item.id)}
                          disabled={submitting}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
            </List>
          )}
        </Paper>

        {/* Summary */}
        <Box sx={{ mt: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {totalFileCount} file{totalFileCount !== 1 ? "s" : ""} staged for commit
          </Typography>
        </Box>

        {/* Progress */}
        {submitting && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant="determinate" value={progress} />
            <Typography variant="caption" color="text.secondary">
              {progressMessage} {progress}%
            </Typography>
          </Box>
        )}

        {/* Error */}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={submitCommit}
          disabled={submitting || stagedItems.length === 0}
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
        >
          {submitting ? "Creating..." : "Create Commit"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
