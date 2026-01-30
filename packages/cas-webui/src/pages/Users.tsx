import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Chip,
  IconButton,
  Tooltip,
  ButtonGroup,
  alpha,
} from "@mui/material";
import {
  Refresh as RefreshIcon,
  PersonOff as RevokeIcon,
  AdminPanelSettings as AdminIcon,
  VerifiedUser as AuthorizedIcon,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";
import { apiRequest } from "../utils/api";

interface UserRoleEntry {
  userId: string;
  role: string;
  email?: string;
  name?: string;
}

const ROLE_CONFIG: Record<string, { label: string; color: "success" | "warning" | "error" | "default" | "primary" | "secondary" | "info" }> = {
  authorized: { label: "Authorized", color: "success" },
  admin: { label: "Admin", color: "primary" },
};

function truncateUserId(userId: string): string {
  if (userId.length <= 20) return userId;
  return `${userId.slice(0, 8)}...${userId.slice(-8)}`;
}

export default function Users() {
  const { getAccessToken, isAdmin, userRole, user } = useAuth();
  const [users, setUsers] = useState<UserRoleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [revokeDialog, setRevokeDialog] = useState<{ open: boolean; user: UserRoleEntry | null }>({
    open: false,
    user: null,
  });

  const currentUserId = user?.userId;

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setLoading(true);
      setError("");
      const token = await getAccessToken();
      if (!token) {
        setError("Not authenticated");
        return;
      }
      const res = await apiRequest("/api/auth/users", {}, token);
      if (!res.ok) {
        if (res.status === 403) setError("Access denied (admin only)");
        else setError("Failed to load users");
        return;
      }
      const data = (await res.json()) as { users?: UserRoleEntry[] };
      setUsers(data.users ?? []);
    } catch {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, isAdmin]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSetRole = async (userId: string, role: "authorized" | "admin") => {
    if (userId === currentUserId) return;
    setActionLoading(userId);
    setError("");
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await apiRequest(`/api/auth/users/${encodeURIComponent(userId)}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }, token);
      if (!res.ok) {
        const err = (await res.json()).error ?? "Failed to set role";
        setError(err);
        return;
      }
      await fetchUsers();
    } catch {
      setError("Failed to set role");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevoke = async () => {
    const target = revokeDialog.user;
    if (!target || target.userId === currentUserId) return;
    setActionLoading(target.userId);
    setError("");
    setRevokeDialog({ open: false, user: null });
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await apiRequest(`/api/auth/users/${encodeURIComponent(target.userId)}/authorize`, {
        method: "DELETE",
      }, token);
      if (!res.ok) {
        setError((await res.json()).error ?? "Failed to revoke");
        return;
      }
      await fetchUsers();
    } catch {
      setError("Failed to revoke");
    } finally {
      setActionLoading(null);
    }
  };

  if (userRole !== null && !isAdmin) {
    return (
      <Box>
        <Typography variant="h4" fontWeight={600} gutterBottom>
          User Management
        </Typography>
        <Alert severity="error" sx={{ mt: 2 }}>
          Access denied. Only administrators can manage user permissions.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 4, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={600} gutterBottom>
            User Management
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Grant or revoke user access. Users without a role are unauthorized.
          </Typography>
        </Box>
        <Button
          startIcon={<RefreshIcon />}
          onClick={fetchUsers}
          disabled={loading}
          variant="outlined"
          sx={{ borderRadius: 2 }}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Card sx={{ borderRadius: 3, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
          <CardContent sx={{ p: 0 }}>
            {users.length === 0 ? (
              <Box sx={{ p: 4 }}>
                <Typography color="text.secondary">
                  No users with a role yet. Use the script <code>bun run set-admin-users --set-admin &lt;email&gt;</code> to
                  add the first admin, or grant roles via API.
                </Typography>
              </Box>
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow sx={{ bgcolor: "grey.50" }}>
                      <TableCell sx={{ fontWeight: 600, py: 2 }}>User</TableCell>
                      <TableCell sx={{ fontWeight: 600, py: 2 }}>Role</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, py: 2, pr: 3 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {users.map((u) => {
                      const isSelf = u.userId === currentUserId;
                      const roleConfig = ROLE_CONFIG[u.role] ?? { label: u.role, color: "default" as const };
                      const isLoading = actionLoading === u.userId;

                      return (
                        <TableRow
                          key={u.userId}
                          sx={{
                            "&:hover": { bgcolor: "grey.50" },
                            ...(isSelf && { bgcolor: alpha("#667eea", 0.04) }),
                          }}
                        >
                          <TableCell sx={{ py: 2 }}>
                            <Box>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                <Typography variant="body1" fontWeight={500}>
                                  {u.email || u.name || "—"}
                                </Typography>
                                {isSelf && (
                                  <Chip label="You" size="small" variant="outlined" sx={{ height: 20, fontSize: "0.7rem" }} />
                                )}
                              </Box>
                              {u.email && u.name && (
                                <Typography variant="body2" color="text.secondary">
                                  {u.name}
                                </Typography>
                              )}
                              <Typography
                                variant="caption"
                                color="text.disabled"
                                fontFamily="monospace"
                                title={u.userId}
                              >
                                {truncateUserId(u.userId)}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell sx={{ py: 2 }}>
                            <Chip
                              label={roleConfig.label}
                              color={roleConfig.color}
                              size="small"
                              sx={{ fontWeight: 500 }}
                            />
                          </TableCell>
                          <TableCell align="right" sx={{ py: 2, pr: 3 }}>
                            {isSelf ? (
                              <Typography variant="caption" color="text.disabled">
                                Cannot modify yourself
                              </Typography>
                            ) : (
                              <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", alignItems: "center" }}>
                                <ButtonGroup size="small" variant="outlined" disabled={isLoading}>
                                  <Tooltip title="Set as Authorized">
                                    <Button
                                      onClick={() => handleSetRole(u.userId, "authorized")}
                                      color={u.role === "authorized" ? "success" : "inherit"}
                                      sx={{
                                        minWidth: 36,
                                        ...(u.role === "authorized" && {
                                          bgcolor: alpha("#4caf50", 0.1),
                                          borderColor: "success.main",
                                        }),
                                      }}
                                    >
                                      <AuthorizedIcon fontSize="small" />
                                    </Button>
                                  </Tooltip>
                                  <Tooltip title="Set as Admin">
                                    <Button
                                      onClick={() => handleSetRole(u.userId, "admin")}
                                      color={u.role === "admin" ? "primary" : "inherit"}
                                      sx={{
                                        minWidth: 36,
                                        ...(u.role === "admin" && {
                                          bgcolor: alpha("#1976d2", 0.1),
                                          borderColor: "primary.main",
                                        }),
                                      }}
                                    >
                                      <AdminIcon fontSize="small" />
                                    </Button>
                                  </Tooltip>
                                </ButtonGroup>
                                <Tooltip title="Revoke access">
                                  <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => setRevokeDialog({ open: true, user: u })}
                                    disabled={isLoading}
                                    sx={{
                                      border: 1,
                                      borderColor: "error.light",
                                      "&:hover": { bgcolor: alpha("#d32f2f", 0.08) },
                                    }}
                                  >
                                    <RevokeIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={revokeDialog.open}
        onClose={() => setRevokeDialog({ open: false, user: null })}
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ pb: 1 }}>Revoke User Access</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to revoke access for
            {revokeDialog.user ? (
              <>
                {" "}
                <strong>{revokeDialog.user.email || revokeDialog.user.name || truncateUserId(revokeDialog.user.userId)}</strong>
              </>
            ) : (
              ""
            )}
            ? They will become unauthorized and lose all CAS access.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 1 }}>
          <Button
            onClick={() => setRevokeDialog({ open: false, user: null })}
            sx={{ borderRadius: 2 }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleRevoke}
            color="error"
            variant="contained"
            sx={{ borderRadius: 2 }}
          >
            Revoke Access
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
