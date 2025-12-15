#!/usr/bin/env node
/**
 * Preprocess GROMACS simulation data into a JSON file
 * Run with: node scripts/preprocessGromacsData.js
 */

const fs = require('fs');
const path = require('path');

const ANALYSIS_DIR = path.join(__dirname, '../analysis_results');
const OUTPUT_FILE = path.join(__dirname, '../public/data/gromacs_features.json');

const MUTANTS = ['Rub7', 'Rub9', 'Rub10', 'Rub11', 'Rub12', 'Rub13', 'Rub14', 'Rub15', 'Rub16', 'Rub17', 'Rub18', 'Rub20'];
const RUNS = ['run1', 'run2', 'run3'];

function parseCoordinationSummary(content) {
  const result = {
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

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
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
    if (currentSection === 'coordination') {
      const match = trimmed.match(/^(mean|std|min|max|median):\s*([\d.]+)/);
      if (match) {
        const [, stat, value] = match;
        const numValue = parseFloat(value);
        // Look back to find context
        for (let i = lineIdx - 1; i >= 0; i--) {
          const prevTrimmed = lines[i].trim();
          if (prevTrimmed === 'total:') {
            result.coordination.total[stat] = numValue;
            break;
          } else if (prevTrimmed === 'water:') {
            result.coordination.water[stat] = numValue;
            break;
          } else if (prevTrimmed === 'protein:') {
            result.coordination.protein[stat] = numValue;
            break;
          } else if (prevTrimmed.startsWith('coordination_geometry:') || prevTrimmed.startsWith('bond_')) {
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
        if (geometry in result.geometry) {
          result.geometry[geometry] = parseFloat(value);
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
        for (let i = lineIdx - 1; i >= 0; i--) {
          const prevTrimmed = lines[i].trim();
          if (prevTrimmed.startsWith('radius_of_gyration:')) {
            result.bindingSite.radius_of_gyration[stat] = numValue;
            break;
          } else if (prevTrimmed.startsWith('mean_coord_distance:')) {
            result.bindingSite.mean_coord_distance[stat] = numValue;
            break;
          } else if (prevTrimmed.startsWith('max_coord_distance:')) {
            result.bindingSite.max_coord_distance[stat] = numValue;
            break;
          } else if (prevTrimmed.startsWith('min_coord_distance:')) {
            result.bindingSite.min_coord_distance[stat] = numValue;
            break;
          } else if (prevTrimmed.startsWith('binding_site_volume:')) {
            result.bindingSite.binding_site_volume[stat] = numValue;
            break;
          } else if (prevTrimmed.startsWith('asymmetry:')) {
            result.bindingSite.asymmetry[stat] = numValue;
            break;
          } else if (prevTrimmed.startsWith('accessibility_score:')) {
            result.bindingSite.accessibility_score[stat] = numValue;
            break;
          } else if (prevTrimmed.startsWith('occupied_octants:')) {
            result.bindingSite.occupied_octants[stat] = numValue;
            break;
          } else if (prevTrimmed.startsWith('water_exchange:') || prevTrimmed.startsWith('spatial_')) {
            break;
          }
        }
      }
    }

    // Parse water exchange
    if (currentSection === 'water_exchange') {
      const rateMatch = trimmed.match(/exchange_rate:\s*([\d.]+)/);
      if (rateMatch) {
        result.waterExchange.exchange_rate = parseFloat(rateMatch[1]);
      }
      if (trimmed.match(/^mean:\s*([\d.]+)/)) {
        result.waterExchange.mean_residence_time = parseFloat(trimmed.match(/^mean:\s*([\d.]+)/)[1]);
      }
      if (trimmed.match(/^std:\s*([\d.]+)/)) {
        result.waterExchange.std_residence_time = parseFloat(trimmed.match(/^std:\s*([\d.]+)/)[1]);
      }
    }

    // Parse stability
    if (currentSection === 'stability') {
      const freqMatch = trimmed.match(/change_frequency:\s*([\d.]+)/);
      if (freqMatch) {
        for (let i = lineIdx - 1; i >= 0; i--) {
          const prevTrimmed = lines[i].trim();
          if (prevTrimmed.startsWith('total_coordination_changes:')) {
            result.stability.total_change_freq = parseFloat(freqMatch[1]);
            break;
          } else if (prevTrimmed.startsWith('water_coordination_changes:')) {
            result.stability.water_change_freq = parseFloat(freqMatch[1]);
            break;
          } else if (prevTrimmed.startsWith('protein_coordination_changes:')) {
            result.stability.protein_change_freq = parseFloat(freqMatch[1]);
            break;
          } else if (prevTrimmed.startsWith('coordination_stability:')) {
            break;
          }
        }
      }
    }
  }

  return result;
}

function aggregateMutantRuns(runs) {
  if (runs.length === 0) return null;

  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  const std = (values) => {
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

  const tricappedPcts = runs.map(r => r.geometry?.tricapped_trigonal_prismatic ?? 0);
  const octahedralPcts = runs.map(r => r.geometry?.octahedral ?? 0);
  const highCoordPcts = runs.map(r => (r.geometry?.high_coordination_10 ?? 0) + (r.geometry?.high_coordination_11 ?? 0));

  // Find most common dominant geometry
  const geometryCounts = {};
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

function main() {
  console.log('Processing GROMACS simulation data...');

  const mutantData = {};

  for (const mutant of MUTANTS) {
    const runData = [];

    for (const run of RUNS) {
      const summaryPath = path.join(ANALYSIS_DIR, mutant, run, 'eu3p_coordination_summary.txt');

      if (fs.existsSync(summaryPath)) {
        try {
          const content = fs.readFileSync(summaryPath, 'utf-8');
          const parsed = parseCoordinationSummary(content);
          runData.push(parsed);
          console.log(`  ✓ ${mutant}/${run}`);
        } catch (e) {
          console.log(`  ✗ ${mutant}/${run}: ${e.message}`);
        }
      }
    }

    if (runData.length > 0) {
      const aggregated = aggregateMutantRuns(runData);
      if (aggregated) {
        aggregated.mutant = mutant;
        mutantData[mutant] = aggregated;
      }
    }
  }

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mutantData, null, 2));
  console.log(`\nWritten to ${OUTPUT_FILE}`);
  console.log(`Processed ${Object.keys(mutantData).length} mutants`);
}

main();
