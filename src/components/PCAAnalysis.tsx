'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
} from 'recharts';
import { Activity, TrendingUp, Layers, Info, AlertTriangle, RefreshCw, GitBranch, ArrowLeftRight } from 'lucide-react';
import {
  parseCoordinationSummary,
  aggregateMutantRuns,
  getFeatureVector,
  FEATURE_NAMES,
  type AggregatedMutantFeatures,
} from '@/lib/gromacsParser';
import { performPCA, getTopFeatures, type PCAResult } from '@/lib/pca';
import { useDataStore } from '@/store/useDataStore';
import { linearRegression } from '@/lib/statistics';
import { LIGHT_REE, HEAVY_REE, WATER_EXCHANGE_RATES } from '@/lib/constants';

// Mutant colors for consistent visualization
const MUTANT_COLORS: Record<string, string> = {
  Rub7: '#E53E3E',   // red
  Rub9: '#DD6B20',   // orange
  Rub10: '#D69E2E',  // yellow
  Rub11: '#38A169',  // green
  Rub12: '#319795',  // teal
  Rub13: '#3182CE',  // blue
  Rub14: '#805AD5',  // purple
  Rub15: '#D53F8C',  // pink
  Rub16: '#667EEA',  // indigo
  Rub17: '#ED64A6',  // rose
  Rub18: '#48BB78',  // green
  Rub20: '#9F7AEA',  // violet
};

interface LightHeavyAnalysis {
  lightSum: number;
  heavySum: number;
  lhScore: number; // -100 to +100, positive = light preference
  lightSlope: number;
  heavySlope: number;
  slopeDifference: number;
  verticalOffset: number; // at midpoint k_ex
  lightR2: number;
  heavyR2: number;
  hasGadoliniumBreak: boolean;
}

interface MutantPCAData {
  mutant: string;
  features: AggregatedMutantFeatures;
  pcaScores: number[];
  // Binding data from ICP
  totalBinding?: number;
  euSelectivity?: number;
  // Light/Heavy analysis
  lhAnalysis?: LightHeavyAnalysis;
}

export function PCAAnalysis() {
  const [gromacsData, setGromacsData] = useState<Map<string, AggregatedMutantFeatures>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPC1, setSelectedPC1] = useState(0);
  const [selectedPC2, setSelectedPC2] = useState(1);
  const [colorBy, setColorBy] = useState<'mutant' | 'euSelectivity' | 'waterExchange'>('mutant');

  const { replicateGroups } = useDataStore();

  // Load preprocessed GROMACS data
  useEffect(() => {
    async function loadGromacsData() {
      setIsLoading(true);
      setError(null);

      try {
        // Try to load preprocessed JSON file first (faster)
        const response = await fetch('/data/gromacs_features.json');
        if (response.ok) {
          const data = await response.json();
          const aggregatedData = new Map<string, AggregatedMutantFeatures>();
          for (const [mutant, features] of Object.entries(data)) {
            aggregatedData.set(mutant, features as AggregatedMutantFeatures);
          }
          setGromacsData(aggregatedData);
        } else {
          // Fallback: load individual files
          const mutants = ['Rub7', 'Rub9', 'Rub10', 'Rub11', 'Rub12', 'Rub13', 'Rub14', 'Rub15', 'Rub16', 'Rub17', 'Rub18', 'Rub20'];
          const runs = ['run1', 'run2', 'run3'];
          const aggregatedData = new Map<string, AggregatedMutantFeatures>();

          for (const mutant of mutants) {
            const runData: ReturnType<typeof parseCoordinationSummary>[] = [];

            for (const run of runs) {
              try {
                const resp = await fetch(`/data/analysis_results/${mutant}/${run}/eu3p_coordination_summary.txt`);
                if (resp.ok) {
                  const content = await resp.text();
                  const parsed = parseCoordinationSummary(content);
                  runData.push(parsed);
                }
              } catch {
                // Skip missing files
              }
            }

            if (runData.length > 0) {
              const aggregated = aggregateMutantRuns(runData);
              if (aggregated) {
                aggregated.mutant = mutant;
                aggregatedData.set(mutant, aggregated);
              }
            }
          }

          setGromacsData(aggregatedData);
        }
      } catch (err) {
        setError(`Failed to load GROMACS data: ${err}`);
      } finally {
        setIsLoading(false);
      }
    }

    loadGromacsData();
  }, []);

  // Get binding data from ICP measurements
  const bindingData = useMemo(() => {
    const data: Record<string, {
      totalBinding: number;
      euSelectivity: number;
      selectivityProfile: Record<string, number>;
    }> = {};

    for (const group of replicateGroups) {
      // Match mutant names (e.g., "Rub15-H2O" -> "Rub15")
      const match = group.baseName.match(/^(Rub\d+)/i);
      if (match) {
        const mutant = match[1];
        // Only consider H2O (water) conditions for binding comparison
        if (group.baseName.toLowerCase().includes('h2o')) {
          const totalMoles = Object.values(group.mean).reduce((sum, val) => sum + Math.max(0, val), 0);
          const euSelectivity = group.meanSelectivity['Eu'] ?? 0;

          if (!data[mutant] || totalMoles > data[mutant].totalBinding) {
            data[mutant] = {
              totalBinding: totalMoles,
              euSelectivity,
              selectivityProfile: { ...group.meanSelectivity }
            };
          }
        }
      }
    }

    return data;
  }, [replicateGroups]);

  // Calculate Light/Heavy REE analysis for each mutant
  const lhAnalysisData = useMemo(() => {
    const analyses: Record<string, LightHeavyAnalysis> = {};

    // Get k_ex midpoint for vertical offset calculation
    const kexValues = Object.values(WATER_EXCHANGE_RATES);
    const midpointKex = (Math.max(...kexValues) + Math.min(...kexValues)) / 2;

    for (const [mutant, data] of Object.entries(bindingData)) {
      const profile = data.selectivityProfile;

      // Calculate L/H sums
      const lightSum = LIGHT_REE.reduce((sum, el) => sum + Math.max(0, profile[el] ?? 0), 0);
      const heavySum = HEAVY_REE.reduce((sum, el) => sum + Math.max(0, profile[el] ?? 0), 0);
      const total = lightSum + heavySum;

      // L/H score: -100 (heavy) to +100 (light)
      const lhScore = total > 0 ? ((lightSum - heavySum) / total) * 100 : 0;

      // Prepare data for regression: selectivity vs k_ex
      const lightData: { kex: number; selectivity: number }[] = [];
      const heavyData: { kex: number; selectivity: number }[] = [];

      for (const el of LIGHT_REE) {
        if (profile[el] !== undefined && WATER_EXCHANGE_RATES[el] !== undefined) {
          lightData.push({ kex: WATER_EXCHANGE_RATES[el], selectivity: profile[el] });
        }
      }

      for (const el of HEAVY_REE) {
        if (profile[el] !== undefined && WATER_EXCHANGE_RATES[el] !== undefined) {
          heavyData.push({ kex: WATER_EXCHANGE_RATES[el], selectivity: profile[el] });
        }
      }

      // Linear regression for light and heavy REEs
      const lightRegression = lightData.length >= 2
        ? linearRegression(lightData.map(d => d.kex), lightData.map(d => d.selectivity))
        : null;
      const heavyRegression = heavyData.length >= 2
        ? linearRegression(heavyData.map(d => d.kex), heavyData.map(d => d.selectivity))
        : null;

      const lightSlope = lightRegression?.slope ?? 0;
      const heavySlope = heavyRegression?.slope ?? 0;
      const slopeDifference = heavySlope - lightSlope;

      // Calculate vertical offset at midpoint
      const lightYAtMid = lightRegression
        ? lightRegression.intercept + lightSlope * midpointKex
        : 0;
      const heavyYAtMid = heavyRegression
        ? heavyRegression.intercept + heavySlope * midpointKex
        : 0;
      const verticalOffset = heavyYAtMid - lightYAtMid;

      // Determine if there's a significant Gadolinium break
      const hasGadoliniumBreak = Math.abs(slopeDifference) > 0.5 || Math.abs(verticalOffset) > 3;

      analyses[mutant] = {
        lightSum,
        heavySum,
        lhScore,
        lightSlope,
        heavySlope,
        slopeDifference,
        verticalOffset,
        lightR2: lightRegression?.rSquared ?? 0,
        heavyR2: heavyRegression?.rSquared ?? 0,
        hasGadoliniumBreak,
      };
    }

    return analyses;
  }, [bindingData]);

  // Perform PCA on GROMACS features
  const pcaResult = useMemo((): PCAResult | null => {
    if (gromacsData.size < 3) return null;

    const mutantList = Array.from(gromacsData.entries());
    const featureMatrix = mutantList.map(([_, features]) => getFeatureVector(features));

    return performPCA(featureMatrix);
  }, [gromacsData]);

  // Combined data for visualization
  const combinedData = useMemo((): MutantPCAData[] => {
    if (!pcaResult) return [];

    const mutantList = Array.from(gromacsData.entries());
    return mutantList.map(([mutant, features], idx) => ({
      mutant,
      features,
      pcaScores: pcaResult.transformedData[idx] || [],
      totalBinding: bindingData[mutant]?.totalBinding,
      euSelectivity: bindingData[mutant]?.euSelectivity,
      lhAnalysis: lhAnalysisData[mutant],
    }));
  }, [gromacsData, pcaResult, bindingData, lhAnalysisData]);

  // Top features per component
  const topFeatures = useMemo(() => {
    if (!pcaResult) return [];
    return getTopFeatures(pcaResult, FEATURE_NAMES, 5);
  }, [pcaResult]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex items-center gap-3 text-gray-500">
          <RefreshCw className="w-6 h-6 animate-spin" />
          <span>Loading GROMACS simulation data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex items-center gap-3 text-red-600">
          <AlertTriangle className="w-6 h-6" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (gromacsData.size === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertTriangle className="w-12 h-12 text-yellow-500" />
        <p className="text-gray-600">No GROMACS simulation data found.</p>
        <p className="text-sm text-gray-500">
          Please ensure analysis_results directory contains mutant simulation data.
        </p>
      </div>
    );
  }

  if (!pcaResult || pcaResult.nComponents < 2) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex items-center gap-3 text-yellow-600">
          <AlertTriangle className="w-6 h-6" />
          <span>Insufficient data for PCA (need at least 3 mutants)</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="w-6 h-6 text-purple-600" />
            PCA: GROMACS Simulation Features
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Structure-function relationship analysis of {gromacsData.size} mutants
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div>
            <label className="text-xs text-gray-500 block">Color by</label>
            <select
              value={colorBy}
              onChange={e => setColorBy(e.target.value as 'mutant' | 'euSelectivity' | 'waterExchange')}
              className="text-sm border rounded px-2 py-1"
            >
              <option value="mutant">Mutant</option>
              <option value="euSelectivity">Eu Selectivity</option>
              <option value="waterExchange">Water Exchange Rate</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block">X-axis</label>
            <select
              value={selectedPC1}
              onChange={e => setSelectedPC1(parseInt(e.target.value))}
              className="text-sm border rounded px-2 py-1"
            >
              {pcaResult.explainedVarianceRatio.map((_, i) => (
                <option key={i} value={i}>
                  PC{i + 1} ({(pcaResult.explainedVarianceRatio[i] * 100).toFixed(1)}%)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block">Y-axis</label>
            <select
              value={selectedPC2}
              onChange={e => setSelectedPC2(parseInt(e.target.value))}
              className="text-sm border rounded px-2 py-1"
            >
              {pcaResult.explainedVarianceRatio.map((_, i) => (
                <option key={i} value={i}>
                  PC{i + 1} ({(pcaResult.explainedVarianceRatio[i] * 100).toFixed(1)}%)
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-purple-50 rounded-lg p-4">
          <div className="text-sm text-purple-600 font-medium">Mutants Analyzed</div>
          <div className="text-2xl font-bold text-purple-900">{gromacsData.size}</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="text-sm text-blue-600 font-medium">Features</div>
          <div className="text-2xl font-bold text-blue-900">{FEATURE_NAMES.length}</div>
        </div>
        <div className="bg-green-50 rounded-lg p-4">
          <div className="text-sm text-green-600 font-medium">PC1 Variance</div>
          <div className="text-2xl font-bold text-green-900">
            {(pcaResult.explainedVarianceRatio[0] * 100).toFixed(1)}%
          </div>
        </div>
        <div className="bg-orange-50 rounded-lg p-4">
          <div className="text-sm text-orange-600 font-medium">PC1+PC2 Variance</div>
          <div className="text-2xl font-bold text-orange-900">
            {(pcaResult.cumulativeVarianceRatio[1] * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Main PCA Scatter Plot */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Layers className="w-5 h-5 text-purple-600" />
          PCA Biplot
        </h3>
        <ResponsiveContainer width="100%" height={500}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name={`PC${selectedPC1 + 1}`}
              domain={['auto', 'auto']}
              label={{
                value: `PC${selectedPC1 + 1} (${(pcaResult.explainedVarianceRatio[selectedPC1] * 100).toFixed(1)}%)`,
                position: 'bottom',
                offset: 40,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={`PC${selectedPC2 + 1}`}
              domain={['auto', 'auto']}
              label={{
                value: `PC${selectedPC2 + 1} (${(pcaResult.explainedVarianceRatio[selectedPC2] * 100).toFixed(1)}%)`,
                angle: -90,
                position: 'insideLeft',
                offset: -40,
              }}
            />
            <Tooltip
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const data = payload[0].payload as MutantPCAData & { x: number; y: number };
                return (
                  <div className="bg-white border rounded shadow-lg p-3 text-sm">
                    <div className="font-bold text-gray-900">{data.mutant}</div>
                    <div className="text-gray-600">
                      PC{selectedPC1 + 1}: {data.x.toFixed(3)}
                    </div>
                    <div className="text-gray-600">
                      PC{selectedPC2 + 1}: {data.y.toFixed(3)}
                    </div>
                    {data.euSelectivity !== undefined && (
                      <div className="text-purple-600">
                        Eu Selectivity: {data.euSelectivity.toFixed(1)}%
                      </div>
                    )}
                    <div className="text-blue-600">
                      Water Exchange: {data.features.water_exchange_rate.toFixed(2)} events/ns
                    </div>
                  </div>
                );
              }}
            />
            <Scatter
              data={combinedData.map(d => ({
                ...d,
                x: d.pcaScores[selectedPC1] || 0,
                y: d.pcaScores[selectedPC2] || 0,
              }))}
            >
              {combinedData.map((entry, index) => {
                let fill = MUTANT_COLORS[entry.mutant] || '#888';
                if (colorBy === 'euSelectivity' && entry.euSelectivity !== undefined) {
                  const intensity = Math.min(entry.euSelectivity / 30, 1);
                  fill = `rgba(139, 92, 246, ${0.3 + intensity * 0.7})`;
                } else if (colorBy === 'waterExchange') {
                  const intensity = Math.min(entry.features.water_exchange_rate / 7, 1);
                  fill = `rgba(59, 130, 246, ${0.3 + intensity * 0.7})`;
                }
                return <Cell key={`cell-${index}`} fill={fill} />;
              })}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-3 mt-4">
          {combinedData.map(d => (
            <div key={d.mutant} className="flex items-center gap-1.5 text-sm">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: MUTANT_COLORS[d.mutant] || '#888' }}
              />
              <span>{d.mutant}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Explained Variance & Top Features */}
      <div className="grid grid-cols-2 gap-6">
        {/* Scree Plot */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            Explained Variance (Scree Plot)
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={pcaResult.explainedVarianceRatio.map((ratio, i) => ({
                pc: `PC${i + 1}`,
                variance: ratio * 100,
                cumulative: pcaResult.cumulativeVarianceRatio[i] * 100,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="pc" />
              <YAxis domain={[0, 100]} />
              <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
              <Legend />
              <Bar dataKey="variance" name="Individual %" fill="#8884d8" />
              <Line
                type="monotone"
                dataKey="cumulative"
                name="Cumulative %"
                stroke="#82ca9d"
                strokeWidth={2}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top Features for PC1 */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Info className="w-5 h-5 text-green-600" />
            Top Contributing Features (PC1)
          </h3>
          {topFeatures[0] && (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart
                data={topFeatures[0].features.map(f => ({
                  name: f.name.length > 15 ? f.name.slice(0, 15) + '...' : f.name,
                  fullName: f.name,
                  loading: f.loading,
                }))}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={['auto', 'auto']} />
                <YAxis type="category" dataKey="name" width={120} />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload || payload.length === 0) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white border rounded shadow-lg p-2 text-sm">
                        <div className="font-medium">{data.fullName}</div>
                        <div>Loading: {data.loading.toFixed(3)}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="loading">
                  {topFeatures[0].features.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.loading > 0 ? '#10B981' : '#EF4444'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Feature Comparison Radar */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-semibold text-gray-900 mb-4">
          Feature Profile Comparison (Normalized)
        </h3>
        <ResponsiveContainer width="100%" height={400}>
          <RadarChart data={FEATURE_NAMES.slice(0, 10).map((name, i) => {
            const dataPoint: Record<string, string | number> = { feature: name.slice(0, 12) };
            combinedData.forEach(d => {
              const vec = getFeatureVector(d.features);
              // Normalize to 0-100 range for visualization
              const allVals = combinedData.map(cd => getFeatureVector(cd.features)[i]);
              const min = Math.min(...allVals);
              const max = Math.max(...allVals);
              dataPoint[d.mutant] = max > min ? ((vec[i] - min) / (max - min)) * 100 : 50;
            });
            return dataPoint;
          })}>
            <PolarGrid />
            <PolarAngleAxis dataKey="feature" tick={{ fontSize: 10 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} />
            {combinedData.slice(0, 6).map(d => (
              <Radar
                key={d.mutant}
                name={d.mutant}
                dataKey={d.mutant}
                stroke={MUTANT_COLORS[d.mutant] || '#888'}
                fill={MUTANT_COLORS[d.mutant] || '#888'}
                fillOpacity={0.1}
              />
            ))}
            <Legend />
          </RadarChart>
        </ResponsiveContainer>
        <p className="text-xs text-gray-500 text-center mt-2">
          Showing first 6 mutants for clarity. Values normalized to 0-100 scale.
        </p>
      </div>

      {/* Feature Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <h3 className="font-semibold text-gray-900 p-4 border-b">
          GROMACS Feature Summary
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Mutant</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">Total Coord</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">Water Coord</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">Protein Coord</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">Binding Vol</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">k_ex (events/ns)</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">Residence Time</th>
                <th className="px-4 py-2 text-center font-medium text-gray-600">Geometry</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">Eu Selectivity</th>
              </tr>
            </thead>
            <tbody>
              {combinedData.map(d => (
                <tr key={d.mutant} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2"
                      style={{ backgroundColor: MUTANT_COLORS[d.mutant] }}
                    />
                    {d.mutant}
                  </td>
                  <td className="px-4 py-2 text-right">{d.features.total_coord_mean.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">{d.features.water_coord_mean.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">{d.features.protein_coord_mean.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">{d.features.binding_volume_mean.toFixed(1)}</td>
                  <td className="px-4 py-2 text-right">{d.features.water_exchange_rate.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">{d.features.residence_time_mean.toFixed(1)}</td>
                  <td className="px-4 py-2 text-center text-xs">
                    {d.features.dominant_geometry.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {d.euSelectivity !== undefined ? `${d.euSelectivity.toFixed(1)}%` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Correlation with Binding */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-semibold text-gray-900 mb-4">
          Structure-Function Correlations
        </h3>
        <div className="grid grid-cols-2 gap-6">
          {/* Water Exchange vs Eu Selectivity */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Water Exchange Rate vs Eu Selectivity
            </h4>
            <ResponsiveContainer width="100%" height={250}>
              <ScatterChart margin={{ top: 10, right: 30, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Water Exchange Rate"
                  label={{ value: 'Water Exchange (events/ns)', position: 'bottom', offset: 25 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Eu Selectivity"
                  label={{ value: 'Eu Selectivity (%)', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload || payload.length === 0) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white border rounded shadow-lg p-2 text-sm">
                        <div className="font-medium">{data.mutant}</div>
                        <div>k_ex: {data.x.toFixed(2)} events/ns</div>
                        <div>Eu: {data.y.toFixed(1)}%</div>
                      </div>
                    );
                  }}
                />
                <Scatter
                  data={combinedData
                    .filter(d => d.euSelectivity !== undefined)
                    .map(d => ({
                      mutant: d.mutant,
                      x: d.features.water_exchange_rate,
                      y: d.euSelectivity,
                    }))}
                >
                  {combinedData
                    .filter(d => d.euSelectivity !== undefined)
                    .map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={MUTANT_COLORS[entry.mutant] || '#888'} />
                    ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Binding Volume vs Eu Selectivity */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Binding Site Volume vs Eu Selectivity
            </h4>
            <ResponsiveContainer width="100%" height={250}>
              <ScatterChart margin={{ top: 10, right: 30, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Binding Volume"
                  label={{ value: 'Binding Volume (Å³)', position: 'bottom', offset: 25 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Eu Selectivity"
                  label={{ value: 'Eu Selectivity (%)', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload || payload.length === 0) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white border rounded shadow-lg p-2 text-sm">
                        <div className="font-medium">{data.mutant}</div>
                        <div>Volume: {data.x.toFixed(1)} Å³</div>
                        <div>Eu: {data.y.toFixed(1)}%</div>
                      </div>
                    );
                  }}
                />
                <Scatter
                  data={combinedData
                    .filter(d => d.euSelectivity !== undefined)
                    .map(d => ({
                      mutant: d.mutant,
                      x: d.features.binding_volume_mean,
                      y: d.euSelectivity,
                    }))}
                >
                  {combinedData
                    .filter(d => d.euSelectivity !== undefined)
                    .map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={MUTANT_COLORS[entry.mutant] || '#888'} />
                    ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Light/Heavy REE Analysis Section */}
      {Object.keys(lhAnalysisData).length > 0 && (
        <>
          {/* L/H Score and Slope Analysis */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-indigo-600" />
              Light/Heavy REE Discrimination Analysis
            </h3>

            {/* Summary metrics */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-xs text-blue-600 font-medium">Light REE</div>
                <div className="text-sm text-blue-800">La, Ce, Pr, Nd, Sm, Eu</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-3">
                <div className="text-xs text-orange-600 font-medium">Heavy REE</div>
                <div className="text-sm text-orange-800">Gd, Tb, Dy, Ho, Er, Tm, Yb, Lu</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <div className="text-xs text-purple-600 font-medium">L/H Score Range</div>
                <div className="text-sm text-purple-800">-100 (Heavy) to +100 (Light)</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <div className="text-xs text-green-600 font-medium">Gadolinium Break</div>
                <div className="text-sm text-green-800">Slope diff or offset at Gd</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* L/H Score Bar Chart */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  L/H Discrimination Score by Mutant
                </h4>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={combinedData
                      .filter(d => d.lhAnalysis)
                      .map(d => ({
                        mutant: d.mutant,
                        lhScore: d.lhAnalysis!.lhScore,
                        lightSum: d.lhAnalysis!.lightSum,
                        heavySum: d.lhAnalysis!.heavySum,
                      }))
                      .sort((a, b) => b.lhScore - a.lhScore)}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[-50, 50]} />
                    <YAxis type="category" dataKey="mutant" width={60} />
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload || payload.length === 0) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white border rounded shadow-lg p-2 text-sm">
                            <div className="font-bold">{data.mutant}</div>
                            <div className="text-blue-600">Light: {data.lightSum.toFixed(1)}%</div>
                            <div className="text-orange-600">Heavy: {data.heavySum.toFixed(1)}%</div>
                            <div className={data.lhScore > 0 ? 'text-blue-700' : 'text-orange-700'}>
                              L/H Score: {data.lhScore.toFixed(1)}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="lhScore" name="L/H Score">
                      {combinedData
                        .filter(d => d.lhAnalysis)
                        .sort((a, b) => b.lhAnalysis!.lhScore - a.lhAnalysis!.lhScore)
                        .map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={entry.lhAnalysis!.lhScore > 0 ? '#3B82F6' : '#F97316'}
                          />
                        ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-500 text-center mt-1">
                  Positive = Light REE preference | Negative = Heavy REE preference
                </p>
              </div>

              {/* Slope Comparison */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  Light vs Heavy REE Slope (Selectivity vs k_ex)
                </h4>
                <ResponsiveContainer width="100%" height={300}>
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="lightSlope"
                      name="Light REE Slope"
                      domain={['auto', 'auto']}
                      label={{ value: 'Light REE Slope', position: 'bottom', offset: 0 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="heavySlope"
                      name="Heavy REE Slope"
                      domain={['auto', 'auto']}
                      label={{ value: 'Heavy REE Slope', angle: -90, position: 'insideLeft' }}
                    />
                    {/* Diagonal reference line (equal slopes) */}
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload || payload.length === 0) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white border rounded shadow-lg p-2 text-sm">
                            <div className="font-bold">{data.mutant}</div>
                            <div className="text-blue-600">Light Slope: {data.lightSlope.toFixed(3)}</div>
                            <div className="text-orange-600">Heavy Slope: {data.heavySlope.toFixed(3)}</div>
                            <div className="text-purple-600">
                              Diff: {(data.heavySlope - data.lightSlope).toFixed(3)}
                            </div>
                            {data.hasBreak && (
                              <div className="text-red-600 font-medium">Gadolinium Break Detected</div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Scatter
                      data={combinedData
                        .filter(d => d.lhAnalysis)
                        .map(d => ({
                          mutant: d.mutant,
                          lightSlope: d.lhAnalysis!.lightSlope,
                          heavySlope: d.lhAnalysis!.heavySlope,
                          hasBreak: d.lhAnalysis!.hasGadoliniumBreak,
                        }))}
                    >
                      {combinedData
                        .filter(d => d.lhAnalysis)
                        .map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={entry.lhAnalysis!.hasGadoliniumBreak ? '#EF4444' : MUTANT_COLORS[entry.mutant] || '#888'}
                            stroke={entry.lhAnalysis!.hasGadoliniumBreak ? '#B91C1C' : 'none'}
                            strokeWidth={entry.lhAnalysis!.hasGadoliniumBreak ? 2 : 0}
                          />
                        ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-500 text-center mt-1">
                  Points above diagonal: Heavy REE more k_ex dependent | Red = Gadolinium break
                </p>
              </div>
            </div>
          </div>

          {/* Vertical Offset and Gadolinium Break Analysis */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-purple-600" />
              Vertical Offset & Gadolinium Break Analysis
            </h3>

            <div className="grid grid-cols-2 gap-6">
              {/* Vertical Offset Chart */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  Vertical Offset at Midpoint k_ex
                </h4>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={combinedData
                      .filter(d => d.lhAnalysis)
                      .map(d => ({
                        mutant: d.mutant,
                        offset: d.lhAnalysis!.verticalOffset,
                        hasBreak: d.lhAnalysis!.hasGadoliniumBreak,
                      }))
                      .sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="mutant" />
                    <YAxis
                      label={{ value: 'Offset (%)', angle: -90, position: 'insideLeft' }}
                    />
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload || payload.length === 0) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white border rounded shadow-lg p-2 text-sm">
                            <div className="font-bold">{data.mutant}</div>
                            <div>Vertical Offset: {data.offset.toFixed(2)}%</div>
                            <div className="text-gray-500 text-xs">
                              {data.offset > 0 ? 'Heavy REE regression line above Light' : 'Light REE regression line above Heavy'}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="offset" name="Vertical Offset">
                      {combinedData
                        .filter(d => d.lhAnalysis)
                        .sort((a, b) => Math.abs(b.lhAnalysis!.verticalOffset) - Math.abs(a.lhAnalysis!.verticalOffset))
                        .map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={entry.lhAnalysis!.verticalOffset > 0 ? '#F97316' : '#3B82F6'}
                          />
                        ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-500 text-center mt-1">
                  Orange = Heavy higher | Blue = Light higher
                </p>
              </div>

              {/* Slope Difference Chart */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  Slope Difference (Heavy - Light)
                </h4>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={combinedData
                      .filter(d => d.lhAnalysis)
                      .map(d => ({
                        mutant: d.mutant,
                        slopeDiff: d.lhAnalysis!.slopeDifference,
                        hasBreak: d.lhAnalysis!.hasGadoliniumBreak,
                      }))
                      .sort((a, b) => b.slopeDiff - a.slopeDiff)}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="mutant" />
                    <YAxis
                      label={{ value: 'Slope Diff', angle: -90, position: 'insideLeft' }}
                    />
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload || payload.length === 0) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white border rounded shadow-lg p-2 text-sm">
                            <div className="font-bold">{data.mutant}</div>
                            <div>Slope Difference: {data.slopeDiff.toFixed(3)}</div>
                            <div className="text-gray-500 text-xs">
                              {data.slopeDiff > 0
                                ? 'Heavy REE more k_ex sensitive'
                                : 'Light REE more k_ex sensitive'}
                            </div>
                            {data.hasBreak && (
                              <div className="text-red-600 font-medium mt-1">Gadolinium Break</div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="slopeDiff" name="Slope Difference">
                      {combinedData
                        .filter(d => d.lhAnalysis)
                        .sort((a, b) => b.lhAnalysis!.slopeDifference - a.lhAnalysis!.slopeDifference)
                        .map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={entry.lhAnalysis!.hasGadoliniumBreak ? '#EF4444' : '#8B5CF6'}
                          />
                        ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-500 text-center mt-1">
                  Positive = Heavy REE steeper slope | Red = significant break
                </p>
              </div>
            </div>
          </div>

          {/* Detailed L/H Analysis Table */}
          <div className="bg-white rounded-lg border overflow-hidden">
            <h3 className="font-semibold text-gray-900 p-4 border-b">
              Light/Heavy REE Analysis Summary
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Mutant</th>
                    <th className="px-4 py-2 text-right font-medium text-blue-600">Light %</th>
                    <th className="px-4 py-2 text-right font-medium text-orange-600">Heavy %</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">L/H Score</th>
                    <th className="px-4 py-2 text-right font-medium text-blue-600">Light Slope</th>
                    <th className="px-4 py-2 text-right font-medium text-orange-600">Heavy Slope</th>
                    <th className="px-4 py-2 text-right font-medium text-purple-600">Slope Diff</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Vertical Offset</th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">Light R²</th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">Heavy R²</th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">Gd Break</th>
                  </tr>
                </thead>
                <tbody>
                  {combinedData
                    .filter(d => d.lhAnalysis)
                    .sort((a, b) => b.lhAnalysis!.lhScore - a.lhAnalysis!.lhScore)
                    .map(d => (
                      <tr key={d.mutant} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">
                          <span
                            className="inline-block w-2 h-2 rounded-full mr-2"
                            style={{ backgroundColor: MUTANT_COLORS[d.mutant] }}
                          />
                          {d.mutant}
                        </td>
                        <td className="px-4 py-2 text-right text-blue-600">
                          {d.lhAnalysis!.lightSum.toFixed(1)}%
                        </td>
                        <td className="px-4 py-2 text-right text-orange-600">
                          {d.lhAnalysis!.heavySum.toFixed(1)}%
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className={`font-medium ${d.lhAnalysis!.lhScore > 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                            {d.lhAnalysis!.lhScore > 0 ? '+' : ''}{d.lhAnalysis!.lhScore.toFixed(1)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-blue-600">
                          {d.lhAnalysis!.lightSlope.toFixed(3)}
                        </td>
                        <td className="px-4 py-2 text-right text-orange-600">
                          {d.lhAnalysis!.heavySlope.toFixed(3)}
                        </td>
                        <td className="px-4 py-2 text-right text-purple-600">
                          {d.lhAnalysis!.slopeDifference > 0 ? '+' : ''}{d.lhAnalysis!.slopeDifference.toFixed(3)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {d.lhAnalysis!.verticalOffset > 0 ? '+' : ''}{d.lhAnalysis!.verticalOffset.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={d.lhAnalysis!.lightR2 > 0.5 ? 'text-green-600' : 'text-gray-500'}>
                            {d.lhAnalysis!.lightR2.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={d.lhAnalysis!.heavyR2 > 0.5 ? 'text-green-600' : 'text-gray-500'}>
                            {d.lhAnalysis!.heavyR2.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-center">
                          {d.lhAnalysis!.hasGadoliniumBreak ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              Yes
                            </span>
                          ) : (
                            <span className="text-gray-400">No</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Interpretation Guide */}
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 p-4">
            <h4 className="font-semibold text-indigo-900 mb-3">Interpretation Guide</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="font-medium text-indigo-800 mb-1">L/H Score</div>
                <ul className="text-indigo-700 space-y-1">
                  <li>• <span className="text-blue-600 font-medium">Positive (+)</span>: Prefers Light REE (La-Eu)</li>
                  <li>• <span className="text-orange-600 font-medium">Negative (-)</span>: Prefers Heavy REE (Gd-Lu)</li>
                  <li>• Near 0: Balanced binding</li>
                </ul>
              </div>
              <div>
                <div className="font-medium text-indigo-800 mb-1">Slope Difference</div>
                <ul className="text-indigo-700 space-y-1">
                  <li>• <span className="font-medium">Positive</span>: Heavy REE more sensitive to k_ex</li>
                  <li>• <span className="font-medium">Negative</span>: Light REE more sensitive to k_ex</li>
                  <li>• Large |diff|: Strong Gadolinium break effect</li>
                </ul>
              </div>
              <div>
                <div className="font-medium text-indigo-800 mb-1">Vertical Offset</div>
                <ul className="text-indigo-700 space-y-1">
                  <li>• Positive: Heavy REE regression above Light</li>
                  <li>• Negative: Light REE regression above Heavy</li>
                  <li>• Indicates baseline preference independent of k_ex</li>
                </ul>
              </div>
              <div>
                <div className="font-medium text-indigo-800 mb-1">Gadolinium Break</div>
                <ul className="text-indigo-700 space-y-1">
                  <li>• Flagged when slope diff &gt; 0.5 or |offset| &gt; 3</li>
                  <li>• Indicates different binding mechanism for L vs H</li>
                  <li>• May relate to 4f electron configuration changes</li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
