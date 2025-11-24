import React, { useState, useEffect } from 'react';
import { getSystemConfigEditor, putSystemConfigEditor, postSystemVerify } from '../services/api';
import GlassCard from './GlassCard';
import { Loader2, Check, AlertCircle, Settings } from 'lucide-react';

const ConfigEditor: React.FC = () => {
  const [config, setConfig] = useState({
    jellyfinUrl: '',
    jellyseerrUrl: '',
    jellyseerrApiKey: '',
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash-lite',
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [verifyResults, setVerifyResults] = useState<any>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await getSystemConfigEditor();
      if (response.ok && response.config) {
        setConfig({
          jellyfinUrl: response.config.jellyfinUrl || '',
          jellyseerrUrl: response.config.jellyseerrUrl || '',
          jellyseerrApiKey: response.config.jellyseerrApiKey || '',
          geminiApiKey: response.config.geminiApiKey || '',
          geminiModel: response.config.geminiModel || 'gemini-2.5-flash-lite',
        });
      }
    } catch (error: any) {
      console.error('Failed to load config', error);
      setMessage({ type: 'error', text: 'Failed to load configuration' });
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnections = async () => {
    try {
      setTesting(true);
      setMessage(null);
      setVerifyResults(null);

      const response = await postSystemVerify({
        jellyfinUrl: config.jellyfinUrl || undefined,
        jellyseerrUrl: config.jellyseerrUrl || undefined,
        jellyseerrApiKey: config.jellyseerrApiKey.startsWith('*') ? undefined : config.jellyseerrApiKey || undefined,
        geminiApiKey: config.geminiApiKey.startsWith('*') ? undefined : config.geminiApiKey || undefined,
      });

      setVerifyResults(response.results || {});
      
      const allValid = Object.values(response.results || {}).every((r: any) => r.valid);
      setMessage({
        type: allValid ? 'success' : 'error',
        text: allValid ? 'All connections verified successfully!' : 'Some connections failed. Check details below.',
      });
    } catch (error: any) {
      console.error('Connection test failed', error);
      setMessage({ type: 'error', text: error.response?.data?.error || 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage(null);

      const payload: any = {
        jellyfinUrl: config.jellyfinUrl || undefined,
        jellyseerrUrl: config.jellyseerrUrl || undefined,
        jellyseerrApiKey: config.jellyseerrApiKey || undefined,
        geminiApiKey: config.geminiApiKey || undefined,
        geminiModel: config.geminiModel || undefined,
      };

      await putSystemConfigEditor(payload);
      setMessage({ type: 'success', text: 'Configuration saved successfully!' });
      
      // Reload to show masked keys
      setTimeout(() => loadConfig(), 1500);
    } catch (error: any) {
      console.error('Failed to save config', error);
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to save configuration' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          <span className="ml-2 text-slate-300">Loading configuration...</span>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-6 h-6 text-violet-400" />
        <h3 className="text-2xl font-bold text-white">System Configuration</h3>
      </div>

      <p className="text-slate-400 mb-6">
        Update service URLs and API keys. Masked values (****) indicate existing secrets that will be preserved unless replaced.
      </p>

      {message && (
        <div className={`mb-4 p-4 rounded-lg flex items-start gap-3 ${
          message.type === 'success' ? 'bg-green-500/10 border border-green-500/20' :
          message.type === 'error' ? 'bg-red-500/10 border border-red-500/20' :
          'bg-blue-500/10 border border-blue-500/20'
        }`}>
          {message.type === 'success' && <Check className="w-5 h-5 text-green-400 mt-0.5" />}
          {message.type === 'error' && <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />}
          <span className={`${
            message.type === 'success' ? 'text-green-300' :
            message.type === 'error' ? 'text-red-300' :
            'text-blue-300'
          }`}>{message.text}</span>
        </div>
      )}

      <div className="space-y-4">
        {/* Jellyfin URL */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Jellyfin Server URL
          </label>
          <input
            type="text"
            value={config.jellyfinUrl}
            onChange={(e) => setConfig({ ...config, jellyfinUrl: e.target.value })}
            placeholder="http://your-server:8096"
            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>

        {/* Jellyseerr URL */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Jellyseerr URL
          </label>
          <input
            type="text"
            value={config.jellyseerrUrl}
            onChange={(e) => setConfig({ ...config, jellyseerrUrl: e.target.value })}
            placeholder="http://your-server:5055"
            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>

        {/* Jellyseerr API Key */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Jellyseerr API Key
          </label>
          <input
            type="text"
            value={config.jellyseerrApiKey}
            onChange={(e) => setConfig({ ...config, jellyseerrApiKey: e.target.value })}
            placeholder="Enter new key or leave masked to keep existing"
            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">
            Masked values (****) will preserve the existing key. Enter a new key to update.
          </p>
        </div>

        {/* Gemini API Key */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Gemini API Key
          </label>
          <input
            type="text"
            value={config.geminiApiKey}
            onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value })}
            placeholder="Enter new key or leave masked to keep existing"
            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">
            Get your API key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">Google AI Studio</a>
          </p>
        </div>

        {/* Gemini Model */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Gemini Model
          </label>
          <select
            value={config.geminiModel}
            onChange={(e) => setConfig({ ...config, geminiModel: e.target.value })}
            className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (Recommended)</option>
            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
            <option value="gemini-2.5-pro">gemini-2.5-pro</option>
            <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
          </select>
        </div>
      </div>

      {/* Verification Results */}
      {verifyResults && (
        <div className="mt-6 space-y-2">
          <h4 className="text-sm font-semibold text-slate-300 mb-3">Connection Test Results:</h4>
          {Object.entries(verifyResults).map(([service, result]: [string, any]) => (
            <div key={service} className={`flex items-center gap-3 p-3 rounded-lg ${
              result.valid ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'
            }`}>
              {result.valid ? (
                <Check className="w-5 h-5 text-green-400" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-400" />
              )}
              <div className="flex-1">
                <p className={`font-medium ${result.valid ? 'text-green-300' : 'text-red-300'}`}>
                  {service.charAt(0).toUpperCase() + service.slice(1)}
                </p>
                <p className="text-xs text-slate-400">{result.message || (result.valid ? 'Connected' : 'Failed')}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 mt-6">
        <button
          onClick={handleTestConnections}
          disabled={testing || saving}
          className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {testing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Testing...
            </>
          ) : (
            'Test Connections'
          )}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || testing}
          className="flex-1 px-4 py-3 bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Changes'
          )}
        </button>
      </div>
    </GlassCard>
  );
};

export default ConfigEditor;
