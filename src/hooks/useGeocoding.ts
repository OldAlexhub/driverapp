import { useCallback, useRef, useState } from 'react';
import { Env } from '@/constants/env';

export type GeocodeSuggestion = {
  id: string;
  name: string;
  placeName: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  address?: string;
};

type GeocodingState = {
  suggestions: GeocodeSuggestion[];
  isSearching: boolean;
  error: string | null;
};

const initialState: GeocodingState = {
  suggestions: [],
  isSearching: false,
  error: null,
};

export function useGeocoding() {
  const [state, setState] = useState<GeocodingState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (query: string, options: { limit?: number } = {}) => {
      if (!query || !query.trim()) {
        setState(initialState);
        return;
      }

      if (!Env.mapboxToken) {
        setState({
          suggestions: [],
          isSearching: false,
          error: 'Mapbox token is not configured.',
        });
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) => ({ ...prev, isSearching: true, error: null }));

      try {
        const endpoint = new URL(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
        );
        endpoint.searchParams.set('access_token', Env.mapboxToken);
        endpoint.searchParams.set('autocomplete', 'true');
        endpoint.searchParams.set('limit', String(options.limit ?? 5));
        endpoint.searchParams.set('language', 'en');
        endpoint.searchParams.set('types', 'address,place,poi');

        const response = await fetch(endpoint.toString(), { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Geocoding failed with status ${response.status}`);
        }
        const data = await response.json();

        const suggestions: GeocodeSuggestion[] = Array.isArray(data?.features)
          ? data.features
              .map((feature: any) => {
                const [longitude, latitude] = Array.isArray(feature?.center) ? feature.center : [null, null];
                if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                  return null;
                }
                return {
                  id: feature.id ?? `${feature.place_name}-${latitude}-${longitude}`,
                  name: feature.text ?? feature.place_name,
                  placeName: feature.place_name ?? feature.text ?? 'Unknown location',
                  coordinates: {
                    latitude,
                    longitude,
                  },
                  address: feature.properties?.address,
                } as GeocodeSuggestion;
              })
              .filter(Boolean)
          : [];

        setState({ suggestions, isSearching: false, error: null });
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unable to search for address.';
        setState({ suggestions: [], isSearching: false, error: message });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [],
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(initialState);
  }, []);

  return {
    ...state,
    search,
    clear,
  };
}
