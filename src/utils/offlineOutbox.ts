import { createFlagdown, updateBookingStatus } from '@/src/api/driverApp';
import * as SecureStore from 'expo-secure-store';

const OUTBOX_KEY = 'taxiops:outbox';

export type OutboxItem =
  | {
      id: string;
      type: 'updateBookingStatus';
      bookingId: string;
      payload: unknown;
      createdAt: number;
    }
  | {
      id: string;
      type: 'flagdownAndComplete';
      flagdownPayload: unknown; // createFlagdown payload
      completionPayload: { note?: string; meterMiles?: number; waitMinutes?: number; dropoffAddress?: string; dropoffLat?: number; dropoffLon?: number; otherFeeNames?: string[]; flatRateId?: string | undefined };
      createdAt: number;
    };

async function readOutbox(): Promise<OutboxItem[]> {
  try {
    const raw = await SecureStore.getItemAsync(OUTBOX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OutboxItem[];
  } catch {
    return [];
  }
}

async function writeOutbox(items: OutboxItem[]) {
  await SecureStore.setItemAsync(OUTBOX_KEY, JSON.stringify(items));
}

export async function enqueueOutbox(item: OutboxItem) {
  const items = await readOutbox();
  items.push(item);
  await writeOutbox(items);
}

export async function listOutbox(): Promise<OutboxItem[]> {
  return readOutbox();
}

export async function clearOutbox() {
  await SecureStore.deleteItemAsync(OUTBOX_KEY);
}

// Attempt to flush the outbox sequentially. If any item fails due to auth or
// bad payload, remove it to avoid infinite loops. Network errors will abort
// and leave remaining items for a later retry.
export async function flushOutbox(token: string | null) {
  if (!token) return;
  const items = await readOutbox();
  if (!items.length) return;

  const remaining: OutboxItem[] = [];

  for (const item of items) {
    try {
      if (item.type === 'updateBookingStatus') {
        // @ts-ignore
        await updateBookingStatus(token, item.bookingId, item.payload as any);
      } else if (item.type === 'flagdownAndComplete') {
        // create flagdown then complete it
        // @ts-ignore
        const resp = await createFlagdown(token, item.flagdownPayload as any);
        // if booking created, then complete it with updateBookingStatus
        if (resp?.booking?._id) {
          const bookingId = resp.booking._id;
          await updateBookingStatus(token, bookingId, item.completionPayload as any);
        }
      }
    } catch (err: any) {
      // network error: stop and keep this and remaining items for later
      if (!err || !err.status) {
        remaining.push(item);
        const index = items.indexOf(item);
        const rest = items.slice(index + 1);
        remaining.push(...rest);
        break;
      }
      // auth or bad request: drop the item
      // continue to next
    }
  }

  if (remaining.length) {
    await writeOutbox(remaining);
  } else {
    await clearOutbox();
  }
}

export default {
  enqueueOutbox,
  listOutbox,
  flushOutbox,
  clearOutbox,
};
