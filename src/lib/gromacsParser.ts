/**
 * GROMACS Simulation Data Parser
 * Parses and aggregates simulation results from analysis_results directory
 */

export interface CoordinationStats {
  total: { mean: number; std: number; min: number; max: number; median: number };
  water: { mean: number; std: number; min: number; max: number; median: number };
  protein: { mean: number; std: number; min: number; max: number; median: number };
}

export interface GeometryDistribution {
  pentagonal_bipyramidal: number;
  octahedral: number;
  square_antiprismatic: number;
  tricapped_trigonal_prismatic: number;
  high_coordination_10: number;
  trigonal_bipyramidal: number;
  tetrahedral: number;
  square_planar: number;
  distorted_tetrahedral: number;
  pyramidal: number;
  bent: number;
  high_coordination_11: number;
}

export interface BindingSiteStats {
  radius_of_gyration: { mean: number; std: number };
  mean_coord_distance: { mean: number; std: number };
  max_coord_distance: { mean: number; std: number };
  min_coord_distance: { mean: number; std: number };
  binding_site_volume: { mean: number; std: number };
  asymmetry: { mean: number; std: number };
  accessibility_score: { mean: number; std: number };
  occupied_octants: { mean: number; std: number };
}

export interface WaterExchangeStats {
  exchange_rate: number;
  mean_residence_time: number;
  std_residence_time: number;
}

export interface CoordinationStability {
  total_change_freq: number;
  water_change_freq: number;
  protein_change_freq: number;
}

export interface MutantGromacsData {
  mutant: string;
  runs: number;
  coordination: CoordinationStats;
  geometry: GeometryDistribution;
  dominantGeometry: string;
  bindingSite: BindingSiteStats;
  waterExchange: WaterExchangeStats;
  stability: CoordinationStability;
}

export interface AggregatedMutantFeatures {
  mutant: string;
  // Coordination features
  total_coord_mean: number;
  total_coord_std: number;
  water_coord_mean: number;
  protein_coord_mean: number;
  // Geometry features
  dominant_geometry: string;
  geometry_tricapped_pct: number;
  geometry_octahedral_pct: number;
  geometry_high_coord_pct: number;
  // Binding site features
  binding_volume_mean: number;
  binding_volume_std: number;
  radius_gyration_mean: number;
  asymmetry_mean: number;
  accessibility_mean: number;
  // Water exchange features
  water_exchange_rate: number;
  residence_time_mean: number;
  // Stability features
  total_change_freq: number;
  water_change_freq: number;
  protein_change_freq: number;
}

/**
 * Parse a single eu3p_coordination_summary.txt file
 */
export function parseCoordinationSummary(content: string): Partial<MutantGromacsData> {
  const result: Partial<MutantGromacsData> = {
    coordination: {
      total: { mean: 0, std: 0, min: 0, max: 0, median: 0 },
      water: { mean: 0, std: 0, min: 0, max: 0, median: 0 },
      protein: { mean: 0, std: 0, min: 0, max: 0, median: 0 },
    },
    geometry: {
      pentagonal_bipyramidal: 0,
      octahedral: 0,
      square_antiprismatic: 0,
      tricapped_trigonal_prismatic: 0,
      high_coordination_10: 0,
      trigonal_bipyramidal: 0,
      tetrahedral: 0,
      square_planar: 0,
      distorted_tetrahedral: 0,
      pyramidal: 0,
      bent: 0,
      high_coordination_11: 0,
    },
    dominantGeometry: '',
    bindingSite: {
      radius_of_gyration: { mean: 0, std: 0 },
      mean_coord_distance: { mean: 0, std: 0 },
      max_coord_distance: { mean: 0, std: 0 },
      min_coord_distance: { mean: 0, std: 0 },
      binding_site_volume: { mean: 0, std: 0 },
      asymmetry: { mean: 0, std: 0 },
      accessibility_score: { mean: 0, std: 0 },
      occupied_octants: { mean: 0, std: 0 },
    },
    waterExchange: {
      exchange_rate: 0,
      mean_residence_time: 0,
      std_residence_time: 0,
    },
    stability: {
      total_change_freq: 0,
      water_change_freq: 0,
      protein_change_freq: 0,
    },
  };

  const lines = content.split('\n');
  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Section detection
    if (trimmed.startsWith('coordination_numbers:')) {
      currentSection = 'coordination';
    } else if (trimmed.startsWith('coordination_geometry:')) {
      currentSection = 'geometry';
    } else if (trimmed.startsWith('binding_site:')) {
      currentSection = 'binding_site';
    } else if (trimmed.startsWith('water_exchange:')) {
      currentSection = 'water_exchange';
    } else if (trimmed.startsWith('coordination_stability:')) {
      currentSection = 'stability';
    }

    // Parse coordination numbers
    if (currentSection === 'coordination' && result.coordination) {
      const match = trimmed.match(/^(mean|std|min|max|median):\s*([\d.]+)/);
      if (match) {
        const [, stat, value] = match;
        const numValue = parseFloat(value);
        const statKey = stat as 'mean' | 'std' | 'min' | 'max' | 'median';
        // Determine which coordination type we're in (total/water/protein)
        const prevLines = lines.slice(0, lines.indexOf(line)).reverse();
        for (const prev of prevLines) {
          if (prev.includes('total:')) {
            result.coordination.total[statKey] = numValue;
            break;
          } else if (prev.includes('water:') && !prev.includes('water_exchange')) {
            result.coordination.water[statKey] = numValue;
            break;
          } else if (prev.includes('protein:')) {
            result.coordination.protein[statKey] = numValue;
            break;
          }
        }
      }
    }

    // Parse geometry distribution
    if (currentSection === 'geometry') {
      const geoMatch = trimmed.match(/^(\w+):\s*([\d.]+)/);
      if (geoMatch && !['distribution', 'most_common', 'n_unique_geometries'].includes(geoMatch[1])) {
        const [, geometry, value] = geoMatch;
        if (geometry in result.geometry!) {
          result.geometry![geometry as keyof GeometryDistribution] = parseFloat(value);
        }
      }

      const mostCommonMatch = trimmed.match(/most_common:\s*\('(\w+)',/);
      if (mostCommonMatch) {
        result.dominantGeometry = mostCommonMatch[1];
      }
    }

    // Parse binding site metrics
    if (currentSection === 'binding_site') {
      const bindingMatch = trimmed.match(/^(mean|std):\s*([\d.]+)/);
      if (bindingMatch) {
        const [, stat, value] = bindingMatch;
        const numValue = parseFloat(value);
        const prevLines = lines.slice(0, lines.indexOf(line)).reverse();
        for (const prev of prevLines) {
          const prevTrimmed = prev.trim();
          if (prevTrimmed.startsWith('radius_of_gyration:')) {
            result.bindingSite!.radius_of_gyration[stat as 'mean' | 'std'] = numValue;
            break;
          } else if (prevTrimmed.startsWith('mean_coord_distance:')) {
            result.bindingSite!.mean_coord_distance[stat as 'mean' | 'std'] = numValue;
            break;
          } else if (prevTrimmed.startsWith('max_coord_distance:')) {
            result.bindingSite!.max_coord_distance[stat as 'mean' | 'std'] = numValue;
            break;
          } else if (prevTrimmed.startsWith('min_coord_distance:')) {
            result.bindingSite!.min_coord_distance[stat as 'mean' | 'std'] = numValue;
            break;
          } else if (prevTrimmed.startsWith('binding_site_volume:')) {
            result.bindingSite!.binding_site_volume[stat as 'mean' | 'std'] = numValue;
            break;
          } else if (prevTrimmed.startsWith('asymmetry:')) {
            result.bindingSite!.asymmetry[stat as 'mean' | 'std'] = numValue;
            break;
          } else if (prevTrimmed.startsWith('accessibility_score:')) {
            result.bindingSite!.accessibility_score[stat as 'mean' | 'std'] = numValue;
            break;
          } else if (prevTrimmed.startsWith('occupied_octants:')) {
            result.bindingSite!.occupied_octants[stat as 'mean' | 'std'] = numValue;
            break;
          }
        }
      }
    }

    // Parse water exchange
    if (currentSection === 'water_exchange') {
      const rateMatch = trimmed.match(/exchange_rate:\s*([\d.]+)/);
      if (rateMatch) {
        result.waterExchange!.exchange_rate = parseFloat(rateMatch[1]);
      }
      const resTimeMatch = trimmed.match(/^(mean|std):\s*([\d.]+)/);
      if (resTimeMatch) {
        const [, stat, value] = resTimeMatch;
        if (stat === 'mean') result.waterExchange!.mean_residence_time = parseFloat(value);
        if (stat === 'std') result.waterExchange!.std_residence_time = parseFloat(value);
      }
    }

    // Parse stability
    if (currentSection === 'stability') {
      const freqMatch = trimmed.match(/change_frequency:\s*([\d.]+)/);
      if (freqMatch) {
        const prevLines = lines.slice(0, lines.indexOf(line)).reverse();
        for (const prev of prevLines) {
          if (prev.includes('total_coordination_changes:')) {
            result.stability!.total_change_freq = parseFloat(freqMatch[1]);
            break;
          } else if (prev.includes('water_coordination_changes:')) {
            result.stability!.water_change_freq = parseFloat(freqMatch[1]);
            break;
          } else if (prev.includes('protein_coordination_changes:')) {
            result.stability!.protein_change_freq = parseFloat(freqMatch[1]);
            break;
          }
        }
      }
    }
  }

  return result;
}

/**
 * Aggregate multiple runs of a mutant into feature vectors
 */
export function aggregateMutantRuns(runs: Partial<MutantGromacsData>[]): AggregatedMutantFeatures | null {
  if (runs.length === 0) return null;

  const n = runs.length;

  // Calculate mean of each feature across runs
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const std = (values: number[]) => {
    const m = mean(values);
    return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length);
  };

  const totalCoordMeans = runs.map(r => r.coordination?.total.mean ?? 0);
  const waterCoordMeans = runs.map(r => r.coordination?.water.mean ?? 0);
  const proteinCoordMeans = runs.map(r => r.coordination?.protein.mean ?? 0);

  const bindingVolumes = runs.map(r => r.bindingSite?.binding_site_volume.mean ?? 0);
  const radiusGyrations = runs.map(r => r.bindingSite?.radius_of_gyration.mean ?? 0);
  const asymmetries = runs.map(r => r.bindingSite?.asymmetry.mean ?? 0);
  const accessibilities = runs.map(r => r.bindingSite?.accessibility_score.mean ?? 0);

  const exchangeRates = runs.map(r => r.waterExchange?.exchange_rate ?? 0);
  const residenceTimes = runs.map(r => r.waterExchange?.mean_residence_time ?? 0);

  const totalChangeFreqs = runs.map(r => r.stability?.total_change_freq ?? 0);
  const waterChangeFreqs = runs.map(r => r.stability?.water_change_freq ?? 0);
  const proteinChangeFreqs = runs.map(r => r.stability?.protein_change_freq ?? 0);

  // Aggregate geometry distributions
  const tricappedPcts = runs.map(r => r.geometry?.tricapped_trigonal_prismatic ?? 0);
  const octahedralPcts = runs.map(r => r.geometry?.octahedral ?? 0);
  const highCoordPcts = runs.map(r => (r.geometry?.high_coordination_10 ?? 0) + (r.geometry?.high_coordination_11 ?? 0));

  // Find most common dominant geometry
  const geometryCounts: Record<string, number> = {};
  runs.forEach(r => {
    const geom = r.dominantGeometry || 'unknown';
    geometryCounts[geom] = (geometryCounts[geom] || 0) + 1;
  });
  const dominantGeometry = Object.entries(geometryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

  return {
    mutant: '',
    total_coord_mean: mean(totalCoordMeans),
    total_coord_std: std(totalCoordMeans),
    water_coord_mean: mean(waterCoordMeans),
    protein_coord_mean: mean(proteinCoordMeans),
    dominant_geometry: dominantGeometry,
    geometry_tricapped_pct: mean(tricappedPcts),
    geometry_octahedral_pct: mean(octahedralPcts),
    geometry_high_coord_pct: mean(highCoordPcts),
    binding_volume_mean: mean(bindingVolumes),
    binding_volume_std: std(bindingVolumes),
    radius_gyration_mean: mean(radiusGyrations),
    asymmetry_mean: mean(asymmetries),
    accessibility_mean: mean(accessibilities),
    water_exchange_rate: mean(exchangeRates),
    residence_time_mean: mean(residenceTimes),
    total_change_freq: mean(totalChangeFreqs),
    water_change_freq: mean(waterChangeFreqs),
    protein_change_freq: mean(proteinChangeFreqs),
  };
}

/**
 * Get feature vector for PCA (numeric values only)
 */
export function getFeatureVector(features: AggregatedMutantFeatures): number[] {
  return [
    features.total_coord_mean,
    features.water_coord_mean,
    features.protein_coord_mean,
    features.geometry_tricapped_pct,
    features.geometry_octahedral_pct,
    features.geometry_high_coord_pct,
    features.binding_volume_mean,
    features.radius_gyration_mean,
    features.asymmetry_mean,
    features.accessibility_mean,
    features.water_exchange_rate,
    features.residence_time_mean,
    features.total_change_freq,
    features.water_change_freq,
    features.protein_change_freq,
  ];
}

/**
 * Feature names for PCA loadings
 */
export const FEATURE_NAMES = [
  'Total Coordination',
  'Water Coordination',
  'Protein Coordination',
  'Tricapped Trigonal %',
  'Octahedral %',
  'High Coordination %',
  'Binding Volume',
  'Radius of Gyration',
  'Asymmetry',
  'Accessibility',
  'Water Exchange Rate',
  'Residence Time',
  'Total Change Freq',
  'Water Change Freq',
  'Protein Change Freq',
];
