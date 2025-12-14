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

/**
 * Outlier detection result
 */
export interface OutlierResult {
  values: number[];
  outlierIndices: number[];
  cleanedValues: number[];
  method: 'grubbs' | 'iqr' | 'zscore';
}

/**
 * Critical values for Grubbs test (two-sided, alpha = 0.05)
 * Source: Table of critical values for Grubbs' test
 */
const GRUBBS_CRITICAL: Record<number, number> = {
  3: 1.153,
  4: 1.463,
  5: 1.672,
  6: 1.822,
  7: 1.938,
  8: 2.032,
  9: 2.110,
  10: 2.176,
  11: 2.234,
  12: 2.285,
  13: 2.331,
  14: 2.371,
  15: 2.409,
  16: 2.443,
  17: 2.475,
  18: 2.504,
  19: 2.532,
  20: 2.557,
};

/**
 * Grubbs test for outlier detection
 * Identifies single outlier in normally distributed data
 */
export function grubbsTest(values: number[], alpha: number = 0.05): OutlierResult {
  const n = values.length;
  const outlierIndices: number[] = [];

  if (n < 3) {
    return { values, outlierIndices: [], cleanedValues: values, method: 'grubbs' };
  }

  const workingValues = [...values];
  const workingIndices = values.map((_, i) => i);

  // Iteratively remove outliers
  let foundOutlier = true;
  while (foundOutlier && workingValues.length >= 3) {
    foundOutlier = false;

    const currentN = workingValues.length;
    const mean = workingValues.reduce((a, b) => a + b, 0) / currentN;
    const std = Math.sqrt(
      workingValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (currentN - 1)
    );

    if (std === 0) break;

    // Find max deviation
    let maxG = 0;
    let maxIdx = -1;
    for (let i = 0; i < currentN; i++) {
      const g = Math.abs(workingValues[i] - mean) / std;
      if (g > maxG) {
        maxG = g;
        maxIdx = i;
      }
    }

    // Get critical value (use largest available if n > 20)
    const criticalN = Math.min(currentN, 20);
    const criticalValue = GRUBBS_CRITICAL[criticalN] || 2.557;

    if (maxG > criticalValue && maxIdx >= 0) {
      outlierIndices.push(workingIndices[maxIdx]);
      workingValues.splice(maxIdx, 1);
      workingIndices.splice(maxIdx, 1);
      foundOutlier = true;
    }
  }

  return {
    values,
    outlierIndices,
    cleanedValues: workingValues,
    method: 'grubbs',
  };
}

/**
 * IQR-based outlier detection
 * More robust for non-normal distributions
 */
export function iqrOutlierDetection(values: number[], multiplier: number = 1.5): OutlierResult {
  const n = values.length;
  if (n < 4) {
    return { values, outlierIndices: [], cleanedValues: values, method: 'iqr' };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const q1Idx = Math.floor(n * 0.25);
  const q3Idx = Math.floor(n * 0.75);
  const q1 = sorted[q1Idx];
  const q3 = sorted[q3Idx];
  const iqr = q3 - q1;

  const lowerBound = q1 - multiplier * iqr;
  const upperBound = q3 + multiplier * iqr;

  const outlierIndices: number[] = [];
  const cleanedValues: number[] = [];

  for (let i = 0; i < n; i++) {
    if (values[i] < lowerBound || values[i] > upperBound) {
      outlierIndices.push(i);
    } else {
      cleanedValues.push(values[i]);
    }
  }

  return {
    values,
    outlierIndices,
    cleanedValues,
    method: 'iqr',
  };
}

/**
 * Z-score based outlier detection
 */
export function zScoreOutlierDetection(values: number[], threshold: number = 2.5): OutlierResult {
  const n = values.length;
  if (n < 3) {
    return { values, outlierIndices: [], cleanedValues: values, method: 'zscore' };
  }

  const mean = values.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(
    values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1)
  );

  if (std === 0) {
    return { values, outlierIndices: [], cleanedValues: values, method: 'zscore' };
  }

  const outlierIndices: number[] = [];
  const cleanedValues: number[] = [];

  for (let i = 0; i < n; i++) {
    const zScore = Math.abs(values[i] - mean) / std;
    if (zScore > threshold) {
      outlierIndices.push(i);
    } else {
      cleanedValues.push(values[i]);
    }
  }

  return {
    values,
    outlierIndices,
    cleanedValues,
    method: 'zscore',
  };
}

/**
 * Combined outlier detection using multiple methods
 * Returns indices flagged by at least minAgreement methods
 */
export function combinedOutlierDetection(
  values: number[],
  minAgreement: number = 2
): {
  outlierIndices: number[];
  cleanedValues: number[];
  methodResults: { grubbs: number[]; iqr: number[]; zscore: number[] };
} {
  const grubbs = grubbsTest(values);
  const iqr = iqrOutlierDetection(values);
  const zscore = zScoreOutlierDetection(values);

  // Count how many methods flagged each index
  const flagCounts: Record<number, number> = {};
  for (const idx of [...grubbs.outlierIndices, ...iqr.outlierIndices, ...zscore.outlierIndices]) {
    flagCounts[idx] = (flagCounts[idx] || 0) + 1;
  }

  const outlierIndices = Object.entries(flagCounts)
    .filter(([_, count]) => count >= minAgreement)
    .map(([idx]) => parseInt(idx))
    .sort((a, b) => a - b);

  const outlierSet = new Set(outlierIndices);
  const cleanedValues = values.filter((_, i) => !outlierSet.has(i));

  return {
    outlierIndices,
    cleanedValues,
    methodResults: {
      grubbs: grubbs.outlierIndices,
      iqr: iqr.outlierIndices,
      zscore: zscore.outlierIndices,
    },
  };
}

/**
 * Assess data quality based on variability
 */
export interface DataQualityAssessment {
  cv: number;  // Coefficient of variation (%)
  quality: 'excellent' | 'good' | 'acceptable' | 'poor' | 'unreliable';
  hasOutliers: boolean;
  outlierCount: number;
  recommendation: string;
}

export function assessDataQuality(values: number[]): DataQualityAssessment {
  if (values.length < 2) {
    return {
      cv: 0,
      quality: 'unreliable',
      hasOutliers: false,
      outlierCount: 0,
      recommendation: 'Insufficient replicates (n < 2)',
    };
  }

  const { mean, std } = meanAndSE(values);
  const cv = mean !== 0 ? (std / Math.abs(mean)) * 100 : 0;

  const outlierResult = combinedOutlierDetection(values, 2);
  const hasOutliers = outlierResult.outlierIndices.length > 0;
  const outlierCount = outlierResult.outlierIndices.length;

  let quality: DataQualityAssessment['quality'];
  let recommendation: string;

  if (cv <= 10) {
    quality = 'excellent';
    recommendation = 'Data is highly reproducible';
  } else if (cv <= 20) {
    quality = 'good';
    recommendation = 'Data quality is acceptable';
  } else if (cv <= 30) {
    quality = 'acceptable';
    recommendation = 'Consider investigating sources of variability';
  } else if (cv <= 50) {
    quality = 'poor';
    recommendation = 'High variability - review experimental conditions';
  } else {
    quality = 'unreliable';
    recommendation = 'Data too variable for reliable conclusions';
  }

  if (hasOutliers) {
    recommendation += `. ${outlierCount} potential outlier(s) detected`;
  }

  return { cv, quality, hasOutliers, outlierCount, recommendation };
}
