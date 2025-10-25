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
  // optional filters
  const [dateFrom, setDateFrom] = useState(''); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState(''); // YYYY-MM-DD
  const [fareMin, setFareMin] = useState('');
  const [fareMax, setFareMax] = useState('');

  const { data, isFetching, isLoading, refetch } = useDriverBookings({ status: ['Completed'] });

  const { data: fareData } = useDriverFare();
  const fareConfig = fareData?.fare;

  const filtered = useMemo(() => {
    const term = String(q || '').trim().toLowerCase();
    const from = dateFrom ? dayjs(dateFrom) : null;
    const to = dateTo ? dayjs(dateTo) : null;
    const min = fareMin ? Number(fareMin) : null;
    const max = fareMax ? Number(fareMax) : null;

  const bk = data?.bookings ?? [];
  return bk.filter((b) => {
      // text search
      if (term) {
        const id = String(b.bookingId || b._id || '').toLowerCase();
        const pickup = String(b.pickupAddress || '').toLowerCase();
        const drop = String(b.dropoffAddress || '').toLowerCase();
        const dateStr = b.pickupTime ? dayjs(b.pickupTime).format('YYYY-MM-DD') : '';
        const textMatch = id.includes(term) || pickup.includes(term) || drop.includes(term) || dateStr.includes(term);
        if (!textMatch) return false;
      }

      // date range filter
      if (from || to) {
        if (!b.pickupTime) return false;
        const dt = dayjs(b.pickupTime);
        if (from && dt.isBefore(from, 'day')) return false;
        if (to && dt.isAfter(to, 'day')) return false;
      }

      // fare filter (use finalFare when present; otherwise skip or estimate)
      if (min !== null || max !== null) {
        const fareVal = b.finalFare !== undefined && b.finalFare !== null ? Number(b.finalFare) : null;
        if (fareVal === null) {
          // If finalFare not available, we'll skip the booking from results for strict filtering
          return false;
        }
        if (min !== null && fareVal < min) return false;
        if (max !== null && fareVal > max) return false;
      }

      return true;
    });
  }, [data?.bookings, q, dateFrom, dateTo, fareMin, fareMax]);

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
      } catch {
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

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            placeholder="From YYYY-MM-DD"
            placeholderTextColor="#94a3b8"
            style={[styles.search, { flex: 1 }]}
            value={dateFrom}
            onChangeText={setDateFrom}
          />
          <TextInput
            placeholder="To YYYY-MM-DD"
            placeholderTextColor="#94a3b8"
            style={[styles.search, { flex: 1 }]}
            value={dateTo}
            onChangeText={setDateTo}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            placeholder="Fare min"
            placeholderTextColor="#94a3b8"
            style={[styles.search, { flex: 1 }]}
            value={fareMin}
            onChangeText={setFareMin}
            keyboardType="numeric"
          />
          <TextInput
            placeholder="Fare max"
            placeholderTextColor="#94a3b8"
            style={[styles.search, { flex: 1 }]}
            value={fareMax}
            onChangeText={setFareMax}
            keyboardType="numeric"
          />
        </View>
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
                          } catch {
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
