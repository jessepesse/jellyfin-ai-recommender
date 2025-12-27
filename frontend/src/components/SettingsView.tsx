import React, { useState, useRef, useEffect } from 'react';
import { postSettingsImport, getSettingsExport } from '../services/api';
import GlassCard from './GlassCard';
import HeroButton from './HeroButton';
import ConfigEditor from './ConfigEditor';
import { UploadCloud, FileJson, X, Download, Loader2, Shield, Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import UserStatisticsCard from './UserStatisticsCard';
import type { UserStatisticsResponse } from '../services/api';
import { getUserStatistics, postChangePassword } from '../services/api';

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

interface ImportSummary {
  total: number;
  imported: number;
  skipped: number;
  errors: number;
}

const SettingsView: React.FC = () => {
  const { user } = useAuth();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [userStats, setUserStats] = useState<UserStatisticsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Password Change State
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load user statistics if admin
  useEffect(() => {
    if (user?.isAdmin) {
      loadUserStatistics();
    }
  }, [user?.isAdmin]);

  const loadUserStatistics = async () => {
    try {
      setStatsLoading(true);
      const stats = await getUserStatistics();
      setUserStats(stats);
    } catch (err) {
      console.error('Failed to load user statistics', err);
    } finally {
      setStatsLoading(false);
    }
  };

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
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(fileContent);
      } catch {
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
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(String(err?.message || e));
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
    } catch (e) {
      const err = e as Error & { response?: { data?: { message?: string } } };
      setExportError(err?.response?.data?.message || err?.message || 'Export failed');
    } finally {
      setExportLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    if (newPassword.length < 5) {
      setPasswordError("Password must be at least 5 characters");
      return;
    }

    try {
      setPasswordLoading(true);
      await postChangePassword({ newPassword, confirmPassword });
      setPasswordSuccess("Password updated successfully");
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err.response?.data?.error || "Failed to update password");
    } finally {
      setPasswordLoading(false);
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
        <h3 className="text-lg font-semibold mb-4 text-slate-300">Database Import</h3>

        {/* File Upload Zone */}
        {!selectedFile ? (
          <div
            className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 ${dragActive
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
              Click to upload a database.json backup
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
          Download a JSON backup of watched history, watchlist, and blocked items.
          The exported file can be re-imported using the Import tool above.
          <br />
          <span className="text-cyan-400 font-medium">Admin users export data for all users.</span>
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

      {/* Admin Account Management */}
      {user?.isAdmin && (
        <GlassCard className="mt-6">
          <h3 className="text-lg font-semibold mb-4 text-slate-300 flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyan-400" />
            Admin Account
          </h3>
          <p className="text-sm text-slate-400 mb-6">
            Update the local password for this admin account. This allows you to log in even if the Jellyfin server is unreachable.
          </p>

          <form onSubmit={handlePasswordChange} className="max-w-md space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">New Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white outline-none"
                  placeholder="Enter new password"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white outline-none"
                  placeholder="Confirm new password"
                />
              </div>
            </div>

            {passwordError && (
              <div className="text-red-400 text-sm">{passwordError}</div>
            )}
            {passwordSuccess && (
              <div className="text-green-400 text-sm">{passwordSuccess}</div>
            )}

            <HeroButton type="submit" disabled={passwordLoading || !newPassword}>
              {passwordLoading ? 'Updating...' : 'Update Password'}
            </HeroButton>
          </form>
        </GlassCard>
      )}

      {/* User Statistics (Admin Only) */}
      {user?.isAdmin && (
        <GlassCard className="mt-6">
          <h3 className="text-lg font-semibold mb-4 text-slate-300">User Statistics</h3>

          {statsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
          ) : userStats ? (
            <>
              {/* Summary */}
              <div className="mb-6 p-4 bg-slate-900/30 rounded-lg">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-white">{userStats.summary.total}</div>
                    <div className="text-sm text-slate-400">Total Users</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-400">{userStats.summary.active}</div>
                    <div className="text-sm text-slate-400">Active (7d)</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-red-400">{userStats.summary.inactive}</div>
                    <div className="text-sm text-slate-400">Inactive</div>
                  </div>
                </div>
              </div>

              {/* User Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {userStats.users.map((userStat) => (
                  <UserStatisticsCard key={userStat.username} user={userStat} />
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-slate-400">
              Failed to load user statistics
            </div>
          )}
        </GlassCard>
      )}
    </div>
  );
};

export default SettingsView;
