'use client';

import { useMemo, useState } from 'react';
import { useDataStore } from '@/store/useDataStore';
import {
  LANTHANIDE_ORDER,
  WATER_EXCHANGE_RATES,
  ELEMENT_COLORS,
  LIGHT_REE,
  HEAVY_REE,
} from '@/lib/constants';
import {
  linearRegression,
  meanAndSE,
  combinedOutlierDetection,
  selectivityEntropy,
  lightHeavyDiscrimination,
} from '@/lib/statistics';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Line,
  ComposedChart,
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  Scatter,
} from 'recharts';

// Parse mutant name into base name and condition
function parseMutantName(name: string): { baseName: string; condition: 'H2O' | 'ATC' | 'unknown' } {
  const lower = name.toLowerCase();

  // Check for condition suffix
  if (lower.includes('-h2o') || lower.includes('_h2o') || lower.endsWith('h2o')) {
    const baseName = name.replace(/[-_]?(h2o|H2O)$/i, '').replace(/[-_]$/,'');
    return { baseName, condition: 'H2O' };
  }
  if (lower.includes('-atc') || lower.includes('_atc') || lower.endsWith('atc')) {
    const baseName = name.replace(/[-_]?(atc|ATC)$/i, '').replace(/[-_]$/,'');
    return { baseName, condition: 'ATC' };
  }

  return { baseName: name, condition: 'unknown' };
}

interface MutantData {
  name: string;
  baseName: string;
  condition: 'H2O' | 'ATC' | 'unknown';
  selectivityProfile: Record<string, number>;
  selectivityError: Record<string, number>;
  kexSlope: number;
  kexSlopeError: number;
  kexR2: number;
  kexPValue: number;
  kexIntercept: number;
  entropy: number;
  normalizedEntropy: number;
  lightHeavyScore: number;
  topElement: string;
  topSelectivity: number;
  isBinding: boolean;
  nReplicates: number;
}

// Color palette optimized for publication (colorblind-friendly)
const BASE_MUTANT_COLORS: Record<string, string> = {
  'Rub9': '#1f77b4',   // blue
  'Rub10': '#ff7f0e',  // orange
  'Rub11': '#2ca02c',  // green
  'Rub12': '#d62728',  // red
  'Rub13': '#9467bd',  // purple
  'Rub15': '#8c564b',  // brown
  'Rub17': '#e377c2',  // pink
  'Rub18': '#7f7f7f',  // gray
  'Rub19': '#bcbd22',  // olive
  'Rub20': '#17becf',  // cyan
  'Redox': '#393b79',  // dark blue
  'Hippo': '#637939',  // dark green
  'HiPPO': '#637939',  // dark green (alias)
};

function getMutantColor(baseName: string, index: number): string {
  // Normalize the base name for lookup
  const normalized = baseName.charAt(0).toUpperCase() + baseName.slice(1).toLowerCase();
  const lookup = Object.keys(BASE_MUTANT_COLORS).find(k =>
    normalized.toLowerCase().startsWith(k.toLowerCase())
  );

  if (lookup) {
    return BASE_MUTANT_COLORS[lookup];
  }

  // Fallback colors
  const fallbackColors = ['#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5'];
  return fallbackColors[index % fallbackColors.length];
}

export function PublicationView() {
  const {
    processedData,
    replicateGroups,
    rawData,
    selectedSamples,
    bufferMeasurement,
  } = useDataStore();

  const [showOutliers, setShowOutliers] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<'cross-mutant' | 'within-mutant'>('cross-mutant');
  const [selectedCondition, setSelectedCondition] = useState<'H2O' | 'ATC'>('H2O');
  const [selectedBaseMutants, setSelectedBaseMutants] = useState<Set<string>>(new Set());

  // Get elements with k_ex data
  const elementsWithKex = useMemo(() => {
    return (rawData?.elements || [])
      .filter(e => WATER_EXCHANGE_RATES[e] !== undefined)
      .sort((a, b) => LANTHANIDE_ORDER.indexOf(a) - LANTHANIDE_ORDER.indexOf(b));
  }, [rawData?.elements]);

  // Analyze all mutants with condition parsing
  const allMutantData = useMemo((): MutantData[] => {
    if (!rawData || elementsWithKex.length === 0) return [];

    const data: MutantData[] = [];

    for (const group of replicateGroups) {
      if (group.measurements.some(m => m.id === bufferMeasurement?.id)) continue;

      const selectedMeasurements = group.measurements.filter(m =>
        selectedSamples.includes(m.id)
      );

      if (selectedMeasurements.length === 0) continue;

      // Detect outliers
      const totalMolarities = selectedMeasurements.map(m =>
        elementsWithKex.reduce((sum, e) => sum + Math.max(0, m.normalizedMolarity[e] ?? 0), 0)
      );

      const outlierResult = combinedOutlierDetection(totalMolarities, 2);
      const outlierSet = new Set(outlierResult.outlierIndices);

      const validMeasurements = showOutliers
        ? selectedMeasurements
        : selectedMeasurements.filter((_, i) => !outlierSet.has(i));

      if (validMeasurements.length === 0) continue;

      // Calculate total molarity
      const validTotalMolarities = validMeasurements.map(m =>
        elementsWithKex.reduce((sum, e) => sum + Math.max(0, m.normalizedMolarity[e] ?? 0), 0)
      );
      const { mean: totalMolarity } = meanAndSE(validTotalMolarities);
      const isBinding = totalMolarity >= 0.5;

      // Calculate mean selectivity profile with errors
      const selectivityProfile: Record<string, number> = {};
      const selectivityError: Record<string, number> = {};
      for (const element of elementsWithKex) {
        const values = validMeasurements.map(m => m.selectivity[element] ?? 0);
        const { mean, se } = meanAndSE(values);
        selectivityProfile[element] = mean;
        selectivityError[element] = se;
      }

      // k_ex regression
      const kexValues = elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!);
      const bindingValues = elementsWithKex.map(e => selectivityProfile[e]);

      let kexSlope = 0, kexSlopeError = 0, kexR2 = 0, kexPValue = 1, kexIntercept = 0;

      if (isBinding && bindingValues.some(v => v > 0)) {
        const regression = linearRegression(kexValues, bindingValues);
        kexSlope = regression.slope;
        kexSlopeError = regression.standardError;
        kexR2 = regression.rSquared;
        kexPValue = regression.pValue;
        kexIntercept = regression.intercept;
      }

      // Top element
      const topEntry = Object.entries(selectivityProfile).reduce(
        (max, curr) => (curr[1] > max[1] ? curr : max),
        ['', 0]
      );

      // Entropy
      const entropyResult = selectivityEntropy(selectivityProfile);

      // Light/Heavy
      const lightElements = elementsWithKex.filter(e => LIGHT_REE.includes(e));
      const heavyElements = elementsWithKex.filter(e => HEAVY_REE.includes(e));
      const lhResult = lightHeavyDiscrimination(selectivityProfile, lightElements, heavyElements);

      // Parse name
      const { baseName, condition } = parseMutantName(group.baseName);

      data.push({
        name: group.baseName,
        baseName,
        condition,
        selectivityProfile,
        selectivityError,
        kexSlope,
        kexSlopeError,
        kexR2,
        kexPValue,
        kexIntercept,
        entropy: entropyResult.entropy,
        normalizedEntropy: entropyResult.normalizedEntropy,
        lightHeavyScore: lhResult.score,
        topElement: topEntry[0],
        topSelectivity: topEntry[1],
        isBinding,
        nReplicates: validMeasurements.length,
      });
    }

    return data;
  }, [rawData, elementsWithKex, replicateGroups, selectedSamples, bufferMeasurement, showOutliers]);

  // Get unique base mutant names and conditions
  const { baseMutantNames, availableConditions } = useMemo(() => {
    const baseNames = new Set<string>();
    const conditions = new Set<'H2O' | 'ATC'>();

    allMutantData.forEach(m => {
      if (m.isBinding) {
        baseNames.add(m.baseName);
        if (m.condition !== 'unknown') {
          conditions.add(m.condition);
        }
      }
    });

    return {
      baseMutantNames: Array.from(baseNames).sort(),
      availableConditions: Array.from(conditions).sort(),
    };
  }, [allMutantData]);

  // Filter mutants based on mode and selection
  const displayMutants = useMemo(() => {
    let filtered = allMutantData.filter(m => m.isBinding);

    if (comparisonMode === 'cross-mutant') {
      // Filter by selected condition
      filtered = filtered.filter(m => m.condition === selectedCondition);
    }

    // Filter by selected base mutants
    if (selectedBaseMutants.size > 0) {
      filtered = filtered.filter(m => selectedBaseMutants.has(m.baseName));
    }

    return filtered;
  }, [allMutantData, comparisonMode, selectedCondition, selectedBaseMutants]);

  // For within-mutant mode: pair H2O and ATC data
  const pairedMutantData = useMemo(() => {
    if (comparisonMode !== 'within-mutant') return [];

    const pairs: Array<{
      baseName: string;
      h2o: MutantData | null;
      atc: MutantData | null;
      color: string;
    }> = [];

    const targetBaseNames = selectedBaseMutants.size > 0
      ? Array.from(selectedBaseMutants)
      : baseMutantNames;

    targetBaseNames.forEach((baseName, idx) => {
      const h2o = allMutantData.find(m => m.baseName === baseName && m.condition === 'H2O' && m.isBinding);
      const atc = allMutantData.find(m => m.baseName === baseName && m.condition === 'ATC' && m.isBinding);

      if (h2o || atc) {
        pairs.push({
          baseName,
          h2o: h2o || null,
          atc: atc || null,
          color: getMutantColor(baseName, idx),
        });
      }
    });

    return pairs;
  }, [comparisonMode, allMutantData, baseMutantNames, selectedBaseMutants]);

  // Toggle base mutant selection
  const toggleBaseMutant = (name: string) => {
    setSelectedBaseMutants(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  if (!rawData || allMutantData.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        No data available. Upload a CSV file to begin analysis.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Header & Controls */}
      <div className="bg-white border rounded-lg p-4">
        <h2 className="text-xl font-semibold mb-4">Publication View - Condition-Aware Comparison</h2>

        {/* Mode Selection */}
        <div className="flex flex-wrap gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Comparison Mode</label>
            <div className="flex gap-2">
              <button
                onClick={() => setComparisonMode('cross-mutant')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  comparisonMode === 'cross-mutant'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Cross-Mutant (same condition)
              </button>
              <button
                onClick={() => setComparisonMode('within-mutant')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  comparisonMode === 'within-mutant'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Within-Mutant (H2O vs ATC)
              </button>
            </div>
          </div>

          {comparisonMode === 'cross-mutant' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Condition</label>
              <div className="flex gap-2">
                {availableConditions.map(cond => (
                  <button
                    key={cond}
                    onClick={() => setSelectedCondition(cond)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      selectedCondition === cond
                        ? cond === 'H2O' ? 'bg-cyan-600 text-white' : 'bg-amber-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {cond}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showOutliers}
                onChange={(e) => setShowOutliers(e.target.checked)}
                className="rounded"
              />
              Include outliers
            </label>
          </div>
        </div>

        {/* Mutant Selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              Select Mutants ({baseMutantNames.length} available)
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedBaseMutants(new Set(baseMutantNames))}
                className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                Select All
              </button>
              <button
                onClick={() => setSelectedBaseMutants(new Set())}
                className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {baseMutantNames.map((name, idx) => (
              <button
                key={name}
                onClick={() => toggleBaseMutant(name)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-all border-2 ${
                  selectedBaseMutants.size === 0 || selectedBaseMutants.has(name)
                    ? 'text-white border-transparent'
                    : 'bg-white border-gray-300 text-gray-400'
                }`}
                style={{
                  backgroundColor: selectedBaseMutants.size === 0 || selectedBaseMutants.has(name)
                    ? getMutantColor(name, idx)
                    : undefined,
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cross-Mutant Mode */}
      {comparisonMode === 'cross-mutant' && (
        <>
          {/* k_ex Correlation - Clean Version */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-2">
              k_ex Correlation - {selectedCondition} Condition
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Comparing {displayMutants.length} mutants under {selectedCondition} condition
            </p>
            <ResponsiveContainer width="100%" height={450}>
              <ComposedChart margin={{ top: 20, right: 30, bottom: 60, left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="kex"
                  type="number"
                  domain={[0, 8]}
                  label={{ value: 'k_ex (10⁸ s⁻¹)', position: 'bottom', offset: 40 }}
                  tickFormatter={(v) => v.toFixed(1)}
                />
                <YAxis
                  label={{ value: 'Selectivity (%)', angle: -90, position: 'insideLeft', offset: -10 }}
                  domain={[0, 'auto']}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const point = payload[0]?.payload;
                    if (!point) return null;
                    return (
                      <div className="bg-white border rounded shadow-lg p-3 text-sm">
                        <p className="font-semibold" style={{ color: point.color }}>{point.mutant}</p>
                        <p style={{ color: ELEMENT_COLORS[point.element] }}>
                          <strong>{point.element}</strong>: {point.selectivity?.toFixed(1)}%
                        </p>
                        <p className="text-gray-500">k_ex: {point.kex?.toFixed(2)}</p>
                      </div>
                    );
                  }}
                />
                <Legend />

                {/* Regression lines - render first (behind scatter) */}
                {displayMutants.map((mutant, idx) => {
                  const color = getMutantColor(mutant.baseName, idx);
                  const minKex = 0.5;
                  const maxKex = 7.5;
                  const lineData = [
                    { kex: minKex, y: Math.max(0, mutant.kexIntercept + mutant.kexSlope * minKex) },
                    { kex: maxKex, y: Math.max(0, mutant.kexIntercept + mutant.kexSlope * maxKex) },
                  ];

                  // Show regression line for all binding mutants (removed R² threshold)
                  return (
                    <Line
                      key={`line-${mutant.name}`}
                      data={lineData}
                      dataKey="y"
                      stroke={color}
                      strokeWidth={2}
                      strokeOpacity={0.7}
                      dot={false}
                      name={`${mutant.baseName} (R²=${mutant.kexR2.toFixed(2)})`}
                      legendType="line"
                    />
                  );
                })}

                {/* Scatter points - render second (on top) */}
                {displayMutants.map((mutant, idx) => {
                  const color = getMutantColor(mutant.baseName, idx);
                  const scatterData = elementsWithKex.map(e => ({
                    kex: WATER_EXCHANGE_RATES[e]!,
                    selectivity: mutant.selectivityProfile[e],
                    element: e,
                    mutant: mutant.baseName,
                    color,
                  }));

                  return (
                    <Scatter
                      key={`scatter-${mutant.name}`}
                      data={scatterData}
                      dataKey="selectivity"
                      fill={color}
                      name={mutant.baseName}
                      legendType="circle"
                    />
                  );
                })}
              </ComposedChart>
            </ResponsiveContainer>

            {/* Element legend */}
            <div className="mt-4 pt-4 border-t">
              <p className="text-xs text-gray-500 mb-2">Elements by k_ex position:</p>
              <div className="flex flex-wrap gap-2">
                {elementsWithKex.map(e => (
                  <span
                    key={e}
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      backgroundColor: `${ELEMENT_COLORS[e]}20`,
                      color: ELEMENT_COLORS[e],
                      border: `1px solid ${ELEMENT_COLORS[e]}40`,
                    }}
                  >
                    {e} (k_ex={WATER_EXCHANGE_RATES[e]?.toFixed(1)})
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Metrics Comparison - Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* k_ex Slope */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold mb-2">k_ex Slope - {selectedCondition}</h3>
              <p className="text-xs text-gray-500 mb-3">Positive = prefers high k_ex elements (fast exchange)</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={displayMutants.map((m, i) => ({
                    name: m.baseName,
                    slope: m.kexSlope,
                    error: m.kexSlopeError,
                    color: getMutantColor(m.baseName, i),
                  }))}
                  margin={{ top: 20, right: 20, bottom: 40, left: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis label={{ value: 'Slope', angle: -90, position: 'insideLeft' }} />
                  <Tooltip formatter={(v: number) => v.toFixed(3)} />
                  <ReferenceLine y={0} stroke="#666" />
                  <Bar dataKey="slope">
                    {displayMutants.map((m, i) => (
                      <Cell key={m.name} fill={getMutantColor(m.baseName, i)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* R² */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold mb-2">R² (Correlation Strength) - {selectedCondition}</h3>
              <p className="text-xs text-gray-500 mb-3">Higher = stronger k_ex-selectivity relationship</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={displayMutants.map((m, i) => ({
                    name: m.baseName,
                    r2: m.kexR2,
                    color: getMutantColor(m.baseName, i),
                  }))}
                  margin={{ top: 20, right: 20, bottom: 40, left: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 1]} label={{ value: 'R²', angle: -90, position: 'insideLeft' }} />
                  <Tooltip formatter={(v: number) => v.toFixed(3)} />
                  <Bar dataKey="r2">
                    {displayMutants.map((m, i) => (
                      <Cell key={m.name} fill={getMutantColor(m.baseName, i)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Light/Heavy Preference */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold mb-2">Light/Heavy REE Preference - {selectedCondition}</h3>
              <p className="text-xs text-gray-500 mb-3">Positive = Light REE (La-Eu), Negative = Heavy REE (Gd-Lu)</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={displayMutants.map((m, i) => ({
                    name: m.baseName,
                    score: m.lightHeavyScore,
                    color: getMutantColor(m.baseName, i),
                  }))}
                  margin={{ top: 20, right: 20, bottom: 40, left: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis domain={[-100, 100]} label={{ value: 'L/H Score', angle: -90, position: 'insideLeft' }} />
                  <Tooltip formatter={(v: number) => v.toFixed(1)} />
                  <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                  <Bar dataKey="score">
                    {displayMutants.map((m, i) => (
                      <Cell key={m.name} fill={m.lightHeavyScore >= 0 ? '#22c55e' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Top Selectivity */}
            <div className="bg-white border rounded-lg p-4">
              <h3 className="font-semibold mb-2">Top Element Selectivity - {selectedCondition}</h3>
              <p className="text-xs text-gray-500 mb-3">Maximum selectivity % for preferred element</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={displayMutants.map((m, i) => ({
                    name: m.baseName,
                    selectivity: m.topSelectivity,
                    element: m.topElement,
                    color: getMutantColor(m.baseName, i),
                  }))}
                  margin={{ top: 20, right: 20, bottom: 40, left: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis label={{ value: 'Selectivity (%)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Bar dataKey="selectivity">
                    {displayMutants.map((m, i) => (
                      <Cell key={m.name} fill={getMutantColor(m.baseName, i)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Selectivity Profile - Line Overlay */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-2">Selectivity Profiles - {selectedCondition}</h3>
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart
                data={elementsWithKex.map(e => {
                  const point: Record<string, string | number> = { element: e };
                  displayMutants.forEach(m => {
                    point[m.baseName] = m.selectivityProfile[e] ?? 0;
                  });
                  return point;
                })}
                margin={{ top: 20, right: 30, bottom: 40, left: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="element" />
                <YAxis label={{ value: 'Selectivity (%)', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                {displayMutants.map((m, i) => (
                  <Line
                    key={m.baseName}
                    type="monotone"
                    dataKey={m.baseName}
                    stroke={getMutantColor(m.baseName, i)}
                    strokeWidth={2}
                    dot={{ fill: getMutantColor(m.baseName, i), r: 4 }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Summary Table */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-4">Summary Statistics - {selectedCondition}</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left font-medium">Mutant</th>
                    <th className="px-3 py-2 text-right font-medium">n</th>
                    <th className="px-3 py-2 text-right font-medium">k_ex Slope</th>
                    <th className="px-3 py-2 text-right font-medium">R²</th>
                    <th className="px-3 py-2 text-right font-medium">p-value</th>
                    <th className="px-3 py-2 text-center font-medium">Top Element</th>
                    <th className="px-3 py-2 text-right font-medium">Top %</th>
                    <th className="px-3 py-2 text-right font-medium">L/H Score</th>
                  </tr>
                </thead>
                <tbody>
                  {displayMutants.map((m, i) => (
                    <tr key={m.name} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium" style={{ color: getMutantColor(m.baseName, i) }}>
                        {m.baseName}
                      </td>
                      <td className="px-3 py-2 text-right">{m.nReplicates}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {m.kexSlope.toFixed(3)} ± {m.kexSlopeError.toFixed(3)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{m.kexR2.toFixed(3)}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {m.kexPValue < 0.001 ? '<0.001' : m.kexPValue.toFixed(3)}
                      </td>
                      <td className="px-3 py-2 text-center font-medium" style={{ color: ELEMENT_COLORS[m.topElement] }}>
                        {m.topElement}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{m.topSelectivity.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span className={m.lightHeavyScore > 0 ? 'text-green-600' : 'text-red-600'}>
                          {m.lightHeavyScore > 0 ? '+' : ''}{m.lightHeavyScore.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Within-Mutant Mode - H2O vs ATC comparison */}
      {comparisonMode === 'within-mutant' && (
        <>
          {/* Paired Comparison Chart */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-2">H2O vs ATC Condition Comparison</h3>
            <p className="text-sm text-gray-500 mb-4">
              Comparing selectivity metrics between water and acetic acid conditions for each mutant
            </p>

            {/* k_ex Slope Comparison */}
            <div className="mb-6">
              <h4 className="text-sm font-medium mb-2">k_ex Slope: H2O (solid) vs ATC (striped)</h4>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={pairedMutantData.map(p => ({
                    name: p.baseName,
                    h2o: p.h2o?.kexSlope ?? 0,
                    atc: p.atc?.kexSlope ?? 0,
                    color: p.color,
                  }))}
                  margin={{ top: 20, right: 30, bottom: 40, left: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis label={{ value: 'k_ex Slope', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine y={0} stroke="#666" />
                  <Bar dataKey="h2o" name="H2O" fill="#0ea5e9" />
                  <Bar dataKey="atc" name="ATC" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* R² Comparison */}
            <div className="mb-6">
              <h4 className="text-sm font-medium mb-2">R² (Correlation Strength)</h4>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={pairedMutantData.map(p => ({
                    name: p.baseName,
                    h2o: p.h2o?.kexR2 ?? 0,
                    atc: p.atc?.kexR2 ?? 0,
                    color: p.color,
                  }))}
                  margin={{ top: 20, right: 30, bottom: 40, left: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 1]} label={{ value: 'R²', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="h2o" name="H2O" fill="#0ea5e9" />
                  <Bar dataKey="atc" name="ATC" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* L/H Score Comparison */}
            <div>
              <h4 className="text-sm font-medium mb-2">Light/Heavy REE Preference</h4>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={pairedMutantData.map(p => ({
                    name: p.baseName,
                    h2o: p.h2o?.lightHeavyScore ?? 0,
                    atc: p.atc?.lightHeavyScore ?? 0,
                  }))}
                  margin={{ top: 20, right: 30, bottom: 40, left: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                  <YAxis domain={[-100, 100]} label={{ value: 'L/H Score', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                  <Bar dataKey="h2o" name="H2O" fill="#0ea5e9" />
                  <Bar dataKey="atc" name="ATC" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Detailed Paired Table */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-4">Detailed Comparison Table</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left font-medium" rowSpan={2}>Mutant</th>
                    <th className="px-3 py-2 text-center font-medium bg-cyan-50" colSpan={4}>H2O</th>
                    <th className="px-3 py-2 text-center font-medium bg-amber-50" colSpan={4}>ATC</th>
                  </tr>
                  <tr className="bg-gray-50">
                    <th className="px-2 py-1 text-right text-xs bg-cyan-50">Slope</th>
                    <th className="px-2 py-1 text-right text-xs bg-cyan-50">R²</th>
                    <th className="px-2 py-1 text-center text-xs bg-cyan-50">Top</th>
                    <th className="px-2 py-1 text-right text-xs bg-cyan-50">L/H</th>
                    <th className="px-2 py-1 text-right text-xs bg-amber-50">Slope</th>
                    <th className="px-2 py-1 text-right text-xs bg-amber-50">R²</th>
                    <th className="px-2 py-1 text-center text-xs bg-amber-50">Top</th>
                    <th className="px-2 py-1 text-right text-xs bg-amber-50">L/H</th>
                  </tr>
                </thead>
                <tbody>
                  {pairedMutantData.map(p => (
                    <tr key={p.baseName} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium" style={{ color: p.color }}>
                        {p.baseName}
                      </td>
                      {/* H2O columns */}
                      <td className="px-2 py-1 text-right font-mono bg-cyan-50/30">
                        {p.h2o ? p.h2o.kexSlope.toFixed(2) : '-'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono bg-cyan-50/30">
                        {p.h2o ? p.h2o.kexR2.toFixed(2) : '-'}
                      </td>
                      <td className="px-2 py-1 text-center bg-cyan-50/30" style={{ color: p.h2o ? ELEMENT_COLORS[p.h2o.topElement] : undefined }}>
                        {p.h2o ? p.h2o.topElement : '-'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono bg-cyan-50/30">
                        {p.h2o ? (
                          <span className={p.h2o.lightHeavyScore > 0 ? 'text-green-600' : 'text-red-600'}>
                            {p.h2o.lightHeavyScore > 0 ? '+' : ''}{p.h2o.lightHeavyScore.toFixed(0)}
                          </span>
                        ) : '-'}
                      </td>
                      {/* ATC columns */}
                      <td className="px-2 py-1 text-right font-mono bg-amber-50/30">
                        {p.atc ? p.atc.kexSlope.toFixed(2) : '-'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono bg-amber-50/30">
                        {p.atc ? p.atc.kexR2.toFixed(2) : '-'}
                      </td>
                      <td className="px-2 py-1 text-center bg-amber-50/30" style={{ color: p.atc ? ELEMENT_COLORS[p.atc.topElement] : undefined }}>
                        {p.atc ? p.atc.topElement : '-'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono bg-amber-50/30">
                        {p.atc ? (
                          <span className={p.atc.lightHeavyScore > 0 ? 'text-green-600' : 'text-red-600'}>
                            {p.atc.lightHeavyScore > 0 ? '+' : ''}{p.atc.lightHeavyScore.toFixed(0)}
                          </span>
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Small Multiples - Selectivity Profiles per Mutant */}
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-4">Selectivity Profiles - H2O vs ATC per Mutant</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pairedMutantData.filter(p => p.h2o || p.atc).map(p => (
                <div key={p.baseName} className="border rounded p-3">
                  <h4 className="font-medium text-sm mb-2" style={{ color: p.color }}>{p.baseName}</h4>
                  <ResponsiveContainer width="100%" height={180}>
                    <ComposedChart
                      data={elementsWithKex.map(e => ({
                        element: e,
                        h2o: p.h2o?.selectivityProfile[e] ?? null,
                        atc: p.atc?.selectivityProfile[e] ?? null,
                      }))}
                      margin={{ top: 10, right: 10, bottom: 30, left: 30 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="element" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      {p.h2o && (
                        <Line
                          type="monotone"
                          dataKey="h2o"
                          stroke="#0ea5e9"
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          name="H2O"
                          connectNulls
                        />
                      )}
                      {p.atc && (
                        <Line
                          type="monotone"
                          dataKey="atc"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          name="ATC"
                          connectNulls
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
