import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  acknowledgeBooking,
  declineBooking,
  updateBookingStatus,
  createFlagdown,
  reportBookingLocation,
  UpdateBookingStatusPayload,
  FlagdownPayload,
  ReportLocationPayload,
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

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateBookingStatusPayload }) => {
      if (!token) throw new Error('Missing auth token');
      return updateBookingStatus(token, id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driverProfile'] });
      queryClient.invalidateQueries({ queryKey: ['driverBookings'] });
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
