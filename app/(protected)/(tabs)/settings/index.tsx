import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/src/hooks/useAuth';
import { useDriverFare } from '@/src/hooks/useDriverFare';
import { formatCurrency } from '@/src/utils/format';
import { useChangePassword } from '@/src/hooks/useDriverAccount';

type PasswordForm = {
  current: string;
  next: string;
  confirm: string;
};

export default function SettingsScreen() {
  const { signOut, driver } = useAuth();
  const { data: fareData, isLoading: isFareLoading, error: fareError, refetch: refetchFare } = useDriverFare();
  const { mutateAsync: changePassword, isPending: isChangingPassword } = useChangePassword();

  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({ current: '', next: '', confirm: '' });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const meterConfig = useMemo(() => fareData?.fare, [fareData?.fare]);
  const flatRates = useMemo(() => fareData?.flatRates ?? [], [fareData?.flatRates]);

  const handlePasswordSubmit = async () => {
    setStatusMessage(null);
    setErrorMessage(null);
    if (!passwordForm.current.trim() || !passwordForm.next.trim() || !passwordForm.confirm.trim()) {
      setErrorMessage('Fill in all password fields.');
      return;
    }
    if (passwordForm.next.trim().length < 8) {
      setErrorMessage('New password must be at least 8 characters.');
      return;
    }
    if (passwordForm.next.trim() !== passwordForm.confirm.trim()) {
      setErrorMessage('New passwords do not match.');
      return;
    }

    try {
      await changePassword({
        currentPassword: passwordForm.current,
        newPassword: passwordForm.next,
      });
      setStatusMessage('Password updated successfully.');
      setPasswordModalVisible(false);
      setPasswordForm({ current: '', next: '', confirm: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to change password.';
      setErrorMessage(message);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>
          Manage your driver profile and fare configuration. Notifications register automatically when you sign in.
        </Text>

        {statusMessage ? <Text style={styles.success}>{statusMessage}</Text> : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.heading}>Driver profile</Text>
          <ProfileRow label="Name" value={`${driver?.firstName ?? ''} ${driver?.lastName ?? ''}`.trim()} />
          <ProfileRow label="Driver ID" value={driver?.driverId ?? '—'} />
          <ProfileRow label="Email" value={driver?.email ?? '—'} />
          <ProfileRow label="Phone" value={driver?.phoneNumber ?? '—'} />
          <ProfileRow
            label="Last login"
            value={driver?.driverApp?.lastLoginAt ? new Date(driver.driverApp.lastLoginAt).toLocaleString() : '—'}
          />
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.heading}>Meter &amp; flat rates</Text>
            <Pressable style={styles.refreshButton} onPress={() => refetchFare()}>
              {isFareLoading ? (
                <ActivityIndicator size="small" color="#22d3ee" />
              ) : (
                <Text style={styles.refreshText}>Refresh</Text>
              )}
            </Pressable>
          </View>
          {fareError ? (
            <Text style={styles.error}>
              {fareError instanceof Error ? fareError.message : 'Unable to load fare configuration.'}
            </Text>
          ) : null}
          {meterConfig ? (
            <View style={styles.meterGrid}>
              <MeterItem label="Base fare" value={formatCurrency(meterConfig.baseFare ?? 0)} />
              <MeterItem label="Per mile" value={formatCurrency(meterConfig.farePerMile ?? 0)} />
              <MeterItem label="Wait / min" value={formatCurrency(meterConfig.waitTimePerMinute ?? 0)} />
              <MeterItem label="Minimum fare" value={formatCurrency(meterConfig.minimumFare ?? 0)} />
              <MeterItem label="Wait trigger" value={`${meterConfig.waitTriggerSpeedMph ?? 3} mph`} />
              <MeterItem label="Idle grace" value={`${meterConfig.idleGracePeriodSeconds ?? 45}s`} />
            </View>
          ) : (
            <Text style={styles.placeholder}>Meter configuration will appear once dispatch publishes it.</Text>
          )}

          {flatRates.length ? (
            <View style={styles.flatRates}>
              {flatRates.map((rate) => (
                <View key={rate._id} style={styles.flatRateCard}>
                  <Text style={styles.flatRateName}>{rate.name}</Text>
                  <Text style={styles.flatRateAmount}>{formatCurrency(rate.amount)}</Text>
                  {rate.distanceLabel ? <Text style={styles.flatRateMeta}>{rate.distanceLabel}</Text> : null}
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.placeholder}>
              Dispatch has not published any flat rates yet. They will appear here once available.
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Account security</Text>
          <Text style={styles.caption}>Change your driver app password without contacting dispatch.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setPasswordModalVisible(true)}>
            <Text style={styles.primaryButtonText}>Change password</Text>
          </Pressable>
        </View>

        <Pressable style={[styles.primaryButton, styles.logout]} onPress={signOut}>
          <Text style={styles.primaryButtonText}>Log out</Text>
        </Pressable>
      </ScrollView>

      <PasswordModal
        visible={passwordModalVisible}
        onClose={() => {
          setPasswordModalVisible(false);
          setPasswordForm({ current: '', next: '', confirm: '' });
        }}
        form={passwordForm}
        onChange={setPasswordForm}
        onSubmit={handlePasswordSubmit}
        submitting={isChangingPassword}
      />
    </SafeAreaView>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={2}>
        {value || '—'}
      </Text>
    </View>
  );
}

function MeterItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.meterItem}>
      <Text style={styles.meterLabel}>{label}</Text>
      <Text style={styles.meterValue}>{value}</Text>
    </View>
  );
}

function PasswordModal({
  visible,
  onClose,
  form,
  onChange,
  onSubmit,
  submitting,
}: {
  visible: boolean;
  onClose: () => void;
  form: PasswordForm;
  onChange: (form: PasswordForm) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Update password</Text>
          <Text style={styles.modalSubtitle}>Enter your current password and a new one to update access.</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="Current password"
            placeholderTextColor="#64748b"
            secureTextEntry
            value={form.current}
            onChangeText={(text) => onChange({ ...form, current: text })}
          />
          <TextInput
            style={styles.modalInput}
            placeholder="New password"
            placeholderTextColor="#64748b"
            secureTextEntry
            value={form.next}
            onChangeText={(text) => onChange({ ...form, next: text })}
          />
          <TextInput
            style={styles.modalInput}
            placeholder="Confirm new password"
            placeholderTextColor="#64748b"
            secureTextEntry
            value={form.confirm}
            onChangeText={(text) => onChange({ ...form, confirm: text })}
          />
          <View style={styles.modalActions}>
            <Pressable style={[styles.modalButton, styles.modalCancel]} onPress={onClose} disabled={submitting}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.modalButton, styles.modalPrimary, submitting && styles.disabledButton]}
              onPress={onSubmit}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.modalPrimaryText}>Update</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#030712' },
  container: { padding: 20, gap: 18, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', color: '#f9fafb' },
  subtitle: { color: '#94a3b8', fontSize: 14 },
  success: { color: '#4ade80', fontWeight: '600' },
  error: { color: '#f97316', fontWeight: '600' },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 18,
    gap: 12,
  },
  heading: { color: '#f8fafc', fontWeight: '700', fontSize: 18 },
  caption: { color: '#94a3b8', fontSize: 13 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: { color: '#64748b', fontSize: 13 },
  value: { color: '#e2e8f0', fontWeight: '600', textAlign: 'right', flexShrink: 1, marginLeft: 16 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refreshButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
  },
  refreshText: {
    color: '#38bdf8',
    fontWeight: '600',
  },
  meterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  meterItem: {
    width: '47%',
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 12,
    gap: 4,
  },
  meterLabel: { color: '#64748b', fontSize: 12, textTransform: 'uppercase' },
  meterValue: { color: '#e2e8f0', fontWeight: '600' },
  placeholder: { color: '#94a3b8', fontSize: 13 },
  flatRates: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  flatRateCard: {
    width: '48%',
    backgroundColor: '#111827',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 14,
    gap: 4,
  },
  flatRateName: { color: '#f8fafc', fontWeight: '600' },
  flatRateAmount: { color: '#22d3ee', fontWeight: '700' },
  flatRateMeta: { color: '#94a3b8', fontSize: 12 },
  primaryButton: {
    backgroundColor: '#22d3ee',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#0f172a', fontWeight: '700' },
  disabledButton: { opacity: 0.5 },
  logout: {
    backgroundColor: '#f87171',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(3, 7, 18, 0.8)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderColor: '#1e293b',
  },
  modalTitle: { color: '#f9fafb', fontSize: 20, fontWeight: '700' },
  modalSubtitle: { color: '#94a3b8', fontSize: 13 },
  modalInput: {
    backgroundColor: '#111827',
    color: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalButton: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 14,
  },
  modalCancel: {
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalCancelText: { color: '#e2e8f0', fontWeight: '600' },
  modalPrimary: {
    backgroundColor: '#22d3ee',
  },
  modalPrimaryText: { color: '#0f172a', fontWeight: '700' },
});
