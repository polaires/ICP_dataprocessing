import Papa from 'papaparse';
import { ParsedData, RawMeasurement } from './types';
import { ATOMIC_WEIGHTS, LANTHANIDE_ORDER } from './constants';

/**
 * Extract element symbol from column header
 * Handles formats like "Ce 413.38", "Ce", "Ce-413", etc.
 */
function extractElement(header: string): string | null {
  const trimmed = header.trim();

  // Try to match element symbol at the start
  for (const element of Object.keys(ATOMIC_WEIGHTS)) {
    // Match "Ce 413.38", "Ce-413", "Ce_413", or just "Ce"
    const pattern = new RegExp(`^${element}(?:[\\s_\\-]|$)`, 'i');
    if (pattern.test(trimmed)) {
      return element;
    }
  }

  return null;
}

/**
 * Detect if a row is a method/batch header row
 */
function isMethodRow(row: string[]): boolean {
  return row[0]?.trim().toLowerCase() === 'method';
}

/**
 * Detect if a row is a column header row (Sample, Type, Elements...)
 */
function isHeaderRow(row: string[]): boolean {
  return row[0]?.trim().toLowerCase() === 'sample';
}

/**
 * Parse a single batch of ICP-OES data
 */
function parseBatch(
  rows: string[][],
  startIndex: number,
  batchId: number
): { measurements: RawMeasurement[]; elements: string[]; units: string; method: string; endIndex: number } {
  // Row 0: Method name
  const method = rows[startIndex][1]?.trim() || 'Unknown Method';

  // Row 1: Headers - Sample, Type, Element1, Element2, ...
  const headers = rows[startIndex + 1];
  const elementColumns: { index: number; element: string }[] = [];

  for (let i = 2; i < headers.length; i++) {
    const element = extractElement(headers[i]);
    if (element) {
      elementColumns.push({ index: i, element });
    }
  }

  // Sort elements by standard lanthanide order
  const elements = elementColumns
    .map(ec => ec.element)
    .sort((a, b) => {
      const aIdx = LANTHANIDE_ORDER.indexOf(a);
      const bIdx = LANTHANIDE_ORDER.indexOf(b);
      return aIdx - bIdx;
    });

  // Row 2: Units (usually mg/L)
  const units = rows[startIndex + 2][2]?.trim() || 'mg/L';

  // Rows 3+: Data until next batch or end
  const measurements: RawMeasurement[] = [];
  let i = startIndex + 3;

  while (i < rows.length) {
    const row = rows[i];
    const sampleName = row[0]?.trim();

    // Check if we've hit a new batch
    if (isMethodRow(row)) {
      break;
    }

    // Skip empty rows or header rows
    if (!sampleName || isHeaderRow(row)) {
      i++;
      continue;
    }

    const values: Record<string, number> = {};

    for (const { index, element } of elementColumns) {
      const rawValue = row[index]?.trim();
      const numValue = parseFloat(rawValue);
      values[element] = isNaN(numValue) ? 0 : numValue;
    }

    measurements.push({
      id: `batch${batchId}-sample-${measurements.length}`,
      originalName: sampleName,
      displayName: sampleName,
      type: row[1]?.trim() || '',
      values,
      batchId,
    });

    i++;
  }

  return { measurements, elements, units, method, endIndex: i };
}

/**
 * Parse ICP-OES CSV data (supports multi-batch files)
 */
export function parseICPData(csvText: string): ParsedData {
  const result = Papa.parse<string[]>(csvText, {
    skipEmptyLines: false, // Keep empty lines to detect batch boundaries
  });

  const rows = result.data;

  if (rows.length < 4) {
    throw new Error('CSV must have at least 4 rows (method, headers, units, data)');
  }

  // Find all batch start positions (rows starting with "Method")
  const batchStarts: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (isMethodRow(rows[i])) {
      batchStarts.push(i);
    }
  }

  if (batchStarts.length === 0) {
    throw new Error('No valid batch found (must start with "Method" row)');
  }

  // Parse all batches
  const allMeasurements: RawMeasurement[] = [];
  let allElements = new Set<string>();
  let method = '';
  let units = 'mg/L';

  for (let batchIdx = 0; batchIdx < batchStarts.length; batchIdx++) {
    const startIdx = batchStarts[batchIdx];
    const batch = parseBatch(rows, startIdx, batchIdx);

    allMeasurements.push(...batch.measurements);
    batch.elements.forEach(e => allElements.add(e));

    if (batchIdx === 0) {
      method = batch.method;
      units = batch.units;
    }
  }

  // Sort elements by standard lanthanide order
  const elements = Array.from(allElements).sort((a, b) => {
    const aIdx = LANTHANIDE_ORDER.indexOf(a);
    const bIdx = LANTHANIDE_ORDER.indexOf(b);
    return aIdx - bIdx;
  });

  return {
    method,
    elements,
    units,
    measurements: allMeasurements,
  };
}

/**
 * Detect buffer/blank measurement from sample names
 */
export function detectBuffer(measurements: RawMeasurement[]): RawMeasurement | null {
  const bufferKeywords = ['buffer', 'blank', 'control', 'bg', 'background'];

  for (const m of measurements) {
    const nameLower = m.originalName.toLowerCase();
    if (bufferKeywords.some(kw => nameLower.includes(kw))) {
      return m;
    }
  }

  return null;
}

/**
 * Parse sample name to extract base name, condition, and replicate number
 * Examples:
 * - "901-15-h2o1" -> { base: "901-15", condition: "h2o", replicate: 1 }
 * - "hippo-atc" -> { base: "hippo", condition: "atc", replicate: null }
 */
export function parseSampleName(name: string): {
  base: string;
  condition: string | null;
  replicate: number | null;
} {
  const lower = name.toLowerCase();

  // Common condition patterns
  const conditionPatterns = [
    { pattern: /[-_]?(h2o|water|aq)(\d*)$/i, condition: 'h2o' },
    { pattern: /[-_]?(atc|acetic|acid|hac)(\d*)$/i, condition: 'atc' },
  ];

  for (const { pattern, condition } of conditionPatterns) {
    const match = name.match(pattern);
    if (match) {
      const replicateStr = match[2];
      const replicate = replicateStr ? parseInt(replicateStr) : null;
      const base = name.substring(0, match.index).replace(/[-_]$/, '');
      return { base, condition, replicate };
    }
  }

  // Try to extract trailing number as replicate
  const trailingNum = name.match(/(\d+)$/);
  if (trailingNum) {
    return {
      base: name.substring(0, trailingNum.index),
      condition: null,
      replicate: parseInt(trailingNum[1]),
    };
  }

  return { base: name, condition: null, replicate: null };
}

/**
 * Group samples by base name and condition for replicate analysis
 */
export function groupReplicates<T extends RawMeasurement>(
  measurements: T[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const m of measurements) {
    const { base, condition } = parseSampleName(m.displayName);
    const key = condition ? `${base}-${condition}` : base;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(m);
  }

  return groups;
}
