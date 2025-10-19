import { FareConfig } from '../api/driverApp';
import { MeterConfig } from '../hooks/useFlagdownMeter';

type OtherFee = { name: string; amount: number };

export type FareBreakdown = {
  mode: 'meter' | 'flat';
  baseFare: number;
  distanceFare: number;
  waitFare: number;
  surgeMultiplier: number;
  minimumApplied: boolean;
  extraPassengerFare: number;
  otherFeesTotal: number;
  otherFees: OtherFee[];
  subtotalBeforeExtras: number;
  subtotalWithExtras: number;
  roundingMode?: string;
  roundingAdjustment: number;
  total: number;
};

function safeAmount(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function clampPassengers(count: number) {
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.floor(count);
}

export function applyMeterRounding(value: number, mode?: string) {
  if (!mode || mode === 'none') {
    return Math.max(Number.isFinite(value) ? value : 0, 0);
  }

  const steps: Record<string, number> = {
    nearest_0_1: 0.1,
    nearest_0_25: 0.25,
    nearest_0_5: 0.5,
    nearest_1: 1,
    'nearest_0.1': 0.1,
    'nearest_0.25': 0.25,
    'nearest_0.5': 0.5,
  };

  const step = steps[mode];
  const safeValue = Math.max(Number.isFinite(value) ? value : 0, 0);
  if (!step) return safeValue;

  return Math.round(safeValue / step) * step;
}

export function computeFareBreakdown({
  config,
  distanceMiles,
  waitMinutes,
  passengerCount,
  otherFees,
  flatRateAmount,
}: {
  config: FareConfig;
  distanceMiles: number;
  waitMinutes: number;
  passengerCount: number;
  otherFees: OtherFee[];
  flatRateAmount?: number | null;
}): FareBreakdown {
  const safeOtherFees = Array.isArray(otherFees) ? otherFees : [];
  const otherFeesTotal = safeOtherFees.reduce((sum, fee) => sum + safeAmount(fee?.amount), 0);
  const passengerTotal = clampPassengers(passengerCount);
  const additionalPassengers = Math.max(passengerTotal - 1, 0);
  const extraPassengerFare = additionalPassengers * safeAmount(config.extraPass);
  const roundingMode = config.meterRoundingMode;
  const surgeMultiplier =
    config.surgeEnabled && safeAmount(config.surgeMultiplier, 0) > 0
      ? Math.max(safeAmount(config.surgeMultiplier), 1)
      : 1;

  if (Number.isFinite(flatRateAmount)) {
    const baseFare = safeAmount(flatRateAmount ?? 0);
    const subtotalBeforeExtras = baseFare;
    const subtotalWithExtras = subtotalBeforeExtras + extraPassengerFare + otherFeesTotal;
    const total = applyMeterRounding(subtotalWithExtras, roundingMode);
    return {
      mode: 'flat',
      baseFare,
      distanceFare: 0,
      waitFare: 0,
      surgeMultiplier: 1,
      minimumApplied: false,
      extraPassengerFare,
      otherFeesTotal,
      otherFees: safeOtherFees,
      subtotalBeforeExtras,
      subtotalWithExtras,
      roundingMode,
      roundingAdjustment: total - subtotalWithExtras,
      total,
    };
  }

  const baseFare = safeAmount(config.baseFare);
  const perMile = safeAmount(config.farePerMile);
  const waitRate = safeAmount(config.waitTimePerMinute);
  const minimumFare = safeAmount(config.minimumFare);

  const distanceFare = Math.max(distanceMiles, 0) * perMile;
  const waitFare = Math.max(waitMinutes, 0) * waitRate;

  let subtotalBeforeExtras = baseFare + distanceFare + waitFare;
  let minimumApplied = false;
  if (minimumFare > 0 && subtotalBeforeExtras < minimumFare) {
    subtotalBeforeExtras = minimumFare;
    minimumApplied = true;
  }

  const surgedSubtotal = subtotalBeforeExtras * surgeMultiplier;
  const subtotalWithExtras = surgedSubtotal + extraPassengerFare + otherFeesTotal;
  const total = applyMeterRounding(subtotalWithExtras, roundingMode);

  return {
    mode: 'meter',
    baseFare,
    distanceFare,
    waitFare,
    surgeMultiplier,
    minimumApplied,
    extraPassengerFare,
    otherFeesTotal,
    otherFees: safeOtherFees,
    subtotalBeforeExtras: surgedSubtotal,
    subtotalWithExtras,
    roundingMode,
    roundingAdjustment: total - subtotalWithExtras,
    total,
  };
}

export function buildMeterConfig(fare: FareConfig): MeterConfig {
  return {
    farePerMile: safeAmount(fare.farePerMile),
    waitTimePerMinute: safeAmount(fare.waitTimePerMinute),
    baseFare: safeAmount(fare.baseFare),
    minimumFare: safeAmount(fare.minimumFare),
    waitTriggerSpeedMph: safeAmount(fare.waitTriggerSpeedMph, 3),
    idleGracePeriodSeconds: safeAmount(fare.idleGracePeriodSeconds, 45),
    surgeEnabled: Boolean(fare.surgeEnabled),
    surgeMultiplier: safeAmount(fare.surgeMultiplier) > 0 ? safeAmount(fare.surgeMultiplier) : undefined,
  };
}
