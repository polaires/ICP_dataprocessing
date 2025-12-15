'use client';

import { useCallback, useState, useEffect } from 'react';
import { Upload, FileText, AlertCircle, FolderOpen, Database } from 'lucide-react';
import { useDataStore } from '@/store/useDataStore';

interface DatasetInfo {
  name: string;
  filename: string;
  description: string;
}

export function DataUploader() {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableDatasets, setAvailableDatasets] = useState<DatasetInfo[]>([]);
  const [loadingDataset, setLoadingDataset] = useState<string | null>(null);
  const loadCSV = useDataStore(state => state.loadCSV);

  // Load available datasets from the data folder
  useEffect(() => {
    fetch('/data/datasets.json')
      .then(res => res.json())
      .then(data => setAvailableDatasets(data.datasets || []))
      .catch(() => setAvailableDatasets([]));
  }, []);

  // Load a dataset from the data folder
  const loadDataset = useCallback(
    async (filename: string) => {
      setError(null);
      setLoadingDataset(filename);

      try {
        const response = await fetch(`/data/${filename}`);
        if (!response.ok) {
          throw new Error(`Failed to load ${filename}`);
        }
        const text = await response.text();
        loadCSV(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dataset');
      } finally {
        setLoadingDataset(null);
      }
    },
    [loadCSV]
  );

  const handleFile = useCallback(
    (file: File) => {
      setError(null);

      if (!file.name.endsWith('.csv')) {
        setError('Please upload a CSV file');
        return;
      }

      const reader = new FileReader();
      reader.onload = e => {
        try {
          const text = e.target?.result as string;
          loadCSV(text);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to parse CSV');
        }
      };
      reader.onerror = () => {
        setError('Failed to read file');
      };
      reader.readAsText(file);
    },
    [loadCSV]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  return (
    <div className="w-full max-w-2xl mx-auto p-4 space-y-6">
      {/* Saved Datasets Section */}
      {availableDatasets.length > 0 && (
        <div className="bg-white border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-gray-800">Saved Datasets</h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Quick load from <code className="bg-gray-100 px-1 rounded">public/data/</code> folder
          </p>
          <div className="space-y-2">
            {availableDatasets.map(dataset => (
              <button
                key={dataset.filename}
                onClick={() => loadDataset(dataset.filename)}
                disabled={loadingDataset !== null}
                className={`w-full text-left p-4 rounded-lg border transition-colors ${
                  loadingDataset === dataset.filename
                    ? 'bg-blue-50 border-blue-300'
                    : 'hover:bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800">{dataset.name}</p>
                    <p className="text-sm text-gray-500">{dataset.description}</p>
                    <p className="text-xs text-gray-400 mt-1">{dataset.filename}</p>
                  </div>
                  {loadingDataset === dataset.filename ? (
                    <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                  ) : (
                    <FolderOpen className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Divider */}
      {availableDatasets.length > 0 && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-gray-100 text-gray-500">or upload new file</span>
          </div>
        </div>
      )}

      {/* File Upload Section */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          border-2 border-dashed rounded-lg p-12
          flex flex-col items-center justify-center gap-4
          transition-colors cursor-pointer
          ${isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 bg-gray-50'
          }
        `}
      >
        <input
          type="file"
          accept=".csv"
          onChange={handleInputChange}
          className="hidden"
          id="csv-upload"
        />
        <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center gap-4">
          <div className="p-4 bg-white rounded-full shadow-sm">
            <Upload className="w-8 h-8 text-gray-500" />
          </div>
          <div className="text-center">
            <p className="text-lg font-medium text-gray-700">
              Drop your ICP data CSV here
            </p>
            <p className="text-sm text-gray-500 mt-1">
              or click to browse
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <FileText className="w-4 h-4" />
            <span>Supports ICP-OES format with lanthanide measurements</span>
          </div>
        </label>
      </div>

      {/* Instructions for adding new datasets */}
      <div className="text-sm text-gray-500 bg-gray-50 p-4 rounded-lg">
        <p className="font-medium text-gray-700 mb-2">To add new datasets:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Save your CSV file to <code className="bg-gray-200 px-1 rounded">public/data/</code></li>
          <li>Edit <code className="bg-gray-200 px-1 rounded">public/data/datasets.json</code> to add entry</li>
          <li>Refresh the page to see new dataset</li>
        </ol>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}
