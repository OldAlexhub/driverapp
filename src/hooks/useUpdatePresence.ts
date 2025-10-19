import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, DriverProfileResponse, UpdatePresencePayload, updateDriverPresence } from '../api/driverApp';
import { useAuth } from './useAuth';

export function useUpdatePresence() {
  const { token, signOut, setDriver } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<DriverProfileResponse, Error, UpdatePresencePayload>({
    mutationFn: async (payload) => {
      if (!token) {
        throw new Error('Missing auth token.');
      }
      try {
        return await updateDriverPresence(token, payload);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await signOut();
        }
        throw error as Error;
      }
    },
    onSuccess: (data) => {
      setDriver(data.driver);
      queryClient.setQueryData(['driverProfile'], data);
    },
  });
}
