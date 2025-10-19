import { useDriverBookings } from '@/src/hooks/useDriverBookings';
import { useDriverFare } from '@/src/hooks/useDriverFare';
import { formatCurrency } from '@/src/utils/format';
import { computeFareBreakdown } from '@/src/utils/meter';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function CompletedTripsScreen() {
  const [q, setQ] = useState('');
  const { data, isFetching, isLoading, refetch } = useDriverBookings({ status: ['Completed'] });

  const bookings = data?.bookings ?? [];

  const { data: fareData } = useDriverFare();
  const fareConfig = fareData?.fare;

  const filtered = useMemo(() => {
    const term = String(q || '').trim().toLowerCase();
    if (!term) return bookings;
    return bookings.filter((b) => {
      const id = String(b.bookingId || b._id || '').toLowerCase();
      const pickup = String(b.pickupAddress || '').toLowerCase();
      const drop = String(b.dropoffAddress || '').toLowerCase();
      const date = b.pickupTime ? dayjs(b.pickupTime).format('YYYY-MM-DD') : '';
      return id.includes(term) || pickup.includes(term) || drop.includes(term) || date.includes(term);
    });
  }, [bookings, q]);

  const totalRevenue = useMemo(() => {
    return filtered.reduce((sum, b) => {
      if (b.finalFare !== undefined && b.finalFare !== null) return sum + Number(b.finalFare);
      // fallback: compute an estimated final from fareConfig and booking meter/wait if possible
      if (!fareConfig) return sum;
      try {
        const breakdown = computeFareBreakdown({
          config: fareConfig,
          distanceMiles: Number(b.meterMiles ?? 0),
          waitMinutes: Number(b.waitMinutes ?? 0),
          passengerCount: Number(b.passengers ?? 1),
          otherFees: b.appliedFees ?? [],
        });
        return sum + Number(breakdown.total ?? 0);
      } catch (err) {
        return sum;
      }
    }, 0);
  }, [filtered, fareConfig]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Completed trips</Text>
        <Text style={styles.summary}>{filtered.length} trips · Total {formatCurrency(totalRevenue)}</Text>
        <TextInput
          placeholder="Search by booking id, pickup, dropoff or date"
          placeholderTextColor="#94a3b8"
          style={styles.search}
          value={q}
          onChangeText={setQ}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isLoading || isFetching}
            onRefresh={() => refetch()}
            tintColor="#f8fafc"
          />
        }
      >
        {isLoading || isFetching ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#f8fafc" />
            <Text style={styles.muted}>Loading completed trips…</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.muted}>No completed trips found.</Text>
            <Pressable style={styles.refresh} onPress={() => refetch()}>
              <Text style={styles.refreshText}>Refresh</Text>
            </Pressable>
          </View>
        ) : (
          filtered.map((b) => (
            <View key={b._id || b.bookingId} style={styles.card}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickup}>{b.pickupAddress || '-'} </Text>
                  <Text style={styles.dropoff}>{b.dropoffAddress || '-'} </Text>
                  <Text style={styles.meta}>{b.pickupTime ? dayjs(b.pickupTime).format('MMM D, h:mm A') : '-'}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.fare}>{
                    b.finalFare !== undefined && b.finalFare !== null
                      ? formatCurrency(b.finalFare)
                      : fareConfig
                      ? (() => {
                          try {
                            const cb = computeFareBreakdown({
                              config: fareConfig,
                              distanceMiles: Number(b.meterMiles ?? 0),
                              waitMinutes: Number(b.waitMinutes ?? 0),
                              passengerCount: Number(b.passengers ?? 1),
                              otherFees: b.appliedFees ?? [],
                            });
                            return formatCurrency(cb.total);
                          } catch (e) {
                            return '-';
                          }
                        })()
                      : '-'
                  }</Text>
                  <Text style={styles.status}>{b.status}</Text>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#030712' },
  header: { padding: 20, gap: 12 },
  title: { color: '#f8fafc', fontSize: 24, fontWeight: '700' },
  search: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  content: { padding: 20, gap: 12 },
  loadingRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  muted: { color: '#94a3b8' },
  empty: { alignItems: 'center', padding: 40 },
  refresh: { marginTop: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#2563EB' },
  refreshText: { color: '#fff', fontWeight: '700' },
  card: { backgroundColor: '#0f172a', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#1e293b' },
  row: { flexDirection: 'row', gap: 12 },
  pickup: { color: '#f8fafc', fontWeight: '700' },
  dropoff: { color: '#94a3b8', marginTop: 4 },
  meta: { color: '#94a3b8', marginTop: 6 },
  fare: { color: '#22d3ee', fontWeight: '700' },
  status: { color: '#94a3b8', marginTop: 6 },
  summary: { color: '#cbd5e1', marginTop: 6 },
});
