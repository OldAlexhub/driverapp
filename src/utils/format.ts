export function formatCurrency(value: number, currency: string = 'USD') {
  try {
    return Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

export function formatDistance(miles: number, unit: 'mi' | 'km' = 'mi') {
  const rounded = unit === 'mi' ? miles : miles * 1.60934;
  const label = unit === 'mi' ? 'mi' : 'km';
  return `${rounded.toFixed(2)} ${label}`;
}
