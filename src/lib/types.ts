// Lanthanide elements
export type LanthanideElement =
  | 'La' | 'Ce' | 'Pr' | 'Nd' | 'Pm' | 'Sm' | 'Eu' | 'Gd'
  | 'Tb' | 'Dy' | 'Ho' | 'Er' | 'Tm' | 'Yb' | 'Lu';

// Raw measurement row from CSV
export interface RawMeasurement {
  id: string;
  originalName: string;
  displayName: string;
  type: string;
  values: Record<string, number>; // element -> mg/L value
  batchId?: number; // For multi-batch CSV files
}

// Processed measurement with molarity
export interface ProcessedMeasurement extends RawMeasurement {
  molarity: Record<string, number>; // element -> µM value
  normalizedMolarity: Record<string, number>; // buffer-subtracted µM
  selectivity: Record<string, number>; // element -> % of total moles
}

// Replicate group
export interface ReplicateGroup {
  baseName: string;
  displayName: string;
  buffer: string;
  measurements: ProcessedMeasurement[];
  mean: Record<string, number>;
  stdDev: Record<string, number>;
  cv: Record<string, number>; // coefficient of variation %
  meanSelectivity: Record<string, number>;
}

// Parsed CSV structure
export interface ParsedData {
  method: string;
  elements: string[];
  units: string;
  measurements: RawMeasurement[];
}

// Store state
export interface DataState {
  rawData: ParsedData | null;
  processedData: ProcessedMeasurement[];
  replicateGroups: ReplicateGroup[];
  bufferMeasurement: ProcessedMeasurement | null;
  selectedElements: string[];
  selectedSamples: string[];
  showNormalized: boolean;
  unitMode: 'mg/L' | 'µM' | 'selectivity';
}

// Name mapping for renaming
export interface NameMapping {
  original: string;
  display: string;
}
