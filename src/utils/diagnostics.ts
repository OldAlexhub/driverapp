// Diagnostics utility: buffered logging and upload
import { uploadDiagnostics } from '@/src/api/driverApp';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type DiagnosticEntry = {
  at: string; // ISO timestamp
  level?: 'info' | 'warn' | 'error';
  tag?: string;
  message?: string;
  payload?: any;
};

const STORE_KEY = 'taxiops:diagnosticsBuffer';

async function readBuffer(): Promise<DiagnosticEntry[]> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DiagnosticEntry[];
  } catch {
    return [];
  }
}

async function writeBuffer(entries: DiagnosticEntry[]) {
  try {
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

export async function logDiagnostic(entry: Omit<DiagnosticEntry, 'at'>) {
  try {
    // attach a small _meta context blob with device/app info
    const manifest = (Constants as any).manifest || (Constants as any).expoConfig || null;
    const meta = {
      app: {
        name: manifest ? manifest.name || manifest.slug || null : null,
        version: Constants.nativeAppVersion || (manifest ? manifest.version || null : null) || null,
        sdkVersion: manifest ? manifest.sdkVersion || null : (Constants as any).expoVersion || null,
      },
      device: {
        platform: Platform.OS,
        osVersion: Platform.Version,
        deviceName: (Constants as any).deviceName || null,
        expoDevicePlatform: (Constants as any).platform || null,
      },
    };

    const payload: DiagnosticEntry = {
      at: new Date().toISOString(),
      ...entry,
      payload: { ...(entry.payload || {}), _meta: meta },
    };
    const buf = await readBuffer();
    buf.push(payload);
    // limit buffer size
    if (buf.length > 500) buf.splice(0, buf.length - 500);
    await writeBuffer(buf);
  } catch {
    // ignore
  }
}

export async function flushDiagnostics(token?: string) {
  try {
    const buf = await readBuffer();
    if (!buf.length) return;
    if (!token) return; // require auth token to upload
    // send up to 200 entries at a time
    const batch = buf.slice(0, 200);
    try {
      await uploadDiagnostics(token, batch);
      const remaining = buf.slice(batch.length);
      await writeBuffer(remaining);
    } catch (e) {
      // if upload failed, keep buffer for retry
      console.warn('Diagnostics upload failed', e);
    }
  } catch {}
}

export async function getDiagnostics(): Promise<DiagnosticEntry[]> {
  return readBuffer();
}

export async function clearDiagnostics(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(STORE_KEY);
  } catch {}
}

export default {
  logDiagnostic,
  getDiagnostics,
  clearDiagnostics,
  flushDiagnostics,
};
