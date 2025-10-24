import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import { useColorScheme } from '../../hooks/use-color-scheme';
import AdminMessageModal from '../components/AdminMessageModal';
import ErrorBoundary from '../components/ErrorBoundary';
import useAdminMessages from '../hooks/useAdminMessages';
import { setupGlobalHandlers } from '../utils/globalErrorReporter';
import { AuthProvider } from './AuthProvider';
import { RealtimeProvider } from './RealtimeProvider';
import RecapProvider from './RecapProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
});

if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        handleFocus(true);
      }
    });
    return () => subscription.remove();
  });

}

export function AppProviders({ children }: PropsWithChildren) {
  // Setup global error handlers once per app init. We pass a token getter so
  // error reports can be uploaded when available.
    try {
      setupGlobalHandlers(() => {
        try {
          // lazy require to avoid cycles at module load
          // Import a non-hook token getter to avoid calling hooks outside components
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { getCurrentAuthToken } = require('./AuthProvider');
          return typeof getCurrentAuthToken === 'function' ? getCurrentAuthToken() : null;
        } catch (_e) {
          return null;
        }
      });
  } catch (_e) {}

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <ThemeBridge>{children}</ThemeBridge>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

function ThemeBridge({ children }: PropsWithChildren) {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <RealtimeProvider>
        <RecapProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            {children}
            <AdminMessageBridge />
          </ThemeProvider>
        </RecapProvider>
      </RealtimeProvider>
    </AuthProvider>
  );
}

function AdminMessageBridge() {
  // This hook depends on Auth/Realtime providers being available. Keep it
  // in a child component so it runs after the providers are mounted.
  const { message, dismiss, acknowledge, snooze } = useAdminMessages();
  return <AdminMessageModal message={message} onClose={dismiss} onAcknowledge={acknowledge} onSnooze={snooze} />;
}
