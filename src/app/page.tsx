'use client';

import { useDataStore } from '@/store/useDataStore';
import { DataUploader } from '@/components/DataUploader';
import { DataTable } from '@/components/DataTable';
import { SelectivityAnalysis } from '@/components/SelectivityAnalysis';
import { Charts } from '@/components/Charts';
import { WaterExchangeAnalysis } from '@/components/WaterExchangeAnalysis';
import { MutantRanking } from '@/components/MutantRanking';
import { Sidebar } from '@/components/Sidebar';
import { Upload, Table, PieChart, LineChart, Download, Droplets, FlaskConical } from 'lucide-react';

export default function Home() {
  const { rawData, processedData, activeTab, setActiveTab, selectedElements, selectedSamples } =
    useDataStore();

  const handleExportCSV = () => {
    if (!processedData.length) return;

    const filteredData = processedData.filter(m => selectedSamples.includes(m.id));
    const elements = selectedElements;

    // Build CSV content
    const headers = ['Sample', ...elements.map(e => `${e}_mgL`), ...elements.map(e => `${e}_uM`), ...elements.map(e => `${e}_selectivity`)];
    const rows = filteredData.map(m => [
      m.displayName,
      ...elements.map(e => (m.values[e] ?? 0).toFixed(4)),
      ...elements.map(e => (m.normalizedMolarity[e] ?? 0).toFixed(4)),
      ...elements.map(e => (m.selectivity[e] ?? 0).toFixed(2)),
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'icp_processed_data.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!rawData) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-7xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-900">ICP Lanthanide Data Viewer</h1>
            <p className="text-gray-600 mt-1">
              Analyze lanthanide binding protein selectivity from ICP-OES data
            </p>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-8">
          <DataUploader />
        </main>

        <footer className="bg-white border-t border-gray-200 px-6 py-4 text-center text-sm text-gray-500">
          Upload your ICP-OES CSV file to get started. Supports automatic buffer detection,
          molarity conversion, and selectivity analysis.
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">ICP Lanthanide Data Viewer</h1>
            <p className="text-sm text-gray-600">
              {rawData.method} - {processedData.length} samples, {rawData.elements.length} elements
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Upload className="w-4 h-4" />
              New File
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          <button
            onClick={() => setActiveTab('table')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-colors ${
              activeTab === 'table'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <Table className="w-4 h-4" />
            Data Table
          </button>
          <button
            onClick={() => setActiveTab('selectivity')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-colors ${
              activeTab === 'selectivity'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <PieChart className="w-4 h-4" />
            Selectivity Analysis
          </button>
          <button
            onClick={() => setActiveTab('charts')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-colors ${
              activeTab === 'charts'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <LineChart className="w-4 h-4" />
            Charts
          </button>
          <button
            onClick={() => setActiveTab('kex')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-colors ${
              activeTab === 'kex'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <Droplets className="w-4 h-4" />
            k_ex Analysis
          </button>
          <button
            onClick={() => setActiveTab('ranking')}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-colors ${
              activeTab === 'ranking'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            <FlaskConical className="w-4 h-4" />
            Mutant Ranking
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />

        <main className="flex-1 overflow-auto p-6 bg-white">
          {activeTab === 'table' && <DataTable />}
          {activeTab === 'selectivity' && <SelectivityAnalysis />}
          {activeTab === 'charts' && <Charts />}
          {activeTab === 'kex' && <WaterExchangeAnalysis />}
          {activeTab === 'ranking' && <MutantRanking />}
        </main>
      </div>
    </div>
  );
}
