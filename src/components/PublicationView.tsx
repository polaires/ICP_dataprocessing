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
  LinearRegressionResult,
  meanAndSE,
  combinedOutlierDetection,
  selectivityEntropy,
  lightHeavyDiscrimination,
  kexPreferenceStrength,
} from '@/lib/statistics';
import {
  ScatterChart,
  Scatter,
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
} from 'recharts';
import { Download } from 'lucide-react';

interface MutantSummary {
  name: string;
  selectivityProfile: Record<string, number>;
  kexSlope: number;
  kexSlopeError: number;
  kexR2: number;
  kexPValue: number;
  entropy: number;
  normalizedEntropy: number;
  lightHeavyScore: number;
  kexStrength: number;
  topElement: string;
  topSelectivity: number;
  isBinding: boolean;
  color: string;
}

// Generate distinct colors for mutants
const MUTANT_COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080',
  '#e6beff', '#9a6324', '#800000', '#aaffc3', '#808000',
  '#ffd8b1', '#000075', '#808080', '#000000', '#ffe119',
];

export function PublicationView() {
  const {
    processedData,
    replicateGroups,
    rawData,
    selectedSamples,
    bufferMeasurement,
  } = useDataStore();

  const [showOutliers, setShowOutliers] = useState(false);
  const [selectedMutants, setSelectedMutants] = useState<Set<string>>(new Set());
  const [colorMode, setColorMode] = useState<'mutant' | 'element'>('mutant');

  // Get elements with k_ex data
  const elementsWithKex = useMemo(() => {
    return (rawData?.elements || [])
      .filter(e => WATER_EXCHANGE_RATES[e] !== undefined)
      .sort((a, b) => LANTHANIDE_ORDER.indexOf(a) - LANTHANIDE_ORDER.indexOf(b));
  }, [rawData?.elements]);

  // Analyze all mutants
  const mutantSummaries = useMemo((): MutantSummary[] => {
    if (!rawData || elementsWithKex.length === 0) return [];

    const summaries: MutantSummary[] = [];
    let colorIndex = 0;

    for (const group of replicateGroups) {
      // Skip buffer
      if (group.measurements.some(m => m.id === bufferMeasurement?.id)) continue;

      // Filter to selected samples
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

      // Calculate mean selectivity profile
      const selectivityProfile: Record<string, number> = {};
      for (const element of elementsWithKex) {
        const values = validMeasurements.map(m => m.selectivity[element] ?? 0);
        const { mean } = meanAndSE(values);
        selectivityProfile[element] = mean;
      }

      // k_ex regression
      const kexValues = elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!);
      const bindingValues = elementsWithKex.map(e => selectivityProfile[e]);

      let kexSlope = 0, kexSlopeError = 0, kexR2 = 0, kexPValue = 1;

      if (isBinding && bindingValues.some(v => v > 0)) {
        const regression = linearRegression(kexValues, bindingValues);
        kexSlope = regression.slope;
        kexSlopeError = regression.standardError;
        kexR2 = regression.rSquared;
        kexPValue = regression.pValue;
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

      // k_ex strength
      const kexStrengthResult = kexPreferenceStrength(kexSlope, kexSlopeError, kexR2, kexPValue);

      summaries.push({
        name: group.baseName,
        selectivityProfile,
        kexSlope,
        kexSlopeError,
        kexR2,
        kexPValue,
        entropy: entropyResult.entropy,
        normalizedEntropy: entropyResult.normalizedEntropy,
        lightHeavyScore: lhResult.score,
        kexStrength: kexStrengthResult.strength,
        topElement: topEntry[0],
        topSelectivity: topEntry[1],
        isBinding,
        color: MUTANT_COLORS[colorIndex % MUTANT_COLORS.length],
      });

      colorIndex++;
    }

    return summaries;
  }, [rawData, elementsWithKex, replicateGroups, selectedSamples, bufferMeasurement, showOutliers]);

  // Filter to binding mutants or selected mutants
  const displayMutants = useMemo(() => {
    const binding = mutantSummaries.filter(m => m.isBinding);
    if (selectedMutants.size === 0) return binding;
    return binding.filter(m => selectedMutants.has(m.name));
  }, [mutantSummaries, selectedMutants]);

  // Toggle mutant selection
  const toggleMutant = (name: string) => {
    setSelectedMutants(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  // Select/deselect all
  const selectAll = () => {
    setSelectedMutants(new Set(mutantSummaries.filter(m => m.isBinding).map(m => m.name)));
  };

  const deselectAll = () => {
    setSelectedMutants(new Set());
  };

  // Prepare heatmap data
  const heatmapData = useMemo(() => {
    return elementsWithKex.map(element => {
      const row: Record<string, number | string> = { element };
      for (const mutant of displayMutants) {
        row[mutant.name] = mutant.selectivityProfile[element] ?? 0;
      }
      return row;
    });
  }, [displayMutants, elementsWithKex]);

  // Prepare k_ex scatter data
  const kexScatterData = useMemo(() => {
    const data: Array<{
      kex: number;
      element: string;
      [key: string]: number | string;
    }> = [];

    for (const element of elementsWithKex) {
      const point: Record<string, number | string> = {
        kex: WATER_EXCHANGE_RATES[element]!,
        element,
      };
      for (const mutant of displayMutants) {
        point[mutant.name] = mutant.selectivityProfile[element] ?? 0;
      }
      data.push(point as typeof data[number]);
    }

    return data;
  }, [displayMutants, elementsWithKex]);

  // Prepare metrics comparison data
  const metricsData = useMemo(() => {
    return displayMutants.map(m => ({
      name: m.name,
      'k_ex Slope': m.kexSlope,
      'R²': m.kexR2,
      'L/H Score': m.lightHeavyScore,
      'k_ex Strength': m.kexStrength,
      'Selectivity Breadth': 1 - m.normalizedEntropy,
      color: m.color,
    }));
  }, [displayMutants]);

  if (!rawData || mutantSummaries.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        No data available. Upload a CSV file to begin analysis.
      </div>
    );
  }

  const bindingMutants = mutantSummaries.filter(m => m.isBinding);

  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Publication View - All Mutants Comparison</h2>
        <div className="flex items-center gap-4">
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
      <div className="bg-gray-50 p-4 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium">Select Mutants ({bindingMutants.length} binding)</span>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              Select All
            </button>
            <button
              onClick={deselectAll}
              className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {bindingMutants.map(m => (
            <button
              key={m.name}
              onClick={() => toggleMutant(m.name)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                selectedMutants.size === 0 || selectedMutants.has(m.name)
                  ? 'text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
              style={{
                backgroundColor: selectedMutants.size === 0 || selectedMutants.has(m.name)
                  ? m.color
                  : undefined,
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {selectedMutants.size === 0
            ? `Showing all ${displayMutants.length} binding mutants`
            : `Showing ${displayMutants.length} selected mutants`}
        </p>
      </div>

      {/* 1. Selectivity Heatmap */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-semibold mb-4">Selectivity Profile Heatmap</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left font-medium">Element</th>
                {displayMutants.map(m => (
                  <th
                    key={m.name}
                    className="px-2 py-1 text-center font-medium"
                    style={{ color: m.color }}
                  >
                    {m.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {elementsWithKex.map(element => (
                <tr key={element} className="border-t">
                  <td className="px-2 py-1 font-medium" style={{ color: ELEMENT_COLORS[element] }}>
                    {element}
                  </td>
                  {displayMutants.map(m => {
                    const value = m.selectivityProfile[element] ?? 0;
                    // Color intensity based on value (0-20% range)
                    const intensity = Math.min(value / 20, 1);
                    const bgColor = `rgba(59, 130, 246, ${intensity * 0.8})`;
                    return (
                      <td
                        key={m.name}
                        className="px-2 py-1 text-center"
                        style={{
                          backgroundColor: bgColor,
                          color: intensity > 0.5 ? 'white' : 'black',
                        }}
                      >
                        {value.toFixed(1)}%
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. k_ex Correlation Plot - All Mutants */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-semibold mb-4">Water Exchange Rate (k_ex) Correlation - All Mutants</h3>
        <ResponsiveContainer width="100%" height={500}>
          <ComposedChart data={kexScatterData} margin={{ top: 20, right: 30, bottom: 60, left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="kex"
              type="number"
              domain={['dataMin - 0.5', 'dataMax + 0.5']}
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
                const data = payload[0]?.payload;
                return (
                  <div className="bg-white border rounded shadow-lg p-3 text-sm">
                    <p className="font-semibold">{data.element}</p>
                    <p className="text-gray-600">k_ex: {data.kex.toFixed(2)}</p>
                    <div className="mt-1 space-y-0.5">
                      {displayMutants.map(m => (
                        <p key={m.name} style={{ color: m.color }}>
                          {m.name}: {(data[m.name] as number)?.toFixed(1)}%
                        </p>
                      ))}
                    </div>
                  </div>
                );
              }}
            />
            <Legend verticalAlign="top" height={36} />

            {/* Regression lines for each mutant */}
            {displayMutants.map(mutant => {
              if (mutant.kexR2 < 0.1) return null;
              const minKex = Math.min(...elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!));
              const maxKex = Math.max(...elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!));
              const regression = linearRegression(
                elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!),
                elementsWithKex.map(e => mutant.selectivityProfile[e])
              );
              const lineData = [
                { kex: minKex, y: regression.intercept + regression.slope * minKex },
                { kex: maxKex, y: regression.intercept + regression.slope * maxKex },
              ];
              return (
                <Line
                  key={`line-${mutant.name}`}
                  data={lineData}
                  dataKey="y"
                  stroke={mutant.color}
                  strokeWidth={2}
                  dot={false}
                  name={`${mutant.name} (R²=${mutant.kexR2.toFixed(2)})`}
                  legendType="line"
                />
              );
            })}

            {/* Scatter points for each mutant */}
            {displayMutants.map(mutant => (
              <Scatter
                key={`scatter-${mutant.name}`}
                dataKey={mutant.name}
                fill={mutant.color}
                name={mutant.name}
                legendType="circle"
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 3. Metrics Comparison Bar Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* k_ex Slope Comparison */}
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold mb-4">k_ex Slope Comparison</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={metricsData} margin={{ top: 20, right: 20, bottom: 60, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="name"
                angle={-45}
                textAnchor="end"
                interval={0}
                height={60}
                tick={{ fontSize: 10 }}
              />
              <YAxis label={{ value: 'Slope', angle: -90, position: 'insideLeft' }} />
              <Tooltip />
              <ReferenceLine y={0} stroke="#666" />
              <Bar dataKey="k_ex Slope">
                {metricsData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* R² Comparison */}
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold mb-4">R² (Fit Quality) Comparison</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={metricsData} margin={{ top: 20, right: 20, bottom: 60, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="name"
                angle={-45}
                textAnchor="end"
                interval={0}
                height={60}
                tick={{ fontSize: 10 }}
              />
              <YAxis domain={[0, 1]} label={{ value: 'R²', angle: -90, position: 'insideLeft' }} />
              <Tooltip />
              <Bar dataKey="R²">
                {metricsData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Light/Heavy Score */}
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold mb-4">Light/Heavy REE Preference</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={metricsData} margin={{ top: 20, right: 20, bottom: 60, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="name"
                angle={-45}
                textAnchor="end"
                interval={0}
                height={60}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                domain={[-100, 100]}
                label={{ value: 'L/H Score', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip />
              <ReferenceLine y={0} stroke="#666" label="Balanced" />
              <Bar dataKey="L/H Score">
                {metricsData.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={entry['L/H Score'] > 0 ? '#22c55e' : '#ef4444'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Positive = Light REE preference (La-Eu) | Negative = Heavy REE preference (Gd-Lu)
          </p>
        </div>

        {/* Selectivity Breadth */}
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold mb-4">Selectivity Breadth (1 - Normalized Entropy)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={metricsData} margin={{ top: 20, right: 20, bottom: 60, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="name"
                angle={-45}
                textAnchor="end"
                interval={0}
                height={60}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                domain={[0, 1]}
                label={{ value: 'Selectivity', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip />
              <Bar dataKey="Selectivity Breadth">
                {metricsData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Higher = More selective (prefers fewer elements) | Lower = More promiscuous
          </p>
        </div>
      </div>

      {/* 4. Summary Table */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-semibold mb-4">Summary Statistics</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left font-medium">Mutant</th>
                <th className="px-3 py-2 text-right font-medium">k_ex Slope</th>
                <th className="px-3 py-2 text-right font-medium">R²</th>
                <th className="px-3 py-2 text-right font-medium">p-value</th>
                <th className="px-3 py-2 text-center font-medium">Top Element</th>
                <th className="px-3 py-2 text-right font-medium">Top Sel. %</th>
                <th className="px-3 py-2 text-right font-medium">L/H Score</th>
                <th className="px-3 py-2 text-right font-medium">Entropy</th>
              </tr>
            </thead>
            <tbody>
              {displayMutants.map(m => (
                <tr key={m.name} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium" style={{ color: m.color }}>
                    {m.name}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {m.kexSlope.toFixed(3)} ± {m.kexSlopeError.toFixed(3)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{m.kexR2.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {m.kexPValue < 0.001 ? '<0.001' : m.kexPValue.toFixed(3)}
                  </td>
                  <td
                    className="px-3 py-2 text-center font-medium"
                    style={{ color: ELEMENT_COLORS[m.topElement] }}
                  >
                    {m.topElement}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{m.topSelectivity.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right font-mono">
                    <span className={m.lightHeavyScore > 0 ? 'text-green-600' : 'text-red-600'}>
                      {m.lightHeavyScore > 0 ? '+' : ''}{m.lightHeavyScore.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{m.normalizedEntropy.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. Stacked Selectivity Profile */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-semibold mb-4">Selectivity Profiles Overlay</h3>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart
            data={elementsWithKex.map(e => {
              const point: Record<string, string | number> = { element: e };
              displayMutants.forEach(m => {
                point[m.name] = m.selectivityProfile[e] ?? 0;
              });
              return point;
            })}
            margin={{ top: 20, right: 30, bottom: 40, left: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="element" />
            <YAxis
              label={{ value: 'Selectivity (%)', angle: -90, position: 'insideLeft' }}
              domain={[0, 'auto']}
            />
            <Tooltip />
            <Legend />
            {displayMutants.map(m => (
              <Line
                key={m.name}
                type="monotone"
                dataKey={m.name}
                stroke={m.color}
                strokeWidth={2}
                dot={{ fill: m.color, r: 4 }}
                name={m.name}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
