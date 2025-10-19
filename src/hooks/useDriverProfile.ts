import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ApiError, DriverProfileResponse, getDriverProfile } from '../api/driverApp';
import { useAuth } from './useAuth';

export function useDriverProfile(): UseQueryResult<DriverProfileResponse> {
  const { token, setDriver, signOut } = useAuth();

  return useQuery<DriverProfileResponse>({
    queryKey: ['driverProfile'],
    enabled: Boolean(token),
    queryFn: async () => {
      if (!token) {
        throw new Error('Missing auth token.');
      }
      try {
        const profile = await getDriverProfile(token);
        setDriver(profile.driver);
        return profile;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          // Token expired or invalid; force logout
          await signOut();
        }
        throw error;
      }
    },
    staleTime: 15_000,
    retry: 1,
    refetchOnMount: true,
  });
}
