import { BookingStatus, BookingSummary, FlatRateOption } from '@/src/api/driverApp';
import {
  useFlagdownMutation,
  useReportLocationMutation,
  useUpdateBookingStatusMutation,
} from '@/src/hooks/useDriverActions';
import { useDriverBookings } from '@/src/hooks/useDriverBookings';
import { useDriverFare } from '@/src/hooks/useDriverFare';
import { useDriverLocation } from '@/src/hooks/useDriverLocation';
import { useFlagdownMeter, type MeterStatus } from '@/src/hooks/useFlagdownMeter';
import { useRealtime } from '@/src/providers/RealtimeProvider';
import { formatCurrency, formatDistance, formatDuration } from '@/src/utils/format';
import { buildMeterConfig, computeFareBreakdown, FareBreakdown } from '@/src/utils/meter';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Params = {
  bookingId?: string | string[];
  mode?: string | string[];
};

const WATCHED_STATUSES: BookingStatus[] = ['Assigned', 'EnRoute', 'PickedUp'];

type RecapData = {
  fare: FareBreakdown;
  distanceMiles: number;
  waitMinutes: number;
  elapsedSeconds: number;
  passengers: number;
  otherFees: { name: string; amount: number }[];
  flatRateName?: string;
  tripLabel: string;
};

function isRunningStatus(status: MeterStatus): status is 'running' {
  return status === 'running';
}

export default function MeterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const bookingIdParam = params.bookingId;
  const modeParam = params.mode;
  const bookingId = Array.isArray(bookingIdParam) ? bookingIdParam[0] : bookingIdParam;
  const modeValue = Array.isArray(modeParam) ? modeParam[0] : modeParam;
  const isFlagdownMode = modeValue === 'flagdown' || !bookingId;
  const viewOnlyParam = (params as any)?.viewOnly;
  const viewOnlyValue = Array.isArray(viewOnlyParam) ? viewOnlyParam[0] : viewOnlyParam;
  const isReadOnly = viewOnlyValue === '1' || viewOnlyValue === 'true';

  const { data: fareData, isLoading: isFareLoading, error: fareError, refetch: refetchFare } = useDriverFare();
  const { data: bookingsData, isLoading: isBookingsLoading } = useDriverBookings(
    {
      status: WATCHED_STATUSES,
    },
    { enabled: !isFlagdownMode },
  );
  const updateBookingStatus = useUpdateBookingStatusMutation();
  const createFlagdown = useFlagdownMutation();
  const queryClient = useQueryClient();
  const reportLocation = useReportLocationMutation();
  const meter = useFlagdownMeter();
  const driverLocation = useDriverLocation();

  const lastReportRef = useRef<number>(0);
  const lastLocationRef = useRef(driverLocation.location);
  const [meterError, setMeterError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tripStarted, setTripStarted] = useState(false);
  const [recap, setRecap] = useState<RecapData | null>(null);
  const [recapVisible, setRecapVisible] = useState(false);
  const [finalBreakdown, setFinalBreakdown] = useState<FareBreakdown | null>(null);
  // Guard to avoid opening the recap modal multiple times from overlapping async flows
  const recapOpenRef = useRef(false);

  const openRecapOnce = useCallback((recapData: RecapData | null, breakdown: FareBreakdown | null) => {
    if (recapOpenRef.current) return;
    recapOpenRef.current = true;
    if (breakdown) setFinalBreakdown(breakdown);
    if (recapData) setRecap(recapData);
    setRecapVisible(true);
  }, []);

  // Animated fare value for live count-up and small pulse on increases
  // initialize with 0 here; we'll animate to the actual computed value after it's available
  const animatedFare = useRef<any>(new Animated.Value(0));
  const animatedScale = useRef<any>(new Animated.Value(1));
  const [displayedFare, setDisplayedFare] = useState<number>(0);
  const previousFareRef = useRef<number>(0);

  // Compact view controls (allow forcing compact UI in portrait)
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [forceCompact, setForceCompact] = useState(false);
  const isCompactView = isLandscape || forceCompact;
  // dynamically compute fare font size to avoid clipping in landscape or on small screens
  const fareFontSize = isLandscape ? Math.max(28, Math.min(48, Math.floor(width * 0.12))) : 56;
  const [showDebug, setShowDebug] = useState(false);
  const { connected: realtimeConnected } = useRealtime();

  const [outboxCount, setOutboxCount] = useState<number>(0);

  const [selectedFeeNames, setSelectedFeeNames] = useState<string[]>([]);
  const [passengers, setPassengers] = useState<number>(1);
  const [flagdownDropoff, setFlagdownDropoff] = useState('');
  const [selectedFlatRateId, setSelectedFlatRateId] = useState<string | null>(null);

  const fareConfig = fareData?.fare;
  const flatRates = useMemo<FlatRateOption[]>(() => (fareData?.flatRates ?? []).filter((rate) => rate?.active), [fareData]);

  const booking: BookingSummary | null = useMemo(() => {
    if (isFlagdownMode) return null;
    if (!bookingId) return null;
    return bookingsData?.bookings?.find((candidate) => candidate._id === bookingId) ?? null;
  }, [bookingId, bookingsData?.bookings, isFlagdownMode]);

  const bookingFlatRate = useMemo(() => {
    if (!booking?.flatRateRef) return null;
    return flatRates.find((rate) => rate._id === booking.flatRateRef) ?? null;
  }, [booking?.flatRateRef, flatRates]);

  const effectiveFlatRate = useMemo(() => {
    if (bookingFlatRate) return bookingFlatRate;
    if (!isFlagdownMode && booking?.fareStrategy === 'flat' && booking?.flatRateAmount && booking?.flatRateName) {
      return {
        _id: booking.flatRateRef ?? 'dispatch-flat-rate',
        name: booking.flatRateName,
        amount: booking.flatRateAmount,
        active: true,
      } satisfies FlatRateOption;
    }
    if (selectedFlatRateId) {
      return flatRates.find((rate) => rate._id === selectedFlatRateId) ?? null;
    }
    return null;
  }, [booking?.fareStrategy, booking?.flatRateAmount, booking?.flatRateName, booking?.flatRateRef, bookingFlatRate, flatRates, isFlagdownMode, selectedFlatRateId]);

  const isFlatRateTrip = Boolean(effectiveFlatRate);

  useEffect(() => {
    if (booking?.passengers && booking.passengers > 0) {
      setPassengers(booking.passengers);
    }
    if (booking?.appliedFees?.length) {
      setSelectedFeeNames(booking.appliedFees.map((fee) => fee.name).filter(Boolean));
    }
    if (bookingFlatRate) {
      setSelectedFlatRateId(bookingFlatRate._id);
    }
  }, [booking, bookingFlatRate]);

  // If the driver navigates away mid-trip and returns, resume the UI state
  // so they don't need to press Start again. For meter-based trips we rely on
  // the persisted meter state (meter.status). For dispatched flat-rate
  // bookings the server marks the booking 'PickedUp' when the driver started
  // the trip — use that to set the local tripStarted flag.
  //
  // IMPORTANT: wait for the meter hook to finish hydration before reading
  // meter.status. Previously the screen could read an unhhydrated 'idle'
  // state and fail to resume the UI. The hook now exposes `hydrated` so we
  // defer until it's true.
  useEffect(() => {
    // For flat-rate dispatched trips, resume if server shows PickedUp
    if (isFlatRateTrip) {
      if (booking?.status === 'PickedUp') {
        setTripStarted(true);
      }
      return;
    }

    // Wait for persistence hydration to complete to avoid a race where the
    // hook's initial state is still 'idle' while the persisted snapshot is
    // being loaded.
    if (!meter.hydrated) return;

    // For meter trips (flagdown or dispatched), if the meter hook reports
    // running or paused (mid-trip), reflect that in the UI so the driver
    // doesn't need to press Start again.
    if (meter.status === 'running' || meter.status === 'paused') {
      setTripStarted(true);
    }
  }, [isFlatRateTrip, booking?.status, meter.status, meter.hydrated]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      // In read-only mode we must not start background location reporting or
      // other side-effects. Exit early.
      if (isReadOnly) return () => {};

      (async () => {
        try {
          await driverLocation.start({ distanceInterval: 10, timeInterval: 5000 });
        } catch (error) {
          if (!cancelled) {
            const message = error instanceof Error ? error.message : 'Unable to access location.';
            setActionError(message);
          }
        }
      })();
      return () => {
        cancelled = true;
        driverLocation.stop();
      };
    }, [driverLocation, isReadOnly]),
  );

  useEffect(() => {
    if (driverLocation.location) {
      lastLocationRef.current = driverLocation.location;
    }
  }, [driverLocation.location]);

  // Periodically refresh outbox count so drivers can see queued submissions.
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = async () => {
      try {
        const mod = await import('@/src/utils/offlineOutbox');
        const items = await mod.listOutbox();
        if (mounted) setOutboxCount(items.length);
      } catch {
        // ignore
      }
    };
    // refresh immediately and then poll
    void refresh();
    timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [realtimeConnected]);

  useEffect(() => {
    // Only report booking location to the server when the driver is actively on a trip
    // (dispatched: EnRoute or PickedUp) or when running in flagdown mode (driver-initiated trip).
    // We still keep local live location updates for dispatch via updatePresence elsewhere.
  if (isReadOnly) return; // don't report location for read-only views
  const hasCoords = Boolean(driverLocation.location?.coords);
    const isActiveTrip = isFlagdownMode || Boolean(
      booking?._id && (booking.dispatchMethod === 'flagdown' || ['EnRoute', 'PickedUp'].includes(booking.status))
    );
    if (!isActiveTrip || !hasCoords) return;

    const now = Date.now();
    if (now - lastReportRef.current < 10000) return;
    lastReportRef.current = now;

    // booking._id should exist when not in flagdown-mode; guard defensively and narrow coords
    if (!booking?._id && isFlagdownMode) {
      // In flagdown mode there is no booking yet; skip timeline writes. The flagdown flow will create the booking on submit.
      return;
    }
    if (!booking?._id) return; // defensive guard: we need a booking id to POST location

    const coords = driverLocation.location?.coords;
    if (!coords) return;

    reportLocation.mutate({
      id: booking._id,
      payload: {
        lat: coords.latitude,
        lng: coords.longitude,
        speed: coords.speed ?? undefined,
        heading: coords.heading ?? undefined,
        accuracy: coords.accuracy ?? undefined,
      },
    });
  }, [booking?._id, booking?.status, booking?.dispatchMethod, isFlagdownMode, driverLocation.location?.timestamp, driverLocation.location?.coords, reportLocation, isReadOnly]);

  const availableOtherFees = useMemo(() => {
    const baseFees = fareConfig?.otherFees ?? [];
    if (!booking?.appliedFees?.length) return baseFees;
    const merged = new Map<string, { name: string; amount: number }>();
    baseFees.forEach((fee) => {
      if (!fee) return;
      merged.set(fee.name, { name: fee.name, amount: Number(fee.amount ?? 0) });
    });
    booking.appliedFees.forEach((fee) => {
      if (!fee?.name || merged.has(fee.name)) return;
      merged.set(fee.name, { name: fee.name, amount: Number(fee.amount ?? 0) });
    });
    return Array.from(merged.values());
  }, [fareConfig?.otherFees, booking?.appliedFees]);

  const selectedFees = useMemo(() => {
    const map = new Map<string, { name: string; amount: number }>();
    availableOtherFees.forEach((fee) => map.set(fee.name, { name: fee.name, amount: Number(fee.amount ?? 0) }));
    return selectedFeeNames
      .map((name) => map.get(name))
      .filter((fee): fee is { name: string; amount: number } => Boolean(fee));
  }, [availableOtherFees, selectedFeeNames]);

  const computedBreakdown = useMemo(() => {
    if (!fareConfig) return null;
    const distanceMiles = meter.totals.distanceMiles ?? 0;
    const waitMinutes = meter.totals.waitMinutes ?? 0;
    const flatAmount = effectiveFlatRate?.amount ?? null;
    return computeFareBreakdown({
      config: fareConfig,
      distanceMiles,
      waitMinutes,
      passengerCount: passengers,
      otherFees: selectedFees,
      flatRateAmount: isFlatRateTrip ? flatAmount : undefined,
    });
  }, [effectiveFlatRate?.amount, fareConfig, isFlatRateTrip, meter.totals.distanceMiles, meter.totals.waitMinutes, passengers, selectedFees]);

  // For the live animated fare we only update when a 0.75-mile milestone or whole minute
  // of waiting time has been reached. This reduces frequent micro-updates and
  // makes the count-up feel tied to meter milestones.
  const METER_INCREMENT_MILES = 0.75; // display milestone step
  const rawDistanceMiles = meter.totals.distanceMiles ?? 0;
  const displayDistanceMiles = Math.floor(rawDistanceMiles / METER_INCREMENT_MILES) * METER_INCREMENT_MILES;
  const displayWaitMinutes = Math.floor(meter.totals.waitMinutes ?? 0);

  const displayComputedBreakdown = useMemo(() => {
    if (!fareConfig) return null;
    // flat rate trips update immediately (no per-mile/per-minute changes)
    if (isFlatRateTrip) return computedBreakdown;
    try {
      return computeFareBreakdown({
        config: fareConfig,
        distanceMiles: displayDistanceMiles,
        waitMinutes: displayWaitMinutes,
        passengerCount: passengers,
        otherFees: selectedFees,
      });
    } catch {
      return null;
    }
  }, [fareConfig, isFlatRateTrip, computedBreakdown, displayDistanceMiles, displayWaitMinutes, passengers, selectedFees]);

  // Animate the fare when the live computed breakdown (or finalBreakdown) changes.
  // For live updates prefer the milestone-based `displayComputedBreakdown` so the
  // big fare value only changes on meaningful meter milestones (e.g. 0.75 mi or 1 min)
  // rather than cent-by-cent as fractional distance accumulates.
  useEffect(() => {
    const liveBreakdown = isFlatRateTrip ? computedBreakdown : displayComputedBreakdown ?? computedBreakdown;
    const rawTarget = finalBreakdown ? finalBreakdown.total : liveBreakdown ? liveBreakdown.total : 0;
    const target = Number.isFinite(rawTarget) ? rawTarget : 0;
    const prev = Number.isFinite(previousFareRef.current) ? previousFareRef.current : 0;
    // animate number value
    Animated.timing(animatedFare.current, {
      toValue: target,
      duration: 600,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();

    // pulse when fare increases noticeably
    if (target > prev + 0.001) {
      Animated.sequence([
        Animated.timing(animatedScale.current, { toValue: 1.08, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(animatedScale.current, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
      // lightweight haptic feedback for an increase milestone
      try {
        // Medium impact provides a subtle, noticeable feedback on most devices
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // ignore if haptics unavailable
      }
    }
    previousFareRef.current = target;
  }, [computedBreakdown, displayComputedBreakdown, finalBreakdown, animatedFare, animatedScale, isFlatRateTrip]);

  // Subscribe to animated value updates and set a numeric displayedFare for formatting
  useEffect(() => {
    const af = animatedFare.current;
    const id = af.addListener(({ value }: { value: number }) => {
      setDisplayedFare(Number.isFinite(value) ? Number(value) : 0);
    });
    // initialize
    setDisplayedFare(Number.isFinite(previousFareRef.current) ? previousFareRef.current : 0);
    return () => {
      if (af && id) {
        af.removeListener(id);
      }
    };
  }, []);

  const meterStatus = meter.status;
  const isMeterRunning = isRunningStatus(meterStatus);
  const isMeterCompleted = meterStatus === 'completed';

  // Keep the screen awake while the meter is running
  useEffect(() => {
    let active = false;
    let keepModule: any = null;
    let deactivated = false;
    const activate = async () => {
      try {
        // dynamic import to avoid top-level native module issues
        const mod = await import('expo-keep-awake');
        keepModule = mod && (mod.default ?? mod);
        if (!keepModule) return;
        if (typeof keepModule.activateKeepAwakeAsync === 'function') {
          await keepModule.activateKeepAwakeAsync();
          active = true;
        } else if (typeof keepModule.activateKeepAwake === 'function') {
          keepModule.activateKeepAwake();
          active = true;
        } else if (typeof keepModule.activate === 'function') {
          keepModule.activate();
          active = true;
        }
      } catch (err) {
        // best-effort only
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug('[meter] keep-awake activation failed', err);
      }
    };

    const deactivate = async () => {
      if (!active || deactivated || !keepModule) return;
      try {
        if (typeof keepModule.deactivateKeepAwakeAsync === 'function') {
          await keepModule.deactivateKeepAwakeAsync();
        } else if (typeof keepModule.deactivateKeepAwake === 'function') {
          keepModule.deactivateKeepAwake();
        } else if (typeof keepModule.deactivate === 'function') {
          keepModule.deactivate();
        }
      } catch (e) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug('[meter] keep-awake deactivation failed', e);
      } finally {
        deactivated = true;
        active = false;
        keepModule = null;
      }
    };

    if (isMeterRunning) {
      activate();
    } else {
      // if meter stopped, ensure deactivation
      deactivate();
    }

    // cleanup on unmount
    return () => {
      // try to deactivate if we activated earlier
      void deactivate();
    };
  }, [isMeterRunning]);

  const startDisabled =
    submitting ||
    !fareConfig ||
    isMeterRunning ||
    (isFlatRateTrip ? tripStarted : isMeterRunning || isMeterCompleted);

  const stopDisabled =
    submitting ||
    (!tripStarted && !isFlatRateTrip) ||
    (isFlatRateTrip ? !tripStarted : !isMeterRunning);

  const handleToggleFee = (name: string) => {
    setSelectedFeeNames((current) => {
      if (current.includes(name)) {
        return current.filter((fee) => fee !== name);
      }
      return [...current, name];
    });
  };

  const handlePassengerChange = (delta: number) => {
    setPassengers((current) => {
      const next = Math.max(1, Math.min(8, current + delta));
      return next;
    });
  };

  const handleFlatRateSelect = (id: string | null) => {
    if (!isFlagdownMode || bookingFlatRate) return;
    setSelectedFlatRateId(id);
  };

  const handleStartTrip = useCallback(async () => {
    if (isReadOnly) {
      setActionError('Read-only view — cannot start trip.');
      return;
    }
    if (!fareConfig) return;
    setActionError(null);
    // clear any previous final fare when starting a new trip
    setFinalBreakdown(null);
    try {
      if (isFlatRateTrip) {
        if (!tripStarted) {
          setTripStarted(true);
          if (booking && booking.status !== 'PickedUp') {
            await updateBookingStatus.mutateAsync({
              id: booking._id,
              payload: {
                status: 'PickedUp',
                note: 'Driver started flat-rate trip',
                flatRateId: effectiveFlatRate?._id,
              },
            });
          }
          setStatusMessage('Trip started. Drive safe.');
        }
        return;
      }

      await meter.start({ config: buildMeterConfig(fareConfig) });
      setTripStarted(true);
      setMeterError(null);
      if (booking && booking.status !== 'PickedUp') {
        await updateBookingStatus.mutateAsync({
          id: booking._id,
          payload: {
            status: 'PickedUp',
            note: 'Driver started meter trip',
          },
        });
      }
      setStatusMessage('Meter running.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start trip.';
      setMeterError(message);
    }
  }, [booking, effectiveFlatRate?._id, fareConfig, isFlatRateTrip, meter, tripStarted, updateBookingStatus, isReadOnly]);

  const handleEndTrip = useCallback(async () => {
    if (isReadOnly) {
      setActionError('Read-only view — cannot end trip.');
      return;
    }
    if (submitting || !fareConfig) return;
    if (!isFlatRateTrip && !isRunningStatus(meter.status)) {
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {

      // Try to get a fresh GPS fix before submitting the trip so dropoff coordinates
      // and the final meter values are as accurate as possible. Race this against
      // a short timeout so the UI doesn't hang on slow GPS fixes.
      let currentLocation = lastLocationRef.current ?? driverLocation.location;
      const prevStatus = statusMessage;
      setStatusMessage('Getting final location…');
      try {
        const fresh = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation }),
          new Promise<Location.LocationObject | null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ]);
        if (fresh) {
          currentLocation = fresh;
          lastLocationRef.current = fresh;
        }
      } catch {
        // ignore GPS fetch errors and fall back to last known position
      } finally {
        setStatusMessage(prevStatus);
      }

      const pickupLat = currentLocation?.coords?.latitude;
      const pickupLon = currentLocation?.coords?.longitude;
      const dropoffLat = currentLocation?.coords?.latitude;
      const dropoffLon = currentLocation?.coords?.longitude;
      if (isFlagdownMode && (typeof pickupLat !== 'number' || typeof pickupLon !== 'number')) {
        setActionError('Waiting for a GPS fix before submitting the trip. Move to open sky and try again.');
        return;
      }
      if (!isFlatRateTrip) {
        await meter.stop();
        // meter.stop dispatches a STOP action synchronously but state updates
        // propagate on the next render. Wait briefly for meter.status to become
        // 'completed' to reduce race conditions when reading totals immediately.
        const waitForCompleted = async (timeoutMs = 1500, intervalMs = 100) => {
          const start = Date.now();
           
          while (Date.now() - start < timeoutMs) {
            if (meter.status === 'completed') return true;
            // small delay
             
            await new Promise((r) => setTimeout(r, intervalMs));
          }
          return false;
        };
        await waitForCompleted();
      }
      const distanceMiles = isFlatRateTrip ? 0 : meter.totals.distanceMiles ?? 0;
      const waitMinutes = isFlatRateTrip ? 0 : meter.totals.waitMinutes ?? 0;
      const elapsedSeconds = isFlatRateTrip ? 0 : meter.totals.elapsedSeconds ?? 0;
      const breakdown =
        computedBreakdown ??
        computeFareBreakdown({
          config: fareConfig,
          distanceMiles,
          waitMinutes,
          passengerCount: passengers,
          otherFees: selectedFees,
          flatRateAmount: isFlatRateTrip ? effectiveFlatRate?.amount ?? 0 : undefined,
        });
      const finalTotal = Number(breakdown.total.toFixed(2));
      const otherFeeNames = selectedFees.map((fee) => fee.name);

      // Developer safety guard: when running in dev and the computed distance is
      // extremely large (simulator playback), defer the submission and ask for
      // explicit confirmation to avoid accidental huge fares being sent.
      const DEV_DISTANCE_THRESHOLD = 200; // miles
      if (__DEV__ && distanceMiles > DEV_DISTANCE_THRESHOLD) {
        setPendingSubmission({ distanceMiles, waitMinutes, elapsedSeconds, breakdown, otherFeeNames });
        setSubmitting(false);
        setStatusMessage(`Large trip detected (${distanceMiles.toFixed(1)} mi). Confirm to submit.`);
        return;
      }

      if (booking) {
        try {
          await updateBookingStatus.mutateAsync({
            id: booking._id,
            payload: {
              status: 'Completed',
              // Always send numeric values (server requires meterMiles for meter trips).
              meterMiles: Number(distanceMiles.toFixed(2)),
              waitMinutes: Number(waitMinutes.toFixed(1)),
              dropoffAddress: flagdownDropoff.trim() || booking.dropoffAddress || undefined,
              dropoffLat: lastLocationRef.current?.coords?.latitude,
              dropoffLon: lastLocationRef.current?.coords?.longitude,
              note: isFlatRateTrip ? 'Driver completed flat-rate trip' : 'Meter trip completed',
              flatRateId: effectiveFlatRate?._id,
              otherFeeNames: otherFeeNames.length ? otherFeeNames : undefined,
            },
          });
          // refresh driver bookings so other screens (dashboard/completed list) show updated fare
          await queryClient.refetchQueries({ queryKey: ['driverBookings'], exact: false });
        } catch (err) {
          // If the network/mutation failed, enqueue for later retry
          try {
            const { enqueueOutbox } = await import('@/src/utils/offlineOutbox');
            await enqueueOutbox({
              id: `u-${Date.now()}`,
              type: 'updateBookingStatus',
              bookingId: booking._id,
              payload: {
                status: 'Completed',
                meterMiles: Number(distanceMiles.toFixed(2)),
                waitMinutes: Number(waitMinutes.toFixed(1)),
                dropoffAddress: flagdownDropoff.trim() || booking.dropoffAddress || undefined,
                dropoffLat: lastLocationRef.current?.coords?.latitude,
                dropoffLon: lastLocationRef.current?.coords?.longitude,
                note: isFlatRateTrip ? 'Driver completed flat-rate trip' : 'Meter trip completed',
                flatRateId: effectiveFlatRate?._id,
                otherFeeNames: otherFeeNames.length ? otherFeeNames : undefined,
              },
              createdAt: Date.now(),
            });
            setStatusMessage('Trip saved locally and will be submitted when back online.');
          } catch {
            // fallback: surface original error
            throw err;
          }
        }
      } else {
        const flagdownPayload = {
          dropoffAddress: flagdownDropoff.trim() || undefined,
          passengers,
          estimatedFare: finalTotal,
          flatRateId: effectiveFlatRate?._id ?? undefined,
          pickupLat: pickupLat ?? undefined,
          pickupLon: pickupLon ?? undefined,
          dropoffLat: dropoffLat ?? undefined,
          dropoffLon: dropoffLon ?? undefined,
        };
        try {
          const flagdownResponse = await createFlagdown.mutateAsync(flagdownPayload);

          if (flagdownResponse?.booking?._id) {
            try {
              await updateBookingStatus.mutateAsync({
                id: flagdownResponse.booking._id,
                payload: {
                  status: 'Completed',
                  meterMiles: Number(distanceMiles.toFixed(2)),
                  waitMinutes: Number(waitMinutes.toFixed(1)),
                  dropoffAddress: flagdownDropoff.trim() || undefined,
                  dropoffLat: lastLocationRef.current?.coords?.latitude,
                  dropoffLon: lastLocationRef.current?.coords?.longitude,
                  note: 'Flagdown meter completed via driver app',
                  flatRateId: effectiveFlatRate?._id,
                  otherFeeNames: otherFeeNames.length ? otherFeeNames : undefined,
                },
              });
              await queryClient.refetchQueries({ queryKey: ['driverBookings'], exact: false });
            } catch {
              // enqueue completion if update fails
              const { enqueueOutbox } = await import('@/src/utils/offlineOutbox');
              await enqueueOutbox({
                id: `f-${Date.now()}`,
                type: 'flagdownAndComplete',
                flagdownPayload,
                completionPayload: {
                  note: 'Flagdown meter completed via driver app',
                  meterMiles: Number(distanceMiles.toFixed(2)),
                  waitMinutes: Number(waitMinutes.toFixed(1)),
                  dropoffAddress: flagdownDropoff.trim() || undefined,
                  dropoffLat: lastLocationRef.current?.coords?.latitude,
                  dropoffLon: lastLocationRef.current?.coords?.longitude,
                  otherFeeNames: otherFeeNames.length ? otherFeeNames : undefined,
                  flatRateId: effectiveFlatRate?._id,
                },
                createdAt: Date.now(),
              });
              setStatusMessage('Trip saved locally and will be submitted when back online.');
            }
          }
        } catch {
          // createFlagdown failed (likely offline) - enqueue the whole operation
          const { enqueueOutbox } = await import('@/src/utils/offlineOutbox');
          await enqueueOutbox({
            id: `f-${Date.now()}`,
            type: 'flagdownAndComplete',
            flagdownPayload,
            completionPayload: {
              note: 'Flagdown meter completed via driver app',
              meterMiles: Number(distanceMiles.toFixed(2)),
              waitMinutes: Number(waitMinutes.toFixed(1)),
              dropoffAddress: flagdownDropoff.trim() || undefined,
              dropoffLat: lastLocationRef.current?.coords?.latitude,
              dropoffLon: lastLocationRef.current?.coords?.longitude,
              otherFeeNames: otherFeeNames.length ? otherFeeNames : undefined,
              flatRateId: effectiveFlatRate?._id,
            },
            createdAt: Date.now(),
          });
          setStatusMessage('Trip saved locally and will be submitted when back online.');
        }
      }

      // Open recap once (guarded) to avoid duplicate openings when multiple async
      // operations (createFlagdown + updateBookingStatus + query refetch)
      openRecapOnce(
        {
          fare: breakdown,
          distanceMiles,
          waitMinutes,
          elapsedSeconds,
          passengers,
          otherFees: selectedFees,
          flatRateName: effectiveFlatRate?.name,
          tripLabel: booking ? `Booking #${booking.bookingId ?? booking._id.slice(-6)}` : 'Flagdown ride',
        },
        breakdown,
      );
      setStatusMessage('Trip submitted.');
      meter.reset();
      setTripStarted(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit trip.';
      setActionError(message);
    } finally {
      setSubmitting(false);
    }
  }, [
    booking,
    computedBreakdown,
    createFlagdown,
    driverLocation,
    effectiveFlatRate,
    fareConfig,
    flagdownDropoff,
    isFlagdownMode,
    isFlatRateTrip,
    isReadOnly,
    meter,
    openRecapOnce,
    passengers,
    queryClient,
    selectedFees,
    statusMessage,
    submitting,
    updateBookingStatus,
  ]);

  const handleDismissRecap = () => {
    // clear guard so future trips can open the recap again
    recapOpenRef.current = false;
    setRecapVisible(false);
    setFinalBreakdown(null);
    router.replace('/(protected)/(tabs)/dashboard');
  };

  const [showExtras, setShowExtras] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  // Developer safety: pending submission for very large trips (simulator playback guard)
  const [pendingSubmission, setPendingSubmission] = useState<{
    distanceMiles: number;
    waitMinutes: number;
    elapsedSeconds: number;
    breakdown: FareBreakdown;
    otherFeeNames: string[];
  } | null>(null);

  // Helper to actually perform the submission that was deferred by the large-trip guard
  const performPendingSubmission = useCallback(async () => {
    if (isReadOnly) return; // do nothing in read-only mode
    if (!pendingSubmission) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const { distanceMiles, waitMinutes, elapsedSeconds, breakdown, otherFeeNames } = pendingSubmission;
      if (booking) {
        await updateBookingStatus.mutateAsync({
          id: booking._id,
          payload: {
            status: 'Completed',
            meterMiles: Number(distanceMiles.toFixed(2)),
            waitMinutes: Number(waitMinutes.toFixed(1)),
            dropoffAddress: flagdownDropoff.trim() || booking.dropoffAddress || undefined,
            dropoffLat: lastLocationRef.current?.coords?.latitude,
            dropoffLon: lastLocationRef.current?.coords?.longitude,
            note: isFlatRateTrip ? 'Driver completed flat-rate trip' : 'Meter trip completed',
            flatRateId: effectiveFlatRate?._id,
            otherFeeNames: otherFeeNames.length ? otherFeeNames : undefined,
          },
        });
        await queryClient.refetchQueries({ queryKey: ['driverBookings'], exact: false });
      } else {
        const flagdownPayload = {
          dropoffAddress: flagdownDropoff.trim() || undefined,
          passengers,
          estimatedFare: Number(breakdown.total.toFixed(2)),
          flatRateId: effectiveFlatRate?._id ?? undefined,
          pickupLat: lastLocationRef.current?.coords?.latitude ?? undefined,
          pickupLon: lastLocationRef.current?.coords?.longitude ?? undefined,
          dropoffLat: lastLocationRef.current?.coords?.latitude ?? undefined,
          dropoffLon: lastLocationRef.current?.coords?.longitude ?? undefined,
        };
        const flagdownResponse = await createFlagdown.mutateAsync(flagdownPayload);
        if (flagdownResponse?.booking?._id) {
          await updateBookingStatus.mutateAsync({
            id: flagdownResponse.booking._id,
            payload: {
              status: 'Completed',
              meterMiles: Number(distanceMiles.toFixed(2)),
              waitMinutes: Number(waitMinutes.toFixed(1)),
              dropoffAddress: flagdownDropoff.trim() || undefined,
              dropoffLat: lastLocationRef.current?.coords?.latitude,
              dropoffLon: lastLocationRef.current?.coords?.longitude,
              note: 'Flagdown meter completed via driver app',
              flatRateId: effectiveFlatRate?._id,
              otherFeeNames: otherFeeNames.length ? otherFeeNames : undefined,
            },
          });
          await queryClient.refetchQueries({ queryKey: ['driverBookings'], exact: false });
        }
      }

      // Use guarded opener here too (for the deferred submission flow)
      openRecapOnce(
        {
          fare: breakdown,
          distanceMiles,
          waitMinutes,
          elapsedSeconds,
          passengers,
          otherFees: selectedFees,
          flatRateName: effectiveFlatRate?.name,
          tripLabel: booking ? `Booking #${booking.bookingId ?? booking._id.slice(-6)}` : 'Flagdown ride',
        },
        breakdown,
      );
      setStatusMessage('Trip submitted.');
      meter.reset();
      setTripStarted(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to submit trip.';
      setActionError(message);
    } finally {
      setSubmitting(false);
      setPendingSubmission(null);
    }
  }, [pendingSubmission, booking, updateBookingStatus, queryClient, createFlagdown, flagdownDropoff, isFlatRateTrip, effectiveFlatRate, passengers, selectedFees, meter, isReadOnly, openRecapOnce]);

  // If compact mode (landscape or forced), render a minimal meter UI and exit early
  // This makes the compact experience immediate and removes other UI chrome.
  if (isCompactView) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.landscapeContainer}>
          <View style={styles.landscapeFareRow}>
            <Animated.Text style={[styles.bigFare, { fontSize: fareFontSize, transform: [{ scale: animatedScale.current }] }]}>
              {Number.isFinite(displayedFare) ? formatCurrency(displayedFare) : '-'}
            </Animated.Text>
          </View>
          <View style={styles.landscapeControls}>
            <Pressable
              style={[styles.bigControlButton, styles.controlStart, startDisabled && styles.controlDisabled]}
              disabled={startDisabled}
              onPress={handleStartTrip}
            >
              {submitting ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.bigControlText}>Start</Text>}
            </Pressable>
            <Pressable
              style={[styles.bigControlButton, styles.controlEnd, stopDisabled && styles.controlDisabled]}
              disabled={stopDisabled}
              onPress={handleEndTrip}
            >
              {submitting ? <ActivityIndicator color="#f8fafc" /> : <Text style={styles.bigControlText}>End</Text>}
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 12, paddingHorizontal: 8 }}>
            <Pressable onPress={() => setForceCompact((s) => !s)}>
              <Text style={{ color: '#94a3b8' }}>{forceCompact ? 'Unforce compact' : 'Force compact'}</Text>
            </Pressable>
            <Pressable onPress={() => setShowDebug((s) => !s)}>
              <Text style={{ color: '#94a3b8' }}>{showDebug ? 'Hide debug' : 'Show debug'}</Text>
            </Pressable>
          </View>

          {showDebug ? (
            <View style={{ position: 'absolute', left: 12, top: 12, backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, borderRadius: 8 }}>
              <Text style={{ color: '#f8fafc', fontSize: 12 }}>dist: {(meter.totals.distanceMiles ?? 0).toFixed(3)}</Text>
              <Text style={{ color: '#f8fafc', fontSize: 12 }}>wait: {(meter.totals.waitMinutes ?? 0).toFixed(3)}</Text>
              <Text style={{ color: '#94a3b8', fontSize: 12 }}>floorDist: {displayDistanceMiles}</Text>
              <Text style={{ color: '#94a3b8', fontSize: 12 }}>floorWait: {displayWaitMinutes}</Text>
              {actionError ? <Text style={{ color: '#f97316', fontSize: 12 }}>err: {actionError}</Text> : null}
            </View>
          ) : null}
          {/* Compact extras summary so drivers can still see selected fees */}
          <View style={{ width: '100%', marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 }}>
            <Pressable onPress={() => setShowExtras((s) => !s)}>
              <Text style={{ color: '#22d3ee', fontWeight: '700' }}>{showExtras ? 'Hide extras' : 'Show extras'}</Text>
            </Pressable>
            <Text style={{ color: '#94a3b8' }}>{passengers} pax · {selectedFees.length} fees</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (isFlagdownMode && !fareConfig && isFareLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#f9fafb" />
          <Text style={styles.loadingLabel}>Loading meter configuration...</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!isFlagdownMode && (isBookingsLoading || (!booking && !isBookingsLoading))) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          {isBookingsLoading ? (
            <>
              <ActivityIndicator size="large" color="#f9fafb" />
              <Text style={styles.loadingLabel}>Fetching trip details...</Text>
            </>
          ) : (
            <>
              <Text style={styles.errorTitle}>Trip unavailable</Text>
              <Text style={styles.errorSubtitle}>This assignment is no longer active. Returning to dashboard.</Text>
              <Pressable style={[styles.primaryButton, styles.modalButtonGap]} onPress={() => router.replace('/(protected)/(tabs)/dashboard')}>
                <Text style={styles.primaryButtonText}>Back to dashboard</Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* (Compact view handled earlier via early-return) */}
        <View style={styles.headerRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View>
              <Text style={styles.title}>{isFlagdownMode ? 'Flagdown meter' : 'Trip meter'}</Text>
              <Text style={styles.subtitle}>Start when passenger enters — end when they exit.</Text>
            </View>
            {outboxCount > 0 ? (
              <View style={styles.outboxBadge}>
                <Text style={styles.outboxBadgeText}>{outboxCount}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.smallStatus}>{isFlatRateTrip ? (tripStarted ? 'Flat rate' : 'Ready') : meter.status.toUpperCase()}</Text>
        </View>

        {isReadOnly ? (
          <View style={{ backgroundColor: '#0b1220', padding: 10, borderRadius: 12, marginHorizontal: 16, marginTop: 8, borderWidth: 1, borderColor: '#334155' }}>
            <Text style={{ color: '#94a3b8', textAlign: 'center' }}>Read-only — viewing historical trip details. Tap &apos;Open editable meter&apos; to make changes.</Text>
          </View>
        ) : null}

        {statusMessage ? <Text style={styles.success}>{statusMessage}</Text> : null}
        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
        {meterError ? <Text style={styles.error}>{meterError}</Text> : null}

        {fareError ? (
          <Pressable style={[styles.alertCard, styles.errorAlert]} onPress={() => refetchFare()}>
            <Text style={styles.alertText}>Unable to load fare configuration. Tap to retry.</Text>
          </Pressable>
        ) : null}

        {/* Big meter card (centered) */}
        <View style={styles.bigMeterCardCentered}>
          <Text style={styles.bigStatus}>{isFlatRateTrip ? (tripStarted ? 'Flat rate' : 'Ready') : meter.status.toUpperCase()}</Text>
          <View style={styles.centerMetrics}>
            <View style={styles.smallMetric}>
              <Text style={styles.bigLabel}>Elapsed</Text>
              <Text style={styles.bigValue}>{formatDuration(isFlatRateTrip ? meter.elapsedSeconds : meter.totals.elapsedSeconds ?? meter.elapsedSeconds)}</Text>
            </View>
            <View style={styles.smallMetric}>
              <Text style={styles.bigLabel}>Distance</Text>
              <Text style={styles.bigValue}>{isFlatRateTrip ? '-' : formatDistance(meter.totals.distanceMiles ?? 0)}</Text>
            </View>
          </View>
          <View style={styles.fareCenterRow}>
            <Animated.Text
              style={[
                styles.bigFare,
                { fontSize: fareFontSize },
                {
                  transform: [{ scale: animatedScale.current }],
                },
              ]}
            >
              {Number.isFinite(displayedFare) ? formatCurrency(displayedFare) : '-'}
            </Animated.Text>
          </View>
          <Text style={styles.mutedSmall}>Estimated values update as you drive. Final fare shown after trip end.</Text>

          <View style={styles.breakdownToggleRow}>
            <Pressable onPress={() => setShowBreakdown((s) => !s)}>
              <Text style={styles.breakdownToggle}>{showBreakdown ? 'Hide fare breakdown' : 'Show fare breakdown'}</Text>
            </Pressable>
            {/* Show the milestone-based value for live meter trips so the summary matches the big animated fare */}
            <Text style={styles.breakdownSummary}>{(isFlatRateTrip ? computedBreakdown : (displayComputedBreakdown ?? computedBreakdown)) ? formatCurrency((isFlatRateTrip ? computedBreakdown : (displayComputedBreakdown ?? computedBreakdown))!.total) : '-'}</Text>
          </View>

          {showBreakdown ? (
            <View style={styles.breakdownCard}>
              {(() => {
                const b = finalBreakdown ?? (isFlatRateTrip ? computedBreakdown : displayComputedBreakdown ?? computedBreakdown);
                if (!b) return <Text style={styles.mutedSmall}>No breakdown available</Text>;
                return (
                  <>
                    <DetailRow label="Base fare" value={formatCurrency(b.baseFare)} />
                    {b.mode === 'meter' ? (
                      <>
                        <DetailRow label={`Distance (${formatDistance(meter.totals.distanceMiles ?? 0)})`} value={formatCurrency(b.distanceFare)} />
                        <DetailRow label={`Wait (${(meter.totals.waitMinutes ?? 0).toFixed(1)} min)`} value={formatCurrency(b.waitFare)} />
                        <DetailRow label="Surge" value={`${b.surgeMultiplier.toFixed(2)}x`} />
                      </>
                    ) : (
                      <DetailRow label="Flat rate" value={formatCurrency(b.total)} />
                    )}
                    <DetailRow label="Passenger extras" value={formatCurrency(b.extraPassengerFare)} />
                    <DetailRow label="Other fees" value={formatCurrency(b.otherFeesTotal)} />
                    {b.roundingAdjustment !== 0 ? <DetailRow label="Rounding" value={formatCurrency(b.roundingAdjustment)} /> : null}
                    <DetailRow label="Total" value={formatCurrency(b.total)} highlight />
                  </>
                );
              })()}
            </View>
          ) : null}
        </View>

        {/* Trip info: pickup/dropoff + selected extras so driver can head to customer */}
        {booking ? (
          <View style={styles.tripInfoCard}>
          <Text style={styles.sectionTitle}>Trip details</Text>
          <View style={{ marginTop: 8 }}>
            <Text style={styles.label}>Pickup</Text>
            <Text style={styles.addressText}>{booking?.pickupAddress ?? (isFlagdownMode ? 'Current location' : 'Pickup TBD')}</Text>
          </View>
          <View style={{ marginTop: 8 }}>
            <Text style={styles.label}>Dropoff</Text>
            {booking?.dropoffAddress ? (
              <Text style={styles.addressText}>{booking.dropoffAddress}</Text>
            ) : isFlagdownMode ? (
              isReadOnly ? (
                <Text style={styles.addressText}>{flagdownDropoff || 'Dropoff TBD'}</Text>
              ) : (
                <TextInput
                  value={flagdownDropoff}
                  onChangeText={setFlagdownDropoff}
                  placeholder="Enter dropoff address (optional)"
                  placeholderTextColor="#64748b"
                  style={styles.inlineInput}
                />
              )
            ) : (
              <Text style={styles.addressText}>Dropoff TBD</Text>
            )}
          </View>

          {selectedFees.length ? (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>Selected extras</Text>
              {selectedFees.map((f) => (
                <View key={f.name} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{f.name}</Text>
                  <Text style={styles.detailValue}>{formatCurrency(f.amount)}</Text>
                </View>
              ))}
            </View>
          ) : null}
          </View>
        ) : null}

        <View style={styles.controlsStack}>
          {isReadOnly ? (
            <Pressable
              style={[styles.bigControlButton, styles.controlStart]}
              onPress={() => router.push({ pathname: '/(protected)/meter', params: { bookingId } })}
            >
              <Text style={styles.bigControlText}>Open editable meter</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                style={[styles.bigControlButton, styles.controlStart, startDisabled && styles.controlDisabled]}
                disabled={startDisabled}
                onPress={handleStartTrip}
              >
                {submitting ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.bigControlText}>Start Trip</Text>}
              </Pressable>
              <Pressable
                style={[styles.bigControlButton, styles.controlEnd, stopDisabled && styles.controlDisabled]}
                disabled={stopDisabled}
                onPress={handleEndTrip}
              >
                {submitting ? <ActivityIndicator color="#f8fafc" /> : <Text style={styles.bigControlText}>End Trip</Text>}
              </Pressable>
            </>
          )}
        </View>

        {/* Other fees: always visible for quick access */}
        <Text style={[styles.label, { marginTop: 8 }]}>Additional fees</Text>
        <View style={styles.feeChips}>
          {availableOtherFees.length ? (
            availableOtherFees.map((fee) => {
              const active = selectedFeeNames.includes(fee.name);
              // Render non-interactive fee chips in read-only mode
              if (isReadOnly) {
                return (
                  <View key={fee.name} style={[styles.feeChip, active && styles.feeChipActive]}>
                    <Text style={[styles.feeChipLabel, active && styles.feeChipLabelActive]}>{fee.name}</Text>
                    <Text style={[styles.feeChipAmount, active && styles.feeChipLabelActive]}>{formatCurrency(Number(fee.amount ?? 0))}</Text>
                  </View>
                );
              }
              return (
                <Pressable
                  key={fee.name}
                  style={[styles.feeChip, active && styles.feeChipActive]}
                  onPress={() => handleToggleFee(fee.name)}
                >
                  <Text style={[styles.feeChipLabel, active && styles.feeChipLabelActive]}>{fee.name}</Text>
                  <Text style={[styles.feeChipAmount, active && styles.feeChipLabelActive]}>{formatCurrency(Number(fee.amount ?? 0))}</Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={styles.muted}>No extra fees defined by admin.</Text>
          )}
        </View>

        <View style={styles.extrasBar}>
          <Pressable onPress={() => setShowExtras((s) => !s)}>
            <Text style={styles.extrasToggle}>{showExtras ? 'Hide extras' : 'Show extras'}</Text>
          </Pressable>
          <Text style={styles.extrasSummary}>{passengers} pax · {selectedFees.length} fees</Text>
        </View>

        {showExtras ? (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.label}>Passengers</Text>
              {isReadOnly ? (
                <Text style={styles.counterValue}>{passengers} pax</Text>
              ) : (
                <View style={styles.counter}>
                  <Pressable
                    style={[styles.counterButton, passengers <= 1 && styles.counterDisabled]}
                    disabled={passengers <= 1}
                    onPress={() => handlePassengerChange(-1)}
                  >
                    <Text style={styles.counterButtonText}>-</Text>
                  </Pressable>
                  <Text style={styles.counterValue}>{passengers}</Text>
                  <Pressable
                    style={[styles.counterButton, passengers >= 8 && styles.counterDisabled]}
                    disabled={passengers >= 8}
                    onPress={() => handlePassengerChange(1)}
                  >
                    <Text style={styles.counterButtonText}>+</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {isFlagdownMode && !bookingFlatRate ? (
              <View style={styles.flatRateSelector}>
                <Text style={styles.label}>Flat rate zone</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.flatRateChips}>
                  {isReadOnly ? (
                    // Render a non-interactive list of rates in read-only mode
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={[styles.flatRateChip, !selectedFlatRateId && styles.flatRateChipActive]}>
                        <Text style={styles.flatRateChipTitle}>Meter fare</Text>
                        <Text style={styles.flatRateChipSubtitle}>Use admin meter configuration</Text>
                      </View>
                      {flatRates.map((rate) => (
                        <View
                          key={rate._id}
                          style={[styles.flatRateChip, selectedFlatRateId === rate._id && styles.flatRateChipActive]}
                        >
                          <Text style={styles.flatRateChipTitle}>{rate.name}</Text>
                          <Text style={styles.flatRateChipAmount}>{formatCurrency(Number(rate.amount ?? 0))}</Text>
                          {rate.distanceLabel ? <Text style={styles.flatRateChipSubtitle}>{rate.distanceLabel}</Text> : null}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <>
                      <Pressable
                        style={[styles.flatRateChip, !selectedFlatRateId && styles.flatRateChipActive]}
                        onPress={() => handleFlatRateSelect(null)}
                      >
                        <Text style={styles.flatRateChipTitle}>Meter fare</Text>
                        <Text style={styles.flatRateChipSubtitle}>Use admin meter configuration</Text>
                      </Pressable>
                      {flatRates.map((rate) => (
                        <Pressable
                          key={rate._id}
                          style={[styles.flatRateChip, selectedFlatRateId === rate._id && styles.flatRateChipActive]}
                          onPress={() => handleFlatRateSelect(rate._id)}
                        >
                          <Text style={styles.flatRateChipTitle}>{rate.name}</Text>
                          <Text style={styles.flatRateChipAmount}>{formatCurrency(Number(rate.amount ?? 0))}</Text>
                          {rate.distanceLabel ? <Text style={styles.flatRateChipSubtitle}>{rate.distanceLabel}</Text> : null}
                        </Pressable>
                      ))}
                    </>
                  )}
                </ScrollView>
              </View>
            ) : null}

            {/* fees moved out for quicker access */}
          </View>
        ) : null}

      </ScrollView>


      <Modal visible={recapVisible} transparent animationType="slide" onRequestClose={handleDismissRecap}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Trip recap</Text>
            {recap ? (
              <>
                <Text style={styles.modalSubtitle}>{recap.tripLabel}</Text>
                {recap.flatRateName ? <Text style={styles.modalSubtitle}>Flat rate - {recap.flatRateName}</Text> : null}
                {!isFlatRateTrip ? (
                  <View style={styles.modalMetrics}>
                    <DetailRow label="Distance" value={formatDistance(recap.distanceMiles)} />
                    <DetailRow label="Wait time" value={`${recap.waitMinutes.toFixed(1)} min`} />
                    <DetailRow label="Elapsed" value={formatDuration(recap.elapsedSeconds)} />
                  </View>
                ) : null}
                <View style={styles.modalFare}>
                  <DetailRow label="Base fare" value={formatCurrency(recap.fare.baseFare)} />
                  {recap.fare.mode === 'meter' ? (
                    <>
                      <DetailRow label="Distance fare" value={formatCurrency(recap.fare.distanceFare)} />
                      <DetailRow label="Wait fare" value={formatCurrency(recap.fare.waitFare)} />
                      <DetailRow label="Surge" value={`${recap.fare.surgeMultiplier.toFixed(2)}x`} />
                    </>
                  ) : null}
                  <DetailRow label="Passenger extras" value={formatCurrency(recap.fare.extraPassengerFare)} />
                  <DetailRow label="Other fees" value={formatCurrency(recap.fare.otherFeesTotal)} />
                  {recap.fare.roundingAdjustment !== 0 ? (
                    <DetailRow label="Rounding" value={formatCurrency(recap.fare.roundingAdjustment)} />
                  ) : null}
                  <DetailRow label="Total due" value={formatCurrency(recap.fare.total)} highlight />
                </View>
              </>
            ) : (
              <ActivityIndicator color="#f8fafc" />
            )}
            <Pressable style={[styles.primaryButton, styles.modalButton]} onPress={handleDismissRecap}>
              <Text style={styles.primaryButtonText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {/* Developer confirmation modal for very large simulated trips */}
      <Modal visible={Boolean(pendingSubmission)} transparent animationType="fade" onRequestClose={() => setPendingSubmission(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm large trip</Text>
            {pendingSubmission ? (
              <>
                <Text style={styles.modalSubtitle}>Detected a very large trip — likely emulator route playback.</Text>
                <View style={{ marginTop: 8 }}>
                  <DetailRow label="Distance" value={formatDistance(pendingSubmission.distanceMiles)} />
                  <DetailRow label="Estimated total" value={formatCurrency(pendingSubmission.breakdown.total)} />
                </View>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                  <Pressable style={[styles.primaryButton, { flex: 1 }]} onPress={() => performPendingSubmission()}>
                    <Text style={styles.primaryButtonText}>Confirm and submit</Text>
                  </Pressable>
                  <Pressable style={[styles.primaryButton, { flex: 1, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#22d3ee' }]} onPress={() => setPendingSubmission(null)}>
                    <Text style={[styles.primaryButtonText, { color: '#22d3ee' }]}>Cancel</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <ActivityIndicator color="#f8fafc" />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function DetailRow({ label, value, action, highlight }: { label: string; value: string; action?: ReactNode; highlight?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      {action ? action : <Text style={[styles.detailValue, highlight && styles.detailHighlight]}>{value}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#030712',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
  },
  success: {
    color: '#4ade80',
    fontWeight: '600',
  },
  error: {
    color: '#f97316',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 18,
    gap: 12,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 18,
  },
  label: {
    color: '#94a3b8',
    fontSize: 13,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  counterButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  counterDisabled: {
    opacity: 0.4,
  },
  counterButtonText: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
  },
  counterValue: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 16,
    paddingHorizontal: 12,
  },
  feeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  feeChip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0b1120',
    gap: 2,
  },
  feeChipActive: {
    backgroundColor: '#22d3ee',
    borderColor: '#22d3ee',
  },
  feeChipLabel: {
    color: '#f8fafc',
    fontWeight: '600',
  },
  feeChipLabelActive: {
    color: '#0f172a',
  },
  feeChipAmount: {
    color: '#94a3b8',
    fontSize: 12,
  },
  flatRateSelector: {
    gap: 10,
  },
  flatRateChips: {
    flexDirection: 'row',
    gap: 12,
  },
  flatRateChip: {
    width: 220,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#0b1120',
    gap: 4,
  },
  flatRateChipActive: {
    borderColor: '#22d3ee',
    backgroundColor: '#0f172a',
  },
  flatRateChipTitle: {
    color: '#f8fafc',
    fontWeight: '600',
  },
  flatRateChipAmount: {
    color: '#22d3ee',
    fontWeight: '700',
  },
  flatRateChipSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
  },
  meterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    width: '48%',
    backgroundColor: '#111827',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    gap: 4,
  },
  metricHighlight: {
    backgroundColor: '#22d3ee',
    borderColor: '#22d3ee',
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 12,
  },
  metricValue: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 18,
  },
  metricHighlightLabel: {
    color: '#0f172a',
  },
  metricHighlightValue: {
    color: '#0f172a',
  },
  controls: {
    flexDirection: 'row',
    gap: 12,
  },
  controlButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  controlStart: {
    backgroundColor: '#22d3ee',
  },
  controlEnd: {
    backgroundColor: '#f87171',
  },
  controlStartText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 18,
  },
  controlEndText: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 18,
  },
  controlDisabled: {
    opacity: 0.5,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  detailLabel: {
    color: '#64748b',
    fontSize: 13,
    flexShrink: 0,
  },
  detailValue: {
    color: '#f8fafc',
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
  detailHighlight: {
    color: '#22d3ee',
  },
  inlineInput: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f9fafb',
    marginLeft: 12,
  },
  muted: {
    color: '#64748b',
    fontSize: 12,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingLabel: {
    color: '#94a3b8',
  },
  errorTitle: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 18,
  },
  errorSubtitle: {
    color: '#94a3b8',
    textAlign: 'center',
  },
  alertCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  errorAlert: {
    borderColor: '#f97316',
    backgroundColor: 'rgba(249, 115, 22, 0.1)',
  },
  alertText: {
    color: '#f97316',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(3, 7, 18, 0.8)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 22,
  },
  modalSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
  },
  modalFare: {
    gap: 6,
  },
  modalMetrics: {
    gap: 4,
  },
  modalButton: {
    marginTop: 8,
  },
  modalButtonGap: {
    marginTop: 16,
  },
  primaryButton: {
    backgroundColor: '#22d3ee',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 16,
  },
  /* New UI styles for revamped meter screen */
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  smallStatus: { color: '#94a3b8', fontSize: 12 },
  bigMeterCard: { backgroundColor: '#061026', borderRadius: 18, padding: 18, marginTop: 8, gap: 12, borderWidth: 1, borderColor: '#123047' },
  bigMeterCardCentered: { backgroundColor: '#061026', borderRadius: 18, padding: 20, marginTop: 8, gap: 12, borderWidth: 1, borderColor: '#123047', alignItems: 'center' },
  centerMetrics: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 6 },
  smallMetric: { alignItems: 'center', paddingHorizontal: 12 },
  bigStatus: { color: '#94a3b8', fontSize: 12 },
  // Make elapsed/time smaller so the fare is the dominant element
  bigElapsed: { color: '#f8fafc', fontSize: 18, fontWeight: '600', marginTop: 2 },
  bigRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  bigColumn: { flex: 1, alignItems: 'flex-start' },
  bigLabel: { color: '#94a3b8', fontSize: 12 },
  // distance/time small
  bigValue: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },
  // fare should be big and highly visible for passenger convenience
  bigFare: { color: '#22d3ee', fontSize: 56, fontWeight: '900', includeFontPadding: false },
  fareCenterRow: { marginTop: 12, alignItems: 'center', justifyContent: 'center' },
  mutedSmall: { color: '#94a3b8', fontSize: 12, marginTop: 8 },
  // Stack controls vertically for easier one-handed operation
  controlsStack: { flexDirection: 'column', gap: 12, marginTop: 12, width: '100%' },
  bigControlButton: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', flex: 1 },
  bigControlText: { fontSize: 18, fontWeight: '700' },
  extrasBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  extrasToggle: { color: '#22d3ee', fontWeight: '700' },
  extrasSummary: { color: '#94a3b8' },
  breakdownToggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  breakdownToggle: { color: '#22d3ee', fontWeight: '700' },
  breakdownSummary: { color: '#94a3b8' },
  breakdownCard: { marginTop: 8, backgroundColor: '#071526', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#123047' },
  outboxBadge: { backgroundColor: '#f97316', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 8 },
  outboxBadgeText: { color: '#0f172a', fontWeight: '700' },
  /* Landscape compact view */
  landscapeContainer: { width: '100%', padding: 12, alignItems: 'center', justifyContent: 'center' },
  landscapeFareRow: { width: '100%', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  landscapeControls: { flexDirection: 'row', gap: 12, width: '100%', justifyContent: 'space-around', marginTop: 8 },
  tripInfoCard: { marginTop: 12, backgroundColor: '#061226', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#123047', gap: 8 },
  addressText: { color: '#f8fafc', marginTop: 4 },
});

