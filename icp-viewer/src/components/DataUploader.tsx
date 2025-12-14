'use client';

import { useCallback, useState } from 'react';
import { Upload, FileText, AlertCircle } from 'lucide-react';
import { useDataStore } from '@/store/useDataStore';

export function DataUploader() {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadCSV = useDataStore(state => state.loadCSV);

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
    <div className="w-full max-w-2xl mx-auto p-4">
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

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}
