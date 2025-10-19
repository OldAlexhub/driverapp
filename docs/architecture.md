# Driver App Architecture & Compliance Notes

## State Management & Navigation
- Data fetching / caching: `@tanstack/react-query` (v5) handles API calls, cache invalidation, and background refetching. Queries sit under `QueryClientProvider` in `src/providers/AppProviders.tsx`.
- Auth/session state: `AuthProvider` (React context) persists the driver token with `expo-secure-store`, exposes `signIn`/`signOut`, and seeds React Query so protected data stays current.
- Navigation: Expo Router stack. Route groups split unauthenticated `/(auth)` flows from secured `/(protected)` flows so guards stay declarative.

## Meter Configuration Reference
Dispatcher UI now controls these fare fields (stored in `fares_singleton`):
- `baseFare`: upfront charge before mileage accrues.
- `farePerMile`: per-mile meter rate.
- `minimumFare`: floor applied when completing a trip.
- `extraPass`: surcharge for each additional passenger.
- `waitTimePerMinute`: rate once speed drops under `waitTriggerSpeedMph` beyond `idleGracePeriodSeconds`.
- `waitTriggerSpeedMph`: MPH threshold that flips the meter into waiting mode.
- `idleGracePeriodSeconds`: seconds to wait before charging idle time.
- `meterRoundingMode`: `none`, `nearest_0.1`, `nearest_0.25`, `nearest_0.5`, or `nearest_1`.
- `surgeEnabled`, `surgeMultiplier`, `surgeNotes`: optional uplift bannered to drivers.

Flat rates stay minimal: `name`, `distanceLabel`, `amount`, `active`. Picking a flat rate disables the live meter for that ride; `/api/fares/current` returns both the meter config and active flat rates.

## Android Background Location Checklist
1. **Permissions** – Request `ACCESS_FINE_LOCATION`, upgrade to `ACCESS_BACKGROUND_LOCATION` only after explaining why continuous tracking is required. Supply a settings shortcut if the driver declines.
2. **Manifest / app.json** – Include `FOREGROUND_SERVICE` plus the location permissions; declare a foreground service with a persistent notification that states the tracking purpose.
3. **Google Play disclosure** – Complete the location permissions declaration (trip navigation, metering, safety), link to the privacy policy, and show an in-app disclosure before enabling background tracking.
4. **Testing** – Exercise approximate vs precise modes on Android 12+, Doze/battery optimisations, and recovery when network drops.

## Store-Ready Asset Checklist (Android)
- Adaptive icon set (432x432 foreground, 108x108 background) plus legacy icons.
- 1024x500 feature graphic and phone screenshots that depict the foreground notification and meter.
- Privacy policy URL that calls out continuous location tracking.
- Onboarding copy/screens that explain how to stop tracking (go offline, end shift).

## Hours-of-Service MVP
- Driver dashboard buttons call `PATCH /driver-app/presence`, writing the `hoursOfService` payload against the `Active` record.
- Ending a shift computes minutes on duty locally for now; later iterations can reconcile against GPS and dispatch events.
- React Query invalidates or seeds `driverProfile` after each mutation so the UI and backend stay aligned.

## Next Implementation Targets
1. Add background tasks (`expo-location` + `TaskManager`) to accumulate meter miles and wait time.
2. Surface full assignment workflow (acknowledge, status progress, navigation links).
3. Provide a flat-rate selector that clearly shows the meter disable state before closing a trip.
4. Expand HOS tracking with break reminders and 7-day reset calculations.
