import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import type { DriverAppLoginRequest } from '../../src/api/driverApp';

const initialForm: DriverAppLoginRequest = {
  identifier: '',
  password: '',
};

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (key: 'identifier' | 'password', value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!form.identifier || !form.password) {
      setError('Enter your ID (or email) and password to continue.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(form);
      router.replace('/(protected)');
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Login failed. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <View style={styles.header}>          
          <Text style={styles.title}>Driver login</Text>
          <Text style={styles.subtitle}>Check assignments, run your meter, and track hours of service.</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Driver ID / Email / Phone</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="12345 or you@example.com"
            placeholderTextColor="#6b7280"
            style={styles.input}
            value={form.identifier || ''}
            onChangeText={(value) => handleChange('identifier', value)}
            returnKeyType="next"
          />

          <Text style={[styles.label, styles.passwordLabel]}>Password</Text>
          <TextInput
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor="#6b7280"
            style={styles.input}
            value={form.password}
            onChangeText={(value) => handleChange('password', value)}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={[styles.button, submitting && styles.buttonDisabled]} onPress={handleSubmit} disabled={submitting}>
            <Text style={styles.buttonText}>{submitting ? 'Signing in...' : 'Sign in'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#04060B',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#f9fafb',
    marginBottom: 8,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 16,
    lineHeight: 22,
  },
  form: {
    backgroundColor: '#0f172a',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  label: {
    color: '#cbd5f5',
    fontSize: 14,
    marginBottom: 8,
  },
  passwordLabel: {
    marginTop: 16,
  },
  input: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#f1f5f9',
    fontSize: 16,
  },
  button: {
    marginTop: 24,
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    marginTop: 16,
    color: '#f97316',
    fontSize: 14,
  },
});
