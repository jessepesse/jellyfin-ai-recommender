/**
 * Custom hook for SetupWizard state management
 * Separates business logic from presentation
 */

import { useState, useEffect, useCallback } from 'react';
import { postSystemSetup, postSystemVerify, getSystemSetupDefaults } from '../services/api';

export type ServiceStatus = 'idle' | 'testing' | 'success' | 'error';

export interface ServiceTestResult {
  status: ServiceStatus;
  message: string;
}

export interface TestResults {
  jellyfin: ServiceTestResult;
  jellyseerr: ServiceTestResult;
  gemini: ServiceTestResult;
  openrouter: ServiceTestResult;
}

export interface SetupFormData {
  jellyfinUrl: string;
  jellyseerrUrl: string;
  jellyseerrApiKey: string;
  geminiApiKey: string;
  aiProvider: 'google' | 'openrouter';
  openrouterApiKey: string;
  aiModel: string;
}

export interface UseSetupWizardReturn {
  // Form state
  formData: SetupFormData;
  setFormData: React.Dispatch<React.SetStateAction<SetupFormData>>;
  updateField: <K extends keyof SetupFormData>(field: K, value: SetupFormData[K]) => void;

  // Test state
  testResults: TestResults;
  isAllTestsPassed: boolean;

  // Action states
  isSaving: boolean;
  isRestoring: boolean;
  error: string | null;
  restoreSuccess: boolean;

  // Actions
  handleTest: () => Promise<void>;
  handleSave: (e: React.FormEvent) => Promise<void>;
  handleRestore: (file: File) => Promise<void>;
  clearError: () => void;
}

const defaultTestResults: TestResults = {
  jellyfin: { status: 'idle', message: '' },
  jellyseerr: { status: 'idle', message: '' },
  gemini: { status: 'idle', message: '' },
  openrouter: { status: 'idle', message: '' },
};

const defaultFormData: SetupFormData = {
  jellyfinUrl: '',
  jellyseerrUrl: '',
  jellyseerrApiKey: '',
  geminiApiKey: '',
  aiProvider: 'google',
  openrouterApiKey: '',
  aiModel: 'gemini-3-flash-preview',
};

export function useSetupWizard(): UseSetupWizardReturn {
  const [formData, setFormData] = useState<SetupFormData>(defaultFormData);
  const [testResults, setTestResults] = useState<TestResults>(defaultTestResults);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  // Load defaults on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const defaults = await getSystemSetupDefaults();
        if (!mounted) return;

        setFormData(prev => ({
          jellyfinUrl: defaults.jellyfinUrl || prev.jellyfinUrl,
          jellyseerrUrl: defaults.jellyseerrUrl || prev.jellyseerrUrl,
          jellyseerrApiKey: defaults.jellyseerrApiKey || prev.jellyseerrApiKey,
          geminiApiKey: defaults.geminiApiKey || prev.geminiApiKey,
          aiProvider: (defaults.aiProvider as 'google' | 'openrouter') || prev.aiProvider,
          openrouterApiKey: defaults.openrouterApiKey || prev.openrouterApiKey,
          aiModel: defaults.aiModel || prev.aiModel,
        }));
      } catch (e) {
        console.warn('Failed to load setup defaults', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const updateField = useCallback(<K extends keyof SetupFormData>(field: K, value: SetupFormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handleTest = useCallback(async () => {
    setError(null);
    setTestResults({
      jellyfin: { status: 'testing', message: '' },
      jellyseerr: { status: 'testing', message: '' },
      gemini: { status: 'testing', message: '' },
      openrouter: { status: 'testing', message: '' },
    });

    try {
      const data = await postSystemVerify({
        jellyfinUrl: formData.jellyfinUrl,
        jellyseerrUrl: formData.jellyseerrUrl,
        jellyseerrApiKey: formData.jellyseerrApiKey,
        geminiApiKey: formData.geminiApiKey,
        openrouterApiKey: formData.openrouterApiKey,
      });

      setTestResults({
        jellyfin: {
          status: data.jellyfin?.ok ? 'success' : 'error',
          message: data.jellyfin?.message || ''
        },
        jellyseerr: {
          status: data.jellyseerr?.ok ? 'success' : 'error',
          message: data.jellyseerr?.message || ''
        },
        gemini: {
          status: data.gemini?.ok ? 'success' : 'error',
          message: data.gemini?.message || ''
        },
        openrouter: {
          status: data.openrouter?.ok ? 'success' : 'error',
          message: data.openrouter?.message || ''
        },
      });
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message || 'Test failed');
      setTestResults({
        jellyfin: { status: 'error', message: '' },
        jellyseerr: { status: 'error', message: '' },
        gemini: { status: 'error', message: '' },
        openrouter: { status: 'error', message: '' },
      });
    }
  }, [formData]);

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Check if the selected provider's API key test passed
    const selectedProviderPassed = formData.aiProvider === 'google'
      ? testResults.gemini.status === 'success'
      : testResults.openrouter.status === 'success';

    const allPassed =
      testResults.jellyfin.status === 'success' &&
      testResults.jellyseerr.status === 'success' &&
      selectedProviderPassed;

    if (!allPassed) {
      const ok = window.confirm('Not all connection tests passed. Are you sure you want to save anyway?');
      if (!ok) return;
    }

    setIsSaving(true);
    try {
      await postSystemSetup({
        jellyfinUrl: formData.jellyfinUrl,
        jellyseerrUrl: formData.jellyseerrUrl,
        jellyseerrApiKey: formData.jellyseerrApiKey,
        geminiApiKey: formData.geminiApiKey,
        aiProvider: formData.aiProvider,
        openrouterApiKey: formData.openrouterApiKey,
        aiModel: formData.aiModel,
      });
      window.location.reload();
    } catch (err: unknown) {
      const error = err as { message?: string };
      setError(error?.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [formData, testResults]);

  const handleRestore = useCallback(async (file: File) => {
    setIsRestoring(true);
    setError(null);
    setRestoreSuccess(false);

    try {
      const fileContent = await file.text();
      let parsed: { system_config?: Record<string, unknown>; data?: Record<string, unknown> } | null = null;

      try {
        parsed = JSON.parse(fileContent);
        console.log('📦 Backup file parsed:', parsed);
      } catch {
        setError('Invalid JSON file. Please select a valid backup file.');
        setIsRestoring(false);
        return;
      }

      // Extract system config if available (multi-user backups)
      if (parsed?.system_config) {
        const cfg = parsed.system_config as Record<string, string>;
        setFormData(prev => ({
          jellyfinUrl: cfg.jellyfinUrl || prev.jellyfinUrl,
          jellyseerrUrl: cfg.jellyseerrUrl || prev.jellyseerrUrl,
          jellyseerrApiKey: cfg.jellyseerrApiKey || prev.jellyseerrApiKey,
          geminiApiKey: cfg.geminiApiKey || prev.geminiApiKey,
          aiProvider: (cfg.aiProvider as 'google' | 'openrouter') || prev.aiProvider,
          openrouterApiKey: cfg.openrouterApiKey || prev.openrouterApiKey,
          // Support both old geminiModel and new aiModel field names
          aiModel: cfg.aiModel || cfg.geminiModel || prev.aiModel,
        }));
      }
      // Legacy single-user format
      else if (parsed?.data) {
        const cfg = parsed.data as Record<string, string>;
        setFormData(prev => ({
          jellyfinUrl: cfg.jellyfinUrl || prev.jellyfinUrl,
          jellyseerrUrl: cfg.jellyseerrUrl || prev.jellyseerrUrl,
          jellyseerrApiKey: cfg.jellyseerrApiKey || prev.jellyseerrApiKey,
          geminiApiKey: cfg.geminiApiKey || prev.geminiApiKey,
          aiProvider: (cfg.aiProvider as 'google' | 'openrouter') || prev.aiProvider,
          openrouterApiKey: cfg.openrouterApiKey || prev.openrouterApiKey,
          aiModel: cfg.aiModel || cfg.geminiModel || prev.aiModel,
        }));
      }

      setRestoreSuccess(true);
      setError('✅ Backup file loaded! Configuration fields have been pre-filled. You can now test connections and save.');
    } catch (err: unknown) {
      const error = err as { message?: string };
      setError(error?.message || 'Failed to read backup file');
    } finally {
      setIsRestoring(false);
    }
  }, []);

  const isAllTestsPassed =
    testResults.jellyfin.status === 'success' &&
    testResults.jellyseerr.status === 'success' &&
    (formData.aiProvider === 'google'
      ? testResults.gemini.status === 'success'
      : testResults.openrouter.status === 'success');

  return {
    formData,
    setFormData,
    updateField,
    testResults,
    isAllTestsPassed,
    isSaving,
    isRestoring,
    error,
    restoreSuccess,
    handleTest,
    handleSave,
    handleRestore,
    clearError,
  };
}
