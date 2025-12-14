'use client';

import { useMemo } from 'react';
import { useDataStore } from '@/store/useDataStore';
import { LANTHANIDE_ORDER, ELEMENT_COLORS, IONIC_RADII } from '@/lib/constants';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';

export function Charts() {
  const {
    processedData,
    rawData,
    selectedElements,
    selectedSamples,
    showNormalized,
    unitMode,
    bufferMeasurement,
  } = useDataStore();

  const elements = useMemo(() => {
    return (rawData?.elements || [])
      .filter(e => selectedElements.includes(e))
      .sort((a, b) => LANTHANIDE_ORDER.indexOf(a) - LANTHANIDE_ORDER.indexOf(b));
  }, [rawData?.elements, selectedElements]);

  const analysisData = useMemo(() => {
    return processedData.filter(
      m => selectedSamples.includes(m.id) && m.id !== bufferMeasurement?.id
    );
  }, [processedData, selectedSamples, bufferMeasurement]);

  // Lanthanide series plot (elements on X, concentration on Y)
  const seriesPlotData = useMemo(() => {
    return elements.map(element => {
      const data: Record<string, string | number> = {
        element,
        ionicRadius: IONIC_RADII[element] || 0,
      };

      for (const m of analysisData) {
        let value: number;
        switch (unitMode) {
          case 'mg/L':
            value = m.values[element] ?? 0;
            break;
          case 'µM':
            value = showNormalized
              ? m.normalizedMolarity[element] ?? 0
              : m.molarity[element] ?? 0;
            break;
          case 'selectivity':
            value = m.selectivity[element] ?? 0;
            break;
        }
        data[m.displayName] = Math.max(0, value);
      }

      return data;
    });
  }, [analysisData, elements, unitMode, showNormalized]);

  // Radar chart data (for selectivity profiles)
  const radarData = useMemo(() => {
    return elements.map(element => {
      const data: Record<string, string | number> = { element };

      for (const m of analysisData.slice(0, 6)) {
        data[m.displayName] = Math.max(0, m.selectivity[element] ?? 0);
      }

      return data;
    });
  }, [analysisData, elements]);

  // Ionic radius correlation data
  const ionicRadiusData = useMemo(() => {
    const data: { sample: string; element: string; ionicRadius: number; selectivity: number }[] = [];

    for (const m of analysisData) {
      for (const element of elements) {
        data.push({
          sample: m.displayName,
          element,
          ionicRadius: IONIC_RADII[element] || 0,
          selectivity: Math.max(0, m.selectivity[element] ?? 0),
        });
      }
    }

    return data;
  }, [analysisData, elements]);

  const getYAxisLabel = () => {
    switch (unitMode) {
      case 'mg/L':
        return 'Concentration (mg/L)';
      case 'µM':
        return 'Concentration (µM)';
      case 'selectivity':
        return 'Selectivity (%)';
    }
  };

  if (!rawData || analysisData.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No data to chart. Upload a CSV file and select samples.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Lanthanide Series Plot */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Lanthanide Series Profile</h3>
        <p className="text-sm text-gray-600 mb-4">
          Shows the binding pattern across the lanthanide series (ordered by atomic number).
        </p>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={seriesPlotData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="element" />
              <YAxis label={{ value: getYAxisLabel(), angle: -90, position: 'insideLeft' }} />
              <Tooltip />
              <Legend />
              {analysisData.slice(0, 8).map((m, i) => (
                <Line
                  key={m.id}
                  type="monotone"
                  dataKey={m.displayName}
                  stroke={`hsl(${(i * 360) / Math.min(analysisData.length, 8)}, 70%, 50%)`}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {analysisData.length > 8 && (
          <p className="text-sm text-gray-500 text-center mt-2">
            Showing first 8 samples. Filter samples to view others.
          </p>
        )}
      </div>

      {/* Radar Chart for Selectivity */}
      {analysisData.length <= 6 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Selectivity Radar</h3>
          <p className="text-sm text-gray-600 mb-4">
            Radar plot comparing selectivity profiles across samples.
          </p>
          <div className="h-[500px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} margin={{ top: 20, right: 30, left: 30, bottom: 20 }}>
                <PolarGrid />
                <PolarAngleAxis dataKey="element" />
                <PolarRadiusAxis angle={90} domain={[0, 'auto']} />
                <Tooltip />
                <Legend />
                {analysisData.map((m, i) => (
                  <Radar
                    key={m.id}
                    name={m.displayName}
                    dataKey={m.displayName}
                    stroke={`hsl(${(i * 360) / analysisData.length}, 70%, 50%)`}
                    fill={`hsl(${(i * 360) / analysisData.length}, 70%, 50%)`}
                    fillOpacity={0.2}
                  />
                ))}
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Ionic Radius Correlation */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Ionic Radius vs Selectivity</h3>
        <p className="text-sm text-gray-600 mb-4">
          Explores the relationship between lanthanide ionic radius and binding selectivity.
          Larger ions (La, Ce) are on the right, smaller ions (Lu, Yb) on the left.
        </p>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="ionicRadius"
                type="number"
                domain={['auto', 'auto']}
                name="Ionic Radius"
                label={{ value: 'Ionic Radius (Å)', position: 'bottom', offset: 0 }}
              />
              <YAxis
                dataKey="selectivity"
                name="Selectivity"
                label={{ value: 'Selectivity (%)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value: number, name: string) => [value.toFixed(2), name]}
                labelFormatter={(label: number) => `Ionic Radius: ${label.toFixed(3)} Å`}
              />
              <Legend />
              {analysisData.slice(0, 6).map((m, i) => {
                const sampleData = elements.map(element => ({
                  ionicRadius: IONIC_RADII[element] || 0,
                  selectivity: Math.max(0, m.selectivity[element] ?? 0),
                  element,
                }));

                return (
                  <Scatter
                    key={m.id}
                    name={m.displayName}
                    data={sampleData}
                    fill={`hsl(${(i * 360) / Math.min(analysisData.length, 6)}, 70%, 50%)`}
                  />
                );
              })}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        {analysisData.length > 6 && (
          <p className="text-sm text-gray-500 text-center mt-2">
            Showing first 6 samples. Filter samples to view others.
          </p>
        )}
      </div>

      {/* Element-wise comparison */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Per-Element Sample Comparison</h3>
        <p className="text-sm text-gray-600 mb-4">
          Compare how different samples bind to each specific element.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {elements.slice(0, 6).map(element => {
            const chartData = analysisData.map(m => ({
              name: m.displayName,
              value:
                unitMode === 'selectivity'
                  ? m.selectivity[element] ?? 0
                  : unitMode === 'µM'
                  ? showNormalized
                    ? m.normalizedMolarity[element] ?? 0
                    : m.molarity[element] ?? 0
                  : m.values[element] ?? 0,
            }));

            return (
              <div key={element} className="border border-gray-200 rounded-lg p-4">
                <h4
                  className="font-semibold mb-2 text-center"
                  style={{ color: ELEMENT_COLORS[element] }}
                >
                  {element}
                </h4>
                <div className="h-[150px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <XAxis dataKey="name" hide />
                      <YAxis hide domain={['auto', 'auto']} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke={ELEMENT_COLORS[element]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
        {elements.length > 6 && (
          <p className="text-sm text-gray-500 text-center mt-4">
            Showing first 6 elements. Filter elements to view others.
          </p>
        )}
      </div>
    </div>
  );
}
