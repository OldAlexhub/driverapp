import { Redirect, Slot } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../src/hooks/useAuth';

function LoadingScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#04060B' }}>
      <ActivityIndicator size="large" color="#fff" />
    </View>
  );
}

export default function ProtectedLayout() {
  const { initializing, token } = useAuth();

  if (initializing) {
    return <LoadingScreen />;
  }

  if (!token) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Slot />;
}
