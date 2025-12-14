'use client';

import { useMemo, useState } from 'react';
import { useDataStore } from '@/store/useDataStore';
import {
  LANTHANIDE_ORDER,
  LIGHT_REE,
  HEAVY_REE,
  WATER_EXCHANGE_RATES,
  UNPAIRED_ELECTRONS,
  IONIC_RADII_PM,
} from '@/lib/constants';
import { linearRegression, meanAndSE } from '@/lib/statistics';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ZAxis,
  Cell,
} from 'recharts';
import { Info, TrendingUp } from 'lucide-react';

interface DataPoint {
  element: string;
  kEx: number;
  binding: number;
  bindingError: number;
  ionicRadius: number;
  unpairedElectrons: number;
  isLight: boolean;
  replicateValues?: number[];
}

// Color scale for unpaired electrons (plasma-like)
const getUnpairedElectronColor = (n: number): string => {
  const colors = [
    '#0d0887', // 0
    '#46039f', // 1
    '#7201a8', // 2
    '#9c179e', // 3
    '#bd3786', // 4
    '#d8576b', // 5
    '#ed7953', // 6
    '#fb9f3a', // 7
  ];
  return colors[Math.min(n, 7)];
};

export function WaterExchangeAnalysis() {
  const { processedData, replicateGroups, rawData, selectedSamples, bufferMeasurement } =
    useDataStore();

  const [selectedSample, setSelectedSample] = useState<string | null>(null);
  const [useReplicateMean, setUseReplicateMean] = useState(true);
  const [colorBy, setColorBy] = useState<'series' | 'unpaired'>('series');
  const [sizeBy, setSizeBy] = useState<'radius' | 'fixed'>('radius');
  const [showFitLines, setShowFitLines] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [yAxisType, setYAxisType] = useState<'selectivity' | 'molarity'>('selectivity');

  // Get available samples (excluding buffer)
  const availableSamples = useMemo(() => {
    return processedData.filter(
      m => selectedSamples.includes(m.id) && m.id !== bufferMeasurement?.id
    );
  }, [processedData, selectedSamples, bufferMeasurement]);

  // Get available replicate groups
  const availableGroups = useMemo(() => {
    return replicateGroups.filter(
      g =>
        g.measurements.length > 0 &&
        !g.measurements.some(m => m.id === bufferMeasurement?.id)
    );
  }, [replicateGroups, bufferMeasurement]);

  // Elements that have water exchange rate data
  const elementsWithKex = useMemo(() => {
    return (rawData?.elements || []).filter(e => WATER_EXCHANGE_RATES[e] !== undefined);
  }, [rawData?.elements]);

  // Build data points for the selected sample or group
  const dataPoints = useMemo((): DataPoint[] => {
    if (!selectedSample) return [];

    const points: DataPoint[] = [];

    // Check if it's a replicate group
    const group = availableGroups.find(g => g.baseName === selectedSample);

    if (group && useReplicateMean) {
      // Use replicate group mean
      for (const element of elementsWithKex) {
        const kEx = WATER_EXCHANGE_RATES[element];
        if (kEx === undefined) continue;

        const replicateValues = group.measurements.map(m =>
          yAxisType === 'selectivity'
            ? m.selectivity[element] ?? 0
            : m.normalizedMolarity[element] ?? 0
        );

        const { mean, se } = meanAndSE(replicateValues);

        points.push({
          element,
          kEx,
          binding: mean,
          bindingError: se,
          ionicRadius: IONIC_RADII_PM[element] ?? 90,
          unpairedElectrons: UNPAIRED_ELECTRONS[element] ?? 0,
          isLight: LIGHT_REE.includes(element),
          replicateValues,
        });
      }
    } else {
      // Use single sample
      const sample = availableSamples.find(
        m => m.id === selectedSample || m.displayName === selectedSample
      );

      if (sample) {
        for (const element of elementsWithKex) {
          const kEx = WATER_EXCHANGE_RATES[element];
          if (kEx === undefined) continue;

          const binding =
            yAxisType === 'selectivity'
              ? sample.selectivity[element] ?? 0
              : sample.normalizedMolarity[element] ?? 0;

          points.push({
            element,
            kEx,
            binding,
            bindingError: 0,
            ionicRadius: IONIC_RADII_PM[element] ?? 90,
            unpairedElectrons: UNPAIRED_ELECTRONS[element] ?? 0,
            isLight: LIGHT_REE.includes(element),
          });
        }
      }
    }

    return points.sort(
      (a, b) => LANTHANIDE_ORDER.indexOf(a.element) - LANTHANIDE_ORDER.indexOf(b.element)
    );
  }, [
    selectedSample,
    availableGroups,
    availableSamples,
    useReplicateMean,
    elementsWithKex,
    yAxisType,
  ]);

  // Separate light and heavy lanthanide data
  const lightData = useMemo(
    () => dataPoints.filter(d => d.isLight && d.binding > 0),
    [dataPoints]
  );
  const heavyData = useMemo(
    () => dataPoints.filter(d => !d.isLight && d.binding > 0),
    [dataPoints]
  );

  // Linear regression for light and heavy
  const lightRegression = useMemo(() => {
    if (lightData.length < 2) return null;
    return linearRegression(
      lightData.map(d => d.kEx),
      lightData.map(d => d.binding)
    );
  }, [lightData]);

  const heavyRegression = useMemo(() => {
    if (heavyData.length < 2) return null;
    return linearRegression(
      heavyData.map(d => d.kEx),
      heavyData.map(d => d.binding)
    );
  }, [heavyData]);

  // Overall regression
  const overallRegression = useMemo(() => {
    const validData = dataPoints.filter(d => d.binding > 0);
    if (validData.length < 2) return null;
    return linearRegression(
      validData.map(d => d.kEx),
      validData.map(d => d.binding)
    );
  }, [dataPoints]);

  // Calculate bubble sizes
  const getBubbleSize = (ionicRadius: number): number => {
    if (sizeBy === 'fixed') return 150;
    const minSize = 80;
    const maxSize = 400;
    const minRadius = 86;
    const maxRadius = 104;
    return minSize + ((ionicRadius - minRadius) / (maxRadius - minRadius)) * (maxSize - minSize);
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: DataPoint }> }) => {
    if (!active || !payload || !payload[0]) return null;
    const data = payload[0].payload;

    return (
      <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-sm">
        <div className="font-bold text-lg mb-2">{data.element}³⁺</div>
        <div className="space-y-1">
          <div>
            <span className="text-gray-600">k_ex:</span>{' '}
            <span className="font-mono">{data.kEx.toFixed(1)} × 10⁸ s⁻¹</span>
          </div>
          <div>
            <span className="text-gray-600">
              {yAxisType === 'selectivity' ? 'Selectivity:' : 'Concentration:'}
            </span>{' '}
            <span className="font-mono">
              {data.binding.toFixed(2)}
              {yAxisType === 'selectivity' ? '%' : ' µM'}
              {data.bindingError > 0 && ` ± ${data.bindingError.toFixed(2)}`}
            </span>
          </div>
          <div>
            <span className="text-gray-600">Ionic radius:</span>{' '}
            <span className="font-mono">{data.ionicRadius.toFixed(1)} pm</span>
          </div>
          <div>
            <span className="text-gray-600">Unpaired e⁻:</span>{' '}
            <span className="font-mono">{data.unpairedElectrons}</span>
          </div>
          <div>
            <span className="text-gray-600">Series:</span>{' '}
            <span className={data.isLight ? 'text-red-600' : 'text-blue-600'}>
              {data.isLight ? 'Light (La-Eu)' : 'Heavy (Gd-Lu)'}
            </span>
          </div>
          {data.replicateValues && (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <span className="text-gray-600">Replicates:</span>{' '}
              <span className="font-mono text-xs">
                [{data.replicateValues.map(v => v.toFixed(1)).join(', ')}]
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!rawData || elementsWithKex.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Info className="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <p>Upload ICP data to analyze water exchange rate correlations.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Sample Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Sample / Group
            </label>
            <select
              value={selectedSample || ''}
              onChange={e => setSelectedSample(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">-- Select --</option>
              <optgroup label="Replicate Groups">
                {availableGroups.map(g => (
                  <option key={g.baseName} value={g.baseName}>
                    {g.baseName} (n={g.measurements.length})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Individual Samples">
                {availableSamples.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Y-Axis Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Y-Axis</label>
            <select
              value={yAxisType}
              onChange={e => setYAxisType(e.target.value as 'selectivity' | 'molarity')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="selectivity">Selectivity (%)</option>
              <option value="molarity">Concentration (µM)</option>
            </select>
          </div>

          {/* Color By */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color By</label>
            <select
              value={colorBy}
              onChange={e => setColorBy(e.target.value as 'series' | 'unpaired')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="series">Light/Heavy Series</option>
              <option value="unpaired">Unpaired Electrons</option>
            </select>
          </div>

          {/* Size By */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bubble Size</label>
            <select
              value={sizeBy}
              onChange={e => setSizeBy(e.target.value as 'radius' | 'fixed')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="radius">Ionic Radius</option>
              <option value="fixed">Fixed Size</option>
            </select>
          </div>
        </div>

        {/* Checkboxes */}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useReplicateMean}
              onChange={e => setUseReplicateMean(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Use replicate mean</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showFitLines}
              onChange={e => setShowFitLines(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Show regression lines</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={e => setShowLabels(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Show element labels</span>
          </label>
        </div>
      </div>

      {/* Chart */}
      {selectedSample && dataPoints.length > 0 ? (
        <>
          <div className="h-[500px] bg-white rounded-lg border border-gray-200 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 30, bottom: 60, left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="kEx"
                  type="number"
                  domain={[0, 'auto']}
                  name="k_ex"
                  label={{
                    value: 'kₑₓ [10⁸ s⁻¹]',
                    position: 'bottom',
                    offset: 40,
                    style: { fontWeight: 'bold' },
                  }}
                  tickFormatter={v => v.toFixed(1)}
                />
                <YAxis
                  dataKey="binding"
                  type="number"
                  domain={[0, 'auto']}
                  name={yAxisType === 'selectivity' ? 'Selectivity' : 'Concentration'}
                  label={{
                    value: yAxisType === 'selectivity' ? 'Binding Selectivity (%)' : 'Concentration (µM)',
                    angle: -90,
                    position: 'insideLeft',
                    offset: -45,
                    style: { fontWeight: 'bold' },
                  }}
                />
                <ZAxis dataKey="ionicRadius" range={[80, 400]} />
                <Tooltip content={<CustomTooltip />} />

                {/* Regression lines */}
                {showFitLines && lightRegression && lightData.length >= 2 && (
                  <ReferenceLine
                    segment={[
                      { x: Math.min(...lightData.map(d => d.kEx)), y: lightRegression.intercept + lightRegression.slope * Math.min(...lightData.map(d => d.kEx)) },
                      { x: Math.max(...lightData.map(d => d.kEx)), y: lightRegression.intercept + lightRegression.slope * Math.max(...lightData.map(d => d.kEx)) },
                    ]}
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeDasharray="8 4"
                  />
                )}

                {showFitLines && heavyRegression && heavyData.length >= 2 && (
                  <ReferenceLine
                    segment={[
                      { x: Math.min(...heavyData.map(d => d.kEx)), y: heavyRegression.intercept + heavyRegression.slope * Math.min(...heavyData.map(d => d.kEx)) },
                      { x: Math.max(...heavyData.map(d => d.kEx)), y: heavyRegression.intercept + heavyRegression.slope * Math.max(...heavyData.map(d => d.kEx)) },
                    ]}
                    stroke="#3b82f6"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                  />
                )}

                {/* Light lanthanides */}
                <Scatter
                  name="Light Lanthanides (La-Eu)"
                  data={lightData}
                  shape={colorBy === 'series' ? 'circle' : 'circle'}
                >
                  {lightData.map((entry, index) => (
                    <Cell
                      key={`light-${index}`}
                      fill={colorBy === 'unpaired' ? getUnpairedElectronColor(entry.unpairedElectrons) : '#ef4444'}
                      stroke="#000"
                      strokeWidth={1}
                      r={Math.sqrt(getBubbleSize(entry.ionicRadius) / Math.PI)}
                    />
                  ))}
                </Scatter>

                {/* Heavy lanthanides */}
                <Scatter
                  name="Heavy Lanthanides (Gd-Lu)"
                  data={heavyData}
                  shape={colorBy === 'series' ? 'square' : 'circle'}
                >
                  {heavyData.map((entry, index) => (
                    <Cell
                      key={`heavy-${index}`}
                      fill={colorBy === 'unpaired' ? getUnpairedElectronColor(entry.unpairedElectrons) : '#3b82f6'}
                      stroke="#000"
                      strokeWidth={1}
                      r={Math.sqrt(getBubbleSize(entry.ionicRadius) / Math.PI)}
                    />
                  ))}
                </Scatter>

                <Legend
                  wrapperStyle={{ paddingTop: 20 }}
                  formatter={(value) => <span className="text-sm">{value}</span>}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Element labels overlay */}
          {showLabels && (
            <div className="text-xs text-gray-600 text-center">
              Element labels shown in tooltip on hover
            </div>
          )}

          {/* Statistics Panel */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Light Lanthanide Stats */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h4 className="font-semibold text-red-800 mb-2 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Light Lanthanides (La-Eu)
              </h4>
              {lightRegression ? (
                <div className="space-y-1 text-sm">
                  <div>
                    <span className="text-gray-600">R²:</span>{' '}
                    <span className="font-mono font-semibold">{lightRegression.rSquared.toFixed(3)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Slope:</span>{' '}
                    <span className="font-mono">{lightRegression.slope.toFixed(3)} ± {lightRegression.standardError.toFixed(3)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">p-value:</span>{' '}
                    <span className="font-mono">{lightRegression.pValue.toExponential(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">n:</span>{' '}
                    <span className="font-mono">{lightData.length}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Not enough data points</p>
              )}
            </div>

            {/* Heavy Lanthanide Stats */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Heavy Lanthanides (Gd-Lu)
              </h4>
              {heavyRegression ? (
                <div className="space-y-1 text-sm">
                  <div>
                    <span className="text-gray-600">R²:</span>{' '}
                    <span className="font-mono font-semibold">{heavyRegression.rSquared.toFixed(3)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Slope:</span>{' '}
                    <span className="font-mono">{heavyRegression.slope.toFixed(3)} ± {heavyRegression.standardError.toFixed(3)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">p-value:</span>{' '}
                    <span className="font-mono">{heavyRegression.pValue.toExponential(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">n:</span>{' '}
                    <span className="font-mono">{heavyData.length}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Not enough data points</p>
              )}
            </div>

            {/* Overall Stats */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Overall
              </h4>
              {overallRegression ? (
                <div className="space-y-1 text-sm">
                  <div>
                    <span className="text-gray-600">R²:</span>{' '}
                    <span className="font-mono font-semibold">{overallRegression.rSquared.toFixed(3)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Slope:</span>{' '}
                    <span className="font-mono">{overallRegression.slope.toFixed(3)} ± {overallRegression.standardError.toFixed(3)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">p-value:</span>{' '}
                    <span className="font-mono">{overallRegression.pValue.toExponential(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">n:</span>{' '}
                    <span className="font-mono">{dataPoints.filter(d => d.binding > 0).length}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Not enough data points</p>
              )}
            </div>
          </div>

          {/* Data Table */}
          <div className="mt-6">
            <h4 className="font-semibold mb-3">Individual Element Data</h4>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-gray-300 px-3 py-2 text-left">Element</th>
                    <th className="border border-gray-300 px-3 py-2 text-center">Series</th>
                    <th className="border border-gray-300 px-3 py-2 text-right">k_ex (10⁸ s⁻¹)</th>
                    <th className="border border-gray-300 px-3 py-2 text-right">
                      {yAxisType === 'selectivity' ? 'Selectivity (%)' : 'Conc. (µM)'}
                    </th>
                    <th className="border border-gray-300 px-3 py-2 text-right">Ionic Radius (pm)</th>
                    <th className="border border-gray-300 px-3 py-2 text-right">Unpaired e⁻</th>
                  </tr>
                </thead>
                <tbody>
                  {dataPoints.map(d => (
                    <tr key={d.element} className="hover:bg-blue-50">
                      <td className="border border-gray-300 px-3 py-2 font-medium">
                        {d.element}³⁺
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            d.isLight
                              ? 'bg-red-100 text-red-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {d.isLight ? 'Light' : 'Heavy'}
                        </span>
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-right font-mono">
                        {d.kEx.toFixed(1)}
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-right font-mono">
                        {d.binding.toFixed(2)}
                        {d.bindingError > 0 && (
                          <span className="text-gray-500"> ± {d.bindingError.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-right font-mono">
                        {d.ionicRadius.toFixed(1)}
                      </td>
                      <td className="border border-gray-300 px-3 py-2 text-right font-mono">
                        {d.unpairedElectrons}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend for unpaired electrons color scale */}
          {colorBy === 'unpaired' && (
            <div className="mt-4 flex items-center gap-2">
              <span className="text-sm text-gray-600">Unpaired electrons:</span>
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(n => (
                  <div key={n} className="flex flex-col items-center">
                    <div
                      className="w-6 h-6 rounded"
                      style={{ backgroundColor: getUnpairedElectronColor(n) }}
                    />
                    <span className="text-xs text-gray-500">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ionic radius legend */}
          {sizeBy === 'radius' && (
            <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
              <span>Ionic radius:</span>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-gray-400 border border-gray-600" />
                <span>86 pm</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 rounded-full bg-gray-400 border border-gray-600" />
                <span>95 pm</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-7 h-7 rounded-full bg-gray-400 border border-gray-600" />
                <span>103 pm</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="h-[400px] bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <Info className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p>Select a sample or replicate group to analyze</p>
            <p className="text-sm mt-2">
              This analysis shows the correlation between binding preference and water exchange
              rates
            </p>
          </div>
        </div>
      )}

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
        <h4 className="font-semibold text-blue-800 mb-2">About Water Exchange Rate Analysis</h4>
        <p className="text-blue-700 mb-2">
          This analysis explores the relationship between lanthanide binding selectivity and the
          water exchange rate (k_ex) of aqua-Ln³⁺ ions. The water exchange rate reflects how
          quickly water molecules in the inner coordination sphere are replaced.
        </p>
        <ul className="list-disc list-inside text-blue-700 space-y-1">
          <li>Light lanthanides (La-Eu) often show different binding trends than heavy ones (Gd-Lu)</li>
          <li>Bubble size represents ionic radius (larger = bigger ionic radius)</li>
          <li>Color can represent light/heavy series or number of unpaired electrons</li>
          <li>Linear regression is calculated separately for light and heavy lanthanides</li>
        </ul>
      </div>
    </div>
  );
}
