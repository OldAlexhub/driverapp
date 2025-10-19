import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { listDriverBookings, DriverBookingsResponse, ListBookingsParams } from '../api/driverApp';

type DriverBookingsOptions = {
  enabled?: boolean;
};

export function useDriverBookings(params: ListBookingsParams = {}, options: DriverBookingsOptions = {}) {
  const { token } = useAuth();
  const enabled = (options.enabled ?? true) && Boolean(token);

  return useQuery<DriverBookingsResponse>({
    queryKey: ['driverBookings', params],
    enabled,
    queryFn: () => {
      if (!token) throw new Error('Missing auth token');
      return listDriverBookings(token, params);
    },
    staleTime: 15_000,
  });
}
