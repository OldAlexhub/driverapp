import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import { useColorScheme } from '../../hooks/use-color-scheme';
import AdminMessageModal from '../components/AdminMessageModal';
import useAdminMessages from '../hooks/useAdminMessages';
import { AuthProvider } from './AuthProvider';
import { RealtimeProvider } from './RealtimeProvider';

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
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeBridge>{children}</ThemeBridge>
    </QueryClientProvider>
  );
}

function ThemeBridge({ children }: PropsWithChildren) {
  const colorScheme = useColorScheme();
  const { message, dismiss } = useAdminMessages();

  return (
    <AuthProvider>
      <RealtimeProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          {children}
          <AdminMessageModal message={message} onClose={dismiss} />
        </ThemeProvider>
      </RealtimeProvider>
    </AuthProvider>
  );
}
