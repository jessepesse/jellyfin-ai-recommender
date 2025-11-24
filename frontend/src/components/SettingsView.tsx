import React, { useState, useRef } from 'react';
import { postSettingsImport, getSettingsExport } from '../services/api';
import GlassCard from './GlassCard';
import HeroButton from './HeroButton';
import ConfigEditor from './ConfigEditor';
import { UploadCloud, FileJson, X, Download } from 'lucide-react';

const SettingsView: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    if (!file) return;
    
    // Validate file type
    if (!file.name.endsWith('.json')) {
      setError('Please select a valid JSON file');
      return;
    }

    setSelectedFile(file);
    setError(null);
    setResult(null);

    // Read file content
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setFileContent(content);
    };
    reader.onerror = () => {
      setError('Failed to read file');
      setSelectedFile(null);
    };
    reader.readAsText(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    setFileContent('');
    setError(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const onImport = async () => {
    if (!fileContent) {
      setError('No file content to import');
      return;
    }

    setError(null);
    setResult(null);
    setLoading(true);
    try {
      // Validate JSON before sending
      let parsed: any;
      try {
        parsed = JSON.parse(fileContent);
      } catch (parseErr) {
        throw new Error('Invalid JSON format');
      }

      const res = await postSettingsImport(parsed);
      setResult(res.summary ?? res);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleExport = async () => {
    setExportError(null);
    setExportLoading(true);
    try {
      const blob = await getSettingsExport();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `jellyfin-backup-${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setExportError(String(e?.response?.data?.message || e?.message || 'Export failed'));
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400 mb-8">
        Settings
      </h2>

      {/* System Configuration Editor */}
      <div className="mb-8">
        <ConfigEditor />
      </div>

      <GlassCard>
        <h3 className="text-lg font-semibold mb-4 text-slate-300">Legacy database.json Import</h3>
        
        {/* File Upload Zone */}
        {!selectedFile ? (
          <div
            className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 ${
              dragActive 
                ? 'border-cyan-500 bg-cyan-500/10' 
                : 'border-slate-700 bg-slate-800/30 hover:border-cyan-500/50 hover:bg-slate-800/50'
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <UploadCloud className="w-16 h-16 text-slate-500 mb-4" />
            <p className="text-slate-300 font-medium mb-2">
              Click to upload database.json
            </p>
            <p className="text-sm text-slate-500">
              or drag and drop your file here
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileInputChange}
              className="hidden"
            />
          </div>
        ) : (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 flex items-center justify-between border border-slate-700/50">
            <div className="flex items-center gap-4">
              <FileJson className="w-10 h-10 text-cyan-400" />
              <div>
                <p className="text-slate-200 font-medium">{selectedFile.name}</p>
                <p className="text-sm text-slate-500">{formatFileSize(selectedFile.size)}</p>
              </div>
            </div>
            <button
              onClick={handleClearFile}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition"
              aria-label="Remove file"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 mt-6">
          <HeroButton
            onClick={onImport}
            disabled={loading || !selectedFile || !fileContent}
          >
            {loading ? 'Importing...' : 'Import'}
          </HeroButton>
          {selectedFile && (
            <HeroButton
              variant="secondary"
              onClick={handleClearFile}
            >
              Clear
            </HeroButton>
          )}
        </div>

        {error && (
          <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <strong>Error:</strong> {error}
          </div>
        )}

        {result && (
          <div className="mt-6 p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
            <div className="font-semibold text-cyan-300 mb-3">Import Summary</div>
            <div className="text-sm text-slate-400 space-y-1">
              <div>Total: {result.total}</div>
              <div>Imported: {result.imported}</div>
              <div>Skipped: {result.skipped}</div>
              {result.errors && result.errors.length > 0 && (
                <div className="text-yellow-300 mt-2">Errors: {result.errors.join('; ')}</div>
              )}
            </div>
          </div>
        )}

      </GlassCard>

      {/* Export Section */}
      <GlassCard className="mt-6">
        <h3 className="text-lg font-semibold mb-4 text-slate-300">Export Database</h3>
        <p className="text-sm text-slate-400 mb-6">
          Download a JSON backup of your current watched history, watchlist, and blocked items. 
          The exported file can be re-imported using the Import tool above.
        </p>

        <HeroButton
          onClick={handleExport}
          disabled={exportLoading}
        >
          {exportLoading ? (
            'Downloading...'
          ) : (
            <>
              <Download className="w-5 h-5 inline mr-2" />
              Download Backup
            </>
          )}
        </HeroButton>

        {exportError && (
          <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <strong>Error:</strong> {exportError}
          </div>
        )}
      </GlassCard>
    </div>
  );
};

export default SettingsView;
