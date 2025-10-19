import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { BookingStatus, BookingSummary } from '@/src/api/driverApp';
import { useDriverProfile } from '@/src/hooks/useDriverProfile';
import { useUpdatePresence } from '@/src/hooks/useUpdatePresence';
import { useAuth } from '@/src/hooks/useAuth';
import { useRealtime } from '@/src/providers/RealtimeProvider';
import { useDriverBookings } from '@/src/hooks/useDriverBookings';
import { useDriverLocation } from '@/src/hooks/useDriverLocation';
import { useAcknowledgeBooking, useDeclineBooking, useReportLocationMutation } from '@/src/hooks/useDriverActions';
import { formatCurrency } from '@/src/utils/format';
dayjs.extend(relativeTime);

interface IncomingAssignment {
  id: string;
  booking: Partial<BookingSummary>;
  expiresAt: number;
}

const WATCHED_STATUSES: BookingStatus[] = ['Assigned', 'EnRoute', 'PickedUp'];

export default function DashboardScreen() {
  const router = useRouter();
  const { data, isLoading, isFetching, refetch, error } = useDriverProfile();
  const { mutateAsync: updatePresence, isPending } = useUpdatePresence();
  const { signOut } = useAuth();
  const { socket } = useRealtime();
  const acknowledgeAssignment = useAcknowledgeBooking();
  const declineAssignment = useDeclineBooking();
  const reportLocation = useReportLocationMutation();
  const driverLocation = useDriverLocation();
  const { data: bookingData, isFetching: isBookingsFetching } = useDriverBookings({
    status: WATCHED_STATUSES,
  });

  const [feedback, setFeedback] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [assignmentPrompt, setAssignmentPrompt] = useState<IncomingAssignment | null>(null);
  const [assignmentCountdown, setAssignmentCountdown] = useState<number>(0);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const locationReportRef = useRef<number>(0);

  const active = data?.active;
  const hours = active?.hoursOfService;
  const dutyStart = hours?.dutyStart ? dayjs(hours.dutyStart) : null;

  const onDutyMinutesToday = useMemo(() => {
    if (!hours?.dutyStart) return hours?.onDutyMinutesToday || 0;
    const start = dayjs(hours.dutyStart);
    if (!start.isValid()) return hours?.onDutyMinutesToday || 0;
    return Math.max(dayjs().diff(start, 'minute'), 0);
  }, [hours?.dutyStart, hours?.onDutyMinutesToday]);

  const assignments = useMemo(() => bookingData?.bookings ?? [], [bookingData?.bookings]);
  const activeBooking = useMemo(() => {
    return (
      assignments.find((booking) => booking.status === 'PickedUp') ??
      assignments.find((booking) => booking.status === 'EnRoute') ??
      assignments.find((booking) => booking.status === 'Assigned') ??
      null
    );
  }, [assignments]);
  const pendingAssignments = useMemo(() => {
    return assignments
      .filter((booking) => booking.status === 'Assigned' && booking._id !== activeBooking?._id)
      .sort((a, b) => {
        const timeA = a.pickupTime ? dayjs(a.pickupTime).valueOf() : Number.MAX_SAFE_INTEGER;
        const timeB = b.pickupTime ? dayjs(b.pickupTime).valueOf() : Number.MAX_SAFE_INTEGER;
        return timeA - timeB;
      });
  }, [activeBooking?._id, assignments]);

  const handleOpenMeter = useCallback(
    (id?: string | null) => {
      if (!id) return;
      router.push({ pathname: '/(protected)/meter', params: { bookingId: id } });
    },
    [router],
  );

  const handleStartFlagdown = useCallback(() => {
    router.push('/(protected)/meter?mode=flagdown');
  }, [router]);

  const handleResumeTrip = useCallback(() => {
    if (!activeBooking?._id) return;
    handleOpenMeter(activeBooking._id);
  }, [activeBooking?._id, handleOpenMeter]);

  useEffect(() => {
    setAssignmentError(null);
  }, [assignmentPrompt?.id]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          await driverLocation.start({ distanceInterval: 25, timeInterval: 10000 });
        } catch (err) {
          if (!cancelled) {
            console.warn('Unable to start location updates', err);
          }
        }
      })();
      return () => {
        cancelled = true;
        driverLocation.stop();
      };
    }, [driverLocation]),
  );

  useEffect(() => {
    if (!socket) return;
    const handleAssignment = (payload: any = {}) => {
      const assignmentId = String(payload.id || payload._id || payload.bookingId || '');
      if (!assignmentId) return;
      setAssignmentPrompt({
        id: assignmentId,
        booking: payload,
        expiresAt: Date.now() + 45_000,
      });
      setAssignmentError(null);
    };

    const handleAssignmentCancelled = (payload: any = {}) => {
      const cancelledId = String(payload.id || payload._id || payload.bookingId || '');
      let cleared = false;
      setAssignmentPrompt((current) => {
        if (!current) return current;
        if (!cancelledId || current.id === cancelledId) {
          cleared = true;
          return null;
        }
        return current;
      });
      if (cleared) {
        setAssignmentCountdown(0);
        setAssignmentError(null);
        setFeedback('Dispatch reassigned your trip.');
      }
    };

    const handleDispatchMessage = (payload: any = {}) => {
      const title = payload?.title || 'Dispatch message';
      const body = payload?.body ? ` ${payload.body}` : '';
      setFeedback(`[Dispatch] ${title}.${body}`);
    };

    socket.on('assignment:new', handleAssignment);
    socket.on('assignment:cancelled', handleAssignmentCancelled);
    socket.on('message:new', handleDispatchMessage);

    return () => {
      socket.off('assignment:new', handleAssignment);
      socket.off('assignment:cancelled', handleAssignmentCancelled);
      socket.off('message:new', handleDispatchMessage);
    };
  }, [socket]);

  useEffect(() => {
    if (!assignmentPrompt) {
      setAssignmentCountdown(0);
      return;
    }
    const updateCountdown = () => {
      const seconds = Math.max(0, Math.ceil((assignmentPrompt.expiresAt - Date.now()) / 1000));
      setAssignmentCountdown(seconds);
      if (seconds <= 0) {
        setAssignmentPrompt(null);
        setFeedback('Dispatch reassigned your trip.');
      }
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [assignmentPrompt]);

  useEffect(() => {
    if (!activeBooking?._id || !driverLocation.location?.coords) return;
    const now = Date.now();
    if (now - locationReportRef.current < 10000) return;
    locationReportRef.current = now;
    reportLocation.mutate({
      id: activeBooking._id,
      payload: {
        lat: driverLocation.location.coords.latitude,
        lng: driverLocation.location.coords.longitude,
        speed: driverLocation.location.coords.speed ?? undefined,
        heading: driverLocation.location.coords.heading ?? undefined,
        accuracy: driverLocation.location.coords.accuracy ?? undefined,
      },
    });
  }, [
    activeBooking?._id,
    driverLocation.location?.coords,
    driverLocation.location?.timestamp,
    reportLocation,
  ]);

  const isResponding = acknowledgeAssignment.isPending || declineAssignment.isPending;

  const handleAcceptAssignment = useCallback(async () => {
    if (!assignmentPrompt || isResponding) return;
    try {
      setAssignmentError(null);
      const bookingId = assignmentPrompt.id;
      await acknowledgeAssignment.mutateAsync({ id: bookingId });
      setAssignmentPrompt(null);
      setAssignmentCountdown(0);
      setFeedback('Assignment accepted. Drive safe!');
      handleOpenMeter(bookingId);
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Unable to accept assignment.');
    }
  }, [acknowledgeAssignment, assignmentPrompt, handleOpenMeter, isResponding, setFeedback]);

  const handleDeclineAssignment = useCallback(async () => {
    if (!assignmentPrompt || isResponding) return;
    try {
      setAssignmentError(null);
      await declineAssignment.mutateAsync(assignmentPrompt.id);
      setAssignmentPrompt(null);
      setAssignmentCountdown(0);
      setFeedback('Assignment declined. Dispatch notified.');
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Unable to decline assignment.');
    }
  }, [declineAssignment, assignmentPrompt, isResponding, setFeedback]);

  if (isLoading && !data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#f9fafb" />
        </View>
      </SafeAreaView>
    );
  }

  const handleStartShift = async () => {
    if (isPending) return;
    if (dutyStart) {
      setMutationError('Shift already started.');
      return;
    }
    setFeedback(null);
    setMutationError(null);
    try {
      await updatePresence({
        availability: 'Online',
        status: 'Active',
        hoursOfService: { dutyStart: new Date().toISOString() },
        note: 'driver-app-start-shift',
      });
      setFeedback('Shift started. Stay safe out there.');
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Unable to start shift.');
    }
  };

  const handleEndShift = async () => {
    if (isPending) return;
    if (!dutyStart) {
      setMutationError('No active shift to end.');
      return;
    }
    setFeedback(null);
    setMutationError(null);
    try {
      const minutes = Math.max(dayjs().diff(dutyStart, 'minute'), 0);
      await updatePresence({
        availability: 'Offline',
        status: 'Inactive',
        hoursOfService: {
          dutyStart: null,
          onDutyMinutesToday: minutes,
          lastBreakEnd: new Date().toISOString(),
        },
        note: 'driver-app-end-shift',
      });
      setFeedback(`Shift ended. Logged ${minutes} minutes on duty.`);
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Unable to end shift.');
    }
  };

  const handleGoOffline = async () => {
    if (isPending) return;
    setFeedback(null);
    setMutationError(null);
    try {
      await updatePresence({ availability: 'Offline', note: 'driver-app-go-offline' });
      setFeedback('You are offline.');
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Unable to update status.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            tintColor="#ffffff"
            refreshing={Boolean(isFetching && !isLoading)}
            onRefresh={refetch}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>
              Hello {data?.driver?.firstName || 'Driver'}
            </Text>
            <Text style={styles.subtitle}>
              {active?.availability === 'Online'
                ? 'You are online and visible to dispatch.'
                : 'You are currently offline.'}
            </Text>
          </View>
          <Pressable onPress={signOut} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>
        </View>

        {error && (
          <Text style={styles.error}>
            {error instanceof Error ? error.message : 'Unable to load profile.'}
          </Text>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Hours of service</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Shift status</Text>
            <Text style={styles.value}>
              {dutyStart ? `On duty since ${dutyStart.format('h:mm A')}` : 'Off duty'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Today's on-duty minutes</Text>
            <Text style={styles.value}>{onDutyMinutesToday}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Weekly on-duty minutes</Text>
            <Text style={styles.value}>{hours?.onDutyMinutes7d || 0}</Text>
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.actionButton, dutyStart && styles.actionButtonDisabled]}
              onPress={handleStartShift}
              disabled={isPending || Boolean(dutyStart)}
            >
              <Text style={styles.actionText}>{isPending && !dutyStart ? 'Saving...' : 'Start shift'}</Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, !dutyStart && styles.actionButtonDisabled]}
              onPress={handleEndShift}
              disabled={isPending || !dutyStart}
            >
              <Text style={styles.actionText}>{isPending && dutyStart ? 'Saving...' : 'End shift'}</Text>
            </Pressable>
            <Pressable style={styles.secondaryAction} onPress={handleGoOffline} disabled={isPending}>
              <Text style={styles.secondaryText}>Go offline</Text>
            </Pressable>
          </View>

          {feedback && <Text style={styles.success}>{feedback}</Text>}
          {mutationError && <Text style={styles.error}>{mutationError}</Text>}
        </View>

        <View style={styles.quickActions}>
          <Pressable style={styles.quickActionPrimary} onPress={handleStartFlagdown}>
            <Text style={styles.quickActionTitle}>Start flagdown</Text>
            <Text style={styles.quickActionSubtitle}>Launch the meter for a street hail</Text>
          </Pressable>
          {activeBooking ? (
            <Pressable style={styles.quickActionSecondary} onPress={handleResumeTrip}>
              <Text style={[styles.quickActionTitle, styles.quickActionTitleSecondary]}>Resume trip</Text>
              <Text style={[styles.quickActionSubtitle, styles.quickActionSubtitleSecondary]}>
                {activeBooking.pickupAddress || 'Active dispatch assignment'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {activeBooking ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Active trip</Text>
            <View style={styles.bookingRow}>
              <View style={styles.bookingDetails}>
                <Text style={styles.bookingTitle}>{activeBooking.pickupAddress || 'Pickup TBD'}</Text>
                <Text style={styles.bookingSubtitle}>{activeBooking.dropoffAddress || 'Dropoff TBD'}</Text>
                <Text style={styles.bookingMetaLine}>
                  {activeBooking.pickupTime ? dayjs(activeBooking.pickupTime).format('MMM D, h:mm A') : 'ASAP'}
                </Text>
                {activeBooking.estimatedFare ? (
                  <Text style={styles.bookingMetaLine}>Estimate {formatCurrency(activeBooking.estimatedFare)}</Text>
                ) : null}
              </View>
              <View style={styles.bookingMeta}>
                <Text style={styles.bookingStatus}>{activeBooking.status}</Text>
                <Pressable style={styles.bookingAction} onPress={handleResumeTrip}>
                  <Text style={styles.bookingActionText}>Open meter</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next assignments</Text>
          {isBookingsFetching ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#f8fafc" />
              <Text style={styles.muted}>Updating assignments…</Text>
            </View>
          ) : pendingAssignments.length ? (
            pendingAssignments.map((booking) => (
              <View key={booking._id} style={styles.bookingRow}>
                <View style={styles.bookingDetails}>
                  <Text style={styles.bookingTitle}>{booking.pickupAddress || 'Pickup TBD'}</Text>
                  <Text style={styles.bookingSubtitle}>{booking.dropoffAddress || 'Dropoff TBD'}</Text>
                  {booking.estimatedFare ? (
                    <Text style={styles.bookingMetaLine}>Estimate {formatCurrency(booking.estimatedFare)}</Text>
                  ) : null}
                </View>
                <View style={styles.bookingMeta}>
                  <Text style={styles.bookingTime}>
                    {booking.pickupTime ? dayjs(booking.pickupTime).format('MMM D, h:mm A') : 'TBD'}
                  </Text>
                  <Text style={styles.bookingStatus}>{booking.status || 'Pending'}</Text>
                  <Pressable style={styles.bookingAction} onPress={() => handleOpenMeter(booking._id)}>
                    <Text style={styles.bookingActionText}>Open meter</Text>
                  </Pressable>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>
              No assigned trips yet. Dispatch will notify you when something comes up.
            </Text>
          )}
        </View>
      </ScrollView>
      {assignmentPrompt && (
        <View style={styles.assignmentOverlay}>
          <View style={styles.assignmentCard}>
            <Text style={styles.assignmentTitle}>Dispatch assignment</Text>
            <Text style={styles.assignmentSubtitle}>
              {assignmentPrompt.booking?.pickupAddress || 'Pickup location pending'}
            </Text>
            {assignmentPrompt.booking?.dropoffAddress ? (
              <Text style={styles.assignmentMeta}>
                Drop-off: {assignmentPrompt.booking.dropoffAddress}
              </Text>
            ) : null}
            <Text style={styles.assignmentMeta}>
              Pickup time:{' '}
              {assignmentPrompt.booking?.pickupTime
                ? dayjs(assignmentPrompt.booking.pickupTime).format('MMM D, h:mm A')
                : 'ASAP'}
            </Text>
            <Text style={styles.assignmentMeta}>
              Cab: {assignmentPrompt.booking?.cabNumber || active?.cabNumber || '?'}
            </Text>
            <Text style={styles.assignmentMeta}>
              Passengers: {assignmentPrompt.booking?.passengers ?? '?'}
            </Text>
            {assignmentError ? <Text style={styles.assignmentError}>{assignmentError}</Text> : null}
            <View style={styles.assignmentActions}>
              <Pressable
                style={[styles.assignmentActionButton, styles.assignmentDecline, isResponding && styles.assignmentDisabled]}
                onPress={handleDeclineAssignment}
                disabled={isResponding}
              >
                <Text style={styles.assignmentActionText}>{isResponding ? '...' : 'Decline'}</Text>
              </Pressable>
              <Pressable
                style={[styles.assignmentActionButton, styles.assignmentAccept, isResponding && styles.assignmentDisabled]}
                onPress={handleAcceptAssignment}
                disabled={isResponding}
              >
                <Text style={styles.assignmentActionText}>
                  {isResponding ? 'Processing...' : 'Accept'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.assignmentCountdown}>
              Respond within {assignmentCountdown}s
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#030712',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#f9fafb',
  },
  subtitle: {
    marginTop: 6,
    color: '#9ca3af',
    fontSize: 15,
  },
  logoutButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#f87171',
  },
  logoutText: {
    color: '#f87171',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  cardTitle: {
    color: '#e5e7eb',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  quickActionPrimary: {
    flex: 1,
    minWidth: 180,
    backgroundColor: '#22d3ee',
    borderRadius: 18,
    padding: 16,
    gap: 4,
  },
  quickActionSecondary: {
    flex: 1,
    minWidth: 180,
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  quickActionTitle: {
    fontWeight: '700',
    fontSize: 16,
    color: '#0f172a',
  },
  quickActionTitleSecondary: {
    color: '#e2e8f0',
  },
  quickActionSubtitle: {
    color: '#0f172a',
    fontSize: 12,
  },
  quickActionSubtitleSecondary: {
    color: '#94a3b8',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    color: '#94a3b8',
    fontSize: 15,
  },
  value: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 12,
    flexWrap: 'wrap',
  },
  actionButton: {
    flexGrow: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
  },
  actionButtonDisabled: {
    backgroundColor: '#1e3a8a',
    opacity: 0.6,
  },
  actionText: {
    color: '#f9fafb',
    fontWeight: '600',
    fontSize: 16,
  },
  secondaryAction: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#475569',
  },
  secondaryText: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  success: {
    marginTop: 16,
    color: '#4ade80',
  },
  error: {
    marginTop: 16,
    color: '#f97316',
  },
  muted: {
    color: '#94a3b8',
    fontSize: 14,
  },
  bookingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#1e293b',
    gap: 16,
  },
  bookingDetails: {
    flex: 1,
  },
  bookingMeta: {
    alignItems: 'flex-end',
  },
  bookingTitle: {
    color: '#f1f5f9',
    fontWeight: '600',
    fontSize: 16,
  },
  bookingSubtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 2,
  },
  bookingMetaLine: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
  },
  bookingTime: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  bookingStatus: {
    marginTop: 4,
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '600',
  },
  bookingAction: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#2563EB',
  },
  bookingActionText: {
    color: '#f8fafc',
    fontWeight: '600',
    fontSize: 13,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  assignmentOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 16,
    backgroundColor: 'rgba(2, 6, 23, 0.65)',
  },
  assignmentCard: {
    width: '100%',
    backgroundColor: '#0f172a',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#38bdf8',
    padding: 20,
    gap: 12,
    shadowColor: '#020617',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 24,
  },
  assignmentTitle: {
    color: '#bfdbfe',
    fontSize: 18,
    fontWeight: '700',
  },
  assignmentSubtitle: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
  },
  assignmentMeta: {
    color: '#94a3b8',
    fontSize: 14,
  },
  assignmentActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  assignmentActionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  assignmentDecline: {
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#475569',
  },
  assignmentAccept: {
    backgroundColor: '#2563EB',
  },
  assignmentDisabled: {
    opacity: 0.6,
  },
  assignmentActionText: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 16,
  },
  assignmentError: {
    color: '#f97316',
    fontSize: 14,
  },
  assignmentCountdown: {
    marginTop: 4,
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
  },

});

