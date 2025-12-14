'use client';

import { useMemo, useState } from 'react';
import { useDataStore } from '@/store/useDataStore';
import {
  LANTHANIDE_ORDER,
  WATER_EXCHANGE_RATES,
  ELEMENT_COLORS,
} from '@/lib/constants';
import {
  linearRegression,
  meanAndSE,
  combinedOutlierDetection,
  assessDataQuality,
  DataQualityAssessment,
} from '@/lib/statistics';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Cell,
  ReferenceLine,
} from 'recharts';
import {
  AlertTriangle,
  ArrowUpDown,
  Award,
  CheckCircle,
  XCircle,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  Eye,
  EyeOff,
} from 'lucide-react';

interface MutantAnalysis {
  name: string;
  groupKey: string;
  nReplicates: number;
  nValidReplicates: number;
  outlierSamples: string[];
  isBinding: boolean;
  totalMolarity: number;
  totalMolarityError: number;
  kexSlope: number;
  kexSlopeError: number;
  kexR2: number;
  kexPValue: number;
  slopeDirection: 'positive' | 'negative' | 'neutral';
  topElement: string;
  topSelectivity: number;
  enrichmentFactor: number;
  avgCV: number;
  dataQuality: DataQualityAssessment;
  selectivityProfile: Record<string, { mean: number; error: number }>;
  rawReplicateData: Array<{
    sampleName: string;
    isOutlier: boolean;
    values: Record<string, number>;
  }>;
}

type SortField = 'name' | 'kexSlope' | 'kexR2' | 'topSelectivity' | 'avgCV' | 'totalMolarity' | 'nReplicates';
type SortDirection = 'asc' | 'desc';

const BINDING_THRESHOLD = 0.5; // µM

export function MutantRanking() {
  const {
    processedData,
    replicateGroups,
    rawData,
    selectedSamples,
    bufferMeasurement,
  } = useDataStore();

  const [sortField, setSortField] = useState<SortField>('kexSlope');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showOutliers, setShowOutliers] = useState(false);
  const [selectedMutant, setSelectedMutant] = useState<string | null>(null);
  const [compareMutants, setCompareMutants] = useState<string[]>([]);

  // Get elements with k_ex data
  const elementsWithKex = useMemo(() => {
    return (rawData?.elements || [])
      .filter(e => WATER_EXCHANGE_RATES[e] !== undefined)
      .sort((a, b) => LANTHANIDE_ORDER.indexOf(a) - LANTHANIDE_ORDER.indexOf(b));
  }, [rawData?.elements]);

  // Analyze each mutant/replicate group
  const mutantAnalyses = useMemo((): MutantAnalysis[] => {
    if (!rawData || elementsWithKex.length === 0) return [];

    const analyses: MutantAnalysis[] = [];

    for (const group of replicateGroups) {
      // Skip buffer
      if (group.measurements.some(m => m.id === bufferMeasurement?.id)) continue;

      // Filter to selected samples
      const selectedMeasurements = group.measurements.filter(m =>
        selectedSamples.includes(m.id)
      );

      if (selectedMeasurements.length === 0) continue;

      // Detect outliers based on total binding
      const totalMolarities = selectedMeasurements.map(m =>
        elementsWithKex.reduce((sum, e) => sum + Math.max(0, m.normalizedMolarity[e] ?? 0), 0)
      );

      const outlierResult = combinedOutlierDetection(totalMolarities, 2);
      const outlierSet = new Set(outlierResult.outlierIndices);

      // Determine which samples to use
      const validMeasurements = showOutliers
        ? selectedMeasurements
        : selectedMeasurements.filter((_, i) => !outlierSet.has(i));

      const outlierSamples = selectedMeasurements
        .filter((_, i) => outlierSet.has(i))
        .map(m => m.displayName);

      if (validMeasurements.length === 0) continue;

      // Calculate total molarity
      const validTotalMolarities = validMeasurements.map(m =>
        elementsWithKex.reduce((sum, e) => sum + Math.max(0, m.normalizedMolarity[e] ?? 0), 0)
      );
      const { mean: totalMolarity, se: totalMolarityError } = meanAndSE(validTotalMolarities);

      const isBinding = totalMolarity >= BINDING_THRESHOLD;

      // Calculate selectivity profile with error
      const selectivityProfile: Record<string, { mean: number; error: number }> = {};
      for (const element of elementsWithKex) {
        const values = validMeasurements.map(m => m.selectivity[element] ?? 0);
        const { mean, se } = meanAndSE(values);
        selectivityProfile[element] = { mean, error: se };
      }

      // Calculate k_ex slope using mean selectivity
      const kexValues = elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!);
      const bindingValues = elementsWithKex.map(e => selectivityProfile[e].mean);

      let kexSlope = 0;
      let kexSlopeError = 0;
      let kexR2 = 0;
      let kexPValue = 1;

      // Only calculate if there's binding
      if (isBinding && bindingValues.some(v => v > 0)) {
        const regression = linearRegression(kexValues, bindingValues);
        kexSlope = regression.slope;
        kexSlopeError = regression.standardError;
        kexR2 = regression.rSquared;
        kexPValue = regression.pValue;
      }

      // Determine slope direction
      let slopeDirection: 'positive' | 'negative' | 'neutral' = 'neutral';
      if (Math.abs(kexSlope) > kexSlopeError && kexPValue < 0.1) {
        slopeDirection = kexSlope > 0 ? 'positive' : 'negative';
      }

      // Find top element
      const selectivityEntries = Object.entries(selectivityProfile);
      const topEntry = selectivityEntries.reduce(
        (max, curr) => (curr[1].mean > max[1].mean ? curr : max),
        selectivityEntries[0]
      );
      const topElement = topEntry?.[0] || '-';
      const topSelectivity = topEntry?.[1].mean || 0;
      const enrichmentFactor = topSelectivity / (100 / elementsWithKex.length);

      // Calculate average CV across elements
      const cvValues = elementsWithKex.map(e => {
        const values = validMeasurements.map(m => m.selectivity[e] ?? 0);
        const { mean, std } = meanAndSE(values);
        return mean !== 0 ? (std / Math.abs(mean)) * 100 : 0;
      });
      const avgCV = cvValues.reduce((a, b) => a + b, 0) / cvValues.length;

      // Assess data quality
      const dataQuality = assessDataQuality(validTotalMolarities);

      // Raw replicate data for detail view
      const rawReplicateData = selectedMeasurements.map((m, i) => ({
        sampleName: m.displayName,
        isOutlier: outlierSet.has(i),
        values: Object.fromEntries(
          elementsWithKex.map(e => [e, m.selectivity[e] ?? 0])
        ),
      }));

      analyses.push({
        name: group.baseName,
        groupKey: group.baseName,
        nReplicates: selectedMeasurements.length,
        nValidReplicates: validMeasurements.length,
        outlierSamples,
        isBinding,
        totalMolarity,
        totalMolarityError,
        kexSlope,
        kexSlopeError,
        kexR2,
        kexPValue,
        slopeDirection,
        topElement,
        topSelectivity,
        enrichmentFactor,
        avgCV,
        dataQuality,
        selectivityProfile,
        rawReplicateData,
      });
    }

    return analyses;
  }, [
    replicateGroups,
    rawData,
    elementsWithKex,
    selectedSamples,
    bufferMeasurement,
    showOutliers,
  ]);

  // Sort analyses
  const sortedAnalyses = useMemo(() => {
    const sorted = [...mutantAnalyses];

    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'kexSlope':
          comparison = Math.abs(b.kexSlope) - Math.abs(a.kexSlope);
          break;
        case 'kexR2':
          comparison = b.kexR2 - a.kexR2;
          break;
        case 'topSelectivity':
          comparison = b.topSelectivity - a.topSelectivity;
          break;
        case 'avgCV':
          comparison = a.avgCV - b.avgCV; // Lower is better
          break;
        case 'totalMolarity':
          comparison = b.totalMolarity - a.totalMolarity;
          break;
        case 'nReplicates':
          comparison = b.nReplicates - a.nReplicates;
          break;
      }

      return sortDirection === 'desc' ? comparison : -comparison;
    });

    return sorted;
  }, [mutantAnalyses, sortField, sortDirection]);

  // Binding vs non-binding
  const bindingMutants = sortedAnalyses.filter(m => m.isBinding);
  const nonBindingMutants = sortedAnalyses.filter(m => !m.isBinding);

  // Selected mutant details
  const selectedAnalysis = selectedMutant
    ? mutantAnalyses.find(m => m.groupKey === selectedMutant)
    : null;

  // Comparison chart data
  const comparisonData = useMemo(() => {
    if (compareMutants.length < 2) return null;

    const selected = compareMutants
      .map(key => mutantAnalyses.find(m => m.groupKey === key))
      .filter((m): m is MutantAnalysis => m !== null);

    if (selected.length < 2) return null;

    // Bar chart data for selectivity comparison
    const barData = elementsWithKex.map(element => {
      const data: Record<string, string | number> = { element };
      for (const mutant of selected) {
        data[mutant.name] = mutant.selectivityProfile[element]?.mean || 0;
      }
      return data;
    });

    // Scatter data for k_ex plot
    const scatterData = selected.map(mutant => ({
      name: mutant.name,
      data: elementsWithKex.map(e => ({
        element: e,
        kEx: WATER_EXCHANGE_RATES[e]!,
        selectivity: mutant.selectivityProfile[e]?.mean || 0,
      })),
      slope: mutant.kexSlope,
      r2: mutant.kexR2,
    }));

    return { barData, scatterData, mutants: selected };
  }, [compareMutants, mutantAnalyses, elementsWithKex]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const toggleCompare = (groupKey: string) => {
    setCompareMutants(prev =>
      prev.includes(groupKey)
        ? prev.filter(k => k !== groupKey)
        : prev.length < 4
          ? [...prev, groupKey]
          : prev
    );
  };

  const getQualityBadge = (quality: DataQualityAssessment['quality']) => {
    const styles = {
      excellent: 'bg-green-100 text-green-800 border-green-300',
      good: 'bg-blue-100 text-blue-800 border-blue-300',
      acceptable: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      poor: 'bg-orange-100 text-orange-800 border-orange-300',
      unreliable: 'bg-red-100 text-red-800 border-red-300',
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded border ${styles[quality]}`}>
        {quality}
      </span>
    );
  };

  const getSlopeIcon = (direction: 'positive' | 'negative' | 'neutral') => {
    if (direction === 'positive') return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (direction === 'negative') return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  if (!rawData || mutantAnalyses.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <p>No data to analyze. Upload a CSV file and ensure you have replicate groups.</p>
        <p className="text-sm mt-2">
          This analysis requires multiple replicates per mutant for statistical comparisons.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Mutant Comparison Analysis</h2>
            <p className="text-sm text-gray-600">
              Compare protein mutants by selectivity profile and water exchange rate correlation
            </p>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showOutliers}
                onChange={e => setShowOutliers(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-gray-700">Include outliers</span>
              {showOutliers ? (
                <Eye className="w-4 h-4 text-gray-500" />
              ) : (
                <EyeOff className="w-4 h-4 text-gray-400" />
              )}
            </label>

            {compareMutants.length > 0 && (
              <button
                onClick={() => setCompareMutants([])}
                className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                Clear Comparison ({compareMutants.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-600">{mutantAnalyses.length}</div>
          <div className="text-sm text-gray-600">Total Mutants</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-2xl font-bold text-green-600">{bindingMutants.length}</div>
          <div className="text-sm text-gray-600">Binding Mutants</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-2xl font-bold text-purple-600">
            {bindingMutants.filter(m => m.slopeDirection !== 'neutral').length}
          </div>
          <div className="text-sm text-gray-600">Significant k_ex Correlation</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-2xl font-bold text-orange-600">
            {mutantAnalyses.filter(m => m.outlierSamples.length > 0).length}
          </div>
          <div className="text-sm text-gray-600">Groups with Outliers</div>
        </div>
      </div>

      {/* Non-binding warning */}
      {nonBindingMutants.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-yellow-800">
                {nonBindingMutants.length} mutant(s) show no significant binding
              </h4>
              <div className="flex flex-wrap gap-2 mt-2">
                {nonBindingMutants.map(m => (
                  <span
                    key={m.groupKey}
                    className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded"
                  >
                    {m.name} ({m.totalMolarity.toFixed(2)} µM)
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Ranking Table */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h3 className="font-semibold">Mutant Ranking</h3>
          <p className="text-sm text-gray-500">
            Click column headers to sort. Check boxes to compare mutants.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-3 py-2 text-left">Compare</th>
                <th
                  className="px-3 py-2 text-left cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1">
                    Mutant
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="px-3 py-2 text-center cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('nReplicates')}
                >
                  <div className="flex items-center justify-center gap-1">
                    n
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="px-3 py-2 text-center">Quality</th>
                <th
                  className="px-3 py-2 text-center cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('kexSlope')}
                >
                  <div className="flex items-center justify-center gap-1">
                    k_ex Slope
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="px-3 py-2 text-center cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('kexR2')}
                >
                  <div className="flex items-center justify-center gap-1">
                    R²
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="px-3 py-2 text-center">Top Element</th>
                <th
                  className="px-3 py-2 text-center cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('topSelectivity')}
                >
                  <div className="flex items-center justify-center gap-1">
                    Max Sel.
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="px-3 py-2 text-center cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('avgCV')}
                >
                  <div className="flex items-center justify-center gap-1">
                    Avg CV%
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedAnalyses.map((analysis, idx) => (
                <tr
                  key={analysis.groupKey}
                  className={`
                    border-t hover:bg-blue-50
                    ${!analysis.isBinding ? 'bg-gray-50 text-gray-500' : ''}
                    ${selectedMutant === analysis.groupKey ? 'bg-blue-100' : ''}
                    ${idx === 0 && analysis.isBinding ? 'bg-green-50' : ''}
                  `}
                >
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={compareMutants.includes(analysis.groupKey)}
                      onChange={() => toggleCompare(analysis.groupKey)}
                      disabled={!analysis.isBinding}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <div className="flex items-center gap-2">
                      {idx === 0 && analysis.isBinding && (
                        <Award className="w-4 h-4 text-yellow-500" />
                      )}
                      {analysis.name}
                      {analysis.outlierSamples.length > 0 && (
                        <span className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">
                          {analysis.outlierSamples.length} outlier
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={analysis.nValidReplicates !== analysis.nReplicates ? 'text-orange-600' : ''}>
                      {analysis.nValidReplicates}
                      {analysis.nValidReplicates !== analysis.nReplicates && (
                        <span className="text-gray-400">/{analysis.nReplicates}</span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {getQualityBadge(analysis.dataQuality.quality)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {analysis.isBinding ? (
                      <div className="flex items-center justify-center gap-1">
                        {getSlopeIcon(analysis.slopeDirection)}
                        <span className="font-mono">
                          {analysis.kexSlope.toFixed(3)}
                          <span className="text-gray-400 text-xs ml-1">
                            ±{analysis.kexSlopeError.toFixed(3)}
                          </span>
                        </span>
                      </div>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2 text-center font-mono">
                    {analysis.isBinding ? (
                      <span className={analysis.kexR2 > 0.5 ? 'text-green-600 font-semibold' : ''}>
                        {analysis.kexR2.toFixed(3)}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {analysis.isBinding ? (
                      <span
                        className="px-2 py-1 rounded text-white text-xs font-bold"
                        style={{ backgroundColor: ELEMENT_COLORS[analysis.topElement] || '#666' }}
                      >
                        {analysis.topElement}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2 text-center font-mono">
                    {analysis.isBinding ? `${analysis.topSelectivity.toFixed(1)}%` : '-'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`font-mono ${
                        analysis.avgCV > 30
                          ? 'text-red-600'
                          : analysis.avgCV > 20
                            ? 'text-orange-600'
                            : 'text-green-600'
                      }`}
                    >
                      {analysis.avgCV.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() =>
                        setSelectedMutant(selectedMutant === analysis.groupKey ? null : analysis.groupKey)
                      }
                      className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      {selectedMutant === analysis.groupKey ? 'Hide' : 'Details'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Interpretation Guide */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
        <h4 className="font-semibold text-blue-800 mb-2">How to interpret k_ex slope:</h4>
        <ul className="space-y-1 text-blue-700">
          <li className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <strong>Positive slope:</strong> Prefers lanthanides with faster water exchange (smaller ions, Yb/Lu side)
          </li>
          <li className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-red-600" />
            <strong>Negative slope:</strong> Prefers lanthanides with slower water exchange (larger ions, La/Ce side)
          </li>
          <li className="flex items-center gap-2">
            <Minus className="w-4 h-4 text-gray-400" />
            <strong>Neutral:</strong> No significant correlation with water exchange rate
          </li>
          <li>
            <strong>Higher |slope| + higher R²</strong> = Stronger size/kinetics selectivity - useful for engineering
          </li>
        </ul>
      </div>

      {/* Selected Mutant Details */}
      {selectedAnalysis && (
        <div className="bg-white border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{selectedAnalysis.name} - Detailed Analysis</h3>
            <button
              onClick={() => setSelectedMutant(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          {/* Quality Warning */}
          {selectedAnalysis.dataQuality.quality === 'poor' ||
          selectedAnalysis.dataQuality.quality === 'unreliable' ? (
            <div className="bg-orange-50 border border-orange-200 rounded p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0" />
                <div>
                  <div className="font-medium text-orange-800">Data Quality Warning</div>
                  <div className="text-sm text-orange-700">
                    {selectedAnalysis.dataQuality.recommendation}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Replicate Details */}
          <div>
            <h4 className="font-medium mb-2">Replicate Samples</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border px-2 py-1 text-left">Sample</th>
                    <th className="border px-2 py-1 text-center">Status</th>
                    {elementsWithKex.map(e => (
                      <th key={e} className="border px-2 py-1 text-center text-xs">
                        {e}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedAnalysis.rawReplicateData.map(rep => (
                    <tr
                      key={rep.sampleName}
                      className={rep.isOutlier ? 'bg-red-50' : 'hover:bg-blue-50'}
                    >
                      <td className="border px-2 py-1 font-medium">{rep.sampleName}</td>
                      <td className="border px-2 py-1 text-center">
                        {rep.isOutlier ? (
                          <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded">
                            Outlier
                          </span>
                        ) : (
                          <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />
                        )}
                      </td>
                      {elementsWithKex.map(e => (
                        <td key={e} className="border px-2 py-1 text-center font-mono text-xs">
                          {rep.values[e]?.toFixed(1)}%
                        </td>
                      ))}
                    </tr>
                  ))}
                  {/* Mean row */}
                  <tr className="bg-blue-50 font-semibold">
                    <td className="border px-2 py-1">Mean</td>
                    <td className="border px-2 py-1 text-center">-</td>
                    {elementsWithKex.map(e => (
                      <td key={e} className="border px-2 py-1 text-center font-mono text-xs">
                        {selectedAnalysis.selectivityProfile[e]?.mean.toFixed(1)}%
                        <span className="text-gray-400 ml-1">
                          ±{selectedAnalysis.selectivityProfile[e]?.error.toFixed(1)}
                        </span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* k_ex Plot for single mutant */}
          {selectedAnalysis.isBinding && (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="kEx"
                    type="number"
                    name="k_ex"
                    label={{
                      value: 'k_ex [10⁸ s⁻¹]',
                      position: 'bottom',
                      offset: 20,
                    }}
                  />
                  <YAxis
                    dataKey="selectivity"
                    type="number"
                    name="Selectivity"
                    label={{
                      value: 'Selectivity (%)',
                      angle: -90,
                      position: 'insideLeft',
                      offset: -45,
                    }}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value.toFixed(2)}${name === 'selectivity' ? '%' : ''}`,
                      name,
                    ]}
                    labelFormatter={(label) => `k_ex: ${label}`}
                  />
                  <Scatter
                    name={selectedAnalysis.name}
                    data={elementsWithKex.map(e => ({
                      element: e,
                      kEx: WATER_EXCHANGE_RATES[e],
                      selectivity: selectedAnalysis.selectivityProfile[e]?.mean || 0,
                    }))}
                  >
                    {elementsWithKex.map((e, i) => (
                      <Cell key={i} fill={ELEMENT_COLORS[e] || '#666'} />
                    ))}
                  </Scatter>
                  {selectedAnalysis.kexR2 > 0.1 && (
                    <ReferenceLine
                      segment={[
                        {
                          x: Math.min(...elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!)),
                          y:
                            selectedAnalysis.kexSlope *
                              Math.min(...elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!)) +
                            (selectedAnalysis.selectivityProfile[elementsWithKex[0]]?.mean || 0) -
                            selectedAnalysis.kexSlope * WATER_EXCHANGE_RATES[elementsWithKex[0]]!,
                        },
                        {
                          x: Math.max(...elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!)),
                          y:
                            selectedAnalysis.kexSlope *
                              Math.max(...elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!)) +
                            (selectedAnalysis.selectivityProfile[elementsWithKex[0]]?.mean || 0) -
                            selectedAnalysis.kexSlope * WATER_EXCHANGE_RATES[elementsWithKex[0]]!,
                        },
                      ]}
                      stroke="#666"
                      strokeDasharray="5 5"
                    />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Multi-mutant Comparison */}
      {comparisonData && (
        <div className="bg-white border rounded-lg p-4 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              Comparing: {comparisonData.mutants.map(m => m.name).join(' vs ')}
            </h3>
            <button
              onClick={() => setCompareMutants([])}
              className="text-gray-400 hover:text-gray-600"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          {/* Comparison Summary Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border px-3 py-2 text-left">Metric</th>
                  {comparisonData.mutants.map(m => (
                    <th key={m.groupKey} className="border px-3 py-2 text-center">
                      {m.name}
                    </th>
                  ))}
                  <th className="border px-3 py-2 text-center">Best</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border px-3 py-2 font-medium">k_ex Slope</td>
                  {comparisonData.mutants.map(m => (
                    <td key={m.groupKey} className="border px-3 py-2 text-center font-mono">
                      <div className="flex items-center justify-center gap-1">
                        {getSlopeIcon(m.slopeDirection)}
                        {m.kexSlope.toFixed(3)}
                      </div>
                    </td>
                  ))}
                  <td className="border px-3 py-2 text-center font-semibold text-green-600">
                    {
                      comparisonData.mutants.reduce((best, curr) =>
                        Math.abs(curr.kexSlope) > Math.abs(best.kexSlope) ? curr : best
                      ).name
                    }
                  </td>
                </tr>
                <tr>
                  <td className="border px-3 py-2 font-medium">R² (k_ex)</td>
                  {comparisonData.mutants.map(m => (
                    <td key={m.groupKey} className="border px-3 py-2 text-center font-mono">
                      {m.kexR2.toFixed(3)}
                    </td>
                  ))}
                  <td className="border px-3 py-2 text-center font-semibold text-green-600">
                    {comparisonData.mutants.reduce((best, curr) => (curr.kexR2 > best.kexR2 ? curr : best)).name}
                  </td>
                </tr>
                <tr>
                  <td className="border px-3 py-2 font-medium">Top Selectivity</td>
                  {comparisonData.mutants.map(m => (
                    <td key={m.groupKey} className="border px-3 py-2 text-center">
                      <span
                        className="px-2 py-1 rounded text-white text-xs font-bold"
                        style={{ backgroundColor: ELEMENT_COLORS[m.topElement] || '#666' }}
                      >
                        {m.topElement}
                      </span>
                      <span className="ml-2 font-mono">{m.topSelectivity.toFixed(1)}%</span>
                    </td>
                  ))}
                  <td className="border px-3 py-2 text-center font-semibold text-green-600">
                    {
                      comparisonData.mutants.reduce((best, curr) =>
                        curr.topSelectivity > best.topSelectivity ? curr : best
                      ).name
                    }
                  </td>
                </tr>
                <tr>
                  <td className="border px-3 py-2 font-medium">Avg CV%</td>
                  {comparisonData.mutants.map(m => (
                    <td
                      key={m.groupKey}
                      className={`border px-3 py-2 text-center font-mono ${
                        m.avgCV > 30 ? 'text-red-600' : m.avgCV > 20 ? 'text-orange-600' : ''
                      }`}
                    >
                      {m.avgCV.toFixed(1)}%
                    </td>
                  ))}
                  <td className="border px-3 py-2 text-center font-semibold text-green-600">
                    {comparisonData.mutants.reduce((best, curr) => (curr.avgCV < best.avgCV ? curr : best)).name}
                  </td>
                </tr>
                <tr>
                  <td className="border px-3 py-2 font-medium">Data Quality</td>
                  {comparisonData.mutants.map(m => (
                    <td key={m.groupKey} className="border px-3 py-2 text-center">
                      {getQualityBadge(m.dataQuality.quality)}
                    </td>
                  ))}
                  <td className="border px-3 py-2 text-center">-</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Selectivity Bar Chart Comparison */}
          <div>
            <h4 className="font-medium mb-2">Selectivity Profile Comparison</h4>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData.barData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="element" />
                  <YAxis label={{ value: 'Selectivity (%)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  {comparisonData.mutants.map((m, i) => (
                    <Bar
                      key={m.groupKey}
                      dataKey={m.name}
                      fill={['#ef4444', '#3b82f6', '#10b981', '#f59e0b'][i % 4]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* k_ex Scatter Comparison */}
          <div>
            <h4 className="font-medium mb-2">Water Exchange Rate Correlation</h4>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="kEx"
                    type="number"
                    name="k_ex"
                    label={{ value: 'k_ex [10⁸ s⁻¹]', position: 'bottom', offset: 20 }}
                  />
                  <YAxis
                    dataKey="selectivity"
                    type="number"
                    name="Selectivity"
                    label={{ value: 'Selectivity (%)', angle: -90, position: 'insideLeft', offset: -45 }}
                  />
                  <Tooltip />
                  <Legend />
                  {comparisonData.scatterData.map((mutant, i) => (
                    <Scatter
                      key={mutant.name}
                      name={`${mutant.name} (R²=${mutant.r2.toFixed(2)})`}
                      data={mutant.data}
                      fill={['#ef4444', '#3b82f6', '#10b981', '#f59e0b'][i % 4]}
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
