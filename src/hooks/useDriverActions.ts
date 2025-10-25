import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    acknowledgeBooking,
    createFlagdown,
    declineBooking,
    FlagdownPayload,
    reportBookingLocation,
    ReportLocationPayload,
    updateBookingStatus,
    UpdateBookingStatusPayload,
} from '../api/driverApp';
import { useAuth } from './useAuth';

export function useAcknowledgeBooking() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => {
      if (!token) throw new Error('Missing auth token');
      return acknowledgeBooking(token, id, note);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
      queryClient.invalidateQueries({ queryKey: ['driverBookings'] });
    },
  });
}

export function useDeclineBooking() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => {
      if (!token) throw new Error('Missing auth token');
      return declineBooking(token, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
      queryClient.invalidateQueries({ queryKey: ['driverBookings'] });
    },
  });
}

export function useUpdateBookingStatusMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  // Note: we avoid importing or calling recap hooks at module load time to
  // prevent possible circular import issues. We'll attempt a lazy require of
  // the RecapProvider at runtime inside onSuccess below.

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateBookingStatusPayload }) => {
      if (!token) throw new Error('Missing auth token');
      return updateBookingStatus(token, id, payload);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
      queryClient.invalidateQueries({ queryKey: ['driverBookings'] });
      try {
        const payload = variables?.payload;
        const booking = (data as any)?.booking;
        if (payload?.status === 'Completed' && booking) {
          // Build a minimal recap payload and show it via RecapProvider if available.
          const recapPayload = {
            tripLabel: booking.bookingId ? `Booking #${booking.bookingId}` : booking._id ? `Booking ${String(booking._id).slice(-6)}` : 'Trip',
            distanceMiles: booking.meterMiles ?? booking.meterMiles ?? undefined,
            waitMinutes: booking.waitMinutes ?? undefined,
            elapsedSeconds: undefined,
            passengers: booking.passengers ?? undefined,
            otherFees: booking.appliedFees ?? undefined,
            flatRateName: booking.flatRateName ?? undefined,
            total: booking.finalFare ?? booking.estimatedFare ?? undefined,
          };
          try {
            // Lazy require to avoid circular dependencies during module import.
            // Require the provider module and call the exported global helper if present.
            // Use a relative path so bundlers/resolvers can find the file reliably.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require('../providers/RecapProvider');
            const show = mod?.showRecapGlobal ?? mod?.showRecap ?? null;
            if (typeof show === 'function') {
              show(recapPayload);
            }
          } catch {
            // ignore: recap is optional
          }
        }
      } catch {
        // no-op: recap is an optional enhancement
      }
    },
  });
}

export function useFlagdownMutation() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: FlagdownPayload) => {
      if (!token) throw new Error('Missing auth token');
      return createFlagdown(token, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
      queryClient.invalidateQueries({ queryKey: ['driverBookings'] });
    },
  });
}

export function useReportLocationMutation() {
  const { token } = useAuth();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReportLocationPayload }) => {
      if (!token) throw new Error('Missing auth token');
      return reportBookingLocation(token, id, payload);
    },
  });
}
