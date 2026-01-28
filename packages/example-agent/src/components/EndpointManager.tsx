/**
 * Endpoint Manager
 *
 * Component for managing AWP endpoints
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Paper,
} from '@mui/material';
import { Add, Delete, Refresh, Link as LinkIcon } from '@mui/icons-material';
import type { RegisteredEndpoint } from '../core';

export interface EndpointManagerProps {
  endpoints: RegisteredEndpoint[];
  isLoading: boolean;
  onRegister: (url: string, alias?: string) => Promise<unknown>;
  onUnregister: (endpointId: string) => void;
  onRefresh: () => Promise<void>;
}

export function EndpointManager({
  endpoints,
  isLoading,
  onRegister,
  onUnregister,
  onRefresh,
}: EndpointManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  const handleRegister = async () => {
    if (!url.trim()) {
      setError('URL is required');
      return;
    }

    try {
      new URL(url);
    } catch {
      setError('Invalid URL format');
      return;
    }

    setError(null);
    setRegistering(true);

    try {
      await onRegister(url.trim(), alias.trim() || undefined);
      setDialogOpen(false);
      setUrl('');
      setAlias('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register endpoint');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">AWP Endpoints</Typography>
        <Box>
          <IconButton onClick={onRefresh} disabled={isLoading} title="Refresh">
            <Refresh />
          </IconButton>
          <Button
            startIcon={<Add />}
            variant="outlined"
            size="small"
            onClick={() => setDialogOpen(true)}
          >
            Add
          </Button>
        </Box>
      </Box>

      {endpoints.length === 0 ? (
        <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined">
          <LinkIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography color="text.secondary">
            No endpoints registered. Add an AWP endpoint to get started.
          </Typography>
        </Paper>
      ) : (
        <List>
          {endpoints.map((endpoint) => (
            <ListItem
              key={endpoint.endpointId}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                mb: 1,
              }}
            >
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body1" fontWeight="medium">
                      {endpoint.alias || endpoint.endpointId}
                    </Typography>
                    <Chip
                      label={endpoint.endpointId}
                      size="small"
                      variant="outlined"
                      sx={{ fontFamily: 'monospace' }}
                    />
                    <Chip
                      label={endpoint.isAuthenticated ? 'Authenticated' : 'Not Authenticated'}
                      size="small"
                      color={endpoint.isAuthenticated ? 'success' : 'warning'}
                    />
                  </Box>
                }
                secondary={
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                  >
                    {endpoint.url}
                  </Typography>
                }
              />
              <ListItemSecondaryAction>
                <IconButton
                  edge="end"
                  onClick={() => onUnregister(endpoint.endpointId)}
                  title="Remove endpoint"
                >
                  <Delete />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      )}

      {/* Add Endpoint Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add AWP Endpoint</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label="Endpoint URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              fullWidth
              placeholder="https://example.com/api/awp"
              autoFocus
            />

            <TextField
              label="Alias (optional)"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              fullWidth
              placeholder="My Portal"
              helperText="A friendly name for this endpoint"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleRegister} variant="contained" disabled={registering}>
            {registering ? 'Adding...' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
