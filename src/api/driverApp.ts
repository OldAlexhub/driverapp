export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL && process.env.EXPO_PUBLIC_API_URL.trim().length
    ? process.env.EXPO_PUBLIC_API_URL
    : 'http://192.168.0.13:3001/api'
).replace(/\/$/, '');

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  token?: string | null;
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', token, body } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

export interface DriverAppLoginRequest {
  identifier?: string;
  email?: string;
  driverId?: string;
  phoneNumber?: string;
  password: string;
  deviceId?: string | null;
  pushToken?: string | null;
}

export interface DriverSummary {
  _id: string;
  driverId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  driverApp?: {
    forcePasswordReset?: boolean;
    lastLoginAt?: string | null;
    lastLogoutAt?: string | null;
    deviceId?: string | null;
    pushToken?: string | null;
  };
}

export interface HoursOfService {
  dutyStart?: string | null;
  lastBreakStart?: string | null;
  lastBreakEnd?: string | null;
  drivingMinutesToday?: number | null;
  onDutyMinutesToday?: number | null;
  offDutyMinutesToday?: number | null;
  drivingMinutes7d?: number | null;
  onDutyMinutes7d?: number | null;
  maxDailyDrivingMinutes?: number | null;
  maxDailyOnDutyMinutes?: number | null;
  maxWeeklyOnDutyMinutes?: number | null;
  cycleStart?: string | null;
  lastResetAt?: string | null;
}

export interface ActiveSummary {
  _id: string;
  driverId: string;
  cabNumber?: string;
  status: 'Active' | 'Inactive';
  availability: 'Online' | 'Offline';
  hoursOfService?: HoursOfService;
  updatedAt?: string;
}

export interface BookingSummary {
  _id: string;
  bookingId: number;
  pickupAddress: string;
  dropoffAddress?: string;
  pickupTime: string;
  status: string;
  customerName?: string;
  phoneNumber?: string;
  cabNumber?: string;
  dispatchMethod?: string;
  tripSource?: string;
  driverId?: string;
  passengers?: number;
  notes?: string;
  estimatedFare?: number | null;
  finalFare?: number | null;
  meterMiles?: number | null;
  waitMinutes?: number | null;
  pickupLat?: number | null;
  pickupLon?: number | null;
  dropoffLat?: number | null;
  dropoffLon?: number | null;
  appliedFees?: { name: string; amount: number }[];
  fareStrategy?: 'meter' | 'flat';
  flatRateRef?: string | null;
  flatRateName?: string | null;
  flatRateAmount?: number | null;
}

export interface DriverProfileResponse {
  driver: DriverSummary;
  active: ActiveSummary | null;
  upcomingBookings: BookingSummary[];
}

export type BookingStatus =
  | 'Pending'
  | 'Assigned'
  | 'EnRoute'
  | 'PickedUp'
  | 'Completed'
  | 'Cancelled'
  | 'NoShow';

export interface FlatRateOption {
  _id: string;
  name: string;
  amount: number;
  distanceLabel?: string;
  active: boolean;
}

export interface FareConfig {
  _id: string;
  farePerMile: number;
  extraPass?: number;
  waitTimePerMinute: number;
  baseFare?: number;
  minimumFare?: number;
  waitTriggerSpeedMph?: number;
  idleGracePeriodSeconds?: number;
  meterRoundingMode?: string;
  surgeEnabled?: boolean;
  surgeMultiplier?: number;
  surgeNotes?: string;
  updatedAt?: string;
  otherFees?: { name: string; amount: number }[];
}

export interface DriverFareResponse {
  fare: FareConfig;
  flatRates: FlatRateOption[];
}

export interface DriverLoginResponse {
  message: string;
  token: string;
  driver: DriverSummary;
}

export interface UpdatePresencePayload {
  availability?: 'Online' | 'Offline';
  status?: 'Active' | 'Inactive';
  lat?: number;
  lng?: number;
  hoursOfService?: Partial<HoursOfService>;
  note?: string;
}

export async function driverLogin(payload: DriverAppLoginRequest): Promise<DriverLoginResponse> {
  return request<DriverLoginResponse>('/driver-app/auth/login', {
    method: 'POST',
    body: payload,
  });
}

export async function driverLogout(token: string, deviceId?: string | null): Promise<void> {
  await request('/driver-app/auth/logout', {
    method: 'POST',
    token,
    body: deviceId ? { deviceId } : undefined,
  });
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export async function changeDriverPassword(
  token: string,
  payload: ChangePasswordPayload,
): Promise<{ message: string }> {
  return request<{ message: string }>('/driver-app/auth/password', {
    method: 'POST',
    token,
    body: payload,
  });
}

export async function getDriverProfile(token: string): Promise<DriverProfileResponse> {
  return request<DriverProfileResponse>('/driver-app/me', { token });
}

export async function updateDriverPresence(
  token: string,
  payload: UpdatePresencePayload,
): Promise<DriverProfileResponse> {
  return request<DriverProfileResponse>('/driver-app/presence', {
    method: 'PATCH',
    token,
    body: payload,
  });
}

export interface ListBookingsParams {
  status?: BookingStatus[];
  from?: string;
  to?: string;
}

export interface DriverBookingsResponse {
  count: number;
  bookings: BookingSummary[];
}

export async function listDriverBookings(
  token: string,
  params: ListBookingsParams = {},
): Promise<DriverBookingsResponse> {
  const query = new URLSearchParams();
  if (params.status && params.status.length) {
    query.set('status', params.status.join(','));
  }
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  const qs = query.toString();
  const path = qs.length ? `/driver-app/bookings?${qs}` : '/driver-app/bookings';
  return request<DriverBookingsResponse>(path, { token });
}

export async function acknowledgeBooking(
  token: string,
  bookingId: string,
  note?: string,
): Promise<{ message: string; booking?: BookingSummary }> {
  return request(`/driver-app/bookings/${bookingId}/acknowledge`, {
    method: 'POST',
    token,
    body: note ? { note } : {},
  });
}

export async function declineBooking(
  token: string,
  bookingId: string,
): Promise<{ message: string; booking?: BookingSummary }> {
  return request(`/driver-app/bookings/${bookingId}/decline`, {
    method: 'POST',
    token,
  });
}

export interface UpdateBookingStatusPayload {
  status: BookingStatus;
  note?: string;
  meterMiles?: number;
  waitMinutes?: number;
  dropoffAddress?: string;
  dropoffLat?: number;
  dropoffLon?: number;
  cancelReason?: string;
  cancelledBy?: string;
  noShowFeeApplied?: boolean;
  flatRateId?: string;
  otherFeeNames?: string[];
  finalFare?: number;
}

export async function updateBookingStatus(
  token: string,
  bookingId: string,
  payload: UpdateBookingStatusPayload,
): Promise<{ message: string; booking?: BookingSummary }> {
  return request(`/driver-app/bookings/${bookingId}/status`, {
    method: 'PATCH',
    token,
    body: payload,
  });
}

export interface ReportLocationPayload {
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
}

export async function reportBookingLocation(
  token: string,
  bookingId: string,
  payload: ReportLocationPayload,
): Promise<{ message: string }> {
  return request(`/driver-app/bookings/${bookingId}/location`, {
    method: 'POST',
    token,
    body: payload,
  });
}

export interface FlagdownPayload {
  customerName?: string;
  phoneNumber?: string;
  pickupAddress?: string;
  pickupDescription?: string;
  pickupLat?: number;
  pickupLon?: number;
  dropoffAddress?: string;
  dropoffLat?: number;
  dropoffLon?: number;
  passengers?: number;
  notes?: string;
  estimatedFare?: number;
  flatRateId?: string;
}

export async function createFlagdown(
  token: string,
  payload: FlagdownPayload,
): Promise<{ message: string; booking?: BookingSummary }> {
  return request<{ message: string; booking?: BookingSummary }>('/driver-app/flagdowns', {
    method: 'POST',
    token,
    body: payload,
  });
}

export async function fetchDriverFare(token: string): Promise<DriverFareResponse> {
  return request<DriverFareResponse>('/driver-app/fare', { token });
}

export interface RegisterPushTokenPayload {
  pushToken: string;
  deviceId?: string | null;
}

export async function registerDriverPushToken(
  token: string,
  payload: RegisterPushTokenPayload,
): Promise<{ message: string; driver: DriverSummary }> {
  return request<{ message: string; driver: DriverSummary }>('/driver-app/push-token', {
    method: 'POST',
    token,
    body: payload,
  });
}

export async function acknowledgeDriverMessage(
  token: string,
  messageId: string,
  note?: string,
): Promise<{ message: string }> {
  return request(`/driver-app/messages/${messageId}/acknowledge`, {
    method: 'POST',
    token,
    body: note ? { note } : {},
  });
}

export async function snoozeDriverMessage(
  token: string,
  messageId: string,
  minutes = 10,
): Promise<{ message: string; snoozeUntil?: string }> {
  return request(`/driver-app/messages/${messageId}/snooze`, {
    method: 'POST',
    token,
    body: { minutes },
  });
}

export interface AppendHosPayload {
  date: string; // YYYY-MM-DD
  minutes: number;
}

export async function appendHos(token: string, payload: AppendHosPayload): Promise<{ message: string }> {
  return request('/driver-app/hos', { method: 'POST', token, body: payload });
}

export async function getHosSummary(token: string, driverId?: string, days = 8): Promise<any> {
  const path = driverId ? `/driver-app/hos/${driverId}?days=${days}` : `/driver-app/hos?days=${days}`;
  return request<any>(path, { token });
}

export async function uploadDiagnostics(token: string, payload: unknown): Promise<{ message: string }> {
  return request<{ message: string }>('/driver-app/diagnostics', { method: 'POST', token, body: payload });
}
