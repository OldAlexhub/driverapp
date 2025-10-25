import { appendHos } from '@/src/api/driverApp';
import * as SecureStore from 'expo-secure-store';

const HOS_KEY = 'taxiops:hos';
const HOS_QUEUE_KEY = 'taxiops:hos:queue';

export type HosState = {
  dutyStart?: string | null;
  lastBreakStart?: string | null;
  lastBreakEnd?: string | null;
  onDutyMinutesToday?: number | null;
  // last time (ISO) we reported a delta to the server
  lastReportedAt?: string | null;
};

export type HosQueueEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  minutes: number;
  attempts?: number;
  lastAttemptAt?: string | null;
};

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, val: unknown): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(val));
  } catch {}
}

export async function getHos(): Promise<HosState> {
  const v = await readJson<HosState>(HOS_KEY);
  return v || {};
}

export async function setHos(state: HosState): Promise<void> {
  await writeJson(HOS_KEY, state || {});
}

export async function clearHos(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(HOS_KEY);
  } catch {}
}

// Queue helpers
function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function enqueueHosDelta(entry: { date: string; minutes: number }): Promise<HosQueueEntry> {
  const q = (await readJson<HosQueueEntry[]>(HOS_QUEUE_KEY)) || [];
  const e: HosQueueEntry = { id: makeId(), date: entry.date, minutes: entry.minutes, attempts: 0, lastAttemptAt: null };
  q.push(e);
  await writeJson(HOS_QUEUE_KEY, q);
  return e;
}

export async function getPendingQueue(): Promise<HosQueueEntry[]> {
  return (await readJson<HosQueueEntry[]>(HOS_QUEUE_KEY)) || [];
}

export async function removeQueueEntry(id: string): Promise<void> {
  const q = (await readJson<HosQueueEntry[]>(HOS_QUEUE_KEY)) || [];
  const rem = q.filter((x) => x.id !== id);
  await writeJson(HOS_QUEUE_KEY, rem);
}

// Attempt to flush the queue with exponential backoff. This is best-effort
// and will update attempts/lastAttemptAt so subsequent runs back off.
export async function processPendingQueue(token?: string): Promise<void> {
  if (!token) return;
  const q = (await getPendingQueue()).slice();
  if (!q.length) return;

  for (const entry of q) {
    try {
      // simple backoff: skip if attempts > 0 and lastAttemptAt was recent
      const attempts = Number(entry.attempts || 0);
      if (attempts > 0 && entry.lastAttemptAt) {
        const last = new Date(entry.lastAttemptAt).getTime();
        const waitMs = Math.min(60 * 60 * 1000, Math.pow(2, attempts) * 1000); // up to 1h
        if (Date.now() - last < waitMs) continue; // skip until backoff window passes
      }

      await appendHos(token, { date: entry.date, minutes: entry.minutes });
      await removeQueueEntry(entry.id);
    } catch (err) {
      // update attempts and lastAttemptAt
      try {
        const current = (await getPendingQueue()) || [];
        const found = current.find((x) => x.id === entry.id);
        if (found) {
          found.attempts = (Number(found.attempts || 0) + 1);
          found.lastAttemptAt = new Date().toISOString();
          await writeJson(HOS_QUEUE_KEY, current);
        }
      } catch {}
    }
  }
}

export default { getHos, setHos, clearHos, enqueueHosDelta, getPendingQueue, processPendingQueue };
