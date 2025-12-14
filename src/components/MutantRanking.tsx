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
  assessDataQuality,
  DataQualityAssessment,
  selectivityEntropy,
  lightHeavyDiscrimination,
  kexPreferenceStrength,
  calculateLightHeavyOffset,
  LightHeavyOffsetResult,
  compareMutants as compareMutantStats,
  PairwiseComparisonResult,
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
  ComposedChart,
  Line,
  ErrorBar,
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
  BarChart3,
  Zap,
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
    totalMolarity: number;
  }>;
  // New metrics
  entropy: number;
  normalizedEntropy: number;
  entropyInterpretation: string;
  lightHeavyScore: number;
  lightHeavyPreference: 'light' | 'heavy' | 'balanced';
  kexStrength: number;
  kexStrengthInterpretation: string;
  lightHeavyOffset: LightHeavyOffsetResult;
  lightRegression: LinearRegressionResult | null;
  heavyRegression: LinearRegressionResult | null;
}

type SortField = 'name' | 'kexSlope' | 'kexR2' | 'topSelectivity' | 'avgCV' | 'totalMolarity' | 'nReplicates' | 'entropy' | 'lightHeavyScore' | 'kexStrength' | 'lightSlope' | 'heavySlope' | 'lightHeavyOffset';
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
  const [comparingMutants, setComparingMutants] = useState<string[]>([]);

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
        totalMolarity: totalMolarities[i],
      }));

      // Calculate new metrics
      const meanSelectivityProfile: Record<string, number> = {};
      for (const e of elementsWithKex) {
        meanSelectivityProfile[e] = selectivityProfile[e]?.mean ?? 0;
      }

      // Entropy
      const entropyResult = selectivityEntropy(meanSelectivityProfile);

      // Light/Heavy discrimination
      const lightElements = elementsWithKex.filter(e => LIGHT_REE.includes(e));
      const heavyElements = elementsWithKex.filter(e => HEAVY_REE.includes(e));
      const lhResult = lightHeavyDiscrimination(meanSelectivityProfile, lightElements, heavyElements);

      // k_ex preference strength
      const kexStrengthResult = kexPreferenceStrength(kexSlope, kexSlopeError, kexR2, kexPValue);

      // Calculate separate regressions for light and heavy lanthanides
      let lightRegression: LinearRegressionResult | null = null;
      let heavyRegression: LinearRegressionResult | null = null;

      if (isBinding) {
        const lightKex = lightElements.map(e => WATER_EXCHANGE_RATES[e]!);
        const lightSel = lightElements.map(e => selectivityProfile[e]?.mean ?? 0);
        const heavyKex = heavyElements.map(e => WATER_EXCHANGE_RATES[e]!);
        const heavySel = heavyElements.map(e => selectivityProfile[e]?.mean ?? 0);

        if (lightKex.length >= 2 && lightSel.some(v => v > 0)) {
          lightRegression = linearRegression(lightKex, lightSel);
        }
        if (heavyKex.length >= 2 && heavySel.some(v => v > 0)) {
          heavyRegression = linearRegression(heavyKex, heavySel);
        }
      }

      // Light/Heavy offset
      const midpointKex = (Math.max(...elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!)) +
                          Math.min(...elementsWithKex.map(e => WATER_EXCHANGE_RATES[e]!))) / 2;
      const lightHeavyOffset = calculateLightHeavyOffset(lightRegression, heavyRegression, midpointKex);

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
        // New metrics
        entropy: entropyResult.entropy,
        normalizedEntropy: entropyResult.normalizedEntropy,
        entropyInterpretation: entropyResult.interpretation,
        lightHeavyScore: lhResult.score,
        lightHeavyPreference: lhResult.preference,
        kexStrength: kexStrengthResult.strength,
        kexStrengthInterpretation: kexStrengthResult.interpretation,
        lightHeavyOffset,
        lightRegression,
        heavyRegression,
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
        case 'entropy':
          comparison = a.normalizedEntropy - b.normalizedEntropy; // Lower = more selective
          break;
        case 'lightHeavyScore':
          comparison = Math.abs(b.lightHeavyScore) - Math.abs(a.lightHeavyScore); // Higher magnitude = stronger preference
          break;
        case 'kexStrength':
          comparison = b.kexStrength - a.kexStrength;
          break;
        case 'lightSlope':
          comparison = Math.abs(b.lightRegression?.slope ?? 0) - Math.abs(a.lightRegression?.slope ?? 0);
          break;
        case 'heavySlope':
          comparison = Math.abs(b.heavyRegression?.slope ?? 0) - Math.abs(a.heavyRegression?.slope ?? 0);
          break;
        case 'lightHeavyOffset':
          comparison = Math.abs(b.lightHeavyOffset.offset) - Math.abs(a.lightHeavyOffset.offset);
          break;
      }

      return sortDirection === 'desc' ? comparison : -comparison;
    });

    return sorted;
  }, [mutantAnalyses, sortField, sortDirection]);

  // Calculate pairwise comparisons when comparing mutants
  const pairwiseComparisons = useMemo((): PairwiseComparisonResult[] => {
    if (comparingMutants.length < 2) return [];

    const results: PairwiseComparisonResult[] = [];
    const selectedMutantsForComparison = comparingMutants
      .map(key => mutantAnalyses.find(m => m.groupKey === key))
      .filter((m): m is MutantAnalysis => m !== null);

    // Compare each pair
    for (let i = 0; i < selectedMutantsForComparison.length; i++) {
      for (let j = i + 1; j < selectedMutantsForComparison.length; j++) {
        const a = selectedMutantsForComparison[i];
        const b = selectedMutantsForComparison[j];

        // Compare total molarity
        const molaritiesA = a.rawReplicateData.filter(r => !r.isOutlier).map(r => r.totalMolarity);
        const molaritiesB = b.rawReplicateData.filter(r => !r.isOutlier).map(r => r.totalMolarity);

        if (molaritiesA.length >= 2 && molaritiesB.length >= 2) {
          results.push(compareMutantStats(molaritiesA, molaritiesB, a.name, b.name, 'Total Binding'));
        }
      }
    }

    return results;
  }, [comparingMutants, mutantAnalyses]);

  // Box plot data for replicate distributions
  const boxPlotData = useMemo(() => {
    if (!selectedMutant) return null;

    const analysis = mutantAnalyses.find(m => m.groupKey === selectedMutant);
    if (!analysis) return null;

    return analysis.rawReplicateData.map(rep => ({
      name: rep.sampleName.replace(analysis.name, '').replace(/^[-_]/, '') || rep.sampleName,
      value: rep.totalMolarity,
      isOutlier: rep.isOutlier,
    }));
  }, [selectedMutant, mutantAnalyses]);

  // Binding vs non-binding
  const bindingMutants = sortedAnalyses.filter(m => m.isBinding);
  const nonBindingMutants = sortedAnalyses.filter(m => !m.isBinding);

  // Selected mutant details
  const selectedAnalysis = selectedMutant
    ? mutantAnalyses.find(m => m.groupKey === selectedMutant)
    : null;

  // Comparison chart data
  const comparisonData = useMemo(() => {
    if (comparingMutants.length < 2) return null;

    const selected = comparingMutants
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
  }, [comparingMutants, mutantAnalyses, elementsWithKex]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const toggleCompare = (groupKey: string) => {
    setComparingMutants(prev =>
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

            {comparingMutants.length > 0 && (
              <button
                onClick={() => setComparingMutants([])}
                className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                Clear Comparison ({comparingMutants.length})
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
                <th
                  className="px-3 py-2 text-center cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('entropy')}
                  title="Lower entropy = more selective"
                >
                  <div className="flex items-center justify-center gap-1">
                    Selectivity
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="px-3 py-2 text-center cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('lightHeavyScore')}
                  title="Positive = prefers light REE, Negative = prefers heavy REE"
                >
                  <div className="flex items-center justify-center gap-1">
                    L/H Pref.
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="px-3 py-2 text-center cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('kexStrength')}
                  title="k_ex preference strength index (0-1)"
                >
                  <div className="flex items-center justify-center gap-1">
                    k_ex Str.
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="px-3 py-2 text-center cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('lightSlope')}
                  title="Slope of selectivity vs k_ex for light REE (La-Eu)"
                >
                  <div className="flex items-center justify-center gap-1">
                    Light Slope
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="px-3 py-2 text-center cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('heavySlope')}
                  title="Slope of selectivity vs k_ex for heavy REE (Gd-Lu)"
                >
                  <div className="flex items-center justify-center gap-1">
                    Heavy Slope
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="px-3 py-2 text-center cursor-pointer hover:bg-gray-200"
                  onClick={() => handleSort('lightHeavyOffset')}
                  title="Vertical offset between light and heavy regression lines (% selectivity)"
                >
                  <div className="flex items-center justify-center gap-1">
                    L/H Offset
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
                      checked={comparingMutants.includes(analysis.groupKey)}
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
                    {analysis.isBinding ? (
                      <span
                        className={`px-2 py-0.5 text-xs rounded ${
                          analysis.entropyInterpretation === 'highly selective'
                            ? 'bg-green-100 text-green-800'
                            : analysis.entropyInterpretation === 'selective'
                              ? 'bg-blue-100 text-blue-800'
                              : analysis.entropyInterpretation === 'moderate'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-gray-100 text-gray-800'
                        }`}
                        title={`Entropy: ${analysis.entropy.toFixed(2)}, Normalized: ${(analysis.normalizedEntropy * 100).toFixed(0)}%`}
                      >
                        {analysis.entropyInterpretation}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {analysis.isBinding ? (
                      <span
                        className={`px-2 py-0.5 text-xs font-mono rounded ${
                          analysis.lightHeavyPreference === 'light'
                            ? 'bg-orange-100 text-orange-800'
                            : analysis.lightHeavyPreference === 'heavy'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-gray-100 text-gray-600'
                        }`}
                        title={`Light/Heavy Score: ${analysis.lightHeavyScore.toFixed(2)}`}
                      >
                        {analysis.lightHeavyPreference === 'light'
                          ? `L+${Math.abs(analysis.lightHeavyScore).toFixed(1)}`
                          : analysis.lightHeavyPreference === 'heavy'
                            ? `H+${Math.abs(analysis.lightHeavyScore).toFixed(1)}`
                            : '~0'}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {analysis.isBinding ? (
                      <div
                        className="flex items-center justify-center gap-1"
                        title={`k_ex preference strength: ${analysis.kexStrengthInterpretation}`}
                      >
                        <Zap
                          className={`w-3 h-3 ${
                            analysis.kexStrengthInterpretation === 'strong'
                              ? 'text-green-600'
                              : analysis.kexStrengthInterpretation === 'moderate'
                                ? 'text-yellow-600'
                                : analysis.kexStrengthInterpretation === 'weak'
                                  ? 'text-orange-600'
                                  : 'text-gray-400'
                          }`}
                        />
                        <span className="font-mono text-xs">
                          {(analysis.kexStrength * 100).toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {analysis.isBinding && analysis.lightRegression ? (
                      <span
                        className={`font-mono text-xs ${
                          analysis.lightRegression.slope > 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                        title={`R²=${analysis.lightRegression.rSquared.toFixed(2)}`}
                      >
                        {analysis.lightRegression.slope > 0 ? '+' : ''}
                        {analysis.lightRegression.slope.toFixed(3)}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {analysis.isBinding && analysis.heavyRegression ? (
                      <span
                        className={`font-mono text-xs ${
                          analysis.heavyRegression.slope > 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                        title={`R²=${analysis.heavyRegression.rSquared.toFixed(2)}`}
                      >
                        {analysis.heavyRegression.slope > 0 ? '+' : ''}
                        {analysis.heavyRegression.slope.toFixed(3)}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {analysis.isBinding && analysis.lightHeavyOffset.isSignificant ? (
                      <span
                        className={`font-mono text-xs font-semibold ${
                          analysis.lightHeavyOffset.offset > 0 ? 'text-purple-600' : 'text-orange-600'
                        }`}
                        title={analysis.lightHeavyOffset.interpretation}
                      >
                        {analysis.lightHeavyOffset.offset > 0 ? '+' : ''}
                        {analysis.lightHeavyOffset.offset.toFixed(1)}%
                      </span>
                    ) : analysis.isBinding ? (
                      <span className="text-gray-400 text-xs">~0</span>
                    ) : (
                      '-'
                    )}
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

          {/* Advanced Metrics Summary */}
          {selectedAnalysis.isBinding && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Entropy/Selectivity */}
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">Selectivity Breadth</div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-lg font-bold ${
                    selectedAnalysis.entropyInterpretation === 'highly selective'
                      ? 'text-green-600'
                      : selectedAnalysis.entropyInterpretation === 'selective'
                        ? 'text-blue-600'
                        : selectedAnalysis.entropyInterpretation === 'moderate'
                          ? 'text-yellow-600'
                          : 'text-gray-600'
                  }`}>
                    {selectedAnalysis.entropyInterpretation}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Entropy: {selectedAnalysis.entropy.toFixed(2)} ({(selectedAnalysis.normalizedEntropy * 100).toFixed(0)}% of max)
                </div>
              </div>

              {/* Light/Heavy Preference */}
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">L/H REE Preference</div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-lg font-bold ${
                    selectedAnalysis.lightHeavyPreference === 'light'
                      ? 'text-orange-600'
                      : selectedAnalysis.lightHeavyPreference === 'heavy'
                        ? 'text-purple-600'
                        : 'text-gray-600'
                  }`}>
                    {selectedAnalysis.lightHeavyPreference === 'light'
                      ? 'Light REE'
                      : selectedAnalysis.lightHeavyPreference === 'heavy'
                        ? 'Heavy REE'
                        : 'Balanced'}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Score: {selectedAnalysis.lightHeavyScore.toFixed(2)}
                </div>
              </div>

              {/* k_ex Strength */}
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">k_ex Preference Strength</div>
                <div className="flex items-center gap-2">
                  <Zap className={`w-5 h-5 ${
                    selectedAnalysis.kexStrengthInterpretation === 'strong'
                      ? 'text-green-600'
                      : selectedAnalysis.kexStrengthInterpretation === 'moderate'
                        ? 'text-yellow-600'
                        : selectedAnalysis.kexStrengthInterpretation === 'weak'
                          ? 'text-orange-600'
                          : 'text-gray-400'
                  }`} />
                  <span className="text-lg font-bold">
                    {selectedAnalysis.kexStrengthInterpretation}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Index: {(selectedAnalysis.kexStrength * 100).toFixed(0)}%
                </div>
              </div>

              {/* Light/Heavy Offset */}
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">L/H Line Offset</div>
                {selectedAnalysis.lightHeavyOffset.isSignificant ? (
                  <>
                    <div className="text-lg font-bold text-blue-600">
                      {selectedAnalysis.lightHeavyOffset.offset.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {selectedAnalysis.lightHeavyOffset.interpretation}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-gray-500">
                    {selectedAnalysis.lightHeavyOffset.interpretation}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Light/Heavy Slope Details */}
          {selectedAnalysis.isBinding && (selectedAnalysis.lightRegression || selectedAnalysis.heavyRegression) && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-orange-50 rounded-lg p-3">
                <div className="text-xs text-orange-600 mb-1 font-medium">Light REE Slope (La-Eu)</div>
                {selectedAnalysis.lightRegression ? (
                  <>
                    <div className={`text-xl font-bold ${
                      selectedAnalysis.lightRegression.slope > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {selectedAnalysis.lightRegression.slope > 0 ? '+' : ''}
                      {selectedAnalysis.lightRegression.slope.toFixed(4)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                      <div>R² = {selectedAnalysis.lightRegression.rSquared.toFixed(3)}</div>
                      <div>SE = ±{selectedAnalysis.lightRegression.standardError.toFixed(4)}</div>
                      <div>p = {selectedAnalysis.lightRegression.pValue < 0.001 ? '<0.001' : selectedAnalysis.lightRegression.pValue.toFixed(3)}</div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-gray-500">Insufficient data</div>
                )}
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <div className="text-xs text-purple-600 mb-1 font-medium">Heavy REE Slope (Gd-Lu)</div>
                {selectedAnalysis.heavyRegression ? (
                  <>
                    <div className={`text-xl font-bold ${
                      selectedAnalysis.heavyRegression.slope > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {selectedAnalysis.heavyRegression.slope > 0 ? '+' : ''}
                      {selectedAnalysis.heavyRegression.slope.toFixed(4)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                      <div>R² = {selectedAnalysis.heavyRegression.rSquared.toFixed(3)}</div>
                      <div>SE = ±{selectedAnalysis.heavyRegression.standardError.toFixed(4)}</div>
                      <div>p = {selectedAnalysis.heavyRegression.pValue < 0.001 ? '<0.001' : selectedAnalysis.heavyRegression.pValue.toFixed(3)}</div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-gray-500">Insufficient data</div>
                )}
              </div>
            </div>
          )}

          {/* Box Plot - Replicate Distribution */}
          {boxPlotData && boxPlotData.length > 0 && (
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Replicate Distribution (Total Binding)
              </h4>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={boxPlotData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis label={{ value: 'Total µM', angle: -90, position: 'insideLeft' }} />
                    <Tooltip
                      formatter={(value: number) => [`${value.toFixed(2)} µM`, 'Total Binding']}
                    />
                    <Bar dataKey="value" name="Total Binding">
                      {boxPlotData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.isOutlier ? '#ef4444' : '#3b82f6'}
                          opacity={entry.isOutlier ? 0.6 : 1}
                        />
                      ))}
                    </Bar>
                    <ReferenceLine
                      y={selectedAnalysis.totalMolarity}
                      stroke="#10b981"
                      strokeDasharray="5 5"
                      label={{ value: 'Mean', position: 'right', fill: '#10b981' }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-4 text-xs text-gray-500 mt-2">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-blue-500 rounded-sm" /> Valid
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-red-500 opacity-60 rounded-sm" /> Outlier
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-6 h-0.5 bg-green-500" style={{ borderStyle: 'dashed' }} /> Mean
                </span>
              </div>
            </div>
          )}

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
              onClick={() => setComparingMutants([])}
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
                <tr className="bg-blue-50">
                  <td className="border px-3 py-2 font-medium">Selectivity (Entropy)</td>
                  {comparisonData.mutants.map(m => (
                    <td key={m.groupKey} className="border px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        m.entropyInterpretation === 'highly selective'
                          ? 'bg-green-100 text-green-800'
                          : m.entropyInterpretation === 'selective'
                            ? 'bg-blue-100 text-blue-800'
                            : m.entropyInterpretation === 'moderate'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                      }`}>
                        {m.entropyInterpretation}
                      </span>
                    </td>
                  ))}
                  <td className="border px-3 py-2 text-center font-semibold text-green-600">
                    {comparisonData.mutants.reduce((best, curr) =>
                      curr.normalizedEntropy < best.normalizedEntropy ? curr : best
                    ).name}
                  </td>
                </tr>
                <tr className="bg-blue-50">
                  <td className="border px-3 py-2 font-medium">L/H REE Preference</td>
                  {comparisonData.mutants.map(m => (
                    <td key={m.groupKey} className="border px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 text-xs font-mono rounded ${
                        m.lightHeavyPreference === 'light'
                          ? 'bg-orange-100 text-orange-800'
                          : m.lightHeavyPreference === 'heavy'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-gray-100 text-gray-600'
                      }`}>
                        {m.lightHeavyPreference === 'light'
                          ? `Light +${Math.abs(m.lightHeavyScore).toFixed(1)}`
                          : m.lightHeavyPreference === 'heavy'
                            ? `Heavy +${Math.abs(m.lightHeavyScore).toFixed(1)}`
                            : 'Balanced'}
                      </span>
                    </td>
                  ))}
                  <td className="border px-3 py-2 text-center font-semibold text-green-600">
                    {comparisonData.mutants.reduce((best, curr) =>
                      Math.abs(curr.lightHeavyScore) > Math.abs(best.lightHeavyScore) ? curr : best
                    ).name}
                  </td>
                </tr>
                <tr className="bg-blue-50">
                  <td className="border px-3 py-2 font-medium">k_ex Strength</td>
                  {comparisonData.mutants.map(m => (
                    <td key={m.groupKey} className="border px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Zap className={`w-3 h-3 ${
                          m.kexStrengthInterpretation === 'strong'
                            ? 'text-green-600'
                            : m.kexStrengthInterpretation === 'moderate'
                              ? 'text-yellow-600'
                              : m.kexStrengthInterpretation === 'weak'
                                ? 'text-orange-600'
                                : 'text-gray-400'
                        }`} />
                        <span className="font-mono text-xs">
                          {(m.kexStrength * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  ))}
                  <td className="border px-3 py-2 text-center font-semibold text-green-600">
                    {comparisonData.mutants.reduce((best, curr) =>
                      curr.kexStrength > best.kexStrength ? curr : best
                    ).name}
                  </td>
                </tr>
                <tr className="bg-purple-50">
                  <td className="border px-3 py-2 font-medium">Light REE Slope</td>
                  {comparisonData.mutants.map(m => (
                    <td key={m.groupKey} className="border px-3 py-2 text-center font-mono">
                      {m.lightRegression ? (
                        <span className={m.lightRegression.slope > 0 ? 'text-green-600' : 'text-red-600'}>
                          {m.lightRegression.slope > 0 ? '+' : ''}
                          {m.lightRegression.slope.toFixed(3)}
                        </span>
                      ) : '-'}
                    </td>
                  ))}
                  <td className="border px-3 py-2 text-center font-semibold text-green-600">
                    {comparisonData.mutants.filter(m => m.lightRegression).length > 0
                      ? comparisonData.mutants
                          .filter(m => m.lightRegression)
                          .reduce((best, curr) =>
                            Math.abs(curr.lightRegression?.slope ?? 0) > Math.abs(best.lightRegression?.slope ?? 0)
                              ? curr
                              : best
                          ).name
                      : '-'}
                  </td>
                </tr>
                <tr className="bg-purple-50">
                  <td className="border px-3 py-2 font-medium">Heavy REE Slope</td>
                  {comparisonData.mutants.map(m => (
                    <td key={m.groupKey} className="border px-3 py-2 text-center font-mono">
                      {m.heavyRegression ? (
                        <span className={m.heavyRegression.slope > 0 ? 'text-green-600' : 'text-red-600'}>
                          {m.heavyRegression.slope > 0 ? '+' : ''}
                          {m.heavyRegression.slope.toFixed(3)}
                        </span>
                      ) : '-'}
                    </td>
                  ))}
                  <td className="border px-3 py-2 text-center font-semibold text-green-600">
                    {comparisonData.mutants.filter(m => m.heavyRegression).length > 0
                      ? comparisonData.mutants
                          .filter(m => m.heavyRegression)
                          .reduce((best, curr) =>
                            Math.abs(curr.heavyRegression?.slope ?? 0) > Math.abs(best.heavyRegression?.slope ?? 0)
                              ? curr
                              : best
                          ).name
                      : '-'}
                  </td>
                </tr>
                <tr className="bg-purple-50">
                  <td className="border px-3 py-2 font-medium">L/H Offset (%)</td>
                  {comparisonData.mutants.map(m => (
                    <td key={m.groupKey} className="border px-3 py-2 text-center font-mono">
                      <span className={
                        m.lightHeavyOffset.isSignificant
                          ? m.lightHeavyOffset.offset > 0
                            ? 'text-purple-600 font-semibold'
                            : 'text-orange-600 font-semibold'
                          : 'text-gray-400'
                      }>
                        {m.lightHeavyOffset.isSignificant
                          ? `${m.lightHeavyOffset.offset > 0 ? '+' : ''}${m.lightHeavyOffset.offset.toFixed(1)}`
                          : '~0'}
                      </span>
                    </td>
                  ))}
                  <td className="border px-3 py-2 text-center font-semibold text-green-600">
                    {comparisonData.mutants.reduce((best, curr) =>
                      Math.abs(curr.lightHeavyOffset.offset) > Math.abs(best.lightHeavyOffset.offset)
                        ? curr
                        : best
                    ).name}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Pairwise Statistical Comparison */}
          {pairwiseComparisons.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Pairwise Statistical Comparison (Total Binding)
              </h4>
              <div className="space-y-2">
                {pairwiseComparisons.map((comp, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-2 rounded ${
                      comp.significant ? 'bg-green-50' : 'bg-gray-50'
                    }`}
                  >
                    <span className="font-medium">
                      {comp.mutantA} vs {comp.mutantB}
                    </span>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="font-mono">
                        p = {comp.pValue < 0.001 ? '<0.001' : comp.pValue.toFixed(3)}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        comp.significant
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {comp.significant ? 'Significant' : 'Not Significant'}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        comp.effectInterpretation === 'large'
                          ? 'bg-purple-100 text-purple-800'
                          : comp.effectInterpretation === 'medium'
                            ? 'bg-blue-100 text-blue-800'
                            : comp.effectInterpretation === 'small'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-600'
                      }`}>
                        {comp.effectInterpretation} effect
                      </span>
                      {comp.significant && comp.winner && (
                        <span className="text-green-600 font-semibold">
                          → {comp.winner} higher
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Statistical tests: Welch&apos;s t-test (parametric) / Mann-Whitney U (non-parametric). Effect size: Cohen&apos;s d.
              </p>
            </div>
          )}

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
