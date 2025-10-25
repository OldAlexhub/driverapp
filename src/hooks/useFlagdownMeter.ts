import { logDiagnostic } from '@/src/utils/diagnostics';
import { distanceBetween, metersToMiles, mphToMetersPerSecond, secondsToMinutes } from '@/src/utils/geo';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';

export type MeterStatus = 'idle' | 'running' | 'paused' | 'completed';

export type MeterConfig = {
  farePerMile: number;
  waitTimePerMinute: number;
  baseFare?: number;
  minimumFare?: number;
  waitTriggerSpeedMph?: number;
  idleGracePeriodSeconds?: number;
  surgeEnabled?: boolean;
  surgeMultiplier?: number;
};

type MeterState = {
  status: MeterStatus;
  startedAt: number | null;
  elapsedSeconds: number;
  distanceMeters: number;
  waitSeconds: number;
  lastLocation: Location.LocationObject | null;
  lastTimestamp: number | null;
  idleAnchor: number | null;
  config: MeterConfig | null;
  points: { latitude: number; longitude: number }[];
  error: string | null;
};

type StartParams = {
  config: MeterConfig;
};

type MeterAction =
  | { type: 'START'; payload: { timestamp: number; location: Location.LocationObject | null; config: MeterConfig } }
  | { type: 'LOCATION_UPDATE'; payload: { location: Location.LocationObject } }
  | { type: 'PAUSE' }
  | { type: 'RESUME'; payload: { timestamp: number } }
  | { type: 'STOP'; payload: { timestamp: number } }
  | { type: 'RESET' }
  | { type: 'HYDRATE'; payload: MeterState }
  | { type: 'SET_ERROR'; payload: string | null };

const initialState: MeterState = {
  status: 'idle',
  startedAt: null,
  elapsedSeconds: 0,
  distanceMeters: 0,
  waitSeconds: 0,
  lastLocation: null,
  lastTimestamp: null,
  idleAnchor: null,
  config: null,
  points: [],
  error: null,
};

function meterReducer(state: MeterState, action: MeterAction): MeterState {
  switch (action.type) {
    case 'HYDRATE': {
      // Replace full state with hydrated snapshot from storage. Keep safety guards.
      const payload = action.payload;
      // Cap points
      const MAX_POINTS = 500;
      const cappedPoints = Array.isArray(payload.points) && payload.points.length > MAX_POINTS ? payload.points.slice(payload.points.length - MAX_POINTS) : payload.points || [];
      return {
        ...payload,
        points: cappedPoints,
      };
    }
    case 'START': {
      const { timestamp, location, config } = action.payload;
      const initialPoint =
        location?.coords && location.coords.latitude && location.coords.longitude
          ? [
              {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              },
            ]
          : [];
      return {
        status: 'running',
        startedAt: timestamp,
        elapsedSeconds: 0,
        distanceMeters: 0,
        waitSeconds: 0,
        lastLocation: location,
        lastTimestamp: timestamp,
        idleAnchor: null,
        config,
        points: initialPoint,
        error: null,
      };
    }
    case 'LOCATION_UPDATE': {
      if (state.status !== 'running') return state;
      const location = action.payload.location;
      const timestamp = location.timestamp ?? Date.now();
      const lastTimestamp = state.lastTimestamp ?? timestamp;
      const deltaSeconds = Math.max(0, (timestamp - lastTimestamp) / 1000);

      let distanceMeters = state.distanceMeters;
      let waitSeconds = state.waitSeconds;
      let idleAnchor = state.idleAnchor;
      const lastLocation = state.lastLocation;

      if (lastLocation) {
        const prevCoords = {
          latitude: lastLocation.coords.latitude,
          longitude: lastLocation.coords.longitude,
        };
        const nextCoords = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        let deltaDistance = distanceBetween(prevCoords, nextCoords);
        // Guard against implausible GPS jumps which can create huge one-off
        // distance spikes (and therefore very large fares). If a very large
        // delta is observed in a short time window, ignore it as likely bad
        // GPS data rather than counting it toward the trip distance.
        const MAX_REASONABLE_DELTA_METERS = 2000; // ~2km
        if (!Number.isFinite(deltaDistance) || (deltaDistance > MAX_REASONABLE_DELTA_METERS && deltaSeconds < 10)) {
          // treat as zero movement (ignore spike)
          deltaDistance = 0;
        }
        if (Number.isFinite(deltaDistance) && deltaDistance > 0) {
          distanceMeters += deltaDistance;
        }
      }

      const speedFromUpdate = location.coords.speed;
      const effectiveSpeed =
        typeof speedFromUpdate === 'number' && speedFromUpdate >= 0
          ? speedFromUpdate
          : deltaSeconds > 0
            ? (distanceBetween(
                {
                  latitude: lastLocation?.coords.latitude ?? location.coords.latitude,
                  longitude: lastLocation?.coords.longitude ?? location.coords.longitude,
                },
                {
                  latitude: location.coords.latitude,
                  longitude: location.coords.longitude,
                },
              ) ?? 0) / deltaSeconds
            : 0;

      const waitThreshold = state.config?.waitTriggerSpeedMph
        ? mphToMetersPerSecond(state.config.waitTriggerSpeedMph)
        : mphToMetersPerSecond(3);
      const graceSeconds = state.config?.idleGracePeriodSeconds ?? 45;

      const wasIdling = idleAnchor !== null;
      const idleAnchorValue = idleAnchor;
      const belowThreshold = effectiveSpeed <= waitThreshold;

      if (belowThreshold) {
        if (!wasIdling) {
          idleAnchor = timestamp;
        } else if (idleAnchorValue !== null) {
          const prevIdleDuration = Math.max(0, ((lastTimestamp ?? timestamp) - idleAnchorValue) / 1000);
          const currentIdleDuration = Math.max(0, (timestamp - idleAnchorValue) / 1000);
          const effectivePrev = Math.max(0, prevIdleDuration - graceSeconds);
          const effectiveCurrent = Math.max(0, currentIdleDuration - graceSeconds);
          const additionalWait = Math.max(0, effectiveCurrent - effectivePrev);
          waitSeconds += additionalWait;
        }
      } else {
        idleAnchor = null;
      }

      const shouldStorePoint =
        !state.points.length ||
        distanceBetween(
          state.points[state.points.length - 1],
          {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          },
        ) > 5;

      const newPoints = shouldStorePoint
        ? [
            ...state.points,
            {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            },
          ]
        : state.points;

      // Cap stored polyline points to avoid unbounded memory growth on long trips
      const MAX_POINTS = 500;
      const cappedPoints = newPoints.length > MAX_POINTS ? newPoints.slice(newPoints.length - MAX_POINTS) : newPoints;

      return {
        ...state,
        lastLocation: location,
        lastTimestamp: timestamp,
        elapsedSeconds: state.elapsedSeconds + deltaSeconds,
        distanceMeters,
        waitSeconds,
        idleAnchor,
        points: cappedPoints,
      };
    }
    case 'PAUSE': {
      if (state.status !== 'running') return state;
      return {
        ...state,
        status: 'paused',
        lastTimestamp: Date.now(),
        idleAnchor: null,
      };
    }
    case 'RESUME': {
      if (state.status !== 'paused') return state;
      return {
        ...state,
        status: 'running',
        lastTimestamp: action.payload.timestamp,
      };
    }
    case 'STOP': {
      if (state.status === 'idle' || state.status === 'completed') return state;
      const timestamp = action.payload.timestamp;
      const startedAt = state.startedAt ?? timestamp;
      const totalSeconds = Math.max(0, (timestamp - startedAt) / 1000);
      return {
        ...state,
        status: 'completed',
        elapsedSeconds: totalSeconds,
        lastTimestamp: timestamp,
        idleAnchor: null,
      };
    }
    case 'RESET': {
      return initialState;
    }
    case 'SET_ERROR': {
      return {
        ...state,
        error: action.payload,
      };
    }
    default:
      return state;
  }
}

export function useFlagdownMeter() {
  const [state, dispatch] = useReducer(meterReducer, initialState);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const latestStateRef = useRef<MeterState>(initialState);
  const isMounted = useRef(true);
  const persistTimerRef = useRef<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      // Persist a final snapshot on unmount so in-app navigation doesn't
      // lose an in-progress meter when returning to the screen.
      (async () => {
        try {
          const s = latestStateRef.current;
          const snapshot: MeterState = {
            status: s.status,
            startedAt: s.startedAt,
            elapsedSeconds: s.elapsedSeconds,
            distanceMeters: s.distanceMeters,
            waitSeconds: s.waitSeconds,
            lastLocation: s.lastLocation,
            lastTimestamp: s.lastTimestamp,
            idleAnchor: s.idleAnchor,
            config: s.config,
            points: s.points,
            error: s.error,
          };
          await SecureStore.setItemAsync('taxiops:meterState', JSON.stringify(snapshot));
          try {
            logDiagnostic({ level: 'info', tag: 'meter.unmount', message: 'persisted snapshot on unmount', payload: { status: s.status } });
          } catch {
            // ignore
          }
        } catch {
          // best-effort only
        }
      })();
      watcherRef.current?.remove();
      watcherRef.current = null;
    };
  }, []);

  // Keep a ref to the latest state for use in unmount/async callbacks so
  // we always persist the freshest snapshot.
  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  

  // Hydrate persisted meter state once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync('taxiops:meterState');
        if (!raw) {
          setHydrated(true);
          return;
        }
        const parsed = JSON.parse(raw) as MeterState | null;
        if (parsed && !cancelled) {
          dispatch({ type: 'HYDRATE', payload: parsed });
        }
      } catch {
        // ignore parse errors
      } finally {
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // After hydration, if the persisted state indicates the meter was running,
  // ensure the location watcher is started so the totals continue updating.
  // NOTE: effect moved below startWatcher declaration to avoid using the
  // startWatcher variable before it's defined.

  const ensurePermission = useCallback(async () => {
    // First check current permission without prompting the user. This avoids
    // triggering the system permission dialog while the app is backgrounded
    // (which causes Android to block the background activity and can lead
    // to ANRs). If permission is not granted and the app is not foregrounded,
    // return a clear error to the caller so the UI can instruct the user to
    // foreground the app and try again.
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === Location.PermissionStatus.GRANTED) return;

    // If we are not in the foreground, don't prompt — that will attempt to
    // start an activity from background and Android will block it.
    if (AppState.currentState !== 'active') {
      throw new Error('Location permission is required. Please bring the app to the foreground and try again.');
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) {
      throw new Error('Location permission is required to start the meter.');
    }
  }, []);

  const startWatcher = useCallback(async () => {
    watcherRef.current?.remove();
    watcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000,
        distanceInterval: 5,
        mayShowUserSettingsDialog: true,
      },
      (location) => {
        try {
          if (!isMounted.current) return;
          dispatch({ type: 'LOCATION_UPDATE', payload: { location } });
        } catch (err) {
          // Protect against unexpected errors in reducer or location payloads
          // so the native callback doesn't cause an unhandled exception.
          // Store a brief error message in state for diagnostics.
          const message = err instanceof Error ? err.message : String(err);
          dispatch({ type: 'SET_ERROR', payload: `Location watch error: ${message}` });
          // record diagnostic with meter snapshot
          try {
            const snapshot = {
              status: state.status,
              startedAt: state.startedAt,
              elapsedSeconds: state.elapsedSeconds,
              distanceMeters: state.distanceMeters,
              waitSeconds: state.waitSeconds,
              pointsCount: Array.isArray(state.points) ? state.points.length : 0,
              appState: AppState.currentState,
            };
            logDiagnostic({ level: 'error', tag: 'meter.locationWatcher', message: String(message), payload: { err: String(err), snapshot } });
          } catch (_e) {}
        }
      },
    );
  }, []);

  // After hydration, if the persisted state indicates the meter was running,
  // ensure the location watcher is started so the totals continue updating.
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        if (state.status === 'running' && !watcherRef.current) {
          await startWatcher();
          try {
            logDiagnostic({ level: 'info', tag: 'meter.hydrate', message: 'restarted watcher after hydrate' });
          } catch {
            // ignore
          }
        }
      } catch (e) {
        try {
          logDiagnostic({ level: 'error', tag: 'meter.hydrate', message: 'failed to restart watcher after hydrate', payload: { error: String(e) } });
        } catch {
          // ignore
        }
      }
    })();
  }, [hydrated, state.status, startWatcher]);

  const stopWatcher = useCallback(() => {
    watcherRef.current?.remove();
    watcherRef.current = null;
  }, []);

  // Persist immediately when the app backgrounds, and try to restart watcher when returning to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      try {
        if (next === 'background' || next === 'inactive') {
          // ensure latest state is persisted (use same snapshot logic)
          (async () => {
            try {
              const snapshot: MeterState = {
                status: state.status,
                startedAt: state.startedAt,
                elapsedSeconds: state.elapsedSeconds,
                distanceMeters: state.distanceMeters,
                waitSeconds: state.waitSeconds,
                lastLocation: state.lastLocation,
                lastTimestamp: state.lastTimestamp,
                idleAnchor: state.idleAnchor,
                config: state.config,
                points: state.points,
                error: state.error,
              };
              await SecureStore.setItemAsync('taxiops:meterState', JSON.stringify(snapshot));
              try {
                logDiagnostic({ level: 'info', tag: 'meter.appstate', message: 'persisted on background', payload: { status: state.status } });
              } catch {
                // ignore
              }
            } catch (_e) {}
          })();
        }
        if (next === 'active') {
          // If meter is running but watch was stopped (e.g., OS killed it while backgrounded), restart it.
          if (state.status === 'running' && !watcherRef.current) {
            (async () => {
              try {
                await startWatcher();
                try {
                  logDiagnostic({ level: 'info', tag: 'meter.appstate', message: 'restarted watcher on foreground' });
                } catch {
                  // ignore
                }
              } catch (e) {
                try {
                  logDiagnostic({ level: 'error', tag: 'meter.appstate', message: 'failed to restart watcher', payload: { error: String(e) } });
                } catch {
                  // ignore
                }
              }
            })();
          }
        }
      } catch {
        // ignore
      }
    });
    return () => sub.remove();
  }, [state.status, state.points, state.elapsedSeconds]);

  const start = useCallback(
    async ({ config }: StartParams) => {
      if (state.status === 'running') {
        return;
      }
      try {
        await ensurePermission();
        // Try to get an initial location but don't block indefinitely.
        // Use a short timeout so the UI remains responsive on devices with
        // slow GPS or when running in environments without a GPS fix.
        const initialLocation =
          (await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, mayShowUserSettingsDialog: true }),
            new Promise<Location.LocationObject | null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ])) ?? null;
  const timestamp = (initialLocation?.timestamp as number | undefined) ?? Date.now();

        dispatch({
          type: 'START',
          payload: {
            timestamp,
            location: initialLocation,
            config,
          },
        });
          try {
            logDiagnostic({ level: 'info', tag: 'meter.start', message: 'Meter started', payload: { timestamp, hasInitialLocation: Boolean(initialLocation) } });
          } catch {
            // ignore
          }
        await startWatcher();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to start meter.';
        dispatch({ type: 'SET_ERROR', payload: message });
        try {
          const snapshot = { appState: AppState.currentState };
          logDiagnostic({ level: 'error', tag: 'meter.start.error', message: message, payload: { error: String(error), snapshot } });
        } catch {
          // ignore
        }
        throw error;
      }
    },
    [ensurePermission, startWatcher, state.status],
  );

  const pause = useCallback(() => {
    if (state.status !== 'running') return;
    stopWatcher();
    dispatch({ type: 'PAUSE' });
    try {
      logDiagnostic({ level: 'info', tag: 'meter.pause', message: 'Meter paused', payload: { appState: AppState.currentState } });
    } catch {
      // ignore
    }
  }, [state.status, stopWatcher]);

  const resume = useCallback(async () => {
    if (state.status !== 'paused') return;
    dispatch({ type: 'RESUME', payload: { timestamp: Date.now() } });
    await startWatcher();
  }, [startWatcher, state.status]);

  const stop = useCallback(async () => {
    if (state.status === 'idle' || state.status === 'completed') return;
    stopWatcher();
    dispatch({ type: 'STOP', payload: { timestamp: Date.now() } });
    try {
      logDiagnostic({ level: 'info', tag: 'meter.stop', message: 'Meter stopped', payload: { appState: AppState.currentState } });
    } catch {
      // ignore
    }
  }, [state.status, stopWatcher]);

  const reset = useCallback(() => {
    stopWatcher();
    dispatch({ type: 'RESET' });
    try {
      logDiagnostic({ level: 'info', tag: 'meter.reset', message: 'Meter reset' });
    } catch {
      // ignore
    }
    // Remove persisted snapshot when reset
    (async () => {
      try {
        await SecureStore.deleteItemAsync('taxiops:meterState');
      } catch {
        // ignore
      }
    })();
  }, [stopWatcher]);

  // Persist meter state changes (debounced) to avoid hammering SecureStore on
  // rapid location updates. Persist at most once per 1500ms of quiet.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current as unknown as number);
      }
    } catch {
      // ignore
    }

    persistTimerRef.current = (setTimeout(async () => {
      try {
        const snapshot: MeterState = {
          status: state.status,
          startedAt: state.startedAt,
          elapsedSeconds: state.elapsedSeconds,
          distanceMeters: state.distanceMeters,
          waitSeconds: state.waitSeconds,
          lastLocation: state.lastLocation,
          lastTimestamp: state.lastTimestamp,
          idleAnchor: state.idleAnchor,
          config: state.config,
          points: state.points,
          error: state.error,
        };
        await SecureStore.setItemAsync('taxiops:meterState', JSON.stringify(snapshot));
        } catch {
        // best-effort only
      }
    }, 1500) as unknown) as number;

    return () => {
      try {
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current as unknown as number);
          persistTimerRef.current = null;
        }
      } catch {
        // ignore
      }
    };
  }, [state.status, state.startedAt, state.elapsedSeconds, state.distanceMeters, state.waitSeconds, state.lastTimestamp, state.idleAnchor, state.config, state.points, state.error, hydrated]);

  const totals = useMemo(() => {
    const distanceMiles = metersToMiles(state.distanceMeters);
    const waitMinutes = secondsToMinutes(state.waitSeconds);
    const config = state.config;
    let calculatedFare = 0;

    if (config) {
      const baseFare = config.baseFare ?? 0;
      const distanceFare = distanceMiles * (config.farePerMile ?? 0);
      const waitFare = waitMinutes * (config.waitTimePerMinute ?? 0);
      calculatedFare = baseFare + distanceFare + waitFare;
      if (config.minimumFare) {
        calculatedFare = Math.max(config.minimumFare, calculatedFare);
      }
      if (config.surgeEnabled && config.surgeMultiplier && config.surgeMultiplier > 1) {
        calculatedFare *= config.surgeMultiplier;
      }
    }

    return {
      distanceMiles,
      waitMinutes,
      fare: calculatedFare,
      elapsedSeconds: state.elapsedSeconds,
    };
  }, [state.distanceMeters, state.waitSeconds, state.elapsedSeconds, state.config]);

  return {
    ...state,
    hydrated,
    start,
    pause,
    resume,
    stop,
    reset,
    totals,
  };
}
