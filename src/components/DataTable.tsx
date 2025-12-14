'use client';

import { useState, useCallback } from 'react';
import { useDataStore } from '@/store/useDataStore';
import { LANTHANIDE_ORDER } from '@/lib/constants';
import { Pencil, Check, X, Undo2 } from 'lucide-react';

export function DataTable() {
  const {
    processedData,
    rawData,
    selectedElements,
    selectedSamples,
    unitMode,
    showNormalized,
    bufferMeasurement,
    renameSample,
    undoRename,
    renameHistory,
    setBufferSample,
  } = useDataStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const elements = rawData?.elements.sort((a, b) => {
    return LANTHANIDE_ORDER.indexOf(a) - LANTHANIDE_ORDER.indexOf(b);
  }) || [];

  const startEdit = useCallback((id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  const saveEdit = useCallback(() => {
    if (editingId && editValue.trim()) {
      renameSample(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  }, [editingId, editValue, renameSample]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        saveEdit();
      } else if (e.key === 'Escape') {
        cancelEdit();
      }
    },
    [saveEdit, cancelEdit]
  );

  const formatValue = (measurement: typeof processedData[0], element: string): string => {
    let value: number;

    switch (unitMode) {
      case 'mg/L':
        value = measurement.values[element] ?? 0;
        return value.toFixed(4);
      case 'µM':
        value = showNormalized
          ? measurement.normalizedMolarity[element] ?? 0
          : measurement.molarity[element] ?? 0;
        return value.toFixed(4);
      case 'selectivity':
        value = measurement.selectivity[element] ?? 0;
        return value.toFixed(2) + '%';
    }
  };

  const getValueClass = (measurement: typeof processedData[0], element: string): string => {
    const value = showNormalized
      ? measurement.normalizedMolarity[element] ?? 0
      : measurement.molarity[element] ?? 0;

    if (value < 0) return 'text-gray-400';
    if (unitMode === 'selectivity') {
      const selectivity = measurement.selectivity[element] ?? 0;
      if (selectivity > 20) return 'text-green-600 font-semibold';
      if (selectivity > 10) return 'text-blue-600';
    }
    return '';
  };

  const filteredData = processedData.filter(m => selectedSamples.includes(m.id));
  const filteredElements = elements.filter(e => selectedElements.includes(e));

  if (!rawData) return null;

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            {filteredData.length} samples, {filteredElements.length} elements
          </span>
          {bufferMeasurement && (
            <span className="text-sm text-blue-600">
              Buffer: {bufferMeasurement.displayName}
            </span>
          )}
        </div>
        {renameHistory.length > 0 && (
          <button
            onClick={undoRename}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <Undo2 className="w-4 h-4" />
            Undo rename
          </button>
        )}
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 px-3 py-2 text-left font-medium sticky left-0 bg-gray-100 z-10">
              Sample
            </th>
            <th className="border border-gray-300 px-3 py-2 text-center font-medium w-20">
              Buffer
            </th>
            {filteredElements.map(element => (
              <th
                key={element}
                className="border border-gray-300 px-3 py-2 text-center font-medium min-w-[80px]"
              >
                {element}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredData.map(measurement => (
            <tr
              key={measurement.id}
              className={`
                hover:bg-blue-50
                ${measurement.id === bufferMeasurement?.id ? 'bg-yellow-50' : ''}
              `}
            >
              <td className="border border-gray-300 px-3 py-2 sticky left-0 bg-white z-10">
                {editingId === measurement.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="flex-1 px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <button
                      onClick={saveEdit}
                      className="p-1 text-green-600 hover:bg-green-100 rounded"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="p-1 text-red-600 hover:bg-red-100 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between group">
                    <span className="font-medium">{measurement.displayName}</span>
                    <button
                      onClick={() => startEdit(measurement.id, measurement.displayName)}
                      className="p-1 text-gray-400 hover:text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </td>
              <td className="border border-gray-300 px-3 py-2 text-center">
                <input
                  type="radio"
                  name="buffer"
                  checked={measurement.id === bufferMeasurement?.id}
                  onChange={() =>
                    setBufferSample(
                      measurement.id === bufferMeasurement?.id ? null : measurement.id
                    )
                  }
                  className="cursor-pointer"
                />
              </td>
              {filteredElements.map(element => (
                <td
                  key={element}
                  className={`border border-gray-300 px-3 py-2 text-right font-mono ${getValueClass(measurement, element)}`}
                >
                  {formatValue(measurement, element)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
