import { Env } from '@/constants/env';

const DEFAULT_STYLE = 'mapbox/streets-v12';

function normalizeStyle(style?: string) {
  if (!style) return DEFAULT_STYLE;
  const trimmed = style.trim();
  if (!trimmed) return DEFAULT_STYLE;
  if (trimmed.startsWith('mapbox://styles/')) {
    return trimmed.replace('mapbox://styles/', '');
  }
  if (trimmed.startsWith('styles/')) {
    return trimmed.replace('styles/', '');
  }
  return trimmed;
}

export function getMapboxTileTemplate(styleOverride?: string): string | null {
  const token = Env.mapboxToken?.trim();
  if (!token) return null;
  const style = normalizeStyle(styleOverride ?? Env.mapboxStyleUrl);
  return `https://api.mapbox.com/styles/v1/${style}/tiles/256/{z}/{x}/{y}?access_token=${token}`;
}
