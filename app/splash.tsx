import { useAuth } from '@/src/hooks/useAuth';
// Lazy-load Video from expo-av to avoid top-level native initialization
// which can cause EventEmitter errors in Expo Go/dev setups.
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SplashVideo() {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('Splash loaded');
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const startedAtRef = useRef<number | null>(null);
  const MIN_SPLASH_MS = 7000; // minimum time to show splash (ms)

  useEffect(() => {
    let mounted = true;
    (async () => {
      // small delay to allow native splash to hide cleanly
      await new Promise((r) => setTimeout(r, 300));
      if (mounted) {
        setLoading(false);
        startedAtRef.current = Date.now();
      }
    })();
    // no dynamic native imports for a static splash
    return () => { mounted = false; };
  }, []);

  // Simple splash: navigate after a small delay to allow initial paint,
  // then ensure minimum splash duration via finishWhenReady.
  
  const { token } = useAuth();

  const finishWhenReady = useCallback(() => {
    const started = startedAtRef.current ?? Date.now();
    const elapsed = Date.now() - started;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
      if (remaining > 0) {
      setTimeout(() => {
        try {
          finishWhenReady();
        } catch {}
      }, remaining);
      return;
    }
    try {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('Splash navigating after min duration, token present:', !!token);
      if (token) {
        router.replace('/(protected)');
      } else {
        router.replace('/(auth)/login');
      }
    } catch {
      // swallow navigation errors during teardown
    }
  }, [router, token]);

  const handleFinish = useCallback(() => {
    // After video ends, navigate to the appropriate stack depending on auth.
    // If the video finished early, ensure we still respect minimum splash time.
    try {
      finishWhenReady();
    } catch {
      // swallow
    }
  }, [finishWhenReady]);

  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => {
        try {
          handleFinish();
        } catch {
          // swallow
        }
      }, 300);
      return () => clearTimeout(t);
    }
    return;
  }, [loading, handleFinish]);

  return (
    <SafeAreaView style={styles.container}>
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#22d3ee" />
        </View>
      ) : (
        <View style={styles.center}>
          <View style={styles.logoOuter} accessible accessibilityLabel="TaxiOps">
            <View style={styles.logoInner}>
              <Image source={require('../assets/playstore-icon.png')} style={styles.image} resizeMode="contain" />
            </View>
          </View>
          <Text style={styles.appName}>TaxiOps</Text>
          <Text style={styles.tagline}>Drive smarter. Earn faster.</Text>
          <View style={styles.vignette} pointerEvents="none" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  video: { width: '100%', height: '100%' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  logoOuter: {
    width: 220,
    height: 220,
    borderRadius: 110,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    marginBottom: 14,
  },
  logoInner: {
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,211,238,0.06)',
    borderWidth: 2,
    borderColor: 'rgba(34,211,238,0.18)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  image: { width: 110, height: 110 },
  appName: { color: '#f8fafc', fontSize: 22, fontWeight: '800', marginTop: 6 },
  tagline: { color: '#94a3b8', fontSize: 13, marginTop: 6 },
  vignette: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.18)'
  }
});
