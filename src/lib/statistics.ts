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

// ============================================================================
// STATISTICAL TESTS FOR MUTANT COMPARISON
// ============================================================================

/**
 * Result of a two-sample comparison test
 */
export interface TwoSampleTestResult {
  statistic: number;
  pValue: number;
  significant: boolean;  // at alpha = 0.05
  effectSize: number;    // Cohen's d
  effectInterpretation: 'negligible' | 'small' | 'medium' | 'large';
  ci95: { lower: number; upper: number };  // 95% CI of difference
  method: string;
}

/**
 * Welch's t-test (unequal variances)
 * More robust than Student's t-test for unequal sample sizes/variances
 */
export function welchTTest(group1: number[], group2: number[]): TwoSampleTestResult {
  const n1 = group1.length;
  const n2 = group2.length;

  if (n1 < 2 || n2 < 2) {
    return {
      statistic: 0,
      pValue: 1,
      significant: false,
      effectSize: 0,
      effectInterpretation: 'negligible',
      ci95: { lower: 0, upper: 0 },
      method: "Welch's t-test",
    };
  }

  const { mean: mean1, std: std1 } = meanAndSE(group1);
  const { mean: mean2, std: std2 } = meanAndSE(group2);

  const var1 = std1 * std1;
  const var2 = std2 * std2;

  // Welch's t-statistic
  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) {
    return {
      statistic: 0,
      pValue: 1,
      significant: false,
      effectSize: 0,
      effectInterpretation: 'negligible',
      ci95: { lower: 0, upper: 0 },
      method: "Welch's t-test",
    };
  }

  const t = (mean1 - mean2) / se;

  // Welch-Satterthwaite degrees of freedom
  const v1 = var1 / n1;
  const v2 = var2 / n2;
  const df = Math.pow(v1 + v2, 2) / (Math.pow(v1, 2) / (n1 - 1) + Math.pow(v2, 2) / (n2 - 1));

  const pValue = tStatToPValue(Math.abs(t), df);

  // Cohen's d effect size
  const pooledStd = Math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2));
  const effectSize = pooledStd !== 0 ? (mean1 - mean2) / pooledStd : 0;

  // 95% CI for difference (using t critical value approximation)
  const tCrit = 1.96 + 2.4 / df; // Approximation for small df
  const ci95 = {
    lower: (mean1 - mean2) - tCrit * se,
    upper: (mean1 - mean2) + tCrit * se,
  };

  return {
    statistic: t,
    pValue,
    significant: pValue < 0.05,
    effectSize,
    effectInterpretation: interpretEffectSize(Math.abs(effectSize)),
    ci95,
    method: "Welch's t-test",
  };
}

/**
 * Mann-Whitney U test (Wilcoxon rank-sum test)
 * Non-parametric alternative to t-test, robust for small samples
 */
export function mannWhitneyU(group1: number[], group2: number[]): TwoSampleTestResult {
  const n1 = group1.length;
  const n2 = group2.length;

  if (n1 < 2 || n2 < 2) {
    return {
      statistic: 0,
      pValue: 1,
      significant: false,
      effectSize: 0,
      effectInterpretation: 'negligible',
      ci95: { lower: 0, upper: 0 },
      method: 'Mann-Whitney U',
    };
  }

  // Combine and rank all values
  const combined: Array<{ value: number; group: number; originalIdx: number }> = [
    ...group1.map((v, i) => ({ value: v, group: 1, originalIdx: i })),
    ...group2.map((v, i) => ({ value: v, group: 2, originalIdx: i })),
  ];

  combined.sort((a, b) => a.value - b.value);

  // Assign ranks (handle ties by averaging)
  const ranks: number[] = new Array(combined.length);
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].value === combined[i].value) {
      j++;
    }
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      ranks[k] = avgRank;
    }
    i = j;
  }

  // Sum of ranks for group 1
  let R1 = 0;
  for (let k = 0; k < combined.length; k++) {
    if (combined[k].group === 1) {
      R1 += ranks[k];
    }
  }

  // U statistics
  const U1 = R1 - (n1 * (n1 + 1)) / 2;
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);

  // Normal approximation for p-value (valid for n1, n2 >= 8, but usable for smaller)
  const meanU = (n1 * n2) / 2;
  const stdU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = stdU !== 0 ? (U - meanU) / stdU : 0;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));

  // Effect size: rank-biserial correlation r = 1 - (2U)/(n1*n2)
  const effectSize = 1 - (2 * U) / (n1 * n2);

  // Hodges-Lehmann estimator for median difference (CI approximation)
  const { mean: mean1 } = meanAndSE(group1);
  const { mean: mean2 } = meanAndSE(group2);
  const medianDiff = mean1 - mean2;
  const seDiff = Math.sqrt(
    (meanAndSE(group1).std ** 2) / n1 + (meanAndSE(group2).std ** 2) / n2
  );

  return {
    statistic: U,
    pValue,
    significant: pValue < 0.05,
    effectSize,
    effectInterpretation: interpretEffectSize(Math.abs(effectSize)),
    ci95: {
      lower: medianDiff - 1.96 * seDiff,
      upper: medianDiff + 1.96 * seDiff,
    },
    method: 'Mann-Whitney U',
  };
}

/**
 * Standard normal CDF approximation
 */
function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Cohen's d effect size interpretation
 */
function interpretEffectSize(d: number): 'negligible' | 'small' | 'medium' | 'large' {
  if (d < 0.2) return 'negligible';
  if (d < 0.5) return 'small';
  if (d < 0.8) return 'medium';
  return 'large';
}

/**
 * Calculate Cohen's d effect size between two groups
 */
export function cohensD(group1: number[], group2: number[]): number {
  const n1 = group1.length;
  const n2 = group2.length;
  if (n1 < 2 || n2 < 2) return 0;

  const { mean: mean1, std: std1 } = meanAndSE(group1);
  const { mean: mean2, std: std2 } = meanAndSE(group2);

  const pooledStd = Math.sqrt(
    ((n1 - 1) * std1 * std1 + (n2 - 1) * std2 * std2) / (n1 + n2 - 2)
  );

  return pooledStd !== 0 ? (mean1 - mean2) / pooledStd : 0;
}

/**
 * Calculate 95% confidence interval for the mean
 */
export function confidenceInterval95(values: number[]): { lower: number; upper: number; mean: number } {
  const n = values.length;
  if (n < 2) {
    const mean = n === 1 ? values[0] : 0;
    return { lower: mean, upper: mean, mean };
  }

  const { mean, se } = meanAndSE(values);
  const tCrit = n < 30 ? 2.0 + 4.0 / n : 1.96; // Approximation

  return {
    lower: mean - tCrit * se,
    upper: mean + tCrit * se,
    mean,
  };
}

// ============================================================================
// SELECTIVITY METRICS FOR PROTEIN ENGINEERING
// ============================================================================

/**
 * Shannon entropy of selectivity distribution
 * Low entropy = highly selective (prefers few elements)
 * High entropy = promiscuous (binds many elements equally)
 * Max entropy for n elements = ln(n)
 */
export function selectivityEntropy(selectivityProfile: Record<string, number>): {
  entropy: number;
  normalizedEntropy: number;  // 0-1 scale
  interpretation: 'highly selective' | 'selective' | 'moderate' | 'promiscuous';
} {
  const values = Object.values(selectivityProfile).filter(v => v > 0);
  const n = values.length;

  if (n === 0) {
    return { entropy: 0, normalizedEntropy: 0, interpretation: 'highly selective' };
  }

  // Normalize to probabilities
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return { entropy: 0, normalizedEntropy: 0, interpretation: 'highly selective' };
  }

  const probs = values.map(v => v / total);

  // Shannon entropy: H = -sum(p * ln(p))
  let entropy = 0;
  for (const p of probs) {
    if (p > 0) {
      entropy -= p * Math.log(p);
    }
  }

  // Normalize by max entropy (ln(n))
  const maxEntropy = Math.log(n);
  const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

  let interpretation: 'highly selective' | 'selective' | 'moderate' | 'promiscuous';
  if (normalizedEntropy < 0.3) {
    interpretation = 'highly selective';
  } else if (normalizedEntropy < 0.6) {
    interpretation = 'selective';
  } else if (normalizedEntropy < 0.8) {
    interpretation = 'moderate';
  } else {
    interpretation = 'promiscuous';
  }

  return { entropy, normalizedEntropy, interpretation };
}

/**
 * Light vs Heavy REE discrimination score
 * Positive = prefers light REE (La-Eu)
 * Negative = prefers heavy REE (Gd-Lu)
 * Range: -100 to +100
 */
export function lightHeavyDiscrimination(
  selectivityProfile: Record<string, number>,
  lightElements: string[],
  heavyElements: string[]
): {
  score: number;  // -100 to +100
  lightSum: number;
  heavySum: number;
  preference: 'light' | 'heavy' | 'balanced';
} {
  const lightSum = lightElements.reduce((sum, e) => sum + (selectivityProfile[e] ?? 0), 0);
  const heavySum = heavyElements.reduce((sum, e) => sum + (selectivityProfile[e] ?? 0), 0);

  const total = lightSum + heavySum;
  if (total === 0) {
    return { score: 0, lightSum: 0, heavySum: 0, preference: 'balanced' };
  }

  // Score: (light - heavy) / total * 100
  const score = ((lightSum - heavySum) / total) * 100;

  let preference: 'light' | 'heavy' | 'balanced';
  if (score > 15) {
    preference = 'light';
  } else if (score < -15) {
    preference = 'heavy';
  } else {
    preference = 'balanced';
  }

  return { score, lightSum, heavySum, preference };
}

/**
 * k_ex preference strength index
 * Combines slope magnitude, R², and statistical significance
 * Higher = stronger and more reliable k_ex-dependent selectivity
 */
export function kexPreferenceStrength(
  slope: number,
  slopeError: number,
  r2: number,
  pValue: number
): {
  strength: number;
  interpretation: 'none' | 'weak' | 'moderate' | 'strong';
  reliable: boolean;
} {
  // Strength = |slope| * R² / SE (if significant)
  // This rewards: large slope, good fit, low uncertainty

  if (pValue > 0.1 || slopeError === 0) {
    return { strength: 0, interpretation: 'none', reliable: false };
  }

  const tValue = Math.abs(slope) / slopeError;
  const strength = Math.abs(slope) * r2 * Math.min(tValue, 5) / 5;  // Cap t contribution at 5

  let interpretation: 'none' | 'weak' | 'moderate' | 'strong';
  if (strength < 0.01) {
    interpretation = 'none';
  } else if (strength < 0.05) {
    interpretation = 'weak';
  } else if (strength < 0.15) {
    interpretation = 'moderate';
  } else {
    interpretation = 'strong';
  }

  return {
    strength,
    interpretation,
    reliable: pValue < 0.05 && r2 > 0.3,
  };
}

/**
 * Light/Heavy regression line offset
 * Measures the vertical distance between light and heavy REE regression lines
 * at their intersection point (or midpoint of k_ex range)
 *
 * Positive offset = heavy REE line is above light REE line
 * This indicates different binding mechanisms for the two series
 */
export interface LightHeavyOffsetResult {
  offset: number;           // Vertical offset at midpoint k_ex
  offsetPercent: number;    // Offset as % of average selectivity
  lightSlope: number;
  heavySlope: number;
  slopeDifference: number;  // Heavy slope - Light slope
  hasBreak: boolean;        // True if slopes differ significantly
  isSignificant: boolean;   // True if offset is meaningful (alias for hasBreak)
  breakInterpretation: string;
  interpretation: string;   // Human-readable interpretation
}

export function calculateLightHeavyOffset(
  lightRegression: LinearRegressionResult | null,
  heavyRegression: LinearRegressionResult | null,
  midpointKex: number
): LightHeavyOffsetResult {
  if (!lightRegression || !heavyRegression) {
    return {
      offset: 0,
      offsetPercent: 0,
      lightSlope: lightRegression?.slope ?? 0,
      heavySlope: heavyRegression?.slope ?? 0,
      slopeDifference: 0,
      hasBreak: false,
      isSignificant: false,
      breakInterpretation: 'Insufficient data for comparison',
      interpretation: 'Insufficient data for comparison',
    };
  }

  const lightSlope = lightRegression.slope;
  const heavySlope = heavyRegression.slope;
  const slopeDifference = heavySlope - lightSlope;

  // Calculate y-values at midpoint
  const lightY = lightRegression.intercept + lightSlope * midpointKex;
  const heavyY = heavyRegression.intercept + heavySlope * midpointKex;
  const offset = heavyY - lightY;

  // Calculate average selectivity for percentage
  const avgY = (Math.abs(lightY) + Math.abs(heavyY)) / 2;
  const offsetPercent = avgY !== 0 ? (offset / avgY) * 100 : 0;

  // Determine if there's a significant break
  // Use combined standard errors to estimate significance
  const combinedSE = Math.sqrt(
    lightRegression.standardError ** 2 + heavyRegression.standardError ** 2
  );
  const hasBreak = combinedSE > 0 && Math.abs(slopeDifference) > 2 * combinedSE;

  let breakInterpretation: string;
  if (!hasBreak) {
    breakInterpretation = 'Continuous trend across all lanthanides';
  } else if (slopeDifference > 0) {
    breakInterpretation = 'Heavy REE show steeper k_ex dependence (gadolinium break effect)';
  } else {
    breakInterpretation = 'Light REE show steeper k_ex dependence';
  }

  if (Math.abs(offset) > 5) {
    if (offset > 0) {
      breakInterpretation += '. Heavy REE are preferentially bound.';
    } else {
      breakInterpretation += '. Light REE are preferentially bound.';
    }
  }

  return {
    offset,
    offsetPercent,
    lightSlope,
    heavySlope,
    slopeDifference,
    hasBreak,
    isSignificant: hasBreak || Math.abs(offset) > 5,
    breakInterpretation,
    interpretation: breakInterpretation,
  };
}

/**
 * Pairwise comparison result for mutant ranking
 */
export interface PairwiseComparisonResult {
  mutantA: string;
  mutantB: string;
  metricCompared: string;
  valueA: number;
  valueB: number;
  difference: number;
  pValue: number;
  effectSize: number;
  significant: boolean;
  effectInterpretation: 'negligible' | 'small' | 'medium' | 'large';
  winner: string | null;  // null if not significant
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Compare two mutants on a specific metric using appropriate test
 */
export function compareMutants(
  valuesA: number[],
  valuesB: number[],
  mutantA: string,
  mutantB: string,
  metric: string
): PairwiseComparisonResult {
  // Use Mann-Whitney U for small samples (more robust)
  // Use Welch's t-test for larger samples
  const useNonParametric = valuesA.length < 8 || valuesB.length < 8;

  const result = useNonParametric
    ? mannWhitneyU(valuesA, valuesB)
    : welchTTest(valuesA, valuesB);

  const { mean: meanA } = meanAndSE(valuesA);
  const { mean: meanB } = meanAndSE(valuesB);

  let winner: string | null = null;
  if (result.significant) {
    winner = meanA > meanB ? mutantA : mutantB;
  }

  let confidence: 'high' | 'medium' | 'low';
  if (result.pValue < 0.01 && result.effectInterpretation === 'large') {
    confidence = 'high';
  } else if (result.pValue < 0.05) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    mutantA,
    mutantB,
    metricCompared: metric,
    valueA: meanA,
    valueB: meanB,
    difference: meanA - meanB,
    pValue: result.pValue,
    effectSize: result.effectSize,
    significant: result.significant,
    effectInterpretation: result.effectInterpretation,
    winner,
    confidence,
  };
}
