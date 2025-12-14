'use client';

import { useMemo } from 'react';
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
  Cell,
} from 'recharts';

export function SelectivityAnalysis() {
  const {
    processedData,
    replicateGroups,
    rawData,
    selectedElements,
    selectedSamples,
    bufferMeasurement,
  } = useDataStore();

  const elements = useMemo(() => {
    return (rawData?.elements || [])
      .filter(e => selectedElements.includes(e))
      .sort((a, b) => LANTHANIDE_ORDER.indexOf(a) - LANTHANIDE_ORDER.indexOf(b));
  }, [rawData?.elements, selectedElements]);

  // Filter out buffer from analysis
  const analysisData = useMemo(() => {
    return processedData.filter(
      m => selectedSamples.includes(m.id) && m.id !== bufferMeasurement?.id
    );
  }, [processedData, selectedSamples, bufferMeasurement]);

  // Prepare data for stacked bar chart (samples on X, elements stacked)
  const stackedChartData = useMemo(() => {
    return analysisData.map(m => {
      const data: Record<string, string | number> = { name: m.displayName };
      for (const element of elements) {
        data[element] = Math.max(0, m.selectivity[element] ?? 0);
      }
      return data;
    });
  }, [analysisData, elements]);

  // Prepare data for element comparison (elements on X, samples grouped)
  const elementChartData = useMemo(() => {
    return elements.map(element => {
      const data: Record<string, string | number> = { element };
      for (const m of analysisData) {
        data[m.displayName] = Math.max(0, m.selectivity[element] ?? 0);
      }
      return data;
    });
  }, [analysisData, elements]);

  // Summary statistics per sample
  const summaryStats = useMemo(() => {
    return analysisData.map(m => {
      const selectivityValues = elements.map(e => m.selectivity[e] ?? 0);
      const maxElement = elements[selectivityValues.indexOf(Math.max(...selectivityValues))];
      const maxSelectivity = Math.max(...selectivityValues);

      // Calculate enrichment factor (max / average)
      const avgSelectivity = 100 / elements.length;
      const enrichmentFactor = maxSelectivity / avgSelectivity;

      return {
        sample: m.displayName,
        maxElement,
        maxSelectivity,
        enrichmentFactor,
      };
    });
  }, [analysisData, elements]);

  // Replicate group summary
  const groupStats = useMemo(() => {
    return replicateGroups
      .filter(g => g.measurements.some(m => selectedSamples.includes(m.id)))
      .filter(g => !g.measurements.some(m => m.id === bufferMeasurement?.id))
      .map(g => {
        const selectivityValues = elements.map(e => g.meanSelectivity[e] ?? 0);
        const maxElement = elements[selectivityValues.indexOf(Math.max(...selectivityValues))];
        const maxSelectivity = Math.max(...selectivityValues);
        const cvValues = elements.map(e => g.cv[e] ?? 0);
        const avgCV = cvValues.reduce((a, b) => a + b, 0) / cvValues.length;

        return {
          group: g.baseName,
          nReplicates: g.measurements.length,
          maxElement,
          maxSelectivity,
          avgCV,
          meanSelectivity: g.meanSelectivity,
        };
      });
  }, [replicateGroups, elements, selectedSamples, bufferMeasurement]);

  if (!rawData || analysisData.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No data to analyze. Upload a CSV file and select samples.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Summary Table */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Sample Selectivity Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 px-3 py-2 text-left">Sample</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Top Element</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Selectivity</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Enrichment</th>
              </tr>
            </thead>
            <tbody>
              {summaryStats.map(stat => (
                <tr key={stat.sample} className="hover:bg-blue-50">
                  <td className="border border-gray-300 px-3 py-2 font-medium">
                    {stat.sample}
                  </td>
                  <td className="border border-gray-300 px-3 py-2 text-center">
                    <span
                      className="px-2 py-1 rounded text-white text-xs font-bold"
                      style={{ backgroundColor: ELEMENT_COLORS[stat.maxElement] || '#666' }}
                    >
                      {stat.maxElement}
                    </span>
                  </td>
                  <td className="border border-gray-300 px-3 py-2 text-center font-mono">
                    {stat.maxSelectivity.toFixed(1)}%
                  </td>
                  <td className="border border-gray-300 px-3 py-2 text-center font-mono">
                    {stat.enrichmentFactor.toFixed(2)}x
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
                  <th className="border border-gray-300 px-3 py-2 text-center">Top Element</th>
                  <th className="border border-gray-300 px-3 py-2 text-center">Mean Selectivity</th>
                  <th className="border border-gray-300 px-3 py-2 text-center">Avg CV%</th>
                </tr>
              </thead>
              <tbody>
                {groupStats.map(stat => (
                  <tr key={stat.group} className="hover:bg-blue-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">
                      {stat.group}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center">
                      {stat.nReplicates}
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center">
                      <span
                        className="px-2 py-1 rounded text-white text-xs font-bold"
                        style={{ backgroundColor: ELEMENT_COLORS[stat.maxElement] || '#666' }}
                      >
                        {stat.maxElement}
                      </span>
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center font-mono">
                      {stat.maxSelectivity.toFixed(1)}%
                    </td>
                    <td className="border border-gray-300 px-3 py-2 text-center font-mono">
                      {stat.avgCV.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stacked Bar Chart - Selectivity Profile */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Selectivity Profile by Sample</h3>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stackedChartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
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

      {/* Element Comparison Chart */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Element Comparison Across Samples</h3>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={elementChartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="element" />
              <YAxis
                label={{ value: 'Selectivity (%)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
              />
              <Legend />
              {analysisData.slice(0, 8).map((m, i) => (
                <Bar
                  key={m.id}
                  dataKey={m.displayName}
                  fill={`hsl(${(i * 360) / Math.min(analysisData.length, 8)}, 70%, 50%)`}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        {analysisData.length > 8 && (
          <p className="text-sm text-gray-500 text-center mt-2">
            Showing first 8 samples. Filter samples to view others.
          </p>
        )}
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
              {analysisData.map(m => (
                <tr key={m.id}>
                  <td className="border border-gray-300 px-2 py-1 font-medium text-xs whitespace-nowrap">
                    {m.displayName}
                  </td>
                  {elements.map(element => {
                    const value = m.selectivity[element] ?? 0;
                    const intensity = Math.min(value / 30, 1); // Normalize to 30% max
                    const bgColor = value > 0
                      ? `rgba(59, 130, 246, ${intensity})`
                      : 'rgba(156, 163, 175, 0.2)';

                    return (
                      <td
                        key={element}
                        className="border border-gray-300 px-2 py-1 text-center text-xs font-mono"
                        style={{ backgroundColor: bgColor }}
                        title={`${m.displayName} - ${element}: ${value.toFixed(2)}%`}
                      >
                        {value > 0 ? value.toFixed(1) : '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
          <span>Intensity scale:</span>
          <div className="flex items-center gap-1">
            <div className="w-6 h-4 bg-gray-200"></div>
            <span>0%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-4" style={{ backgroundColor: 'rgba(59, 130, 246, 0.5)' }}></div>
            <span>15%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-4" style={{ backgroundColor: 'rgba(59, 130, 246, 1)' }}></div>
            <span>30%+</span>
          </div>
        </div>
      </div>
    </div>
  );
}
