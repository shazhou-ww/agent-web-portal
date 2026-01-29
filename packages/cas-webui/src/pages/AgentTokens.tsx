import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  Alert,
  CircularProgress,
  Tooltip,
  Paper,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  ContentCopy as CopyIcon,
  Key as KeyIcon,
  Check as CheckIcon,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";

interface AgentToken {
  id: string;
  name: string;
  permissions: {
    read: boolean;
    write: boolean;
    issueTicket: boolean;
  };
  createdAt: string;
  expiresAt: string;
}

interface CreateTokenData {
  name: string;
  expiresIn: number;
  permissions: {
    read: boolean;
    write: boolean;
    issueTicket: boolean;
  };
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

function isExpired(expiresAt: string): boolean {
  return Date.now() > new Date(expiresAt).getTime();
}

function isExpiringSoon(expiresAt: string): boolean {
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const expiresTime = new Date(expiresAt).getTime();
  return !isExpired(expiresAt) && expiresTime - Date.now() < threeDays;
}

export default function AgentTokens() {
  const { getAccessToken } = useAuth();
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTokenData, setNewTokenData] = useState<CreateTokenData>({
    name: "",
    expiresIn: 2592000, // 30 days
    permissions: {
      read: true,
      write: true,
      issueTicket: false,
    },
  });
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tokenToDelete, setTokenToDelete] = useState<AgentToken | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTokens = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      const response = await fetch("/api/auth/agent-tokens", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setTokens(data.tokens || []);
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to load tokens");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleCreateToken = async () => {
    if (!newTokenData.name.trim()) {
      setError("Token name is required");
      return;
    }

    setCreating(true);
    setError("");

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      const response = await fetch("/api/auth/agent-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(newTokenData),
      });

      if (response.ok) {
        const data = await response.json();
        setCreatedToken(data.token);
        fetchTokens();
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to create token");
      }
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClick = (token: AgentToken) => {
    setTokenToDelete(token);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!tokenToDelete) return;

    setDeleting(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError("Not authenticated");
        return;
      }

      const response = await fetch(
        `/api/auth/agent-token/${encodeURIComponent(tokenToDelete.id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.ok) {
        setTokens((prev) => prev.filter((t) => t.id !== tokenToDelete.id));
        setDeleteDialogOpen(false);
      } else {
        const errData = await response.json().catch(() => ({}));
        setError(errData.error || "Failed to delete token");
      }
    } catch {
      setError("Network error");
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyToken = async () => {
    if (createdToken) {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCloseCreateDialog = () => {
    setCreateDialogOpen(false);
    setCreatedToken(null);
    setCopied(false);
    setNewTokenData({
      name: "",
      expiresIn: 2592000,
      permissions: {
        read: true,
        write: true,
        issueTicket: false,
      },
    });
  };

  const truncateId = (id: string) => {
    if (id.length <= 16) return id;
    return `${id.slice(0, 8)}...${id.slice(-6)}`;
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
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
            Agent Tokens
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create and manage API tokens for your agents
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={fetchTokens}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            Create Token
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {tokens.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 8 }}>
            <KeyIcon sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
              No agent tokens
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ mb: 3 }}>
              Create a token to allow agents to access your CAS storage
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
            >
              Create Your First Token
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {tokens.map((token) => {
            const expired = isExpired(token.expiresAt);
            const expiringSoon = isExpiringSoon(token.expiresAt);

            return (
              <Card
                key={token.id}
                sx={{
                  opacity: expired ? 0.7 : 1,
                  borderLeft: expired
                    ? "4px solid #f44336"
                    : expiringSoon
                      ? "4px solid #ff9800"
                      : "4px solid #4caf50",
                }}
              >
                <CardContent>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <Box sx={{ flex: 1 }}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          mb: 1,
                        }}
                      >
                        <Typography variant="h6" fontWeight={600}>
                          {token.name}
                        </Typography>
                        {expired && (
                          <Chip label="Expired" size="small" color="error" />
                        )}
                        {expiringSoon && !expired && (
                          <Chip
                            label="Expiring Soon"
                            size="small"
                            color="warning"
                          />
                        )}
                      </Box>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 1.5 }}
                      >
                        <Tooltip title={token.id}>
                          <span style={{ fontFamily: "monospace" }}>
                            ID: {truncateId(token.id)}
                          </span>
                        </Tooltip>
                      </Typography>

                      <Box sx={{ display: "flex", gap: 1, mb: 1.5 }}>
                        <Chip
                          label="Read"
                          size="small"
                          color={token.permissions.read ? "primary" : "default"}
                          variant={
                            token.permissions.read ? "filled" : "outlined"
                          }
                        />
                        <Chip
                          label="Write"
                          size="small"
                          color={
                            token.permissions.write ? "primary" : "default"
                          }
                          variant={
                            token.permissions.write ? "filled" : "outlined"
                          }
                        />
                        <Chip
                          label="Issue Ticket"
                          size="small"
                          color={
                            token.permissions.issueTicket
                              ? "secondary"
                              : "default"
                          }
                          variant={
                            token.permissions.issueTicket ? "filled" : "outlined"
                          }
                        />
                      </Box>

                      <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                        <Typography variant="caption" color="text.secondary">
                          Created: {formatDate(token.createdAt)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color={
                            expired
                              ? "error"
                              : expiringSoon
                                ? "warning.main"
                                : "text.secondary"
                          }
                        >
                          Expires: {formatDate(token.expiresAt)}
                        </Typography>
                      </Box>
                    </Box>

                    <IconButton
                      color="error"
                      onClick={() => handleDeleteClick(token)}
                      title="Delete Token"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}

      {/* Create Token Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={handleCloseCreateDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {createdToken ? "Token Created Successfully" : "Create Agent Token"}
        </DialogTitle>
        <DialogContent>
          {createdToken ? (
            <Box>
              <Alert severity="warning" sx={{ mb: 2 }}>
                Make sure to copy your token now. You won't be able to see it
                again!
              </Alert>
              <Paper
                sx={{
                  p: 2,
                  bgcolor: "grey.100",
                  fontFamily: "monospace",
                  fontSize: "0.875rem",
                  wordBreak: "break-all",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <Box sx={{ flex: 1 }}>{createdToken}</Box>
                <IconButton onClick={handleCopyToken} size="small">
                  {copied ? <CheckIcon color="success" /> : <CopyIcon />}
                </IconButton>
              </Paper>
            </Box>
          ) : (
            <Box sx={{ mt: 1 }}>
              <TextField
                fullWidth
                label="Token Name"
                value={newTokenData.name}
                onChange={(e) =>
                  setNewTokenData({ ...newTokenData, name: e.target.value })
                }
                margin="normal"
                placeholder="e.g., My Agent"
              />
              <FormControl fullWidth margin="normal">
                <InputLabel>Expiration</InputLabel>
                <Select
                  value={newTokenData.expiresIn}
                  label="Expiration"
                  onChange={(e) =>
                    setNewTokenData({
                      ...newTokenData,
                      expiresIn: e.target.value as number,
                    })
                  }
                >
                  <MenuItem value={86400}>1 day</MenuItem>
                  <MenuItem value={604800}>7 days</MenuItem>
                  <MenuItem value={2592000}>30 days</MenuItem>
                  <MenuItem value={7776000}>90 days</MenuItem>
                  <MenuItem value={31536000}>1 year</MenuItem>
                </Select>
              </FormControl>
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Permissions
              </Typography>
              <FormGroup>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={newTokenData.permissions.read}
                      onChange={(e) =>
                        setNewTokenData({
                          ...newTokenData,
                          permissions: {
                            ...newTokenData.permissions,
                            read: e.target.checked,
                          },
                        })
                      }
                    />
                  }
                  label="Read - Retrieve content from storage"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={newTokenData.permissions.write}
                      onChange={(e) =>
                        setNewTokenData({
                          ...newTokenData,
                          permissions: {
                            ...newTokenData.permissions,
                            write: e.target.checked,
                          },
                        })
                      }
                    />
                  }
                  label="Write - Store new content"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={newTokenData.permissions.issueTicket}
                      onChange={(e) =>
                        setNewTokenData({
                          ...newTokenData,
                          permissions: {
                            ...newTokenData.permissions,
                            issueTicket: e.target.checked,
                          },
                        })
                      }
                    />
                  }
                  label="Issue Ticket - Create temporary access tickets"
                />
              </FormGroup>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {createdToken ? (
            <Button onClick={handleCloseCreateDialog} variant="contained">
              Done
            </Button>
          ) : (
            <>
              <Button onClick={handleCloseCreateDialog} disabled={creating}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateToken}
                variant="contained"
                disabled={creating || !newTokenData.name.trim()}
              >
                {creating ? <CircularProgress size={20} /> : "Create Token"}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Delete Token?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the token{" "}
            <strong>{tokenToDelete?.name}</strong>? Any agents using this token
            will lose access immediately.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
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
