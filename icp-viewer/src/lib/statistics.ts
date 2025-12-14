/**
 * Statistical utilities for data analysis
 */

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  r: number;
  pValue: number;
  standardError: number;
  predictions: number[];
}

/**
 * Perform simple linear regression
 */
export function linearRegression(x: number[], y: number[]): LinearRegressionResult {
  const n = x.length;

  if (n < 2) {
    return {
      slope: 0,
      intercept: 0,
      rSquared: 0,
      r: 0,
      pValue: 1,
      standardError: 0,
      predictions: y,
    };
  }

  // Calculate means
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  // Calculate slope and intercept
  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }

  const slope = ssXX !== 0 ? ssXY / ssXX : 0;
  const intercept = meanY - slope * meanX;

  // Calculate R and R²
  const r = ssXX !== 0 && ssYY !== 0 ? ssXY / Math.sqrt(ssXX * ssYY) : 0;
  const rSquared = r * r;

  // Calculate predictions
  const predictions = x.map(xi => slope * xi + intercept);

  // Calculate residual sum of squares
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssRes += Math.pow(y[i] - predictions[i], 2);
  }

  // Calculate standard error of the slope
  const standardError = n > 2 && ssXX !== 0
    ? Math.sqrt(ssRes / (n - 2) / ssXX)
    : 0;

  // Calculate p-value using t-distribution approximation
  const tStat = standardError !== 0 ? Math.abs(slope / standardError) : 0;
  const pValue = tStatToPValue(tStat, n - 2);

  return {
    slope,
    intercept,
    rSquared,
    r,
    pValue,
    standardError,
    predictions,
  };
}

/**
 * Approximate p-value from t-statistic
 * Using a simplified approximation for degrees of freedom > 2
 */
function tStatToPValue(t: number, df: number): number {
  if (df <= 0) return 1;

  // Use approximation based on normal distribution for larger df
  // For small df, use a lookup-based approximation
  const x = df / (df + t * t);

  // Incomplete beta function approximation
  const a = df / 2;
  const b = 0.5;

  // Simple approximation
  const p = Math.exp(
    -0.5 * t * t * (1 + (t * t) / df) / (1 + (t * t) / (2 * df))
  );

  return Math.min(1, 2 * p);
}

/**
 * Calculate Pearson correlation coefficient
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    sumXX += dx * dx;
    sumYY += dy * dy;
  }

  const denominator = Math.sqrt(sumXX * sumYY);
  return denominator !== 0 ? numerator / denominator : 0;
}

/**
 * Calculate mean and standard error from array
 */
export function meanAndSE(values: number[]): { mean: number; se: number; std: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, se: 0, std: 0 };

  const mean = values.reduce((a, b) => a + b, 0) / n;

  if (n === 1) return { mean, se: 0, std: 0 };

  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (n - 1);
  const std = Math.sqrt(variance);
  const se = std / Math.sqrt(n);

  return { mean, se, std };
}
