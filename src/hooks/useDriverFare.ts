import { useQuery } from '@tanstack/react-query';
import { fetchDriverFare, DriverFareResponse } from '../api/driverApp';
import { useAuth } from './useAuth';

export function useDriverFare() {
  const { token } = useAuth();

  return useQuery<DriverFareResponse>({
    queryKey: ['driverFare'],
    enabled: Boolean(token),
    queryFn: () => {
      if (!token) throw new Error('Missing auth token');
      return fetchDriverFare(token);
    },
    staleTime: 60_000,
  });
}
