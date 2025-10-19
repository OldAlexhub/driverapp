export type Coordinates = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

/**
 * Haversine distance between two coordinates in meters.
 */
export function distanceBetween(a: Coordinates, b: Coordinates): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

export function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

export function metersToKilometers(meters: number): number {
  return meters / 1000;
}

export function secondsToMinutes(seconds: number): number {
  return seconds / 60;
}

export function mphToMetersPerSecond(mph: number): number {
  return mph * 0.44704;
}
