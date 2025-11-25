import React, { useState, useRef, useEffect } from 'react';
import { postSettingsImport, getSettingsExport } from '../services/api';
import GlassCard from './GlassCard';
import HeroButton from './HeroButton';
import ConfigEditor from './ConfigEditor';
import { UploadCloud, FileJson, X, Download, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface ImportProgress {
  username: string;
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  errors: number;
  currentItem: string;
  active: boolean;
  completed: boolean;
}

const SettingsView: React.FC = () => {
  const { user } = useAuth();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  
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

  // Connect to SSE for import progress
  const connectToProgressStream = () => {
    if (!user?.id) return;
    
    const username = user.name || user.id;
    const es = new EventSource(`/api/settings/import/progress/${username}`);
    
    es.onmessage = (event) => {
      try {
        const progress = JSON.parse(event.data);
        setImportProgress(progress);
        
        // When import completes, close SSE and show final result
        if (progress.completed) {
          setLoading(false);
          setResult({
            total: progress.total,
            imported: progress.imported,
            skipped: progress.skipped,
            errors: progress.errors,
          });
          es.close();
          setEventSource(null);
        }
      } catch (e) {
        console.error('Failed to parse progress:', e);
      }
    };
    
    es.onerror = () => {
      console.error('SSE connection error');
      es.close();
      setEventSource(null);
    };
    
    setEventSource(es);
  };

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [eventSource]);

  const onImport = async () => {
    if (!fileContent) {
      setError('No file content to import');
      return;
    }

    setError(null);
    setResult(null);
    setImportProgress(null);
    setLoading(true);
    
    try {
      // Validate JSON before sending
      let parsed: any;
      try {
        parsed = JSON.parse(fileContent);
      } catch (parseErr) {
        throw new Error('Invalid JSON format');
      }

      // Start SSE connection for progress
      connectToProgressStream();

      const res = await postSettingsImport(parsed);
      
      // Check if async import
      if (res.async) {
        // Keep loading state, progress will update via SSE
        // Don't set result or loading here - progress bar handles it
      } else {
        // Small import completed synchronously
        setResult(res.summary ?? res);
        setLoading(false);
        if (eventSource) {
          eventSource.close();
          setEventSource(null);
        }
      }
    } catch (e: any) {
      setError(String(e?.message || e));
      setLoading(false);
      if (eventSource) {
        eventSource.close();
        setEventSource(null);
      }
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
        <h3 className="text-lg font-semibold mb-4 text-slate-300">Legacy & New database.json Import</h3>
        
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
              Click to upload a database.json (legacy or new)
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
            disabled={loading || !selectedFile || !fileContent || importProgress?.active}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Importing...
              </span>
            ) : 'Import'}
          </HeroButton>
          {selectedFile && !loading && (
            <HeroButton
              variant="secondary"
              onClick={handleClearFile}
            >
              Clear
            </HeroButton>
          )}
        </div>

        {/* Progress Bar */}
        {importProgress && importProgress.active && (
          <div className="mt-6 p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-300">
                Importing... {importProgress.processed}/{importProgress.total}
              </span>
              <span className="text-sm text-slate-400">
                {Math.round((importProgress.processed / importProgress.total) * 100)}%
              </span>
            </div>
            
            {/* Progress Bar */}
            <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${(importProgress.processed / importProgress.total) * 100}%` }}
              />
            </div>
            
            {/* Current Item & Stats */}
            <div className="mt-3 space-y-1 text-xs text-slate-400">
              {importProgress.currentItem && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Current:</span>
                  <span className="text-slate-300 truncate">{importProgress.currentItem}</span>
                </div>
              )}
              <div className="flex gap-4">
                <span className="text-green-400">✓ {importProgress.imported} imported</span>
                <span className="text-yellow-400">⊘ {importProgress.skipped} skipped</span>
                {importProgress.errors > 0 && (
                  <span className="text-red-400">✗ {importProgress.errors} errors</span>
                )}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <strong>Error:</strong> {error}
          </div>
        )}

        {result && !importProgress?.active && (
          <div className="mt-6 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
            <div className="font-semibold text-green-300 mb-3">
              ✓ Import Complete
            </div>
            <div className="text-sm text-slate-400 space-y-1">
              <div className="flex gap-4">
                <span>Total: {result.total}</span>
                <span className="text-green-400">Imported: {result.imported}</span>
                <span className="text-yellow-400">Skipped: {result.skipped}</span>
              </div>
              {result.errors > 0 && (
                <div className="text-red-400 mt-2">Errors: {result.errors}</div>
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
