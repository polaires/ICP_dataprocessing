/**
 * Principal Component Analysis (PCA) Implementation
 * For analyzing structure-function relationships in lanthanide binding proteins
 */

export interface PCAResult {
  // Principal components (eigenvectors)
  components: number[][];
  // Explained variance for each component
  explainedVariance: number[];
  // Explained variance ratio (percentage)
  explainedVarianceRatio: number[];
  // Cumulative explained variance ratio
  cumulativeVarianceRatio: number[];
  // Transformed data (scores)
  transformedData: number[][];
  // Feature loadings for each component
  loadings: number[][];
  // Mean of original features (for centering)
  mean: number[];
  // Std of original features (for scaling)
  std: number[];
  // Number of components
  nComponents: number;
}

/**
 * Standardize data (z-score normalization)
 */
function standardize(data: number[][]): { standardized: number[][]; mean: number[]; std: number[] } {
  const n = data.length;
  const p = data[0]?.length || 0;

  if (n === 0 || p === 0) {
    return { standardized: [], mean: [], std: [] };
  }

  // Calculate mean for each feature
  const mean: number[] = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) {
      mean[j] += data[i][j];
    }
    mean[j] /= n;
  }

  // Calculate standard deviation for each feature
  const std: number[] = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) {
      std[j] += (data[i][j] - mean[j]) ** 2;
    }
    std[j] = Math.sqrt(std[j] / (n - 1));
    // Prevent division by zero
    if (std[j] === 0) std[j] = 1;
  }

  // Standardize
  const standardized: number[][] = data.map(row =>
    row.map((val, j) => (val - mean[j]) / std[j])
  );

  return { standardized, mean, std };
}

/**
 * Compute covariance matrix
 */
function covarianceMatrix(data: number[][]): number[][] {
  const n = data.length;
  const p = data[0]?.length || 0;

  if (n < 2 || p === 0) {
    return [];
  }

  // Data should already be centered (standardized)
  const cov: number[][] = Array(p).fill(null).map(() => Array(p).fill(0));

  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += data[k][i] * data[k][j];
      }
      cov[i][j] = sum / (n - 1);
      cov[j][i] = cov[i][j]; // Symmetric
    }
  }

  return cov;
}

/**
 * Power iteration method for finding eigenvectors
 * More numerically stable for small matrices
 */
function powerIteration(
  matrix: number[][],
  numIterations: number = 100,
  tolerance: number = 1e-10
): { eigenvalue: number; eigenvector: number[] } {
  const n = matrix.length;

  // Start with random vector
  let v = Array(n).fill(0).map(() => Math.random() - 0.5);

  // Normalize
  let norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  v = v.map(x => x / norm);

  let eigenvalue = 0;

  for (let iter = 0; iter < numIterations; iter++) {
    // Multiply matrix by vector
    const newV = matrix.map(row => row.reduce((sum, val, j) => sum + val * v[j], 0));

    // Calculate new eigenvalue (Rayleigh quotient)
    eigenvalue = newV.reduce((sum, val, i) => sum + val * v[i], 0);

    // Normalize
    norm = Math.sqrt(newV.reduce((sum, x) => sum + x * x, 0));
    if (norm === 0) break;

    const nextV = newV.map(x => x / norm);

    // Check convergence
    const diff = Math.sqrt(nextV.reduce((sum, val, i) => sum + (val - v[i]) ** 2, 0));
    v = nextV;

    if (diff < tolerance) break;
  }

  return { eigenvalue, eigenvector: v };
}

/**
 * Deflate matrix after extracting an eigenvalue/eigenvector pair
 */
function deflateMatrix(matrix: number[][], eigenvalue: number, eigenvector: number[]): number[][] {
  const n = matrix.length;
  const deflated: number[][] = matrix.map(row => [...row]);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      deflated[i][j] -= eigenvalue * eigenvector[i] * eigenvector[j];
    }
  }

  return deflated;
}

/**
 * Perform PCA on data matrix
 * @param data - n x p matrix (n samples, p features)
 * @param nComponents - number of components to keep (default: all)
 */
export function performPCA(data: number[][], nComponents?: number): PCAResult {
  const n = data.length;
  const p = data[0]?.length || 0;

  if (n < 2 || p === 0) {
    return {
      components: [],
      explainedVariance: [],
      explainedVarianceRatio: [],
      cumulativeVarianceRatio: [],
      transformedData: [],
      loadings: [],
      mean: [],
      std: [],
      nComponents: 0,
    };
  }

  // Standardize data
  const { standardized, mean, std } = standardize(data);

  // Compute covariance matrix
  const cov = covarianceMatrix(standardized);

  // Find eigenvalues and eigenvectors using power iteration with deflation
  const numComponents = nComponents || Math.min(n - 1, p);
  const eigenvalues: number[] = [];
  const eigenvectors: number[][] = [];

  let currentMatrix = cov.map(row => [...row]);

  for (let i = 0; i < numComponents; i++) {
    const { eigenvalue, eigenvector } = powerIteration(currentMatrix);

    // Handle numerical issues
    if (eigenvalue < 1e-10) break;

    eigenvalues.push(eigenvalue);
    eigenvectors.push(eigenvector);

    // Deflate for next iteration
    currentMatrix = deflateMatrix(currentMatrix, eigenvalue, eigenvector);
  }

  // Calculate total variance
  const totalVariance = eigenvalues.reduce((sum, val) => sum + val, 0);

  // Explained variance ratio
  const explainedVarianceRatio = eigenvalues.map(ev =>
    totalVariance > 0 ? ev / totalVariance : 0
  );

  // Cumulative variance ratio
  const cumulativeVarianceRatio: number[] = [];
  let cumSum = 0;
  for (const ratio of explainedVarianceRatio) {
    cumSum += ratio;
    cumulativeVarianceRatio.push(cumSum);
  }

  // Transform data (project onto principal components)
  const transformedData = standardized.map(row =>
    eigenvectors.map(ev => row.reduce((sum, val, j) => sum + val * ev[j], 0))
  );

  // Loadings are the eigenvectors scaled by sqrt of eigenvalue
  const loadings = eigenvectors.map((ev, i) =>
    ev.map(val => val * Math.sqrt(eigenvalues[i]))
  );

  return {
    components: eigenvectors,
    explainedVariance: eigenvalues,
    explainedVarianceRatio,
    cumulativeVarianceRatio,
    transformedData,
    loadings,
    mean,
    std,
    nComponents: eigenvectors.length,
  };
}

/**
 * Transform new data using existing PCA model
 */
export function transformData(newData: number[][], pcaResult: PCAResult): number[][] {
  const { mean, std, components } = pcaResult;

  // Standardize using training mean and std
  const standardized = newData.map(row =>
    row.map((val, j) => (val - mean[j]) / std[j])
  );

  // Project onto components
  return standardized.map(row =>
    components.map(ev => row.reduce((sum, val, j) => sum + val * ev[j], 0))
  );
}

/**
 * Get top contributing features for each component
 */
export function getTopFeatures(
  pcaResult: PCAResult,
  featureNames: string[],
  topN: number = 5
): { component: number; features: { name: string; loading: number; contribution: number }[] }[] {
  const { loadings } = pcaResult;

  return loadings.map((componentLoadings, i) => {
    const featureContributions = componentLoadings.map((loading, j) => ({
      name: featureNames[j] || `Feature ${j}`,
      loading,
      contribution: loading ** 2, // Squared loading = contribution
    }));

    // Sort by absolute contribution
    featureContributions.sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading));

    return {
      component: i + 1,
      features: featureContributions.slice(0, topN),
    };
  });
}

/**
 * Compute correlation matrix between features
 */
export function correlationMatrix(data: number[][]): number[][] {
  const { standardized } = standardize(data);
  return covarianceMatrix(standardized);
}
