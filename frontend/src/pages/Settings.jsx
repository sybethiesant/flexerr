import React, { useState, useEffect, useMemo } from 'react';
import { api, useAuth } from '../App';
import {
  Settings, Clock, Film, RefreshCw, Calendar,
  Server, Save, Loader2, RotateCcw, Eye, EyeOff,
  ChevronDown, ChevronUp, HardDrive, Zap, Video, Play,
  CheckCircle, XCircle, Plus, Trash2, Edit2, ExternalLink,
  Search, X, Layers, Tv, Shield
} from 'lucide-react';
import toast from 'react-hot-toast';

// Default provider IDs for discover filter (popular US streaming services)
const DEFAULT_PROVIDER_IDS = [8, 9, 337, 1899, 15, 386, 350, 2303, 283];

// ============================================
// Reusable Components
// ============================================

function SettingSection({ title, icon: Icon, children, collapsible = false, defaultOpen = true }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => collapsible && setIsOpen(!isOpen)}
        className={collapsible ? 'w-full flex items-center justify-between p-4 cursor-pointer hover:bg-slate-700/50' : 'w-full flex items-center justify-between p-4'}
        disabled={!collapsible}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-500/20 rounded-lg">
            <Icon className="h-5 w-5 text-primary-400" />
          </div>
          <h3 className="font-semibold text-white">{title}</h3>
        </div>
        {collapsible && (
          isOpen ? <ChevronUp className="h-5 w-5 text-slate-400" /> : <ChevronDown className="h-5 w-5 text-slate-400" />
        )}
      </button>
      {isOpen && (
        <div className="p-4 pt-0 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

function SettingRow({ label, description, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3 border-b border-slate-700 last:border-0">
      <div className="flex-1 min-w-0">
        <label className="text-sm font-medium text-white">{label}</label>
        {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
      </div>
      <div className="flex-shrink-0 sm:ml-4">
        {children}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={checked
        ? 'relative w-11 h-6 rounded-full transition-colors bg-primary-500' + (disabled ? ' opacity-50 cursor-not-allowed' : ' cursor-pointer')
        : 'relative w-11 h-6 rounded-full transition-colors bg-slate-600' + (disabled ? ' opacity-50 cursor-not-allowed' : ' cursor-pointer')
      }
    >
      <div
        className={checked
          ? 'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform translate-x-5'
          : 'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform translate-x-0'
        }
      />
    </button>
  );
}

function NumberInput({ value, onChange, min, max, step = 1, unit, className = '' }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        max={max}
        step={step}
        className={'w-20 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ' + className}
      />
      {unit && <span className="text-sm text-slate-400">{unit}</span>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', className = '' }) {
  const [showPassword, setShowPassword] = useState(false);

  if (type === 'password') {
    return (
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={'w-full px-3 py-1.5 pr-10 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ' + className}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  }

  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={'w-full px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ' + className}
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function ScheduleInput({ value, onChange }) {
  const parseCron = (cron) => {
    if (!cron) return { type: 'daily', hour: 2 };
    const parts = cron.split(' ');
    if (parts.length !== 5) return { type: 'daily', hour: 2 };
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    if (hour.startsWith('*/')) {
      const hours = parseInt(hour.slice(2));
      return { type: 'hours', interval: hours };
    }
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && !hour.includes('/') && !hour.includes(',')) {
      return { type: 'daily', hour: parseInt(hour) || 0 };
    }
    return { type: 'daily', hour: 2 };
  };

  const toCron = (schedule) => {
    switch (schedule.type) {
      case 'hours':
        return '0 */' + (schedule.interval || 6) + ' * * *';
      case 'daily':
      default:
        return '0 ' + (schedule.hour || 2) + ' * * *';
    }
  };

  const schedule = parseCron(value);

  const handleTypeChange = (type) => {
    if (type === 'hours') {
      onChange(toCron({ type: 'hours', interval: 6 }));
    } else {
      onChange(toCron({ type: 'daily', hour: 2 }));
    }
  };

  const handleHourChange = (hour) => {
    onChange(toCron({ type: 'daily', hour: parseInt(hour) }));
  };

  const handleIntervalChange = (interval) => {
    onChange(toCron({ type: 'hours', interval: parseInt(interval) }));
  };

  const hours = [];
  for (let i = 0; i < 24; i++) {
    const label = i === 0 ? '12:00 AM' :
                  i < 12 ? i + ':00 AM' :
                  i === 12 ? '12:00 PM' :
                  (i - 12) + ':00 PM';
    hours.push({ value: i, label });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={schedule.type}
        onChange={(e) => handleTypeChange(e.target.value)}
        className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <option value="daily">Daily at</option>
        <option value="hours">Every</option>
      </select>
      {schedule.type === 'daily' ? (
        <select
          value={schedule.hour}
          onChange={(e) => handleHourChange(e.target.value)}
          className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {hours.map((h) => (
            <option key={h.value} value={h.value}>{h.label}</option>
          ))}
        </select>
      ) : (
        <>
          <select
            value={schedule.interval || 6}
            onChange={(e) => handleIntervalChange(e.target.value)}
            className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="6">6</option>
            <option value="8">8</option>
            <option value="12">12</option>
            <option value="24">24</option>
          </select>
          <span className="text-sm text-slate-400">hours</span>
        </>
      )}
    </div>
  );
}

function ServiceCard({ service, onTest, onEdit, onDelete, testing, testResult }) {
  const getServiceIcon = (type) => {
    switch (type) {
      case 'plex':
        return (
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.643 0L4.68 12l6.963 12h6.714L11.393 12 18.357 0z" />
          </svg>
        );
      case 'jellyfin':
        return (
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .002C7.524.002 3.53 2.144 1.088 5.5L12 22l10.912-16.5C20.47 2.144 16.476.002 12 .002zm0 3.996a4.5 4.5 0 110 9 4.5 4.5 0 010-9z" />
          </svg>
        );
      case 'sonarr':
        return <Video className="h-6 w-6" />;
      case 'radarr':
        return <Film className="h-6 w-6" />;
      default:
        return <Server className="h-6 w-6" />;
    }
  };

  const getServiceColor = (type) => {
    switch (type) {
      case 'plex':
        return 'text-yellow-400 bg-yellow-500/20';
      case 'jellyfin':
        return 'text-purple-400 bg-purple-500/20';
      case 'sonarr':
        return 'text-blue-400 bg-blue-500/20';
      case 'radarr':
        return 'text-orange-400 bg-orange-500/20';
      default:
        return 'text-slate-400 bg-slate-500/20';
    }
  };

  return (
    <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${getServiceColor(service.type)}`}>
            {getServiceIcon(service.type)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-white">{service.name}</h4>
              {service.is_default === 1 && (
                <span className="text-xs bg-primary-500/30 text-primary-300 px-2 py-0.5 rounded">Default</span>
              )}
              {service.is_active === 0 && (
                <span className="text-xs bg-red-500/30 text-red-300 px-2 py-0.5 rounded">Inactive</span>
              )}
            </div>
            <p className="text-sm text-slate-400">{service.url}</p>
            {service.api_key && (
              <p className="text-xs text-slate-500 mt-1">API Key: {service.api_key}</p>
            )}
            {testResult && (
              <div className={`flex items-center gap-1 mt-1 text-xs ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {testResult.success ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                <span>{testResult.success ? 'Connected' : testResult.error || 'Failed'}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onTest(service)}
            disabled={testing === service.id}
            className={`p-2 rounded-lg transition-colors ${
              testResult?.success ? 'text-green-400 hover:text-green-300 hover:bg-slate-600' :
              testResult && !testResult.success ? 'text-red-400 hover:text-red-300 hover:bg-slate-600' :
              'text-slate-400 hover:text-white hover:bg-slate-600'
            }`}
            title="Test Connection"
          >
            {testing === service.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : testResult?.success ? (
              <CheckCircle className="h-4 w-4" />
            ) : testResult && !testResult.success ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => onEdit(service)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-600 rounded-lg transition-colors"
            title="Edit"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          {service.type !== 'plex' && service.type !== 'jellyfin' && (
            <button
              onClick={() => onDelete(service)}
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-600 rounded-lg transition-colors"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ServiceModal({ service, onSave, onClose, isNew = false }) {
  const [formData, setFormData] = useState({
    type: service?.type || 'sonarr',
    name: service?.name || '',
    url: service?.url || '',
    api_key: '',
    is_default: service?.is_default === 1,
    is_active: service?.is_active !== 0
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      let res;
      if (!isNew && !formData.api_key && service?.id) {
        // Editing existing service with no new API key - use stored key via service ID
        res = await api.post(`/services/${service.id}/test`);
      } else {
        // New service or new API key provided - test with provided credentials
        res = await api.post('/services/test', {
          type: formData.type,
          url: formData.url,
          api_key: formData.api_key
        });
      }
      setTestResult(res.data);
    } catch (err) {
      setTestResult({ success: false, error: err.response?.data?.error || err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const data = { ...formData };
    if (!data.api_key) {
      delete data.api_key;
    }
    onSave(data);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-md">
        <div className="p-4 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-white">
            {isNew ? 'Add Service' : 'Edit Service'}
          </h3>
        </div>
        <div className="p-4 space-y-4">
          {isNew && (
            <div>
              <label className="block text-sm font-medium text-white mb-1">Service Type</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value, name: e.target.value.charAt(0).toUpperCase() + e.target.value.slice(1) })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              >
                <option value="sonarr">Sonarr</option>
                <option value="radarr">Radarr</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-white mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              placeholder="My Sonarr"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white mb-1">URL</label>
            <input
              type="text"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              placeholder="http://localhost:8989"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white mb-1">API Key</label>
            <input
              type="password"
              value={formData.api_key}
              onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              placeholder={isNew ? 'Enter API key' : 'Leave blank to keep existing'}
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="rounded border-slate-600 bg-slate-700"
              />
              Default
            </label>
            <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="rounded border-slate-600 bg-slate-700"
              />
              Active
            </label>
          </div>
          {testResult && (
            <div className={`p-3 rounded-lg ${testResult.success ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
              <div className="flex items-center gap-2">
                {testResult.success ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                <span className="text-sm">
                  {testResult.success ? `Connected: ${testResult.name || testResult.serverName || 'OK'}` : testResult.error}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-700 flex items-center justify-between">
          <button
            onClick={handleTest}
            disabled={testing || !formData.url}
            className="btn btn-secondary flex items-center gap-2"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Test
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button
              onClick={handleSave}
              disabled={!formData.name || !formData.url}
              className="btn btn-primary"
            >
              {isNew ? 'Add' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Settings Tabs Configuration
// ============================================

const SETTINGS_TABS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'services', label: 'Services', icon: Server },
  { id: 'viper', label: 'VIPER', icon: Zap },
  { id: 'media', label: 'Media Sync', icon: Tv },
  { id: 'cleanup', label: 'Cleanup', icon: Clock },
  { id: 'convert', label: 'Auto Convert', icon: Video },
];

// ============================================
// Main Settings Page
// ============================================

export default function SettingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [settingsReady, setSettingsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalSettings, setOriginalSettings] = useState({});
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [protectionStats, setProtectionStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Services state
  const [services, setServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [testingService, setTestingService] = useState(null);
  const [serviceTestResults, setServiceTestResults] = useState({});
  const [editingService, setEditingService] = useState(null);
  const [addingService, setAddingService] = useState(false);

  // Discover providers state
  const [allProviders, setAllProviders] = useState([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [providerSearch, setProviderSearch] = useState('');

  // Hardware detection state
  const [detectedHardware, setDetectedHardware] = useState(null);
  const [detectingHardware, setDetectingHardware] = useState(false);

  // Conversion jobs state
  const [conversionJobs, setConversionJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobsFilter, setJobsFilter] = useState('all');

  // Plex libraries for auto-invite
  const [plexLibraries, setPlexLibraries] = useState([]);
  const [loadingLibraries, setLoadingLibraries] = useState(false);

  // Plex invitations tracking
  const [invitations, setInvitations] = useState([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);

  // Derive enabledProviders from settings synchronously (avoids useEffect timing gap)
  const enabledProviders = useMemo(() => {
    if (settings.discover_providers) {
      try {
        const parsed = JSON.parse(settings.discover_providers);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // Use defaults on parse error
      }
    }
    return DEFAULT_PROVIDER_IDS;
  }, [settings.discover_providers]);

  // Derive selectedLibraries from settings synchronously (avoids useEffect timing gap)
  const selectedLibraries = useMemo(() => {
    if (settings.auto_invite_libraries) {
      try {
        const parsed = JSON.parse(settings.auto_invite_libraries);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // Use empty array on parse error
      }
    }
    return [];
  }, [settings.auto_invite_libraries]);

  useEffect(() => {
    fetchSettings();
    fetchServices();
    detectHardware();
    fetchPlexLibraries();
    fetchInvitations();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await api.get('/settings');
      setSettings(res.data);
      setOriginalSettings(res.data);
      setSettingsReady(true);
    } catch (err) {
      console.error('Failed to load settings:', err);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const fetchServices = async () => {
    try {
      const res = await api.get('/services');
      setServices(res.data);
    } catch (err) {
      console.error('Failed to load services:', err);
    } finally {
      setLoadingServices(false);
    }
  };

  const fetchPlexLibraries = async () => {
    setLoadingLibraries(true);
    try {
      const res = await api.get('/settings/plex-libraries');
      setPlexLibraries(res.data.libraries || []);
    } catch (err) {
      console.error('Failed to load Plex libraries:', err);
      // Silently fail - Plex might not be configured yet
    } finally {
      setLoadingLibraries(false);
    }
  };

  const fetchInvitations = async () => {
    setLoadingInvitations(true);
    try {
      const res = await api.get('/settings/invitations');
      setInvitations(res.data || []);
    } catch (err) {
      console.error('Failed to load invitations:', err);
      // Silently fail - no invitations yet
    } finally {
      setLoadingInvitations(false);
    }
  };

  const toggleLibrary = (libraryId) => {
    const newSelected = selectedLibraries.includes(libraryId)
      ? selectedLibraries.filter(id => id !== libraryId)
      : [...selectedLibraries, libraryId];
    updateSetting('auto_invite_libraries', JSON.stringify(newSelected));
  };

  const selectAllLibraries = () => {
    const allIds = plexLibraries.map(lib => lib.id);
    updateSetting('auto_invite_libraries', JSON.stringify(allIds));
  };

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: String(value) }));
    setHasChanges(true);
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await api.put('/settings', settings);
      setOriginalSettings(settings);
      setHasChanges(false);
      toast.success('Settings saved successfully');
    } catch (err) {
      console.error('Failed to save settings:', err);
      toast.error(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const resetSettings = () => {
    setSettings(originalSettings);
    setHasChanges(false);
  };

  const detectHardware = async () => {
    setDetectingHardware(true);
    try {
      const res = await api.get('/settings/detect-hardware');
      setDetectedHardware(res.data);
    } catch (err) {
      console.error('Failed to detect hardware:', err);
    } finally {
      setDetectingHardware(false);
    }
  };

  const applyRecommendedHardware = () => {
    if (!detectedHardware?.recommended) return;
    const rec = detectedHardware.recommended;
    updateSetting('auto_convert_hwaccel', rec.hwaccel);
    updateSetting('auto_convert_gpu_device', rec.device);
    updateSetting('auto_convert_codec', rec.codec);
    toast.success('Applied recommended settings');
  };

  const fetchConversionJobs = async () => {
    setLoadingJobs(true);
    try {
      const res = await api.get('/conversions', { params: { limit: 50 } });
      setConversionJobs(res.data.jobs || []);
    } catch (err) {
      console.error('Failed to fetch conversion jobs:', err);
    } finally {
      setLoadingJobs(false);
    }
  };

  const deleteConversionJob = async (jobId) => {
    try {
      await api.delete(`/conversions/${jobId}`);
      toast.success('Conversion job deleted');
      fetchConversionJobs();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete job');
    }
  };

  const retryConversionJob = async (jobId) => {
    try {
      await api.post(`/conversions/${jobId}/retry`);
      toast.success('Conversion job queued for retry');
      fetchConversionJobs();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to retry job');
    }
  };

  const deleteAllFailedJobs = async () => {
    const failedJobs = conversionJobs.filter(j => j.status === 'failed');
    if (failedJobs.length === 0) {
      toast.error('No failed jobs to delete');
      return;
    }
    if (!window.confirm(`Delete all ${failedJobs.length} failed conversion jobs?`)) return;

    let deleted = 0;
    for (const job of failedJobs) {
      try {
        await api.delete(`/conversions/${job.id}`);
        deleted++;
      } catch (err) {
        console.error('Failed to delete job:', job.id, err);
      }
    }
    toast.success(`Deleted ${deleted} failed jobs`);
    fetchConversionJobs();
  };

  const fetchProtectionStats = async () => {
    setLoadingStats(true);
    try {
      const res = await api.get('/cleanup/protection-stats');
      setProtectionStats(res.data);
    } catch (err) {
      console.error('Failed to fetch protection stats:', err);
      toast.error('Failed to load protection stats');
    } finally {
      setLoadingStats(false);
    }
  };

  const runSmartCleanup = async (dryRun = true) => {
    setRunningCleanup(true);
    setCleanupResult(null);
    try {
      const res = await api.post('/cleanup/run', { dryRun });
      setCleanupResult(res.data);

      if (res.data.skipped) {
        toast.error('Cleanup skipped - another task is already running');
        return;
      }

      if (res.data.episodes?.enabled === false) {
        toast.error('VIPER is disabled. Enable it in settings first.');
        return;
      }

      if (res.data.error) {
        toast.error(`Cleanup failed: ${res.data.error}`);
        return;
      }

      const epAnalyzed = res.data.episodes?.episodesAnalyzed || 0;
      const movAnalyzed = res.data.movies?.moviesAnalyzed || 0;
      const epCandidates = res.data.episodes?.deletionCandidates?.length || 0;
      const movieCandidates = res.data.movies?.deletionCandidates?.length || 0;
      const epDeleted = res.data.episodes?.deleted?.length || 0;
      const movieDeleted = res.data.movies?.deleted?.length || 0;

      if (dryRun) {
        if (epCandidates === 0 && movieCandidates === 0) {
          toast.success(`Analyzed ${epAnalyzed} episodes, ${movAnalyzed} movies - all content within buffer zones`);
        } else {
          toast.success(`Preview: ${epCandidates} episodes, ${movieCandidates} movies ready for cleanup`);
        }
      } else {
        if (epDeleted === 0 && movieDeleted === 0) {
          toast.success(`Analyzed ${epAnalyzed + movAnalyzed} items - nothing met cleanup criteria`);
        } else {
          toast.success(`Cleanup complete: ${epDeleted} episodes, ${movieDeleted} movies deleted`);
        }
      }
    } catch (err) {
      console.error('Cleanup failed:', err);
      toast.error(err.response?.data?.error || 'Cleanup failed');
    } finally {
      setRunningCleanup(false);
    }
  };

  const handleTestService = async (service) => {
    setTestingService(service.id);
    setServiceTestResults(prev => ({ ...prev, [service.id]: null })); // Clear previous result
    try {
      const res = await api.post(`/services/${service.id}/test`);
      setServiceTestResults(prev => ({ ...prev, [service.id]: res.data }));
      if (res.data.success) {
        toast.success(`${service.name}: Connected successfully`);
      } else {
        toast.error(`${service.name}: ${res.data.error}`);
      }
    } catch (err) {
      const errorResult = { success: false, error: err.response?.data?.error || err.message };
      setServiceTestResults(prev => ({ ...prev, [service.id]: errorResult }));
      toast.error(`${service.name}: ${errorResult.error}`);
    } finally {
      setTestingService(null);
    }
  };

  const handleSaveService = async (data) => {
    try {
      if (editingService) {
        await api.put(`/services/${editingService.id}`, data);
        toast.success('Service updated');
      } else {
        await api.post('/services', data);
        toast.success('Service added');
      }
      fetchServices();
      setEditingService(null);
      setAddingService(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save service');
    }
  };

  const handleDeleteService = async (service) => {
    if (!window.confirm(`Delete ${service.name}?`)) return;
    try {
      await api.delete(`/services/${service.id}`);
      toast.success('Service deleted');
      fetchServices();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete service');
    }
  };

  // Provider functions
  const fetchAllProviders = async () => {
    setLoadingProviders(true);
    try {
      const [movieRes, tvRes] = await Promise.all([
        api.get('/discover/providers', { params: { type: 'movie', region: 'US' } }),
        api.get('/discover/providers', { params: { type: 'tv', region: 'US' } })
      ]);

      const byId = new Map();
      [...(movieRes.data.providers || []), ...(tvRes.data.providers || [])].forEach(p => {
        if (!byId.has(p.id)) {
          byId.set(p.id, p);
        }
      });

      const getBrand = (name) => {
        const lower = name.toLowerCase().trim();
        const brandPatterns = [
          /^(amazon)/i, /^(amc)/i, /^(apple)/i, /^(bet)/i, /^(britbox)/i,
          /^(cbs)/i, /^(comedy)/i, /^(criterion)/i, /^(crunchyroll)/i,
          /^(curiosity)/i, /^(discovery)/i, /^(disney)/i, /^(doc)/i,
          /^(epix)/i, /^(espn)/i, /^(fandango)/i, /^(fox)/i, /^(fubi)/i,
          /^(fxnow)/i, /^(google)/i, /^(hallmark)/i, /^(hbo)/i, /^(history)/i,
          /^(hulu)/i, /^(itv)/i, /^(kanopy)/i, /^(lifetime)/i, /^(max)/i,
          /^(mgm)/i, /^(mubi)/i, /^(nbc)/i, /^(netflix)/i, /^(nick)/i,
          /^(paramount)/i, /^(pbs)/i, /^(peacock)/i, /^(pluto)/i, /^(plex)/i,
          /^(roku)/i, /^(shudder)/i, /^(showtime)/i, /^(starz)/i, /^(sundance)/i,
          /^(tnt)/i, /^(tubi)/i, /^(vudu)/i, /^(youtube)/i
        ];
        for (const pattern of brandPatterns) {
          const match = lower.match(pattern);
          if (match) return match[1].toLowerCase();
        }
        return lower.split(/[\s+]/)[0].replace(/[^a-z0-9]/g, '');
      };

      const byBrand = new Map();
      Array.from(byId.values()).forEach(p => {
        const brand = getBrand(p.name);
        const existing = byBrand.get(brand);
        if (!existing || (p.display_priority || 999) < (existing.display_priority || 999)) {
          byBrand.set(brand, p);
        }
      });

      const merged = Array.from(byBrand.values()).sort((a, b) =>
        (a.display_priority || 999) - (b.display_priority || 999)
      );
      setAllProviders(merged);
    } catch (err) {
      console.error('Failed to load providers:', err);
      toast.error('Failed to load streaming providers');
    } finally {
      setLoadingProviders(false);
    }
  };

  const toggleProvider = (providerId) => {
    const newEnabled = enabledProviders.includes(providerId)
      ? enabledProviders.filter(id => id !== providerId)
      : [...enabledProviders, providerId];
    updateSetting('discover_providers', JSON.stringify(newEnabled));
  };

  const selectAllProviders = () => {
    const filtered = getFilteredProviders();
    const newEnabled = [...new Set([...enabledProviders, ...filtered.map(p => p.id)])];
    updateSetting('discover_providers', JSON.stringify(newEnabled));
  };

  const deselectAllProviders = () => {
    const filtered = getFilteredProviders();
    const filterIds = new Set(filtered.map(p => p.id));
    const newEnabled = enabledProviders.filter(id => !filterIds.has(id));
    updateSetting('discover_providers', JSON.stringify(newEnabled));
  };

  const getFilteredProviders = () => {
    let filtered = allProviders;
    if (providerSearch.trim()) {
      const search = providerSearch.toLowerCase();
      filtered = allProviders.filter(p => p.name.toLowerCase().includes(search));
    }
    // Sort alphabetically by name
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  };

  const getBool = (key) => settings[key] === 'true';
  const getInt = (key, defaultVal = 0) => parseInt(settings[key]) || defaultVal;
  const getFloat = (key, defaultVal = 0) => parseFloat(settings[key]) || defaultVal;
  const getStr = (key, defaultVal = '') => settings[key] || defaultVal;

  const mediaServerType = getStr('media_server_type', 'plex');
  const mediaServerLabel = mediaServerType === 'jellyfin' ? 'Jellyfin' : 'Plex';

  const mediaServer = services.find(s => s.type === 'plex' || s.type === 'jellyfin');
  const arrServices = services.filter(s => s.type === 'sonarr' || s.type === 'radarr');

  // Wait for settings to be fully loaded - check for actual data, not just flags
  const hasSettings = Object.keys(settings).length > 0;
  if (loading || !hasSettings) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-12 w-12 text-primary-500 animate-spin" />
      </div>
    );
  }

  // Non-admin users see limited settings
  if (!user?.is_admin) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-primary-400" />
          <h1 className="text-2xl font-bold text-white">Settings</h1>
        </div>

        <SettingSection title={`Your ${mediaServerLabel} Account`} icon={Server}>
          <div className="flex items-center gap-4 py-4">
            {user?.thumb && (
              <img src={user.thumb} alt={user.username} className="w-16 h-16 rounded-full" />
            )}
            <div>
              <p className="text-lg font-medium text-white">{user?.username}</p>
              <p className="text-sm text-slate-400">{user?.email}</p>
              <p className="text-xs text-slate-500 mt-1">
                Connected via {mediaServerLabel}
              </p>
            </div>
          </div>
        </SettingSection>

        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <p className="text-sm text-slate-400">
            Additional settings are available to administrators only.
          </p>
        </div>
      </div>
    );
  }

  // ============================================
  // Tab Content Renderers
  // ============================================

  const renderGeneralTab = () => (
    <div className="space-y-6">
      <SettingSection title="General Settings" icon={Settings}>
        <SettingRow label="Timezone" description="Timezone for scheduled tasks">
          <SelectInput
            value={getStr('timezone', 'UTC')}
            onChange={(v) => updateSetting('timezone', v)}
            options={[
              { value: 'UTC', label: 'UTC' },
              { value: 'America/New_York', label: 'Eastern Time' },
              { value: 'America/Chicago', label: 'Central Time' },
              { value: 'America/Denver', label: 'Mountain Time' },
              { value: 'America/Los_Angeles', label: 'Pacific Time' },
              { value: 'Europe/London', label: 'London' },
              { value: 'Europe/Paris', label: 'Paris' },
              { value: 'Asia/Tokyo', label: 'Tokyo' },
              { value: 'Australia/Sydney', label: 'Sydney' }
            ]}
          />
        </SettingRow>
        <SettingRow label="TMDB API Key" description="Your TMDB API key for media information">
          <div className="w-64">
            <TextInput
              type="password"
              value={getStr('tmdb_api_key')}
              onChange={(v) => updateSetting('tmdb_api_key', v)}
              placeholder="Enter TMDB API key"
            />
          </div>
        </SettingRow>
        <SettingRow label="Dry Run Mode" description="Preview deletions without actually deleting">
          <Toggle
            checked={getBool('dry_run')}
            onChange={(v) => updateSetting('dry_run', v)}
          />
        </SettingRow>
        <SettingRow label="Delete Files" description="Actually delete files from disk (not just from Sonarr/Radarr)">
          <Toggle
            checked={getBool('delete_files')}
            onChange={(v) => updateSetting('delete_files', v)}
          />
        </SettingRow>
      </SettingSection>

      {/* Discover Providers */}
      <SettingSection title="Discover Providers" icon={Search}>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
          <p className="text-blue-300 text-sm">
            Select which streaming providers appear in the Discover page filter.
          </p>
        </div>

        {allProviders.length === 0 ? (
          <div className="text-center py-8">
            <button
              onClick={fetchAllProviders}
              disabled={loadingProviders}
              className="btn btn-primary flex items-center gap-2 mx-auto"
            >
              {loadingProviders ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {loadingProviders ? 'Loading...' : 'Load Providers'}
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                  placeholder="Search providers..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                />
                {providerSearch && (
                  <button
                    onClick={() => setProviderSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={selectAllProviders} className="px-3 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg">
                  Select All
                </button>
                <button onClick={deselectAllProviders} className="px-3 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg">
                  Deselect All
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-4 px-1">
              <span className="text-sm text-slate-400">
                {getFilteredProviders().length} providers
              </span>
              <span className="text-sm font-medium text-primary-400">
                {enabledProviders.length} enabled
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-72 overflow-y-auto pr-1">
              {getFilteredProviders().map(provider => {
                const isEnabled = enabledProviders.includes(provider.id);
                return (
                  <button
                    key={provider.id}
                    onClick={() => toggleProvider(provider.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
                      isEnabled
                        ? 'bg-gradient-to-br from-primary-500/20 to-blue-500/20 ring-2 ring-primary-400/50'
                        : 'bg-slate-700/40 hover:bg-slate-600/50 border border-slate-600/50'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-white flex-shrink-0 flex items-center justify-center shadow-md">
                      {provider.logo_path ? (
                        <img src={provider.logo_path} alt={provider.name} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <span className="text-xs text-slate-500 font-bold">{provider.name.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-medium truncate block ${isEnabled ? 'text-white' : 'text-slate-300'}`}>
                        {provider.name}
                      </span>
                    </div>
                    <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center ${isEnabled ? 'bg-primary-500' : 'bg-slate-600'}`}>
                      {isEnabled && <CheckCircle className="w-3 h-3 text-white" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </SettingSection>
    </div>
  );

  const renderServicesTab = () => (
    <div className="space-y-6">
      <SettingSection title="Connected Services" icon={Server}>
        {loadingServices ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 text-primary-500 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Media Server</div>
              {mediaServer ? (
                <ServiceCard
                  service={mediaServer}
                  onTest={handleTestService}
                  onEdit={setEditingService}
                  onDelete={handleDeleteService}
                  testing={testingService}
                  testResult={serviceTestResults[mediaServer.id]}
                />
              ) : (
                <div className="bg-slate-700/30 border border-slate-600 border-dashed rounded-lg p-4 text-center">
                  <p className="text-sm text-slate-400">No media server configured</p>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Download Managers</div>
                <button
                  onClick={() => setAddingService(true)}
                  className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300"
                >
                  <Plus className="h-4 w-4" />
                  Add Service
                </button>
              </div>
              {arrServices.length > 0 ? (
                <div className="space-y-2">
                  {arrServices.map((service) => (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      onTest={handleTestService}
                      onEdit={setEditingService}
                      onDelete={handleDeleteService}
                      testing={testingService}
                      testResult={serviceTestResults[service.id]}
                    />
                  ))}
                </div>
              ) : (
                <div className="bg-slate-700/30 border border-slate-600 border-dashed rounded-lg p-4 text-center">
                  <p className="text-sm text-slate-400">No Sonarr or Radarr services configured</p>
                </div>
              )}
            </div>
          </div>
        )}
      </SettingSection>
    </div>
  );

  const renderViperTab = () => (
    <div className="space-y-6">
      <SettingSection title="VIPER" icon={Zap}>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
          <p className="text-blue-300 text-sm">
            <strong>VIPER</strong> (Velocity-Informed Protection & Episode Removal) intelligently manages TV show episodes based on each user's
            watch progress and velocity. Episodes are deleted only after all active users have watched them.
          </p>
        </div>

        <SettingRow label="Enable VIPER" description="Automatically manage episodes based on watch progress">
          <Toggle
            checked={getBool('smart_cleanup_enabled')}
            onChange={(v) => updateSetting('smart_cleanup_enabled', v)}
          />
        </SettingRow>

        <SettingRow label="Run Now" description="Manually trigger VIPER cleanup">
          <div className="flex items-center gap-2">
            <button
              onClick={() => runSmartCleanup(true)}
              disabled={runningCleanup}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              {runningCleanup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Preview
            </button>
            <button
              onClick={() => runSmartCleanup(false)}
              disabled={runningCleanup || getBool('dry_run')}
              className="btn btn-primary flex items-center gap-2 text-sm"
            >
              {runningCleanup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run Now
            </button>
          </div>
        </SettingRow>

        {cleanupResult && (
          <div className="bg-slate-700/50 rounded-lg p-3 text-sm">
            <div className="font-medium text-white mb-2">Last Run Results:</div>
            <div className="grid grid-cols-2 gap-2 text-slate-300">
              <div>Episodes analyzed: {cleanupResult.episodes?.episodesAnalyzed || 0}</div>
              <div>Movies analyzed: {cleanupResult.movies?.moviesAnalyzed || 0}</div>
              <div>Episode candidates: {cleanupResult.episodes?.deletionCandidates?.length || 0}</div>
              <div>Movie candidates: {cleanupResult.movies?.deletionCandidates?.length || 0}</div>
            </div>
          </div>
        )}

        <SettingRow label="Protection Stats" description="View why episodes are being protected">
          <button
            onClick={fetchProtectionStats}
            disabled={loadingStats}
            className="btn btn-secondary flex items-center gap-2 text-sm"
          >
            {loadingStats ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            {protectionStats ? 'Refresh' : 'Load Stats'}
          </button>
        </SettingRow>

        {protectionStats && (
          <div className="bg-slate-700/50 rounded-lg p-4 text-sm space-y-4">
            <div>
              <div className="font-medium text-white mb-2">Protection Rules:</div>
              <div className="grid grid-cols-1 gap-1 text-slate-300 text-xs">
                <div>* {protectionStats.protectionReasons?.minDaysSinceWatch}</div>
                <div>* {protectionStats.protectionReasons?.velocityBuffer}</div>
                <div>* {protectionStats.protectionReasons?.maxAhead}</div>
                <div>* {protectionStats.protectionReasons?.graceperiod}</div>
              </div>
            </div>
          </div>
        )}

        <SettingRow label="Cleanup Schedule" description="When to run VIPER episode cleanup">
          <ScheduleInput
            value={getStr('velocity_cleanup_schedule', '0 3 * * *')}
            onChange={(v) => updateSetting('velocity_cleanup_schedule', v)}
          />
        </SettingRow>
      </SettingSection>

      {/* Deletion Timing */}
      <SettingSection title="Deletion Timing" icon={Clock} collapsible defaultOpen={false}>
        <SettingRow label="Min Days Since Watch" description="Minimum days after watching before cleanup">
          <NumberInput
            value={getInt('smart_min_days_since_watch', 15)}
            onChange={(v) => updateSetting('smart_min_days_since_watch', v)}
            min={1}
            max={90}
            unit="days"
          />
        </SettingRow>
        <SettingRow label="Protect Episodes Ahead" description="Minimum unwatched episodes to keep ahead of each user">
          <NumberInput
            value={getInt('smart_protect_episodes_ahead', 3)}
            onChange={(v) => updateSetting('smart_protect_episodes_ahead', v)}
            min={1}
            max={20}
            unit="episodes"
          />
        </SettingRow>
        <SettingRow label="Active Viewer Window" description="Days of inactivity before user is considered inactive">
          <NumberInput
            value={getInt('smart_active_viewer_days', 30)}
            onChange={(v) => updateSetting('smart_active_viewer_days', v)}
            min={7}
            max={180}
            unit="days"
          />
        </SettingRow>
        <SettingRow label="Require All Users Watched" description="Only delete when ALL active users have watched">
          <Toggle
            checked={getBool('smart_require_all_users_watched')}
            onChange={(v) => updateSetting('smart_require_all_users_watched', v)}
          />
        </SettingRow>
        <SettingRow label="Watchlist Grace Period" description="Days to protect shows added to watchlist">
          <NumberInput
            value={getInt('smart_watchlist_grace_days', 14)}
            onChange={(v) => updateSetting('smart_watchlist_grace_days', v)}
            min={1}
            max={60}
            unit="days"
          />
        </SettingRow>
      </SettingSection>

      {/* Velocity-Based Trimming */}
      <SettingSection title="Velocity-Based Trimming" icon={Zap} collapsible defaultOpen={false}>
        <p className="text-xs text-slate-400 pb-2">Delete episodes too far ahead of users based on their watch velocity.</p>

        <SettingRow label="Enable Velocity-Based Trimming" description="Delete unwatched episodes too far ahead">
          <Toggle
            checked={getBool('smart_trim_ahead_enabled')}
            onChange={(v) => updateSetting('smart_trim_ahead_enabled', v)}
          />
        </SettingRow>
        <SettingRow label="Days Buffer" description="Keep enough episodes for this many days of watching ahead">
          <NumberInput
            value={getInt('smart_trim_days_ahead', 10)}
            onChange={(v) => updateSetting('smart_trim_days_ahead', v)}
            min={3}
            max={30}
            unit="days"
          />
        </SettingRow>
        <SettingRow label="Max Episodes Ahead (Hard Cap)" description="Absolute maximum episodes to keep">
          <NumberInput
            value={getInt('smart_max_episodes_ahead', 20)}
            onChange={(v) => updateSetting('smart_max_episodes_ahead', v)}
            min={5}
            max={50}
            unit="episodes"
          />
        </SettingRow>
        <SettingRow label="Min Velocity Samples" description="Episodes watched before trusting velocity">
          <NumberInput
            value={getInt('smart_min_velocity_samples', 3)}
            onChange={(v) => updateSetting('smart_min_velocity_samples', v)}
            min={1}
            max={10}
            unit="episodes"
          />
        </SettingRow>
        <SettingRow label="Unknown Velocity Buffer" description="Conservative buffer when velocity data is insufficient">
          <NumberInput
            value={getInt('smart_unknown_velocity_buffer', 10)}
            onChange={(v) => updateSetting('smart_unknown_velocity_buffer', v)}
            min={3}
            max={30}
            unit="episodes"
          />
        </SettingRow>
        <SettingRow label="Default Velocity" description="Assumed watch speed when no data exists">
          <NumberInput
            value={getFloat('smart_default_velocity', 1.0)}
            onChange={(v) => updateSetting('smart_default_velocity', v)}
            min={0.1}
            max={10}
            step={0.1}
            unit="eps/day"
          />
        </SettingRow>
      </SettingSection>

      {/* Proactive Redownload */}
      <SettingSection title="Proactive Redownload" icon={RefreshCw} collapsible defaultOpen={false}>
        <p className="text-xs text-slate-400 pb-2">Automatically re-download deleted episodes before users need them.</p>

        <SettingRow label="Enable Proactive Redownload" description="Re-download episodes before users catch up">
          <Toggle
            checked={getBool('smart_proactive_redownload')}
            onChange={(v) => updateSetting('smart_proactive_redownload', v)}
          />
        </SettingRow>
        <SettingRow label="Redownload Lead Time" description="Days before a user needs an episode to trigger redownload">
          <NumberInput
            value={getInt('smart_redownload_lead_days', 3)}
            onChange={(v) => updateSetting('smart_redownload_lead_days', v)}
            min={1}
            max={14}
            unit="days"
          />
        </SettingRow>
        <SettingRow label="Emergency Buffer" description="Hours before user needs episode to trigger URGENT redownload">
          <NumberInput
            value={getInt('smart_emergency_buffer_hours', 24)}
            onChange={(v) => updateSetting('smart_emergency_buffer_hours', v)}
            min={1}
            max={72}
            unit="hours"
          />
        </SettingRow>
        <SettingRow label="Redownload Check Interval" description="How often to check if episodes need to be re-downloaded">
          <NumberInput
            value={getInt('smart_redownload_check_interval', 360)}
            onChange={(v) => updateSetting('smart_redownload_check_interval', v)}
            min={30}
            max={1440}
            unit="min"
          />
        </SettingRow>
      </SettingSection>

      {/* Velocity Monitoring */}
      <SettingSection title="Velocity Monitoring" icon={Eye} collapsible defaultOpen={false}>
        <p className="text-xs text-slate-400 pb-2">Monitor users' watch speed changes and react proactively.</p>

        <SettingRow label="Enable Velocity Monitoring" description="Detect when users speed up or slow down">
          <Toggle
            checked={getBool('smart_velocity_monitoring_enabled')}
            onChange={(v) => updateSetting('smart_velocity_monitoring_enabled', v)}
          />
        </SettingRow>
        <SettingRow label="Check Interval" description="How often to check for velocity changes">
          <NumberInput
            value={getInt('smart_velocity_check_interval', 120)}
            onChange={(v) => updateSetting('smart_velocity_check_interval', v)}
            min={30}
            max={720}
            unit="minutes"
          />
        </SettingRow>
        <SettingRow label="Change Threshold" description="Percentage change in watch speed to trigger action">
          <NumberInput
            value={getInt('smart_velocity_change_threshold', 50)}
            onChange={(v) => updateSetting('smart_velocity_change_threshold', v)}
            min={10}
            max={200}
            unit="%"
          />
        </SettingRow>
        <SettingRow label="On Velocity Change" description="What to do when velocity increases significantly">
          <SelectInput
            value={getStr('smart_velocity_change_action', 'redownload')}
            onChange={(v) => updateSetting('smart_velocity_change_action', v)}
            options={[
              { value: 'redownload', label: 'Trigger Redownloads' },
              { value: 'alert', label: 'Alert Only' },
              { value: 'both', label: 'Both' }
            ]}
          />
        </SettingRow>
      </SettingSection>
    </div>
  );

  const renderMediaTab = () => (
    <div className="space-y-6">
      <SettingSection title={`${mediaServerLabel} Sync`} icon={RefreshCw}>
        <SettingRow label={`Enable ${mediaServerLabel} Sync`} description={`Sync watch history and library from ${mediaServerLabel}`}>
          <Toggle
            checked={settings['plex_sync_enabled'] !== 'false'}
            onChange={(v) => updateSetting('plex_sync_enabled', v)}
          />
        </SettingRow>
        <SettingRow label="Sync Interval" description={`How often to sync with ${mediaServerLabel}`}>
          <NumberInput
            value={getInt('plex_sync_interval', 60)}
            onChange={(v) => updateSetting('plex_sync_interval', v)}
            min={30}
            max={600}
            unit="seconds"
          />
        </SettingRow>
        <SettingRow label={`Auto Import ${mediaServerLabel} Users`} description={`Automatically add ${mediaServerLabel} users to Flexerr`}>
          <Toggle
            checked={getBool('auto_import_plex_users')}
            onChange={(v) => updateSetting('auto_import_plex_users', v)}
          />
        </SettingRow>
        <SettingRow label="Server Owner is Admin" description={`Automatically make ${mediaServerLabel} server owner an admin`}>
          <Toggle
            checked={getBool('server_owner_is_admin')}
            onChange={(v) => updateSetting('server_owner_is_admin', v)}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Watchlist Restoration" icon={Film}>
        <SettingRow label="Enable Restoration" description="Auto-restore deleted media when re-added to watchlist">
          <Toggle
            checked={getBool('watchlist_restoration_enabled')}
            onChange={(v) => updateSetting('watchlist_restoration_enabled', v)}
          />
        </SettingRow>
        <SettingRow label="Check Interval" description="How often to check for watchlist changes">
          <NumberInput
            value={getInt('watchlist_check_interval', 1)}
            onChange={(v) => updateSetting('watchlist_check_interval', v)}
            min={1}
            max={60}
            unit="minutes"
          />
        </SettingRow>
      </SettingSection>

      {/* Auto-Invite Settings - Only show for Plex */}
      {mediaServerLabel === 'Plex' && (
        <SettingSection title="Auto-Invite New Users" icon={Plus}>
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
            <p className="text-blue-300 text-sm">
              When enabled, new users who log in via Plex OAuth will automatically receive an invitation
              to your Plex server with access to the selected libraries. They'll receive an email from Plex to accept the invite.
            </p>
          </div>

          <SettingRow label="Enable Auto-Invite" description="Automatically invite new users to your Plex server">
            <Toggle
              checked={getBool('auto_invite_enabled')}
              onChange={(v) => updateSetting('auto_invite_enabled', v)}
            />
          </SettingRow>

          {getBool('auto_invite_enabled') && (
            <div className="pt-4 border-t border-slate-700">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-white">Libraries to Share</label>
                {plexLibraries.length > 0 && (
                  <button
                    onClick={selectAllLibraries}
                    className="text-xs text-primary-400 hover:text-primary-300"
                  >
                    Select All
                  </button>
                )}
              </div>

              {loadingLibraries ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading libraries...
                </div>
              ) : plexLibraries.length === 0 ? (
                <p className="text-sm text-slate-400">
                  No libraries found. Make sure Plex is configured in the Services tab.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {plexLibraries.map(lib => (
                    <label
                      key={lib.id}
                      className="flex items-center gap-2 p-2 bg-slate-700/50 rounded-lg cursor-pointer hover:bg-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={selectedLibraries.includes(lib.id)}
                        onChange={() => toggleLibrary(lib.id)}
                        className="rounded border-slate-600 bg-slate-700 text-primary-500 focus:ring-primary-500"
                      />
                      <span className="text-sm text-white">{lib.title}</span>
                      <span className="text-xs text-slate-400">({lib.type})</span>
                    </label>
                  ))}
                </div>
              )}

              {selectedLibraries.length === 0 && getBool('auto_invite_enabled') && plexLibraries.length > 0 && (
                <p className="text-xs text-yellow-400 mt-2">
                  No libraries selected. New users won't have access to any content.
                </p>
              )}
            </div>
          )}

          {/* Invited Users List */}
          {invitations.length > 0 && (
            <div className="pt-4 border-t border-slate-700 mt-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-white">Invited Users</label>
                <button
                  onClick={fetchInvitations}
                  disabled={loadingInvitations}
                  className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"
                >
                  {loadingInvitations ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Refresh
                </button>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {invitations.map(inv => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-2 bg-slate-700/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {inv.accepted_thumb ? (
                        <img src={inv.accepted_thumb} alt="" className="w-8 h-8 rounded-full" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center">
                          <span className="text-xs text-slate-400">{(inv.email || '?')[0].toUpperCase()}</span>
                        </div>
                      )}
                      <div>
                        <p className="text-sm text-white">
                          {inv.accepted_username || inv.username || inv.email}
                        </p>
                        {inv.accepted_username && inv.email && (
                          <p className="text-xs text-slate-400">{inv.email}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        inv.status === 'accepted' ? 'bg-green-500/20 text-green-400' :
                        inv.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {inv.status === 'accepted' ? 'Accepted' :
                         inv.status === 'pending' ? 'Pending' : 'Failed'}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(inv.invited_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SettingSection>
      )}

      {/* Jellyfin Settings */}
      <SettingSection title="Jellyfin Configuration" icon={Video} collapsible defaultOpen={false}>
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mb-4">
          <p className="text-purple-300 text-sm">
            Configure how Flexerr tracks watch progress for Jellyfin.
          </p>
        </div>

        <SettingRow label="Completion Percentage" description="Percentage watched before an episode is considered complete">
          <NumberInput
            value={getInt('jellyfin_completion_percentage', 90)}
            onChange={(v) => updateSetting('jellyfin_completion_percentage', v)}
            min={50}
            max={100}
            unit="%"
          />
        </SettingRow>

        <SettingRow label="Velocity Window" description="Days to look back when calculating watch velocity">
          <NumberInput
            value={getInt('jellyfin_velocity_window_days', 30)}
            onChange={(v) => updateSetting('jellyfin_velocity_window_days', v)}
            min={7}
            max={90}
            unit="days"
          />
        </SettingRow>
      </SettingSection>
    </div>
  );

  const renderCleanupTab = () => (
    <div className="space-y-6">
      <SettingSection title="Rules Scheduler" icon={Calendar}>
        <SettingRow label="Rules Schedule" description="When to run automatic cleanup rules">
          <ScheduleInput
            value={getStr('schedule', '0 2 * * *')}
            onChange={(v) => updateSetting('schedule', v)}
          />
        </SettingRow>
        <SettingRow label="Max Deletions Per Run" description="Maximum items to delete in a single cleanup run">
          <NumberInput
            value={getInt('max_deletions_per_run', 50)}
            onChange={(v) => updateSetting('max_deletions_per_run', v)}
            min={1}
            max={500}
            unit="items"
          />
        </SettingRow>
        <SettingRow label="Log Retention" description="How long to keep activity logs">
          <NumberInput
            value={getInt('log_retention_days', 30)}
            onChange={(v) => updateSetting('log_retention_days', v)}
            min={1}
            max={365}
            unit="days"
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Leaving Soon Collection" icon={Clock}>
        <SettingRow label="Default Buffer Days" description="Grace period before items are deleted">
          <NumberInput
            value={getInt('buffer_days', 15)}
            onChange={(v) => updateSetting('buffer_days', v)}
            min={1}
            max={90}
            unit="days"
          />
        </SettingRow>
        <SettingRow label="Collection Name" description={`Name of the ${mediaServerLabel} collection`}>
          <div className="w-48">
            <TextInput
              value={getStr('collection_name', 'Leaving Soon')}
              onChange={(v) => updateSetting('collection_name', v)}
            />
          </div>
        </SettingRow>
        <SettingRow label="Collection Description" description={`Description shown in ${mediaServerLabel}`}>
          <div className="w-64">
            <TextInput
              value={getStr('collection_description')}
              onChange={(v) => updateSetting('collection_description', v)}
              placeholder="Content scheduled for removal..."
            />
          </div>
        </SettingRow>
      </SettingSection>
    </div>
  );

  const renderConvertTab = () => (
    <div className="space-y-6">
      <SettingSection title="Auto Convert" icon={Video}>
        {/* Hardware Detection */}
        <SettingRow label="Detect Hardware" description="Scan for available GPU hardware">
          <div className="flex items-center gap-2">
            <button
              onClick={detectHardware}
              disabled={detectingHardware}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              {detectingHardware ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {detectingHardware ? 'Detecting...' : 'Detect'}
            </button>
            {detectedHardware && (
              <button
                onClick={applyRecommendedHardware}
                className="btn btn-primary flex items-center gap-2 text-sm"
              >
                <Zap className="h-4 w-4" />
                Apply Recommended
              </button>
            )}
          </div>
        </SettingRow>

        {detectedHardware && (
          <div className="bg-slate-700/50 rounded-lg p-3 text-sm mb-2">
            <div className="font-medium text-white mb-2">Detected Hardware:</div>
            <div className="space-y-1 text-slate-300">
              {detectedHardware.nvidia?.available && (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  <span>NVIDIA: {detectedHardware.nvidia.gpus.map(g => g.name).join(', ')}</span>
                </div>
              )}
              {detectedHardware.vaapi?.available && (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  <span>VAAPI: {detectedHardware.vaapi.devices.map(d => d.name).join(', ')}</span>
                </div>
              )}
              {!detectedHardware.nvidia?.available && !detectedHardware.vaapi?.available && (
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-yellow-400" />
                  <span>No GPU detected - CPU encoding only</span>
                </div>
              )}
            </div>
          </div>
        )}

        <SettingRow label="Enable Auto Convert" description="Automatically convert incompatible video formats">
          <Toggle
            checked={getBool('auto_convert_enabled')}
            onChange={(v) => updateSetting('auto_convert_enabled', v)}
          />
        </SettingRow>
        <SettingRow label="Convert DV Profile 5" description="Convert Dolby Vision Profile 5 to HDR10 (incompatible with most players)">
          <Toggle
            checked={getBool('auto_convert_dv5')}
            onChange={(v) => updateSetting('auto_convert_dv5', v)}
          />
        </SettingRow>
        <SettingRow label="Convert DV Profile 7" description="Convert Dolby Vision Profile 7 to HDR10 (limited device support)">
          <Toggle
            checked={getBool('auto_convert_dv7')}
            onChange={(v) => updateSetting('auto_convert_dv7', v)}
          />
        </SettingRow>
        <SettingRow label="Convert DV Profile 8" description="Convert Dolby Vision Profile 8 to HDR10 (for broader compatibility)">
          <Toggle
            checked={getBool('auto_convert_dv8')}
            onChange={(v) => updateSetting('auto_convert_dv8', v)}
          />
        </SettingRow>
        <SettingRow label="Convert AV1 to HEVC" description="Convert AV1 codec to HEVC (many devices lack AV1 support)">
          <Toggle
            checked={getBool('auto_convert_av1')}
            onChange={(v) => updateSetting('auto_convert_av1', v)}
          />
        </SettingRow>
        <SettingRow label="Remux MKV to MP4" description="Repackage MKV files to MP4 for better compatibility (fast, no re-encoding)">
          <Toggle
            checked={getBool('auto_convert_mkv_remux')}
            onChange={(v) => updateSetting('auto_convert_mkv_remux', v)}
          />
        </SettingRow>
        <SettingRow label="Convert Incompatible Audio" description="Convert TrueHD/DTS-HD to EAC3 (many streaming devices can't decode these)">
          <Toggle
            checked={getBool('auto_convert_audio')}
            onChange={(v) => updateSetting('auto_convert_audio', v)}
          />
        </SettingRow>
        <SettingRow label="Hardware Acceleration" description="Use GPU for faster encoding">
          <SelectInput
            value={getStr('auto_convert_hwaccel', 'none')}
            onChange={(v) => updateSetting('auto_convert_hwaccel', v)}
            options={[
              { value: 'none', label: 'CPU Only (Software)' },
              ...(detectedHardware?.nvidia?.available ? [{ value: 'nvenc', label: 'NVENC (NVIDIA)' }] : []),
              ...(detectedHardware?.vaapi?.available ? [{ value: 'vaapi', label: 'VAAPI (AMD/Intel)' }] : []),
              ...(!detectedHardware ? [
                { value: 'nvenc', label: 'NVENC (NVIDIA)' },
                { value: 'vaapi', label: 'VAAPI (AMD/Intel)' }
              ] : [])
            ]}
          />
        </SettingRow>
        <SettingRow label="GPU Device" description="GPU device for hardware acceleration">
          {getStr('auto_convert_hwaccel', 'none') === 'nvenc' ? (
            <SelectInput
              value={getStr('auto_convert_gpu_device', '0')}
              onChange={(v) => updateSetting('auto_convert_gpu_device', v)}
              options={
                detectedHardware?.nvidia?.available
                  ? detectedHardware.nvidia.gpus.map(gpu => ({
                      value: gpu.device,
                      label: `${gpu.name} (${gpu.memory})`
                    }))
                  : [
                      { value: '0', label: 'GPU 0 (Default)' },
                      { value: '1', label: 'GPU 1' },
                      { value: '2', label: 'GPU 2' }
                    ]
              }
            />
          ) : getStr('auto_convert_hwaccel', 'none') === 'vaapi' ? (
            <SelectInput
              value={getStr('auto_convert_gpu_device', '/dev/dri/renderD128')}
              onChange={(v) => updateSetting('auto_convert_gpu_device', v)}
              options={
                detectedHardware?.vaapi?.available
                  ? detectedHardware.vaapi.devices.map(dev => ({
                      value: dev.path,
                      label: dev.name
                    }))
                  : [
                      { value: '/dev/dri/renderD128', label: 'renderD128 (Default)' },
                      { value: '/dev/dri/renderD129', label: 'renderD129' },
                      { value: '/dev/dri/card0', label: 'card0' },
                      { value: '/dev/dri/card1', label: 'card1' }
                    ]
              }
            />
          ) : (
            <div className="w-48 text-sm text-slate-400">N/A (CPU encoding)</div>
          )}
        </SettingRow>
        <SettingRow label="Output Codec" description="Video codec for converted files">
          <SelectInput
            value={getStr('auto_convert_codec', 'hevc')}
            onChange={(v) => updateSetting('auto_convert_codec', v)}
            options={[
              { value: 'hevc', label: 'HEVC (H.265)' },
              { value: 'h264', label: 'H.264' },
              ...(getStr('auto_convert_hwaccel', 'none') === 'none' ? [{ value: 'av1', label: 'AV1 (slow)' }] : [])
            ]}
          />
        </SettingRow>
        <SettingRow label="Output Quality" description="Higher quality = larger file size">
          <SelectInput
            value={getStr('auto_convert_crf', '18')}
            onChange={(v) => updateSetting('auto_convert_crf', v)}
            options={[
              { value: '0', label: 'Lossless (Huge files)' },
              { value: '14', label: 'Near Lossless (Very large)' },
              { value: '18', label: 'High Quality (Recommended)' },
              { value: '22', label: 'Balanced (Good quality, smaller)' },
              { value: '26', label: 'Medium (Decent quality, compact)' },
              { value: '30', label: 'Low (Smaller files, visible loss)' }
            ]}
          />
        </SettingRow>
        <SettingRow label="Keep Original" description="Keep original file after conversion">
          <Toggle
            checked={getBool('auto_convert_keep_original')}
            onChange={(v) => updateSetting('auto_convert_keep_original', v)}
          />
        </SettingRow>
        <SettingRow label="Original Suffix" description="Suffix for original file if kept">
          <div className="w-32">
            <TextInput
              value={getStr('auto_convert_original_suffix', '.original')}
              onChange={(v) => updateSetting('auto_convert_original_suffix', v)}
            />
          </div>
        </SettingRow>
        <SettingRow label="Temp Directory" description="Temporary directory for conversion">
          <div className="w-64">
            <TextInput
              value={getStr('auto_convert_temp_path', '/tmp/flexerr-convert')}
              onChange={(v) => updateSetting('auto_convert_temp_path', v)}
            />
          </div>
        </SettingRow>
        <SettingRow label="Max Concurrent Jobs" description="Maximum simultaneous conversions">
          <NumberInput
            value={getInt('auto_convert_max_jobs', 1)}
            onChange={(v) => updateSetting('auto_convert_max_jobs', v)}
            min={1}
            max={4}
            unit="jobs"
          />
        </SettingRow>
      </SettingSection>

      {/* Conversion Jobs */}
      <SettingSection title="Conversion Jobs" icon={HardDrive}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <SelectInput
              value={jobsFilter}
              onChange={setJobsFilter}
              options={[
                { value: 'all', label: 'All Jobs' },
                { value: 'failed', label: 'Failed' },
                { value: 'pending', label: 'Pending' },
                { value: 'processing', label: 'Processing' },
                { value: 'completed', label: 'Completed' }
              ]}
            />
            <button
              onClick={fetchConversionJobs}
              disabled={loadingJobs}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              {loadingJobs ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
            {conversionJobs.filter(j => j.status === 'failed').length > 0 && (
              <button
                onClick={deleteAllFailedJobs}
                className="btn btn-secondary text-red-400 flex items-center gap-2 text-sm"
              >
                <Trash2 className="h-4 w-4" />
                Delete Failed
              </button>
            )}
          </div>
        </div>

        {conversionJobs.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-4">
            {loadingJobs ? 'Loading...' : 'No conversion jobs found. Click Refresh to load.'}
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {conversionJobs
              .filter(j => jobsFilter === 'all' || j.status === jobsFilter)
              .map(job => (
                <div key={job.id} className="flex items-center justify-between bg-slate-700/50 rounded p-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white truncate">{job.title}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        job.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        job.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                        job.status === 'processing' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {job.status}
                      </span>
                      <span>{job.conversion_type}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    {job.status === 'failed' && (
                      <button onClick={() => retryConversionJob(job.id)} className="p-1 text-slate-400 hover:text-white" title="Retry">
                        <RefreshCw className="h-4 w-4" />
                      </button>
                    )}
                    {job.status !== 'processing' && (
                      <button onClick={() => deleteConversionJob(job.id)} className="p-1 text-slate-400 hover:text-red-400" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}
      </SettingSection>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return renderGeneralTab();
      case 'services':
        return renderServicesTab();
      case 'viper':
        return renderViperTab();
      case 'media':
        return renderMediaTab();
      case 'cleanup':
        return renderCleanupTab();
      case 'convert':
        return renderConvertTab();
      default:
        return renderGeneralTab();
    }
  };

  // ============================================
  // Main Render
  // ============================================

  return (
    <div className="max-w-5xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-primary-400" />
          <h1 className="text-2xl font-bold text-white">Settings</h1>
        </div>
        {hasChanges && (
          <div className="flex items-center gap-2">
            <button onClick={resetSettings} className="btn btn-secondary flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
            <button onClick={saveSettings} disabled={saving} className="btn btn-primary flex items-center gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 mb-6 bg-slate-800/50 rounded-lg p-2">
        {SETTINGS_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-primary-500 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content - key forces re-render when settings load */}
      <div key={Object.keys(settings).length > 0 ? 'loaded' : 'loading'}>
        {renderTabContent()}
      </div>

      {/* Floating Save Bar */}
      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-700 p-4 z-50">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <p className="text-sm text-slate-400">You have unsaved changes</p>
            <div className="flex items-center gap-2">
              <button onClick={resetSettings} className="btn btn-secondary flex items-center gap-2">
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
              <button onClick={saveSettings} disabled={saving} className="btn btn-primary flex items-center gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Service Edit Modal */}
      {(editingService || addingService) && (
        <ServiceModal
          service={editingService}
          isNew={addingService}
          onSave={handleSaveService}
          onClose={() => {
            setEditingService(null);
            setAddingService(false);
          }}
        />
      )}
    </div>
  );
}
