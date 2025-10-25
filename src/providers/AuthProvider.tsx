import { useQueryClient } from '@tanstack/react-query';
// Note: do NOT import expo-notifications at module top-level. Some versions
// include an auto-registration FX which can run before native modules are
// available and cause EventEmitter / metro symbolication errors. We'll
// lazy-import notifications inside signIn where it's used.
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { PropsWithChildren, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    ApiError,
    DriverAppLoginRequest,
    DriverLoginResponse,
    DriverSummary,
    driverLogin,
    driverLogout,
} from '../api/driverApp';

type AuthContextValue = {
  initializing: boolean;
  token: string | null;
  driver: DriverSummary | null;
  signIn: (payload: DriverAppLoginRequest) => Promise<DriverLoginResponse>;
  signOut: () => Promise<void>;
  setDriver: (driver: DriverSummary | null) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const TOKEN_KEY = 'driverapp.auth_token';
const LEGACY_KEYS = ['driverapp/auth-token'];

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [initializing, setInitializing] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [driver, setDriverState] = useState<DriverSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadToken = async () => {
      try {
        for (const legacyKey of LEGACY_KEYS) {
          try {
            await SecureStore.deleteItemAsync(legacyKey);
          } catch {
            // ignore
          }
        }
        const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!cancelled && storedToken) {
          setToken(storedToken);
        }
      } catch (error) {
        console.warn('Failed to load stored auth token', error);
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    };
    loadToken();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (payload: DriverAppLoginRequest) => {
      try {
        const result = await driverLogin(payload);
        await SecureStore.setItemAsync(TOKEN_KEY, result.token);
        setToken(result.token);
        setDriverState(result.driver);
        // Seed the driverProfile cache with the returned driver instead of
        // clearing it. Clearing to `undefined` causes UI components that
        // depend on the query to briefly render their empty/placeholder
        // states (e.g. "Hello Driver" or missing fare config) while the
        // background refetch completes. Provide the known driver so the
        // UI remains stable and a refetch can still update the cache.
        try {
          queryClient.setQueryData(['driverProfile'], { driver: result.driver } as any);
        } catch {
          // ignore cache set errors
        }
        // Try to register a push token for this device if notifications are enabled.
        // Avoid importing `expo-notifications` when running inside Expo Go since
        // recent Expo Go builds no longer include remote push support and the
        // module may log or throw during its top-level execution. See:
        // https://docs.expo.dev/develop/development-builds/introduction/
        (async () => {
          try {
            if (Constants.appOwnership === 'expo') {
              // Running in Expo Go — skip push registration to avoid noisy errors.
              // Developers who need push tokens should use a development build /
              // custom dev client.
               
              console.info('Skipping push registration: running in Expo Go. Use a dev-client for push support.');
              return;
            }
            // dynamic import so the module's top-level code doesn't run on module
            // initialization in unsupported environments.
             
            const Notifications: typeof import('expo-notifications') = await import('expo-notifications');
            const permission = await Notifications.getPermissionsAsync();
            let granted = permission.granted;
            if (!granted) {
              const request = await Notifications.requestPermissionsAsync();
              granted = request.granted;
            }
            if (granted) {
              const tokenData = await Notifications.getExpoPushTokenAsync();
              const pushToken = (tokenData as any).data;
              if (pushToken && result.token) {
                const { registerDriverPushToken } = await import('../api/driverApp');
                try {
                  await registerDriverPushToken(result.token, { pushToken, deviceId: null });
                } catch (e) {
                  console.warn('Failed to register push token with server', e);
                }
              }
            }
          } catch (e) {
            console.warn('Push registration failed', e);
          }
        })();
        return result;
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }
        throw new Error('Unable to sign in. Check your connection and try again.');
      } finally {
        setInitializing(false);
      }
    },
    [queryClient],
  );

    // After token is set, try to flush any buffered diagnostics
    useEffect(() => {
      if (!token) return;
      (async () => {
        try {
          // dynamic import to avoid cycles
          const { flushDiagnostics } = await import('../utils/diagnostics');
          await flushDiagnostics(token);
        } catch {
          // ignore
        }
      })();
    }, [token]);

  const signOut = useCallback(async () => {
    const currentToken = token;
    setDriverState(null);
    setToken(null);
    queryClient.clear();
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    for (const legacyKey of LEGACY_KEYS) {
      try {
        await SecureStore.deleteItemAsync(legacyKey);
      } catch {
        // ignore
      }
    }
    if (currentToken) {
      try {
        await driverLogout(currentToken);
      } catch (error) {
        // Swallow network issues during logout; token already cleared locally.
        console.warn('Logout request failed', error);
      }
    }
  }, [queryClient, token]);

  const setDriver = useCallback((value: DriverSummary | null) => {
    setDriverState(value);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      initializing,
      token,
      driver,
      signIn,
      signOut,
      setDriver,
    }),
    [driver, initializing, setDriver, signIn, signOut, token],
  );

  // Maintain a process-global token reference for non-React consumers that
  // need to read the current auth token outside of React (e.g. global error
  // reporters). This avoids calling React hooks outside components.
  // Tests and other modules can import `getCurrentAuthToken`.
   
  try {
    // @ts-ignore - attach to module scope
    (global as any).__CURRENT_DRIVER_AUTH_TOKEN = token;
  } catch {
    // ignore
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within an AuthProvider.');
  }
  return ctx;
}

export function getCurrentAuthToken(): string | null {
  try {
    // @ts-ignore
    return (global as any).__CURRENT_DRIVER_AUTH_TOKEN ?? null;
  } catch {
    return null;
  }
}
