import * as SecureStore from 'expo-secure-store';

const HOS_KEY = 'taxiops:hos';

export type HosState = {
  dutyStart?: string | null;
  lastBreakStart?: string | null;
  lastBreakEnd?: string | null;
  onDutyMinutesToday?: number | null;
  // last time (ISO) we reported a delta to the server
  lastReportedAt?: string | null;
};

export async function getHos(): Promise<HosState> {
  try {
    const raw = await SecureStore.getItemAsync(HOS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

export async function setHos(state: HosState): Promise<void> {
  try {
    await SecureStore.setItemAsync(HOS_KEY, JSON.stringify(state));
  } catch (e) {
    // ignore
  }
}

export async function clearHos(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(HOS_KEY);
  } catch (e) {}
}

export default { getHos, setHos, clearHos };
