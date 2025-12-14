'use client';

import { create } from 'zustand';
import { ParsedData, ProcessedMeasurement, RawMeasurement, ReplicateGroup } from '@/lib/types';
import { parseICPData, detectBuffer, groupReplicates, parseSampleName } from '@/lib/parser';
import {
  mgLToMicromolar,
  calculateSelectivity,
  normalizeByBuffer,
  calculateMean,
  calculateStdDev,
  calculateCV,
} from '@/lib/chemistry';

interface DataStore {
  // Data
  rawData: ParsedData | null;
  processedData: ProcessedMeasurement[];
  replicateGroups: ReplicateGroup[];
  bufferMeasurement: ProcessedMeasurement | null;

  // UI State
  selectedElements: string[];
  selectedSamples: string[];
  showNormalized: boolean;
  unitMode: 'mg/L' | 'µM' | 'selectivity';
  activeTab: 'table' | 'selectivity' | 'charts' | 'kex' | 'ranking' | 'publication';

  // Rename history for undo
  renameHistory: { id: string; from: string; to: string }[];

  // Actions
  loadCSV: (csvText: string) => void;
  setBufferSample: (sampleId: string | null) => void;
  renameSample: (sampleId: string, newName: string) => void;
  undoRename: () => void;
  toggleElement: (element: string) => void;
  toggleSample: (sampleId: string) => void;
  selectAllElements: () => void;
  selectAllSamples: () => void;
  deselectAllElements: () => void;
  deselectAllSamples: () => void;
  setShowNormalized: (show: boolean) => void;
  setUnitMode: (mode: 'mg/L' | 'µM' | 'selectivity') => void;
  setActiveTab: (tab: 'table' | 'selectivity' | 'charts' | 'kex' | 'ranking' | 'publication') => void;
  recalculateReplicateGroups: () => void;
}

function processRawMeasurement(
  raw: RawMeasurement,
  elements: string[],
  bufferMolarity: Record<string, number> | null
): ProcessedMeasurement {
  // Convert to molarity
  const molarity: Record<string, number> = {};
  for (const element of elements) {
    molarity[element] = mgLToMicromolar(raw.values[element] ?? 0, element);
  }

  // Normalize by buffer if available
  const normalizedMolarity = bufferMolarity
    ? normalizeByBuffer(molarity, bufferMolarity)
    : molarity;

  // Calculate selectivity from normalized values
  const selectivity = calculateSelectivity(normalizedMolarity);

  return {
    ...raw,
    molarity,
    normalizedMolarity,
    selectivity,
  };
}

function buildReplicateGroups(
  measurements: ProcessedMeasurement[],
  showNormalized: boolean
): ReplicateGroup[] {
  const groups = groupReplicates(measurements);
  const result: ReplicateGroup[] = [];

  for (const [key, groupMeasurements] of groups) {
    if (groupMeasurements.length === 0) continue;

    const { base, condition } = parseSampleName(groupMeasurements[0].displayName);

    // Use normalized or raw molarity based on setting
    const molarityData = groupMeasurements.map(m =>
      showNormalized ? m.normalizedMolarity : m.molarity
    );

    const mean = calculateMean(molarityData);
    const stdDev = calculateStdDev(molarityData, mean);
    const cv = calculateCV(mean, stdDev);
    const meanSelectivity = calculateSelectivity(mean);

    result.push({
      baseName: key,
      displayName: groupMeasurements[0].displayName.replace(/\d+$/, ''),
      buffer: condition || '',
      measurements: groupMeasurements,
      mean,
      stdDev,
      cv,
      meanSelectivity,
    });
  }

  return result;
}

export const useDataStore = create<DataStore>((set, get) => ({
  // Initial state
  rawData: null,
  processedData: [],
  replicateGroups: [],
  bufferMeasurement: null,
  selectedElements: [],
  selectedSamples: [],
  showNormalized: true,
  unitMode: 'selectivity',
  activeTab: 'table',
  renameHistory: [],

  loadCSV: (csvText: string) => {
    const parsed = parseICPData(csvText);

    // Group measurements by batch
    const measurementsByBatch = new Map<number, RawMeasurement[]>();
    for (const m of parsed.measurements) {
      const batchId = m.batchId ?? 0;
      if (!measurementsByBatch.has(batchId)) {
        measurementsByBatch.set(batchId, []);
      }
      measurementsByBatch.get(batchId)!.push(m);
    }

    // Find buffer for each batch and calculate buffer molarities
    const bufferMolaritiesByBatch = new Map<number, Record<string, number>>();
    let primaryBuffer: RawMeasurement | null = null;

    for (const [batchId, batchMeasurements] of measurementsByBatch) {
      const bufferRaw = detectBuffer(batchMeasurements);
      if (bufferRaw) {
        const bufferMolarity: Record<string, number> = {};
        for (const element of parsed.elements) {
          bufferMolarity[element] = mgLToMicromolar(bufferRaw.values[element] ?? 0, element);
        }
        bufferMolaritiesByBatch.set(batchId, bufferMolarity);
        if (!primaryBuffer) {
          primaryBuffer = bufferRaw;
        }
      }
    }

    // Process all measurements with per-batch buffer normalization
    const processed = parsed.measurements.map(raw => {
      const batchId = raw.batchId ?? 0;
      const bufferMolarity = bufferMolaritiesByBatch.get(batchId) || null;
      return processRawMeasurement(raw, parsed.elements, bufferMolarity);
    });

    const bufferProcessed = primaryBuffer
      ? processed.find(p => p.id === primaryBuffer!.id) || null
      : null;

    // Build replicate groups
    const groups = buildReplicateGroups(processed, true);

    set({
      rawData: parsed,
      processedData: processed,
      replicateGroups: groups,
      bufferMeasurement: bufferProcessed,
      selectedElements: parsed.elements,
      selectedSamples: processed.map(p => p.id),
    });
  },

  setBufferSample: (sampleId: string | null) => {
    const { rawData, processedData } = get();
    if (!rawData) return;

    let bufferMolarity: Record<string, number> | null = null;

    if (sampleId) {
      const bufferSample = processedData.find(p => p.id === sampleId);
      if (bufferSample) {
        bufferMolarity = bufferSample.molarity;
      }
    }

    // Reprocess all measurements with new buffer
    const reprocessed = rawData.measurements.map(raw =>
      processRawMeasurement(raw, rawData.elements, bufferMolarity)
    );

    const bufferProcessed = sampleId
      ? reprocessed.find(p => p.id === sampleId) || null
      : null;

    const groups = buildReplicateGroups(reprocessed, get().showNormalized);

    set({
      processedData: reprocessed,
      replicateGroups: groups,
      bufferMeasurement: bufferProcessed,
    });
  },

  renameSample: (sampleId: string, newName: string) => {
    const { processedData, renameHistory } = get();

    const updated = processedData.map(m => {
      if (m.id === sampleId) {
        return { ...m, displayName: newName };
      }
      return m;
    });

    const original = processedData.find(m => m.id === sampleId);
    const newHistory = original
      ? [...renameHistory, { id: sampleId, from: original.displayName, to: newName }]
      : renameHistory;

    const groups = buildReplicateGroups(updated, get().showNormalized);

    set({
      processedData: updated,
      replicateGroups: groups,
      renameHistory: newHistory,
    });
  },

  undoRename: () => {
    const { processedData, renameHistory } = get();
    if (renameHistory.length === 0) return;

    const lastRename = renameHistory[renameHistory.length - 1];

    const updated = processedData.map(m => {
      if (m.id === lastRename.id) {
        return { ...m, displayName: lastRename.from };
      }
      return m;
    });

    const groups = buildReplicateGroups(updated, get().showNormalized);

    set({
      processedData: updated,
      replicateGroups: groups,
      renameHistory: renameHistory.slice(0, -1),
    });
  },

  toggleElement: (element: string) => {
    const { selectedElements } = get();
    if (selectedElements.includes(element)) {
      set({ selectedElements: selectedElements.filter(e => e !== element) });
    } else {
      set({ selectedElements: [...selectedElements, element] });
    }
  },

  toggleSample: (sampleId: string) => {
    const { selectedSamples } = get();
    if (selectedSamples.includes(sampleId)) {
      set({ selectedSamples: selectedSamples.filter(s => s !== sampleId) });
    } else {
      set({ selectedSamples: [...selectedSamples, sampleId] });
    }
  },

  selectAllElements: () => {
    const { rawData } = get();
    if (rawData) {
      set({ selectedElements: rawData.elements });
    }
  },

  selectAllSamples: () => {
    const { processedData } = get();
    set({ selectedSamples: processedData.map(p => p.id) });
  },

  deselectAllElements: () => {
    set({ selectedElements: [] });
  },

  deselectAllSamples: () => {
    set({ selectedSamples: [] });
  },

  setShowNormalized: (show: boolean) => {
    const { processedData } = get();
    const groups = buildReplicateGroups(processedData, show);
    set({ showNormalized: show, replicateGroups: groups });
  },

  setUnitMode: (mode: 'mg/L' | 'µM' | 'selectivity') => {
    set({ unitMode: mode });
  },

  setActiveTab: (tab: 'table' | 'selectivity' | 'charts' | 'kex' | 'ranking' | 'publication') => {
    set({ activeTab: tab });
  },

  recalculateReplicateGroups: () => {
    const { processedData, showNormalized } = get();
    const groups = buildReplicateGroups(processedData, showNormalized);
    set({ replicateGroups: groups });
  },
}));
