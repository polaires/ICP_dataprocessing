import { ATOMIC_WEIGHTS } from './constants';

/**
 * Convert mg/L to µM (micromolar)
 * Formula: (mg/L) / (g/mol) * 1000 = µM
 */
export function mgLToMicromolar(mgL: number, element: string): number {
  const atomicWeight = ATOMIC_WEIGHTS[element];
  if (!atomicWeight) {
    console.warn(`Unknown element: ${element}`);
    return 0;
  }
  return (mgL / atomicWeight) * 1000;
}

/**
 * Convert µM to mg/L
 */
export function micromolarToMgL(uM: number, element: string): number {
  const atomicWeight = ATOMIC_WEIGHTS[element];
  if (!atomicWeight) {
    return 0;
  }
  return (uM * atomicWeight) / 1000;
}

/**
 * Calculate selectivity (% of total moles for each element)
 * Only considers positive values (above detection limit)
 */
export function calculateSelectivity(
  molarity: Record<string, number>
): Record<string, number> {
  const selectivity: Record<string, number> = {};

  // Sum only positive values
  const totalMoles = Object.values(molarity).reduce((sum, val) => {
    return sum + Math.max(0, val);
  }, 0);

  if (totalMoles === 0) {
    // All values are zero or negative - return zeros
    for (const element of Object.keys(molarity)) {
      selectivity[element] = 0;
    }
    return selectivity;
  }

  for (const [element, value] of Object.entries(molarity)) {
    // Negative values contribute 0% to selectivity
    selectivity[element] = Math.max(0, value) / totalMoles * 100;
  }

  return selectivity;
}

/**
 * Normalize measurements by subtracting buffer values
 */
export function normalizeByBuffer(
  molarity: Record<string, number>,
  bufferMolarity: Record<string, number>
): Record<string, number> {
  const normalized: Record<string, number> = {};

  for (const [element, value] of Object.entries(molarity)) {
    const bufferValue = bufferMolarity[element] ?? 0;
    normalized[element] = value - bufferValue;
  }

  return normalized;
}

/**
 * Calculate mean of multiple measurements
 */
export function calculateMean(
  measurements: Record<string, number>[]
): Record<string, number> {
  if (measurements.length === 0) return {};

  const mean: Record<string, number> = {};
  const elements = Object.keys(measurements[0]);

  for (const element of elements) {
    const values = measurements.map(m => m[element] ?? 0);
    mean[element] = values.reduce((a, b) => a + b, 0) / values.length;
  }

  return mean;
}

/**
 * Calculate standard deviation
 */
export function calculateStdDev(
  measurements: Record<string, number>[],
  mean: Record<string, number>
): Record<string, number> {
  if (measurements.length < 2) {
    const stdDev: Record<string, number> = {};
    for (const element of Object.keys(mean)) {
      stdDev[element] = 0;
    }
    return stdDev;
  }

  const stdDev: Record<string, number> = {};

  for (const element of Object.keys(mean)) {
    const values = measurements.map(m => m[element] ?? 0);
    const meanVal = mean[element];
    const squaredDiffs = values.map(v => Math.pow(v - meanVal, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
    stdDev[element] = Math.sqrt(variance);
  }

  return stdDev;
}

/**
 * Calculate coefficient of variation (CV%)
 */
export function calculateCV(
  mean: Record<string, number>,
  stdDev: Record<string, number>
): Record<string, number> {
  const cv: Record<string, number> = {};

  for (const element of Object.keys(mean)) {
    const meanVal = mean[element];
    if (meanVal === 0) {
      cv[element] = 0;
    } else {
      cv[element] = Math.abs(stdDev[element] / meanVal) * 100;
    }
  }

  return cv;
}
