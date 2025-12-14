'use client';

import { useDataStore } from '@/store/useDataStore';
import { LANTHANIDE_ORDER, LIGHT_REE, HEAVY_REE } from '@/lib/constants';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export function Sidebar() {
  const {
    rawData,
    processedData,
    selectedElements,
    selectedSamples,
    showNormalized,
    unitMode,
    bufferMeasurement,
    toggleElement,
    toggleSample,
    selectAllElements,
    selectAllSamples,
    deselectAllElements,
    deselectAllSamples,
    setShowNormalized,
    setUnitMode,
  } = useDataStore();

  const [elementsExpanded, setElementsExpanded] = useState(true);
  const [samplesExpanded, setSamplesExpanded] = useState(true);

  const elements = (rawData?.elements || []).sort((a, b) => {
    return LANTHANIDE_ORDER.indexOf(a) - LANTHANIDE_ORDER.indexOf(b);
  });

  const lightREE = elements.filter(e => LIGHT_REE.includes(e));
  const heavyREE = elements.filter(e => HEAVY_REE.includes(e));

  const selectLightREE = () => {
    for (const e of elements) {
      if (LIGHT_REE.includes(e) && !selectedElements.includes(e)) {
        toggleElement(e);
      } else if (!LIGHT_REE.includes(e) && selectedElements.includes(e)) {
        toggleElement(e);
      }
    }
  };

  const selectHeavyREE = () => {
    for (const e of elements) {
      if (HEAVY_REE.includes(e) && !selectedElements.includes(e)) {
        toggleElement(e);
      } else if (!HEAVY_REE.includes(e) && selectedElements.includes(e)) {
        toggleElement(e);
      }
    }
  };

  if (!rawData) return null;

  return (
    <div className="w-64 border-r border-gray-200 bg-gray-50 p-4 overflow-y-auto">
      {/* Display Options */}
      <div className="mb-6">
        <h3 className="font-semibold text-gray-700 mb-3">Display Options</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Units</label>
            <select
              value={unitMode}
              onChange={e => setUnitMode(e.target.value as 'mg/L' | 'µM' | 'selectivity')}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
            >
              <option value="mg/L">mg/L (raw)</option>
              <option value="µM">µM (molarity)</option>
              <option value="selectivity">% (selectivity)</option>
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showNormalized}
              onChange={e => setShowNormalized(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Normalize by buffer</span>
          </label>

          {bufferMeasurement && (
            <div className="text-xs text-gray-500 ml-6">
              Using: {bufferMeasurement.displayName}
            </div>
          )}
        </div>
      </div>

      {/* Elements */}
      <div className="mb-6">
        <button
          onClick={() => setElementsExpanded(!elementsExpanded)}
          className="flex items-center gap-1 font-semibold text-gray-700 mb-2 hover:text-gray-900"
        >
          {elementsExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Elements ({selectedElements.length}/{elements.length})
        </button>

        {elementsExpanded && (
          <div className="space-y-2">
            <div className="flex gap-2 text-xs">
              <button
                onClick={selectAllElements}
                className="text-blue-600 hover:underline"
              >
                All
              </button>
              <button
                onClick={deselectAllElements}
                className="text-blue-600 hover:underline"
              >
                None
              </button>
              {lightREE.length > 0 && (
                <button
                  onClick={selectLightREE}
                  className="text-blue-600 hover:underline"
                >
                  Light
                </button>
              )}
              {heavyREE.length > 0 && (
                <button
                  onClick={selectHeavyREE}
                  className="text-blue-600 hover:underline"
                >
                  Heavy
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1">
              {elements.map(element => (
                <label
                  key={element}
                  className="flex items-center gap-1 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedElements.includes(element)}
                    onChange={() => toggleElement(element)}
                    className="rounded"
                  />
                  <span>{element}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Samples */}
      <div>
        <button
          onClick={() => setSamplesExpanded(!samplesExpanded)}
          className="flex items-center gap-1 font-semibold text-gray-700 mb-2 hover:text-gray-900"
        >
          {samplesExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Samples ({selectedSamples.length}/{processedData.length})
        </button>

        {samplesExpanded && (
          <div className="space-y-2">
            <div className="flex gap-2 text-xs">
              <button
                onClick={selectAllSamples}
                className="text-blue-600 hover:underline"
              >
                All
              </button>
              <button
                onClick={deselectAllSamples}
                className="text-blue-600 hover:underline"
              >
                None
              </button>
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto">
              {processedData.map(m => (
                <label
                  key={m.id}
                  className={`flex items-center gap-2 cursor-pointer text-sm p-1 rounded hover:bg-gray-100 ${
                    m.id === bufferMeasurement?.id ? 'bg-yellow-100' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedSamples.includes(m.id)}
                    onChange={() => toggleSample(m.id)}
                    className="rounded"
                  />
                  <span className="truncate" title={m.displayName}>
                    {m.displayName}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
