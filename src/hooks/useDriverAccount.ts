import { useMutation } from '@tanstack/react-query';
import {
  changeDriverPassword,
  registerDriverPushToken,
  ChangePasswordPayload,
  RegisterPushTokenPayload,
  DriverSummary,
} from '../api/driverApp';
import { useAuth } from './useAuth';

export function useChangePassword() {
  const { token } = useAuth();

  return useMutation({
    mutationFn: (payload: ChangePasswordPayload) => {
      if (!token) throw new Error('Missing auth token');
      return changeDriverPassword(token, payload);
    },
  });
}

export function useRegisterPushToken() {
  const { token, setDriver } = useAuth();

  return useMutation({
    mutationFn: async (payload: RegisterPushTokenPayload) => {
      if (!token) throw new Error('Missing auth token');
      return registerDriverPushToken(token, payload);
    },
    onSuccess: (response) => {
      if (response?.driver) {
        setDriver(response.driver as DriverSummary);
      }
    },
  });
}
