import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Breadcrumbs,
  Link,
  Chip,
  CircularProgress,
  Alert,
  Button,
  TextField,
  InputAdornment,
  LinearProgress,
  Divider,
} from "@mui/material";
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Home as HomeIcon,
  NavigateNext as NavigateNextIcon,
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
  Upload as UploadIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  ArrowBack as ArrowBackIcon,
  DataObject as ChunkIcon,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest, API_URL } from "../utils/api";

// Node kind type
type NodeKind = "collection" | "file" | "chunk";

// Ownership record from API
interface CasOwnership {
  key: string;
  realm: string;
  kind?: NodeKind;
  contentType?: string;
  size: number;
  createdAt: number;
  createdBy: string;
}

// Commit record from API
interface CommitRecord {
  root: string;
  title?: string;
  createdAt: string;
}

// Expanded node from /node/:key API
interface CasNode {
  kind: NodeKind;
  key: string;
  size: number;
  contentType?: string;
  children?: Record<string, CasNode>;
}

// Navigation path item
interface PathItem {
  key: string;
  name: string;
}

interface FileExplorerProps {
  onError?: (error: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function getContentTypeColor(
  contentType: string
): "default" | "primary" | "secondary" | "success" | "warning" | "error" | "info" {
  if (contentType.startsWith("image/")) return "success";
  if (contentType.startsWith("video/")) return "secondary";
  if (contentType.startsWith("audio/")) return "warning";
  if (contentType.startsWith("text/")) return "info";
  if (contentType === "application/json") return "primary";
  if (contentType === "application/vnd.cas.collection") return "default";
  return "default";
}

function getExtensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    "text/plain": ".txt",
    "text/html": ".html",
    "text/css": ".css",
    "text/javascript": ".js",
    "application/json": ".json",
    "application/xml": ".xml",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  return map[contentType] || "";
}

// Compute SHA-256 hash of content
async function computeHash(content: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", content);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function FileExplorer({ onError }: FileExplorerProps) {
  const { getAccessToken, realm } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Current directory state
  const [currentPath, setCurrentPath] = useState<PathItem[]>([]);
  const [currentNode, setCurrentNode] = useState<CasNode | null>(null);
  const [rootNodes, setRootNodes] = useState<CasOwnership[]>([]);
  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [viewMode, setViewMode] = useState<"commits" | "nodes">("commits");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [initialized, setInitialized] = useState(false);

  // Selected item for detail panel
  const [selectedItem, setSelectedItem] = useState<{
    name: string;
    node: CasNode;
    ownership?: CasOwnership;
  } | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Copy state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Download state
  const [downloading, setDownloading] = useState<string | null>(null);

  // Delete state
  const [deleting, setDeleting] = useState<string | null>(null);

  // Fetch commits
  const fetchCommits = useCallback(async () => {
    if (!realm) return;
    
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      const response = await apiRequest(`/api/realm/${realm}/commits?limit=100`, {}, accessToken);
      if (response.ok) {
        const data = await response.json();
        setCommits(data.commits || []);
      }
    } catch {
      // Ignore errors, commits view is optional
    }
  }, [getAccessToken, realm]);

  // Fetch root level nodes (all collections and files not inside other collections)
  const fetchRootNodes = useCallback(async () => {
    if (!realm) return; // Wait for realm to be loaded
    
    try {
      setLoading(true);
      setError("");

      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      // Fetch all nodes, we'll filter/sort on client
      const response = await apiRequest(`/api/realm/${realm}/nodes?limit=1000`, {}, accessToken);

      if (response.ok) {
        const data = await response.json();
        const nodes = (data.nodes || []) as CasOwnership[];
        // Show collections first, then files, exclude chunks from root view
        const sorted = nodes
          .filter((n) => n.kind !== "chunk")
          .sort((a, b) => {
            if (a.kind === "collection" && b.kind !== "collection") return -1;
            if (a.kind !== "collection" && b.kind === "collection") return 1;
            return b.createdAt - a.createdAt;
          });
        setRootNodes(sorted);
      } else if (response.status === 404) {
        setRootNodes([]);
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to load nodes");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, realm]);

  // Fetch node details (for navigating into collections)
  const fetchNode = useCallback(
    async (key: string): Promise<CasNode | null> => {
      if (!realm) return null; // Wait for realm to be loaded
      
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) return null;

        const response = await apiRequest(
          `/api/realm/${realm}/node/${encodeURIComponent(key)}`,
          {},
          accessToken
        );

        if (response.ok) {
          return await response.json();
        }
        return null;
      } catch {
        return null;
      }
    },
    [getAccessToken, realm]
  );

  // Parse URL path to get current key
  const getKeyFromUrl = useCallback(() => {
    // URL format: /nodes/{key} where key is URL-encoded
    const pathMatch = location.pathname.match(/^\/nodes\/(.+)$/);
    if (pathMatch && pathMatch[1]) {
      return decodeURIComponent(pathMatch[1]);
    }
    return null;
  }, [location.pathname]);

  // Update URL when navigating
  const updateUrl = useCallback(
    (path: PathItem[]) => {
      if (path.length === 0) {
        navigate("/nodes", { replace: true });
      } else {
        const lastItem = path[path.length - 1];
        if (lastItem) {
          navigate(`/nodes/${encodeURIComponent(lastItem.key)}`, { replace: true });
        }
      }
    },
    [navigate]
  );

  // Initial load - check URL for initial state
  useEffect(() => {
    const initFromUrl = async () => {
      const urlKey = getKeyFromUrl();

      if (urlKey) {
        // Navigate to the collection specified in URL
        setLoading(true);
        const node = await fetchNode(urlKey);
        if (node && node.kind === "collection") {
          setCurrentNode(node);
          // For now, we only track the current key in path (could be enhanced to track full path)
          setCurrentPath([{ key: urlKey, name: urlKey.slice(0, 16) + "..." }]);
        } else {
          // Invalid key or not a collection, go to root
          await Promise.all([fetchRootNodes(), fetchCommits()]);
          navigate("/nodes", { replace: true });
        }
        setLoading(false);
      } else {
        await Promise.all([fetchRootNodes(), fetchCommits()]);
      }
      setInitialized(true);
    };

    if (!initialized) {
      initFromUrl();
    }
  }, [initialized, getKeyFromUrl, fetchNode, fetchRootNodes, fetchCommits, navigate]);

  // Navigate into a collection
  const navigateToCollection = async (key: string, name: string) => {
    setLoading(true);
    const node = await fetchNode(key);
    if (node && node.kind === "collection") {
      setCurrentNode(node);
      const newPath = [...currentPath, { key, name }];
      setCurrentPath(newPath);
      setSelectedItem(null);
      updateUrl(newPath);
    }
    setLoading(false);
  };

  // Navigate to a specific path index
  const navigateToPath = async (index: number) => {
    if (index < 0) {
      // Go to root
      setCurrentPath([]);
      setCurrentNode(null);
      setSelectedItem(null);
      updateUrl([]);
      await fetchRootNodes();
    } else {
      const newPath = currentPath.slice(0, index + 1);
      const targetItem = newPath[newPath.length - 1];
      if (!targetItem) return;
      setLoading(true);
      const node = await fetchNode(targetItem.key);
      if (node) {
        setCurrentNode(node);
        setCurrentPath(newPath);
        setSelectedItem(null);
        updateUrl(newPath);
      }
      setLoading(false);
    }
  };

  // Go back one level
  const goBack = () => {
    if (currentPath.length > 0) {
      navigateToPath(currentPath.length - 2);
    }
  };

  // Handle item click
  const handleItemClick = (name: string, node: CasNode, ownership?: CasOwnership) => {
    if (node.kind === "collection") {
      navigateToCollection(node.key, name);
    } else {
      setSelectedItem({ name, node, ownership });
    }
  };

  // Handle item double click (enter collection)
  const handleItemDoubleClick = (name: string, node: CasNode) => {
    if (node.kind === "collection") {
      navigateToCollection(node.key, name);
    }
  };

  // Copy key to clipboard
  const handleCopyKey = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Download file
  const handleDownload = async (key: string, contentType: string, name?: string) => {
    if (!realm) return;
    
    try {
      setDownloading(key);

      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      const response = await fetch(`${API_URL}/api/realm/${realm}/chunk/${encodeURIComponent(key)}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const ext = getExtensionFromContentType(contentType);
        a.download = name || `${key.slice(0, 16)}${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to download file");
      }
    } catch (err) {
      setError("Download failed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setDownloading(null);
    }
  };

  // Delete node
  const handleDelete = async (key: string) => {
    if (!realm) return;
    
    try {
      setDeleting(key);

      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      const response = await apiRequest(
        `/api/realm/${realm}/node/${encodeURIComponent(key)}`,
        { method: "DELETE" },
        accessToken
      );

      if (response.ok) {
        // Refresh current view
        if (currentPath.length === 0) {
          await fetchRootNodes();
        } else {
          const currentItem = currentPath[currentPath.length - 1];
          if (currentItem) {
            const node = await fetchNode(currentItem.key);
            if (node) {
              setCurrentNode(node);
            }
          }
        }
        setSelectedItem(null);
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to delete node");
      }
    } catch (err) {
      setError("Delete failed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setDeleting(null);
    }
  };

  // Compute file node key (must match server's format)
  const computeFileKey = async (
    chunks: string[],
    contentType: string,
    size: number
  ): Promise<string> => {
    const metadata = JSON.stringify({ kind: "file", chunks, contentType, size });
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(metadata));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return `sha256:${hash}`;
  };

  // Upload file using new commit endpoint
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!realm) return;
    
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setUploadProgress(0);
      setError("");

      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      // Read file content
      const content = await file.arrayBuffer();
      setUploadProgress(20);

      // Compute chunk hash
      const chunkHash = await computeHash(content);
      const chunkKey = `sha256:${chunkHash}`;
      setUploadProgress(30);

      // 1. Upload chunk
      const chunkResponse = await fetch(`${API_URL}/api/realm/${realm}/chunk/${encodeURIComponent(chunkKey)}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: content,
      });

      if (!chunkResponse.ok) {
        const errData = await chunkResponse.json().catch(() => ({}));
        setError(errData.error || "Failed to upload chunk");
        return;
      }
      setUploadProgress(60);

      // 2. Compute file key and call commit
      const contentType = file.type || "application/octet-stream";
      const fileKey = await computeFileKey([chunkKey], contentType, content.byteLength);
      setUploadProgress(70);

      // 3. Call POST /commit
      const commitResponse = await fetch(`${API_URL}/api/realm/${realm}/commit`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          root: fileKey,
          title: file.name,
          files: {
            [fileKey]: {
              chunks: [chunkKey],
              contentType,
              size: content.byteLength,
            },
          },
        }),
      });

      setUploadProgress(90);

      if (commitResponse.ok) {
        const result = await commitResponse.json();
        if (result.success) {
          setUploadProgress(100);
          // Refresh view
          if (currentPath.length === 0) {
            await Promise.all([fetchRootNodes(), fetchCommits()]);
          }
        } else if (result.error === "missing_nodes") {
          setError(`Missing chunks: ${result.missing.join(", ")}`);
        } else {
          setError(result.error || "Commit failed");
        }
      } else {
        const errData = await commitResponse.json().catch(() => ({}));
        setError(errData.error || "Failed to commit file");
      }
    } catch (err) {
      setError("Upload failed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Get items to display
  const getDisplayItems = (): Array<{ name: string; node: CasNode; ownership?: CasOwnership; commit?: CommitRecord }> => {
    if (currentNode && currentNode.kind === "collection" && currentNode.children) {
      // Inside a collection
      return Object.entries(currentNode.children)
        .map(([name, node]) => ({ name, node }))
        .filter(
          (item) =>
            !searchQuery ||
            item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.node.key.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .sort((a, b) => {
          // Folders first
          if (a.node.kind === "collection" && b.node.kind !== "collection") return -1;
          if (a.node.kind !== "collection" && b.node.kind === "collection") return 1;
          return a.name.localeCompare(b.name);
        });
    }

    // At root level - show commits or nodes based on viewMode
    if (viewMode === "commits" && commits.length > 0) {
      return commits
        .filter(
          (c) =>
            !searchQuery ||
            c.root.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (c.title?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
        )
        .map((c) => ({
          name: c.title || c.root.slice(0, 16) + "...",
          node: {
            kind: "file" as NodeKind, // Will be fetched when clicked
            key: c.root,
            size: 0,
          },
          commit: c,
        }));
    }

    // Fallback to nodes view
    return rootNodes
      .filter(
        (n) =>
          !searchQuery ||
          n.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (n.contentType?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
      )
      .map((n) => ({
        name: n.key.slice(0, 16) + "...",
        node: {
          kind: n.kind || ("file" as NodeKind),
          key: n.key,
          size: n.size,
          contentType: n.contentType,
        },
        ownership: n,
      }));
  };

  const displayItems = getDisplayItems();
  const isAtRoot = currentPath.length === 0;

  const truncateKey = (key: string, maxLength = 20) => {
    if (key.length <= maxLength) return key;
    return `${key.slice(0, 12)}...${key.slice(-6)}`;
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        {/* Back button */}
        <IconButton onClick={goBack} disabled={isAtRoot || loading} size="small">
          <ArrowBackIcon />
        </IconButton>

        {/* Breadcrumb */}
        <Breadcrumbs
          separator={<NavigateNextIcon fontSize="small" />}
          sx={{ flex: 1, minWidth: 200 }}
        >
          <Link
            component="button"
            underline="hover"
            color={isAtRoot ? "text.primary" : "inherit"}
            onClick={() => navigateToPath(-1)}
            sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
          >
            <HomeIcon fontSize="small" />
            Home
          </Link>
          {currentPath.map((item, index) => (
            <Link
              key={item.key}
              component="button"
              underline="hover"
              color={index === currentPath.length - 1 ? "text.primary" : "inherit"}
              onClick={() => navigateToPath(index)}
            >
              {item.name.length > 20 ? item.name.slice(0, 17) + "..." : item.name}
            </Link>
          ))}
        </Breadcrumbs>

        {/* Search */}
        <TextField
          size="small"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ width: 200 }}
        />

        {/* Upload button */}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />
        <Button
          variant="contained"
          size="small"
          startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <UploadIcon />}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          Upload
        </Button>

        {/* View mode toggle (only at root) */}
        {isAtRoot && (
          <Box sx={{ display: "flex", gap: 0.5 }}>
            <Chip
              label="Commits"
              size="small"
              color={viewMode === "commits" ? "primary" : "default"}
              onClick={() => setViewMode("commits")}
              variant={viewMode === "commits" ? "filled" : "outlined"}
            />
            <Chip
              label="All Nodes"
              size="small"
              color={viewMode === "nodes" ? "primary" : "default"}
              onClick={() => setViewMode("nodes")}
              variant={viewMode === "nodes" ? "filled" : "outlined"}
            />
          </Box>
        )}

        {/* Refresh button */}
        <IconButton onClick={() => (isAtRoot ? Promise.all([fetchRootNodes(), fetchCommits()]) : navigateToPath(currentPath.length - 1))} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {/* Upload progress */}
      {uploading && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress variant="determinate" value={uploadProgress} />
          <Typography variant="caption" color="text.secondary">
            Uploading... {uploadProgress}%
          </Typography>
        </Box>
      )}

      {/* Error alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Main content */}
      <Box sx={{ display: "flex", flex: 1, gap: 2, minHeight: 0 }}>
        {/* File list */}
        <Paper sx={{ flex: 1, overflow: "auto", minWidth: 0 }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : displayItems.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography color="text.secondary">
                {searchQuery ? "No matching items" : "No items"}
              </Typography>
            </Box>
          ) : (
            <List dense>
              {displayItems.map((item) => (
                <ListItem
                  key={item.node.key}
                  disablePadding
                  secondaryAction={
                    <Box sx={{ display: "flex", gap: 0.5 }}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyKey(item.node.key);
                        }}
                      >
                        {copiedKey === item.node.key ? (
                          <CheckIcon fontSize="small" color="success" />
                        ) : (
                          <CopyIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Box>
                  }
                >
                  <ListItemButton
                    selected={selectedItem?.node.key === item.node.key}
                    onClick={() => handleItemClick(item.name, item.node, item.ownership)}
                    onDoubleClick={() => handleItemDoubleClick(item.name, item.node)}
                  >
                    <ListItemIcon>
                      {item.node.kind === "collection" ? (
                        <FolderIcon color="primary" />
                      ) : item.node.kind === "chunk" ? (
                        <ChunkIcon color="disabled" />
                      ) : (
                        <FileIcon color="action" />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.name}
                      secondary={
                        item.node.kind === "collection"
                          ? `${Object.keys(item.node.children || {}).length} items`
                          : formatBytes(item.node.size)
                      }
                      primaryTypographyProps={{
                        noWrap: true,
                        sx: { fontFamily: item.name.startsWith("sha256:") ? "monospace" : "inherit" },
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Paper>

        {/* Detail panel */}
        <Paper sx={{ width: 320, p: 2, overflow: "auto", flexShrink: 0 }}>
          {selectedItem ? (
            <Box>
              <Typography variant="h6" noWrap sx={{ mb: 2 }}>
                {selectedItem.name}
              </Typography>

              <Divider sx={{ mb: 2 }} />

              {/* Key */}
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Key
              </Typography>
              <Paper
                sx={{
                  p: 1,
                  mb: 2,
                  bgcolor: "grey.100",
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  wordBreak: "break-all",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <Box sx={{ flex: 1 }}>{selectedItem.node.key}</Box>
                <IconButton size="small" onClick={() => handleCopyKey(selectedItem.node.key)}>
                  {copiedKey === selectedItem.node.key ? (
                    <CheckIcon fontSize="small" color="success" />
                  ) : (
                    <CopyIcon fontSize="small" />
                  )}
                </IconButton>
              </Paper>

              {/* Type */}
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Type
              </Typography>
              <Chip
                label={selectedItem.node.kind}
                size="small"
                color={selectedItem.node.kind === "collection" ? "primary" : "default"}
                sx={{ mb: 2 }}
              />

              {/* Content Type */}
              {selectedItem.node.contentType && (
                <>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Content Type
                  </Typography>
                  <Chip
                    label={selectedItem.node.contentType}
                    size="small"
                    color={getContentTypeColor(selectedItem.node.contentType)}
                    variant="outlined"
                    sx={{ mb: 2 }}
                  />
                </>
              )}

              {/* Size */}
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Size
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {formatBytes(selectedItem.node.size)}
              </Typography>

              {/* Created (if available) */}
              {selectedItem.ownership?.createdAt && (
                <>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Created
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    {formatDate(selectedItem.ownership.createdAt)}
                  </Typography>
                </>
              )}

              <Divider sx={{ my: 2 }} />

              {/* Actions */}
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {selectedItem.node.kind !== "collection" && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={
                      downloading === selectedItem.node.key ? (
                        <CircularProgress size={16} />
                      ) : (
                        <DownloadIcon />
                      )
                    }
                    onClick={() =>
                      handleDownload(
                        selectedItem.node.key,
                        selectedItem.node.contentType || "application/octet-stream",
                        selectedItem.name
                      )
                    }
                    disabled={downloading === selectedItem.node.key}
                  >
                    Download
                  </Button>
                )}
                <Button
                  variant="outlined"
                  size="small"
                  color="error"
                  startIcon={
                    deleting === selectedItem.node.key ? (
                      <CircularProgress size={16} />
                    ) : (
                      <DeleteIcon />
                    )
                  }
                  onClick={() => handleDelete(selectedItem.node.key)}
                  disabled={deleting === selectedItem.node.key}
                >
                  Delete
                </Button>
              </Box>
            </Box>
          ) : (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "text.secondary",
              }}
            >
              <FileIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
              <Typography variant="body2">Select an item to view details</Typography>
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
