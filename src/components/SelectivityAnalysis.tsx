'use client';

import { useMemo, useState } from 'react';
import { useDataStore } from '@/store/useDataStore';
import { LANTHANIDE_ORDER, ELEMENT_COLORS } from '@/lib/constants';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';
import { AlertTriangle, ArrowLeftRight, Info } from 'lucide-react';

// Threshold for considering a sample as "binding" (total µM after buffer subtraction)
const DEFAULT_BINDING_THRESHOLD = 0.5; // µM

interface SampleBindingStatus {
  id: string;
  displayName: string;
  totalMolarity: number;
  isBinding: boolean;
  selectivity: Record<string, number>;
}

export function SelectivityAnalysis() {
  const {
    processedData,
    replicateGroups,
    rawData,
    selectedElements,
    selectedSamples,
    bufferMeasurement,
  } = useDataStore();

  const [bindingThreshold, setBindingThreshold] = useState(DEFAULT_BINDING_THRESHOLD);
  const [compareMode, setCompareMode] = useState(false);
  const [sampleA, setSampleA] = useState<string | null>(null);
  const [sampleB, setSampleB] = useState<string | null>(null);

  const elements = useMemo(() => {
    return (rawData?.elements || [])
      .filter(e => selectedElements.includes(e))
      .sort((a, b) => LANTHANIDE_ORDER.indexOf(a) - LANTHANIDE_ORDER.indexOf(b));
  }, [rawData?.elements, selectedElements]);

  // Calculate binding status for each sample
  const sampleBindingStatus = useMemo((): SampleBindingStatus[] => {
    return processedData
      .filter(m => selectedSamples.includes(m.id) && m.id !== bufferMeasurement?.id)
      .map(m => {
        // Calculate total molarity (sum of positive normalized values)
        const totalMolarity = elements.reduce((sum, e) => {
          const val = m.normalizedMolarity[e] ?? 0;
          return sum + Math.max(0, val);
        }, 0);

        const isBinding = totalMolarity >= bindingThreshold;

        return {
          id: m.id,
          displayName: m.displayName,
          totalMolarity,
          isBinding,
          selectivity: m.selectivity,
        };
      });
  }, [processedData, selectedSamples, bufferMeasurement, elements, bindingThreshold]);

  // Separate binding and non-binding samples
  const bindingSamples = useMemo(
    () => sampleBindingStatus.filter(s => s.isBinding),
    [sampleBindingStatus]
  );
  const nonBindingSamples = useMemo(
    () => sampleBindingStatus.filter(s => !s.isBinding),
    [sampleBindingStatus]
  );

  // Get full sample data for binding samples
  const analysisData = useMemo(() => {
    const bindingIds = new Set(bindingSamples.map(s => s.id));
    return processedData.filter(m => bindingIds.has(m.id));
  }, [processedData, bindingSamples]);

  // Prepare data for stacked bar chart
  const stackedChartData = useMemo(() => {
    return analysisData.map(m => {
      const data: Record<string, string | number> = { name: m.displayName };
      for (const element of elements) {
        data[element] = Math.max(0, m.selectivity[element] ?? 0);
      }
      return data;
    });
  }, [analysisData, elements]);

  // Summary statistics per sample
  const summaryStats = useMemo(() => {
    return sampleBindingStatus.map(s => {
      const selectivityValues = elements.map(e => s.selectivity[e] ?? 0);
      const maxIdx = selectivityValues.indexOf(Math.max(...selectivityValues));
      const maxElement = elements[maxIdx] || '-';
      const maxSelectivity = Math.max(...selectivityValues, 0);

      const avgSelectivity = 100 / elements.length;
      const enrichmentFactor = avgSelectivity > 0 ? maxSelectivity / avgSelectivity : 0;

      return {
        id: s.id,
        sample: s.displayName,
        totalMolarity: s.totalMolarity,
        isBinding: s.isBinding,
        maxElement,
        maxSelectivity,
        enrichmentFactor,
      };
    });
  }, [sampleBindingStatus, elements]);

  // Replicate group summary
  const groupStats = useMemo(() => {
    return replicateGroups
      .filter(g => g.measurements.some(m => selectedSamples.includes(m.id)))
      .filter(g => !g.measurements.some(m => m.id === bufferMeasurement?.id))
      .map(g => {
        // Calculate total molarity for the group
        const totalMolarity = elements.reduce((sum, e) => {
          const val = g.mean[e] ?? 0;
          return sum + Math.max(0, val);
        }, 0);

        const isBinding = totalMolarity >= bindingThreshold;

        const selectivityValues = elements.map(e => g.meanSelectivity[e] ?? 0);
        const maxElement = elements[selectivityValues.indexOf(Math.max(...selectivityValues))] || '-';
        const maxSelectivity = Math.max(...selectivityValues, 0);
        const cvValues = elements.map(e => g.cv[e] ?? 0);
        const avgCV = cvValues.length > 0 ? cvValues.reduce((a, b) => a + b, 0) / cvValues.length : 0;

        return {
          group: g.baseName,
          nReplicates: g.measurements.length,
          totalMolarity,
          isBinding,
          maxElement,
          maxSelectivity,
          avgCV,
          meanSelectivity: g.meanSelectivity,
        };
      });
  }, [replicateGroups, elements, selectedSamples, bufferMeasurement, bindingThreshold]);

  // Sample comparison data
  const comparisonData = useMemo(() => {
    if (!sampleA || !sampleB) return null;

    const dataA = processedData.find(m => m.id === sampleA);
    const dataB = processedData.find(m => m.id === sampleB);

    if (!dataA || !dataB) return null;

    const statusA = sampleBindingStatus.find(s => s.id === sampleA);
    const statusB = sampleBindingStatus.find(s => s.id === sampleB);

    return {
      sampleA: {
        ...dataA,
        isBinding: statusA?.isBinding ?? false,
        totalMolarity: statusA?.totalMolarity ?? 0,
      },
      sampleB: {
        ...dataB,
        isBinding: statusB?.isBinding ?? false,
        totalMolarity: statusB?.totalMolarity ?? 0,
      },
      comparison: elements.map(e => ({
        element: e,
        selectivityA: dataA.selectivity[e] ?? 0,
        selectivityB: dataB.selectivity[e] ?? 0,
        molarityA: dataA.normalizedMolarity[e] ?? 0,
        molarityB: dataB.normalizedMolarity[e] ?? 0,
        difference: (dataA.selectivity[e] ?? 0) - (dataB.selectivity[e] ?? 0),
        foldChange:
          (dataB.selectivity[e] ?? 0) > 0.1
            ? (dataA.selectivity[e] ?? 0) / (dataB.selectivity[e] ?? 0.1)
            : null,
      })),
    };
  }, [sampleA, sampleB, processedData, elements, sampleBindingStatus]);

  // Radar chart data for comparison
  const radarData = useMemo(() => {
    if (!comparisonData) return [];
    return comparisonData.comparison.map(c => ({
      element: c.element,
      [comparisonData.sampleA.displayName]: Math.max(0, c.selectivityA),
      [comparisonData.sampleB.displayName]: Math.max(0, c.selectivityB),
    }));
  }, [comparisonData]);

  if (!rawData || sampleBindingStatus.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No data to analyze. Upload a CSV file and select samples.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Controls */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">
              Binding Threshold (µM):
            </label>
            <input
              type="number"
              value={bindingThreshold}
              onChange={e => setBindingThreshold(parseFloat(e.target.value) || 0)}
              step="0.1"
              min="0"
              className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
            />
            <span className="text-xs text-gray-500">
              (samples below this total concentration are marked as non-binding)
            </span>
          </div>

          <button
            onClick={() => setCompareMode(!compareMode)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              compareMode
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <ArrowLeftRight className="w-4 h-4" />
            Compare Samples
          </button>
        </div>
      </div>

      {/* Non-binding samples warning */}
      {nonBindingSamples.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-yellow-800">
                {nonBindingSamples.length} sample(s) show no significant binding
              </h4>
              <p className="text-sm text-yellow-700 mt-1">
                These samples have total concentration below {bindingThreshold} µM after buffer
                subtraction, indicating no significant lanthanide binding:
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {nonBindingSamples.map(s => (
                  <span
                    key={s.id}
                    className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded"
                  >
                    {s.displayName} ({s.totalMolarity.toFixed(3)} µM)
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sample Comparison Mode */}
      {compareMode && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
          <h3 className="text-lg font-semibold text-blue-800">Sample Comparison</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sample A</label>
              <select
                value={sampleA || ''}
                onChange={e => setSampleA(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">Select sample...</option>
                {sampleBindingStatus.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.displayName} {!s.isBinding && '(no binding)'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sample B</label>
              <select
                value={sampleB || ''}
                onChange={e => setSampleB(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">Select sample...</option>
                {sampleBindingStatus.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.displayName} {!s.isBinding && '(no binding)'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {comparisonData && (
            <div className="space-y-6 mt-4">
              {/* Comparison summary */}
              <div className="grid grid-cols-2 gap-4">
                <div
                  className={`p-3 rounded-lg ${
                    comparisonData.sampleA.isBinding ? 'bg-green-50' : 'bg-gray-100'
                  }`}
                >
                  <div className="font-semibold">{comparisonData.sampleA.displayName}</div>
                  <div className="text-sm text-gray-600">
                    Total: {comparisonData.sampleA.totalMolarity.toFixed(2)} µM
                    {!comparisonData.sampleA.isBinding && (
                      <span className="ml-2 text-yellow-600">(no binding)</span>
                    )}
                  </div>
                </div>
                <div
                  className={`p-3 rounded-lg ${
                    comparisonData.sampleB.isBinding ? 'bg-green-50' : 'bg-gray-100'
                  }`}
                >
                  <div className="font-semibold">{comparisonData.sampleB.displayName}</div>
                  <div className="text-sm text-gray-600">
                    Total: {comparisonData.sampleB.totalMolarity.toFixed(2)} µM
                    {!comparisonData.sampleB.isBinding && (
                      <span className="ml-2 text-yellow-600">(no binding)</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Radar comparison */}
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="element" />
                    <PolarRadiusAxis angle={90} domain={[0, 'auto']} />
                    <Radar
                      name={comparisonData.sampleA.displayName}
                      dataKey={comparisonData.sampleA.displayName}
                      stroke="#ef4444"
                      fill="#ef4444"
                      fillOpacity={0.3}
                    />
                    <Radar
                      name={comparisonData.sampleB.displayName}
                      dataKey={comparisonData.sampleB.displayName}
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.3}
                    />
                    <Legend />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* Bar comparison */}
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={comparisonData.comparison}
                    margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="element" />
                    <YAxis label={{ value: 'Selectivity (%)', angle: -90, position: 'insideLeft' }} />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="selectivityA"
                      name={comparisonData.sampleA.displayName}
                      fill="#ef4444"
                    />
                    <Bar
                      dataKey="selectivityB"
                      name={comparisonData.sampleB.displayName}
                      fill="#3b82f6"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Difference table */}
              <div>
                <h4 className="font-semibold mb-2">Element-wise Comparison</h4>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-300 px-3 py-2">Element</th>
                        <th className="border border-gray-300 px-3 py-2 text-red-600">
                          {comparisonData.sampleA.displayName} (%)
                        </th>
                        <th className="border border-gray-300 px-3 py-2 text-blue-600">
                          {comparisonData.sampleB.displayName} (%)
                        </th>
                        <th className="border border-gray-300 px-3 py-2">Difference</th>
                        <th className="border border-gray-300 px-3 py-2">Fold Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonData.comparison.map(c => (
                        <tr key={c.element} className="hover:bg-blue-50">
                          <td className="border border-gray-300 px-3 py-2 font-medium">
                            {c.element}
                          </td>
                          <td className="border border-gray-300 px-3 py-2 text-right font-mono">
                            {c.selectivityA.toFixed(2)}
                          </td>
                          <td className="border border-gray-300 px-3 py-2 text-right font-mono">
                            {c.selectivityB.toFixed(2)}
                          </td>
                          <td
                            className={`border border-gray-300 px-3 py-2 text-right font-mono ${
                              c.difference > 0
                                ? 'text-green-600'
                                : c.difference < 0
                                ? 'text-red-600'
                                : ''
                            }`}
                          >
                            {c.difference > 0 ? '+' : ''}
                            {c.difference.toFixed(2)}
                          </td>
                          <td className="border border-gray-300 px-3 py-2 text-right font-mono">
                            {c.foldChange !== null ? c.foldChange.toFixed(2) + 'x' : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {!comparisonData && sampleA && sampleB && (
            <div className="text-center text-gray-500 py-4">
              <Info className="w-8 h-8 mx-auto mb-2" />
              Unable to load comparison data
            </div>
          )}
        </div>
      )}

      {/* Summary Table */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Sample Selectivity Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 px-3 py-2 text-left">Sample</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Status</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Total (µM)</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Top Element</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Selectivity</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Enrichment</th>
              </tr>
            </thead>
            <tbody>
              {summaryStats.map(stat => (
                <tr
                  key={stat.id}
                  className={`hover:bg-blue-50 ${!stat.isBinding ? 'bg-gray-50 text-gray-500' : ''}`}
                >
                  <td className="border border-gray-300 px-3 py-2 font-medium">{stat.sample}</td>
                  <td className="border border-gray-300 px-3 py-2 text-center">
                    {stat.isBinding ? (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                        Binding
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded">
                        No binding
                      </span>
                    )}
                  </td>
                  <td className="border border-gray-300 px-3 py-2 text-center font-mono">
                    {stat.totalMolarity.toFixed(3)}
                  </td>
                  <td className="border border-gray-300 px-3 py-2 text-center">
                    {stat.isBinding ? (
                      <span
                        className="px-2 py-1 rounded text-white text-xs font-bold"
                        style={{ backgroundColor: ELEMENT_COLORS[stat.maxElement] || '#666' }}
                      >
                        {stat.maxElement}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="border border-gray-300 px-3 py-2 text-center font-mono">
                    {stat.isBinding ? stat.maxSelectivity.toFixed(1) + '%' : '-'}
                  </td>
                  <td className="border border-gray-300 px-3 py-2 text-center font-mono">
                    {stat.isBinding ? stat.enrichmentFactor.toFixed(2) + 'x' : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Replicate Group Summary */}
      {groupStats.length > 0 && groupStats.some(g => g.nReplicates > 1) && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Replicate Group Summary</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">Group</th>
                  <th className="border border-gray-300 px-3 py-2 text-center">n</th>
                  <th className="border border-gray-300 px-3 py-2 text-center">Status</th>
                  <th className="border border-gray-300 px-3 py-2 text-center">Top Element</th>
                  <th className="border border-gray-300 px-3 py-2 text-center">Mean Selectivity</th>
                  <th className="border border-gray-300 px-3 py-2 text-center">Avg CV%</th>
                </tr>
              </thead>
              <tbody>
                {groupStats.map(stat => (
                  <tr
                    key={stat.group}
                    className={`hover:bg-blue-50 ${!stat.isBinding ? 'bg-gray-50 text-gray-500' : ''}`}
                  >
                    <td className="border border-gray-300 px-3 py-2 font-medium">{stat.group}</td>
                    <td className="border border-gray-300 px-3 py-2 text-center">
                      {stat.nReplicates}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center">
                      {stat.isBinding ? (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                          Binding
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded">
                          No binding
                        </span>
                      )}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center">
                      {stat.isBinding ? (
                        <span
                          className="px-2 py-1 rounded text-white text-xs font-bold"
                          style={{ backgroundColor: ELEMENT_COLORS[stat.maxElement] || '#666' }}
                        >
                          {stat.maxElement}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center font-mono">
                      {stat.isBinding ? stat.maxSelectivity.toFixed(1) + '%' : '-'}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center font-mono">
                      {stat.isBinding ? stat.avgCV.toFixed(1) + '%' : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Charts only for binding samples */}
      {bindingSamples.length > 0 && (
        <>
          {/* Stacked Bar Chart */}
          <div>
            <h3 className="text-lg font-semibold mb-4">
              Selectivity Profile by Sample
              <span className="text-sm font-normal text-gray-500 ml-2">
                (binding samples only)
              </span>
            </h3>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stackedChartData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    interval={0}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    label={{ value: 'Selectivity (%)', angle: -90, position: 'insideLeft' }}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
                  />
                  <Legend wrapperStyle={{ paddingTop: 20 }} />
                  {elements.map(element => (
                    <Bar
                      key={element}
                      dataKey={element}
                      stackId="a"
                      fill={ELEMENT_COLORS[element] || '#8884d8'}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Selectivity Heatmap */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Selectivity Heatmap</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border border-gray-300 px-2 py-1 bg-gray-100"></th>
                    {elements.map(element => (
                      <th
                        key={element}
                        className="border border-gray-300 px-2 py-1 bg-gray-100 text-center text-xs"
                      >
                        {element}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleBindingStatus.map(s => {
                    const sample = processedData.find(m => m.id === s.id);
                    if (!sample) return null;

                    return (
                      <tr key={s.id} className={!s.isBinding ? 'opacity-50' : ''}>
                        <td className="border border-gray-300 px-2 py-1 font-medium text-xs whitespace-nowrap">
                          {s.displayName}
                          {!s.isBinding && (
                            <span className="ml-1 text-gray-400">(NB)</span>
                          )}
                        </td>
                        {elements.map(element => {
                          const value = sample.selectivity[element] ?? 0;
                          const intensity = Math.min(value / 30, 1);
                          const bgColor =
                            value > 0 && s.isBinding
                              ? `rgba(59, 130, 246, ${intensity})`
                              : 'rgba(156, 163, 175, 0.2)';

                          return (
                            <td
                              key={element}
                              className="border border-gray-300 px-2 py-1 text-center text-xs font-mono"
                              style={{ backgroundColor: bgColor }}
                              title={`${s.displayName} - ${element}: ${value.toFixed(2)}%`}
                            >
                              {s.isBinding && value > 0 ? value.toFixed(1) : '-'}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
              <span>Intensity scale:</span>
              <div className="flex items-center gap-1">
                <div className="w-6 h-4 bg-gray-200"></div>
                <span>0% / NB</span>
              </div>
              <div className="flex items-center gap-1">
                <div
                  className="w-6 h-4"
                  style={{ backgroundColor: 'rgba(59, 130, 246, 0.5)' }}
                ></div>
                <span>15%</span>
              </div>
              <div className="flex items-center gap-1">
                <div
                  className="w-6 h-4"
                  style={{ backgroundColor: 'rgba(59, 130, 246, 1)' }}
                ></div>
                <span>30%+</span>
              </div>
              <span className="ml-4 text-gray-400">NB = No Binding</span>
            </div>
          </div>
        </>
      )}

      {bindingSamples.length === 0 && (
        <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-500">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p>No samples show significant binding above the threshold.</p>
          <p className="text-sm mt-2">
            Try lowering the binding threshold or check your buffer subtraction.
          </p>
        </div>
      )}
    </div>
  );
}
