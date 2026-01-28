/**
 * AWP Agent - Main Application
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import { ThemeProvider, CssBaseline, useMediaQuery } from '@mui/material';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Tabs,
  Tab,
  Divider,
  Button,
  Chip,
  SwipeableDrawer,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Settings,
  Extension,
  Link as LinkIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { theme } from './theme';
import {
  LlmConfigPanel,
  EndpointManager,
  SkillSidebar,
  ChatPanel,
  ConversationList,
} from './components';
import { useLlmConfig, useAwpManager, useConversations, useAgent } from './hooks';
import { StorageContextProvider } from './contexts/StorageContext';
import type { Message } from './storage';

const LEFT_DRAWER_WIDTH = 280;
const RIGHT_DRAWER_WIDTH = 300;
const MOBILE_DRAWER_WIDTH = '85vw';

type RightTab = 'skills' | 'endpoints' | 'config';

export function App() {
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('config');

  // On desktop, open drawers by default
  useEffect(() => {
    if (!isMobile) {
      setLeftDrawerOpen(true);
      setRightDrawerOpen(true);
    }
  }, [isMobile]);

  // Hooks
  const { config, isConfigured, adapter, saveConfig } = useLlmConfig();
  const {
    manager,
    endpoints,
    skills,
    isLoading: endpointsLoading,
    registerEndpoint,
    unregisterEndpoint,
    refresh,
  } = useAwpManager();
  const {
    conversations,
    currentConversation,
    createConversation,
    loadConversation,
    deleteConversation,
    addMessage,
  } = useConversations();

  // Use ref to avoid stale closures in handleMessageAdded
  const currentConversationRef = useRef(currentConversation);
  currentConversationRef.current = currentConversation;
  const addMessageRef = useRef(addMessage);
  addMessageRef.current = addMessage;

  // Handle message persistence callback - uses refs to avoid recreating on every render
  const handleMessageAdded = useCallback(async (message: Message) => {
    if (currentConversationRef.current) {
      try {
        await addMessageRef.current(message);
      } catch (err) {
        console.error("Failed to persist message:", err);
      }
    }
  }, []);

  const {
    state,
    messages,
    streamingMessage,
    activeSkillIds,
    availableSkills,
    sendMessage,
    loadSkill,
    unloadSkill,
    clearConversation,
    loadMessages,
    stop,
    error,
  } = useAgent({ manager, adapter, onMessageAdded: handleMessageAdded });

  const handleNewConversation = async () => {
    await createConversation();
    clearConversation();
  };

  const handleSelectConversation = async (id: string) => {
    const conversation = await loadConversation(id);
    if (conversation) {
      loadMessages(conversation.messages);
    }
  };

  // Drawer content for left side
  const leftDrawerContent = (
    <>
      {isMobile && (
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Typography variant="h6">Conversations</Typography>
          <IconButton onClick={() => setLeftDrawerOpen(false)}>
            <CloseIcon />
          </IconButton>
        </Toolbar>
      )}
      {!isMobile && <Toolbar />}
      <ConversationList
        conversations={conversations}
        currentId={currentConversation?.id ?? null}
        onSelect={(id) => {
          handleSelectConversation(id);
          if (isMobile) setLeftDrawerOpen(false);
        }}
        onCreate={async () => {
          await handleNewConversation();
          if (isMobile) setLeftDrawerOpen(false);
        }}
        onDelete={deleteConversation}
      />
    </>
  );

  // Drawer content for right side
  const rightDrawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {isMobile && (
        <Toolbar sx={{ justifyContent: 'space-between', flexShrink: 0 }}>
          <Typography variant="h6">Settings</Typography>
          <IconButton onClick={() => setRightDrawerOpen(false)}>
            <CloseIcon />
          </IconButton>
        </Toolbar>
      )}
      {!isMobile && <Toolbar />}
      <Tabs
        value={rightTab}
        onChange={(_, value) => setRightTab(value)}
        variant="fullWidth"
        sx={{ flexShrink: 0 }}
      >
        <Tab icon={<Settings />} label="Config" value="config" sx={{ minWidth: 0, px: 1 }} />
        <Tab icon={<Extension />} label="Skills" value="skills" sx={{ minWidth: 0, px: 1 }} />
        <Tab icon={<LinkIcon />} label="AWP" value="endpoints" sx={{ minWidth: 0, px: 1 }} />
      </Tabs>
      <Divider />

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {rightTab === 'config' && (
          <LlmConfigPanel
            onSave={saveConfig}
            currentConfig={config}
          />
        )}

        {rightTab === 'skills' && (
          <SkillSidebar
            availableSkills={availableSkills.length > 0 ? availableSkills : skills}
            activeSkillIds={activeSkillIds}
            onLoadSkill={loadSkill}
            onUnloadSkill={unloadSkill}
          />
        )}

        {rightTab === 'endpoints' && (
          <Box sx={{ p: 2 }}>
            <EndpointManager
              endpoints={endpoints}
              isLoading={endpointsLoading}
              onRegister={registerEndpoint}
              onUnregister={unregisterEndpoint}
              onRefresh={refresh}
            />
          </Box>
        )}
      </Box>
    </Box>
  );

  const drawerWidth = isMobile ? MOBILE_DRAWER_WIDTH : LEFT_DRAWER_WIDTH;
  const rightDrawerWidth = isMobile ? MOBILE_DRAWER_WIDTH : RIGHT_DRAWER_WIDTH;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <StorageContextProvider baseUrl="http://localhost:3400">
        <Box sx={{ display: 'flex', height: '100vh' }}>
        {/* App Bar */}
        <AppBar
          position="fixed"
          sx={{
            zIndex: (theme) => theme.zIndex.drawer + 1,
            bgcolor: 'background.paper',
            color: 'text.primary',
            boxShadow: 'none',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Toolbar sx={{ px: { xs: 1, sm: 2 } }}>
            <IconButton
              edge="start"
              onClick={() => setLeftDrawerOpen(!leftDrawerOpen)}
              sx={{ mr: { xs: 1, sm: 2 } }}
            >
              <MenuIcon />
            </IconButton>

            <Typography 
              variant="h6" 
              component="div" 
              sx={{ 
                flexGrow: 1,
                fontSize: { xs: '1rem', sm: '1.25rem' },
              }}
            >
              AWP Agent
            </Typography>

            {/* Status indicators - hide some on mobile */}
            {!isConfigured && (
              <Chip
                label={isMobile ? "Configure" : "LLM not configured"}
                color="warning"
                size="small"
                sx={{ mr: 1 }}
                onClick={() => {
                  setRightTab('config');
                  setRightDrawerOpen(true);
                }}
              />
            )}
            {isConfigured && config && !isMobile && (
              <Chip
                label={config.model}
                size="small"
                variant="outlined"
                sx={{ mr: 1, cursor: 'pointer' }}
                onClick={() => {
                  setRightTab('config');
                  setRightDrawerOpen(true);
                }}
              />
            )}
            {endpoints.length > 0 && !isMobile && (
              <Chip
                label={`${endpoints.length} AWP`}
                size="small"
                variant="outlined"
                sx={{ mr: 1, cursor: 'pointer' }}
                onClick={() => {
                  setRightTab('endpoints');
                  setRightDrawerOpen(true);
                }}
              />
            )}

            <IconButton 
              onClick={() => setRightDrawerOpen(!rightDrawerOpen)}
              title="Settings"
            >
              <Settings />
            </IconButton>
          </Toolbar>
        </AppBar>

        {/* Left Drawer - Conversations */}
        {isMobile ? (
          <SwipeableDrawer
            anchor="left"
            open={leftDrawerOpen}
            onClose={() => setLeftDrawerOpen(false)}
            onOpen={() => setLeftDrawerOpen(true)}
            sx={{
              '& .MuiDrawer-paper': {
                width: drawerWidth,
                boxSizing: 'border-box',
              },
            }}
            disableBackdropTransition
          >
            {leftDrawerContent}
          </SwipeableDrawer>
        ) : (
          <Drawer
            variant="persistent"
            anchor="left"
            open={leftDrawerOpen}
            sx={{
              width: leftDrawerOpen ? LEFT_DRAWER_WIDTH : 0,
              flexShrink: 0,
              '& .MuiDrawer-paper': {
                width: LEFT_DRAWER_WIDTH,
                boxSizing: 'border-box',
              },
            }}
          >
            {leftDrawerContent}
          </Drawer>
        )}

        {/* Main Content */}
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            // On mobile, no margin adjustment needed since drawers overlay
            ml: isMobile ? 0 : (leftDrawerOpen ? 0 : `-${LEFT_DRAWER_WIDTH}px`),
            mr: isMobile ? 0 : (rightDrawerOpen ? 0 : `-${RIGHT_DRAWER_WIDTH}px`),
            transition: (theme) =>
              theme.transitions.create(['margin'], {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.leavingScreen,
              }),
          }}
        >
          <Toolbar />

          {/* Not configured state */}
          {!isConfigured && (
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                p: { xs: 2, sm: 4 },
              }}
            >
              <Settings sx={{ fontSize: { xs: 48, sm: 64 }, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h5" gutterBottom sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
                Configure LLM
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 3, textAlign: 'center', px: 2 }}>
                Set up your LLM API connection to start using the agent.
              </Typography>
              <Button
                variant="contained"
                size="large"
                onClick={() => {
                  setRightTab('config');
                  setRightDrawerOpen(true);
                }}
              >
                Configure LLM
              </Button>
            </Box>
          )}

          {/* No endpoints state */}
          {isConfigured && endpoints.length === 0 && (
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                p: { xs: 2, sm: 4 },
              }}
            >
              <LinkIcon sx={{ fontSize: { xs: 48, sm: 64 }, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h5" gutterBottom sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
                Add an AWP Endpoint
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 3, textAlign: 'center', px: 2 }}>
                Connect to an AWP server to access skills and tools.
              </Typography>
              <Button
                variant="contained"
                size="large"
                onClick={() => {
                  setRightDrawerOpen(true);
                  setRightTab('endpoints');
                }}
              >
                Add Endpoint
              </Button>
            </Box>
          )}

          {/* Chat state */}
          {isConfigured && endpoints.length > 0 && (
            <ChatPanel
              messages={messages}
              streamingMessage={streamingMessage}
              state={state}
              error={error}
              onSendMessage={sendMessage}
              onStop={stop}
            />
          )}
        </Box>

        {/* Right Drawer - Skills & Endpoints */}
        {isMobile ? (
          <SwipeableDrawer
            anchor="right"
            open={rightDrawerOpen}
            onClose={() => setRightDrawerOpen(false)}
            onOpen={() => setRightDrawerOpen(true)}
            sx={{
              '& .MuiDrawer-paper': {
                width: rightDrawerWidth,
                boxSizing: 'border-box',
              },
            }}
            disableBackdropTransition
          >
            {rightDrawerContent}
          </SwipeableDrawer>
        ) : (
          <Drawer
            variant="persistent"
            anchor="right"
            open={rightDrawerOpen}
            sx={{
              width: rightDrawerOpen ? RIGHT_DRAWER_WIDTH : 0,
              flexShrink: 0,
              '& .MuiDrawer-paper': {
                width: RIGHT_DRAWER_WIDTH,
                boxSizing: 'border-box',
              },
            }}
          >
            {rightDrawerContent}
          </Drawer>
        )}

      </Box>
      </StorageContextProvider>
    </ThemeProvider>
  );
}

export default App;
