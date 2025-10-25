import { reportRuntimeError } from '@/src/utils/globalErrorReporter';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type State = { hasError: boolean; error?: Error | null };

export class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, State> {
  state: State = { hasError: false, error: null };

  componentDidCatch(error: Error) {
    this.setState({ hasError: true, error });
    try {
      // Dont await
      reportRuntimeError({ message: error.message, stack: error.stack || null, fatal: false });
    } catch {
      // ignore
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error?.message ?? 'Unexpected error'}</Text>
          <Pressable style={styles.button} onPress={() => this.setState({ hasError: false, error: null })}>
            <Text style={styles.buttonText}>Dismiss</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children as any;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#0b1020' },
  title: { color: '#ff6b6b', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  message: { color: '#fff', marginBottom: 16 },
  button: { paddingVertical: 12, paddingHorizontal: 18, backgroundColor: '#2563EB', borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '700' },
});

export default ErrorBoundary;
