export const Env = {
  mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '',
  mapboxStyleUrl: process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL ?? 'mapbox/streets-v12',
};

export function assertEnv(value: string | undefined, name: string) {
  if (!value || !value.trim()) {
    throw new Error(`${name} is not configured. Please set it in your Expo env.`);
  }
  return value;
}
