import { PropsWithChildren, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useQueryClient } from '@tanstack/react-query';
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
          } catch (_legacyErr) {
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
        queryClient.setQueryData(['driverProfile'], undefined);
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

  const signOut = useCallback(async () => {
    const currentToken = token;
    setDriverState(null);
    setToken(null);
    queryClient.clear();
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    for (const legacyKey of LEGACY_KEYS) {
      try {
        await SecureStore.deleteItemAsync(legacyKey);
      } catch (_legacyErr) {
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within an AuthProvider.');
  }
  return ctx;
}
