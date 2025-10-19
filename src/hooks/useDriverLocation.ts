import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

type PermissionStatus = Location.PermissionStatus;

export function useDriverLocation() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>(Location.PermissionStatus.UNDETERMINED);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      watcherRef.current?.remove();
      watcherRef.current = null;
    };
  }, []);

  const requestPermission = useCallback(async () => {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === Location.PermissionStatus.GRANTED) {
      setPermissionStatus(current.status);
      return current.status;
    }

    if (AppState.currentState !== 'active') {
      // Avoid prompting while backgrounded; caller should bring the app to
      // foreground and try again.
      setPermissionStatus(current.status);
      return current.status;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermissionStatus(status);
    return status;
  }, []);

  const start = useCallback(
    async (options: { distanceInterval?: number; timeInterval?: number } = {}) => {
      const status = await requestPermission();
      if (status !== Location.PermissionStatus.GRANTED) {
        throw new Error('Location permission is required to show your cab. Please bring the app to the foreground and try again.');
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
        mayShowUserSettingsDialog: true,
      });
      if (mountedRef.current) {
        setLocation(current);
      }

      watcherRef.current?.remove();
      watcherRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: options.timeInterval ?? 5000,
          distanceInterval: options.distanceInterval ?? 15,
          mayShowUserSettingsDialog: true,
        },
        (loc) => {
          if (mountedRef.current) {
            setLocation(loc);
          }
        },
      );
    },
    [requestPermission],
  );

  const stop = useCallback(() => {
    watcherRef.current?.remove();
    watcherRef.current = null;
  }, []);

  return {
    location,
    permissionStatus,
    requestPermission,
    start,
    stop,
  };
}
