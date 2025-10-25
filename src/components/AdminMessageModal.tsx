import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AdminMessage } from '../hooks/useAdminMessages';

type Props = {
  message: AdminMessage | null;
  onClose: () => void;
  onAcknowledge?: (note?: string) => Promise<boolean | null> | void;
  onSnooze?: (minutes?: number) => Promise<string | null> | void;
  onOpenDetails?: () => void;
};

export default function AdminMessageModal({ message, onClose, onAcknowledge, onSnooze, onOpenDetails }: Props) {
  if (!message) return null;

  const timeLabel = message.sendAt ? new Date(message.sendAt).toLocaleString() : '';

  return (
    <View style={styles.backdrop} pointerEvents="box-none">
      <View style={styles.modal}>
        <Text style={styles.title}>{message.title || 'Admin message'}</Text>
        <Text style={styles.body}>{message.body || ''}</Text>
        {timeLabel ? <Text style={styles.time}>{timeLabel}</Text> : null}
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={async () => {
              try {
                if (onAcknowledge) await onAcknowledge();
              } catch {
                // ignore
              }
            }}
            style={[styles.button, styles.ackButton]}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Acknowledge</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              try {
                if (onSnooze) await onSnooze(10);
              } catch {
                // ignore
              }
            }}
            style={[styles.button, styles.snoozeButton]}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Snooze</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.button} accessibilityRole="button">
            <Text style={styles.buttonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 2000,
  },
  modal: {
    width: '90%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    elevation: 6,
  },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#0f172a' },
  body: { fontSize: 14, color: '#0f172a', marginBottom: 10 },
  time: { fontSize: 12, color: '#6b7280', marginBottom: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  button: {
    backgroundColor: '#0ea5ff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  ackButton: {
    backgroundColor: '#10b981',
    marginRight: 8,
  },
  snoozeButton: {
    backgroundColor: '#f59e0b',
    marginRight: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
});
