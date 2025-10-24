import { formatCurrency, formatDistance, formatDuration } from '@/src/utils/format';
import { useRouter } from 'expo-router';
import React, { PropsWithChildren, createContext, useCallback, useContext, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type RecapPayload = {
  tripLabel?: string;
  distanceMiles?: number;
  waitMinutes?: number;
  elapsedSeconds?: number;
  passengers?: number;
  otherFees?: { name: string; amount: number }[];
  flatRateName?: string | null;
  total?: number | null;
};

type RecapContextValue = {
  showRecap: (payload: RecapPayload) => void;
};

const RecapContext = createContext<RecapContextValue>({ showRecap: () => {} });

// Expose a module-level callable so non-React code (mutations, utilities)
// can request a recap without calling hooks outside components. This will be
// wired to the live provider instance when mounted.
let __globalShowRecap: ((p: RecapPayload) => void) | null = null;
export function showRecapGlobal(p: RecapPayload) {
  try {
    if (__globalShowRecap) __globalShowRecap(p);
  } catch (_e) {}
}

export function RecapProvider({ children }: PropsWithChildren) {
  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState<RecapPayload | null>(null);
  const router = useRouter();

  const showRecap = useCallback((p: RecapPayload) => {
    setPayload(p);
    setVisible(true);
  }, []);

  // Wire the module-global caller to the local showRecap so external code can
  // call `showRecapGlobal(...)` without needing React hooks.
  React.useEffect(() => {
    __globalShowRecap = showRecap;
    return () => {
      if (__globalShowRecap === showRecap) __globalShowRecap = null;
    };
  }, [showRecap]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setPayload(null);
    // After dismiss, navigate to dashboard to give driver a stable place
    try {
      router.replace('/(protected)/(tabs)/dashboard');
    } catch (_e) {}
  }, [router]);

  return (
    <RecapContext.Provider value={{ showRecap }}>
      {children}
      <Modal visible={visible} transparent animationType="slide" onRequestClose={handleDismiss}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Trip recap</Text>
            {payload ? (
              <>
                <Text style={styles.modalSubtitle}>{payload.tripLabel ?? 'Trip'}</Text>
                {payload.flatRateName ? <Text style={styles.modalSubtitle}>Flat rate - {payload.flatRateName}</Text> : null}
                {typeof payload.distanceMiles === 'number' ? (
                  <View style={styles.modalMetrics}>
                    <Text style={styles.detailLabel}>Distance: {formatDistance(payload.distanceMiles)}</Text>
                    <Text style={styles.detailLabel}>Wait: {payload.waitMinutes?.toFixed(1) ?? '0.0'} min</Text>
                    <Text style={styles.detailLabel}>Elapsed: {formatDuration(payload.elapsedSeconds ?? 0)}</Text>
                  </View>
                ) : null}
                <View style={styles.modalFare}>
                  <Text style={styles.detailLabel}>Passengers: {payload.passengers ?? 1}</Text>
                  {payload.otherFees?.map((f) => (
                    <Text key={f.name} style={styles.detailLabel}>{`${f.name}: ${formatCurrency(f.amount)}`}</Text>
                  ))}
                  <Text style={[styles.detailLabel, styles.total]}>Total due: {formatCurrency(payload.total ?? 0)}</Text>
                </View>
              </>
            ) : (
              <ActivityIndicator color="#f8fafc" />
            )}
            <Pressable style={[styles.primaryButton, styles.modalButton]} onPress={handleDismiss}>
              <Text style={styles.primaryButtonText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </RecapContext.Provider>
  );
}

export function useRecap() {
  return useContext(RecapContext);
}

const styles = StyleSheet.create({
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
  modalTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 22 },
  modalSubtitle: { color: '#94a3b8', fontSize: 13 },
  modalMetrics: { gap: 6, marginTop: 6 },
  modalFare: { gap: 6, marginTop: 8 },
  detailLabel: { color: '#94a3b8' },
  total: { color: '#22d3ee', fontWeight: '700', marginTop: 6 },
  modalButton: { marginTop: 8 },
  primaryButton: {
    backgroundColor: '#22d3ee',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#0f172a', fontWeight: '700', fontSize: 16 },
});

export default RecapProvider;
