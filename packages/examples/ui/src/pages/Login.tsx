import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  Divider,
  Chip,
  CircularProgress,
} from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';

export default function Login() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const verificationCode = searchParams.get('code') || '';
  const pubkey = searchParams.get('pubkey') || '';

  // If no verification code, redirect to dashboard
  useEffect(() => {
    if (!verificationCode && !pubkey) {
      // Allow access without code for testing
    }
  }, [verificationCode, pubkey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);
      formData.append('verification_code', verificationCode);
      formData.append('pubkey', pubkey);

      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (response.ok) {
        setSuccess(true);
        // After 2 seconds, redirect to dashboard
        setTimeout(() => {
          navigate('/');
        }, 2000);
      } else {
        const text = await response.text();
        if (text.includes('Invalid username or password')) {
          setError('Invalid username or password');
        } else if (text.includes('Authorization failed')) {
          setError('Authorization failed. Invalid or expired verification code.');
        } else {
          setError('Login failed. Please try again.');
        }
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
          p: 2,
        }}
      >
        <Card sx={{ maxWidth: 400, width: '100%', textAlign: 'center', p: 4 }}>
          <Box
            sx={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 3,
            }}
          >
            <LockIcon sx={{ fontSize: 40, color: 'white' }} />
          </Box>
          <Typography variant="h5" gutterBottom fontWeight={600}>
            Authorization Complete!
          </Typography>
          <Typography color="text.secondary">
            The MCP client has been authorized. Redirecting...
          </Typography>
        </Card>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 400, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2,
              }}
            >
              <LockIcon sx={{ fontSize: 32, color: 'white' }} />
            </Box>
            <Typography variant="h5" fontWeight={600}>
              Authorize Application
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Enter your credentials to authorize the MCP client
            </Typography>
          </Box>

          {verificationCode && (
            <Box
              sx={{
                p: 2,
                mb: 3,
                borderRadius: 2,
                border: '2px dashed',
                borderColor: 'primary.main',
                bgcolor: 'primary.light',
                textAlign: 'center',
              }}
            >
              <Typography variant="caption" color="text.secondary" display="block">
                Verification Code
              </Typography>
              <Typography
                variant="h4"
                sx={{
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  letterSpacing: 4,
                  color: 'primary.main',
                }}
              >
                {verificationCode}
              </Typography>
            </Box>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              margin="normal"
              required
              autoComplete="username"
            />
            <TextField
              fullWidth
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              margin="normal"
              required
              autoComplete="current-password"
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={loading}
              sx={{
                mt: 3,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : 'Authorize'}
            </Button>
          </Box>

          <Divider sx={{ my: 3 }}>
            <Chip label="Test Accounts" size="small" />
          </Divider>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Chip
              label="test / test123"
              variant="outlined"
              size="small"
              onClick={() => {
                setUsername('test');
                setPassword('test123');
              }}
            />
            <Chip
              label="admin / admin123"
              variant="outlined"
              size="small"
              onClick={() => {
                setUsername('admin');
                setPassword('admin123');
              }}
            />
            <Chip
              label="demo / demo"
              variant="outlined"
              size="small"
              onClick={() => {
                setUsername('demo');
                setPassword('demo');
              }}
            />
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
