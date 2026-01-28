import React, { useState, useEffect } from 'react';
import { api, useAuth } from '../App';
import {
  Settings, Clock, Film, RefreshCw, Calendar,
  Server, Save, Loader2, RotateCcw, Eye, EyeOff,
  ChevronDown, ChevronUp, HardDrive, Zap, Video, Play
} from 'lucide-react';
import toast from 'react-hot-toast';

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

// Simple schedule picker - converts to/from cron expressions
function ScheduleInput({ value, onChange }) {
  // Parse cron to simple format
  const parseCron = (cron) => {
    if (!cron) return { type: 'daily', hour: 2 };

    const parts = cron.split(' ');
    if (parts.length !== 5) return { type: 'daily', hour: 2 };

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Check for "every X hours" pattern: "0 */X * * *"
    if (hour.startsWith('*/')) {
      const hours = parseInt(hour.slice(2));
      return { type: 'hours', interval: hours };
    }

    // Daily at specific hour: "0 X * * *"
    if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && !hour.includes('/') && !hour.includes(',')) {
      return { type: 'daily', hour: parseInt(hour) || 0 };
    }

    // Default
    return { type: 'daily', hour: 2 };
  };

  // Convert simple format to cron
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

export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalSettings, setOriginalSettings] = useState({});
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await api.get('/settings');
      setSettings(res.data);
      setOriginalSettings(res.data);
    } catch (err) {
      console.error('Failed to load settings:', err);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
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

  const runSmartCleanup = async (dryRun = true) => {
    setRunningCleanup(true);
    setCleanupResult(null);
    try {
      const res = await api.post('/cleanup/run', { dryRun });
      setCleanupResult(res.data);

      const epCandidates = res.data.episodes?.deletionCandidates?.length || 0;
      const movieCandidates = res.data.movies?.deletionCandidates?.length || 0;
      const epDeleted = res.data.episodes?.deleted?.length || 0;
      const movieDeleted = res.data.movies?.deleted?.length || 0;

      if (dryRun) {
        toast.success(`Preview: ${epCandidates} episodes, ${movieCandidates} movies would be cleaned up`);
      } else {
        toast.success(`Cleanup complete: ${epDeleted} episodes, ${movieDeleted} movies deleted`);
      }
    } catch (err) {
      console.error('Cleanup failed:', err);
      toast.error(err.response?.data?.error || 'Cleanup failed');
    } finally {
      setRunningCleanup(false);
    }
  };

  const getBool = (key) => settings[key] === 'true';
  const getInt = (key, defaultVal = 0) => parseInt(settings[key]) || defaultVal;
  const getFloat = (key, defaultVal = 0) => parseFloat(settings[key]) || defaultVal;
  const getStr = (key, defaultVal = '') => settings[key] || defaultVal;

  if (loading) {
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

        <SettingSection title="Your Plex Account" icon={Server}>
          <div className="flex items-center gap-4 py-4">
            {user?.thumb && (
              <img src={user.thumb} alt={user.username} className="w-16 h-16 rounded-full" />
            )}
            <div>
              <p className="text-lg font-medium text-white">{user?.username}</p>
              <p className="text-sm text-slate-400">{user?.email}</p>
              <p className="text-xs text-slate-500 mt-1">
                Connected via Plex OAuth
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

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-primary-400" />
          <h1 className="text-2xl font-bold text-white">Settings</h1>
        </div>
        {hasChanges && (
          <div className="flex items-center gap-2">
            <button
              onClick={resetSettings}
              className="btn btn-secondary flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
            <button
              onClick={saveSettings}
              disabled={saving}
              className="btn btn-primary flex items-center gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </button>
          </div>
        )}
      </div>

      {/* General Settings */}
      <SettingSection title="General" icon={Settings}>
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

      {/* Smart Episode Manager - Consolidated Section */}
      <SettingSection title="Smart Episode Manager" icon={Zap}>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
          <p className="text-blue-300 text-sm">
            <strong>Smart Episode Manager</strong> intelligently manages TV show episodes based on each user's
            watch progress and velocity. Episodes are deleted only after all active users have watched them,
            and can be automatically re-downloaded when users approach them.
          </p>
        </div>

        <SettingRow label="Enable Smart Episode Manager" description="Automatically manage episodes based on watch progress">
          <Toggle
            checked={getBool('smart_cleanup_enabled')}
            onChange={(v) => updateSetting('smart_cleanup_enabled', v)}
          />
        </SettingRow>

        <SettingRow label="Run Now" description="Manually trigger smart cleanup">
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
              title={getBool('dry_run') ? 'Disable Dry Run mode in General settings to run live cleanup' : 'Run cleanup now'}
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
              {!getBool('dry_run') && (
                <>
                  <div>Episodes deleted: {cleanupResult.episodes?.deleted?.length || 0}</div>
                  <div>Movies deleted: {cleanupResult.movies?.deleted?.length || 0}</div>
                </>
              )}
            </div>
          </div>
        )}

        <SettingRow label="Cleanup Schedule" description="When to run smart episode cleanup">
          <ScheduleInput
            value={getStr('velocity_cleanup_schedule', '0 3 * * *')}
            onChange={(v) => updateSetting('velocity_cleanup_schedule', v)}
          />
        </SettingRow>

        <div className="pt-4 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Deletion Timing</div>

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

        <div className="pt-4 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Watchlist Protection</div>

        <SettingRow label="Watchlist Grace Period" description="Days to protect shows added to watchlist">
          <NumberInput
            value={getInt('smart_watchlist_grace_days', 14)}
            onChange={(v) => updateSetting('smart_watchlist_grace_days', v)}
            min={1}
            max={60}
            unit="days"
          />
        </SettingRow>

        <div className="pt-4 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Velocity-Based Trimming</div>
        <p className="text-xs text-slate-400 pb-2">Delete episodes too far ahead of users based on their watch velocity.</p>

        <SettingRow label="Enable Velocity-Based Trimming" description="Delete unwatched episodes too far ahead based on watch velocity">
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
        <SettingRow label="Max Episodes Ahead (Hard Cap)" description="Absolute maximum episodes to keep regardless of velocity">
          <NumberInput
            value={getInt('smart_max_episodes_ahead', 20)}
            onChange={(v) => updateSetting('smart_max_episodes_ahead', v)}
            min={5}
            max={50}
            unit="episodes"
          />
        </SettingRow>

        <div className="pt-4 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Unknown Velocity Handling</div>
        <p className="text-xs text-slate-400 pb-2">When velocity data is insufficient, these fallbacks apply.</p>

        <SettingRow label="Min Velocity Samples" description="Episodes watched before trusting velocity calculation">
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

        <div className="pt-4 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Proactive Redownload</div>
        <p className="text-xs text-slate-400 pb-2">Automatically re-download deleted episodes before users need them.</p>

        <SettingRow label="Enable Proactive Redownload" description="Re-download episodes before users catch up to them">
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

        <div className="pt-4 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Velocity Monitoring</div>
        <p className="text-xs text-slate-400 pb-2">Monitor users' watch speed changes and react proactively.</p>

        <SettingRow label="Enable Velocity Monitoring" description="Detect when users speed up or slow down watching">
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

      {/* Scheduler Settings */}
      <SettingSection title="Rules Scheduler" icon={Calendar} collapsible>
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

      {/* Cleanup Settings */}
      <SettingSection title="Leaving Soon Collection" icon={Clock} collapsible>
        <SettingRow label="Default Buffer Days" description="Grace period before items are deleted">
          <NumberInput
            value={getInt('buffer_days', 15)}
            onChange={(v) => updateSetting('buffer_days', v)}
            min={1}
            max={90}
            unit="days"
          />
        </SettingRow>
        <SettingRow label="Collection Name" description="Name of the Plex collection for leaving soon items">
          <div className="w-48">
            <TextInput
              value={getStr('collection_name', 'Leaving Soon')}
              onChange={(v) => updateSetting('collection_name', v)}
            />
          </div>
        </SettingRow>
        <SettingRow label="Collection Description" description="Description shown in Plex for the collection">
          <div className="w-64">
            <TextInput
              value={getStr('collection_description')}
              onChange={(v) => updateSetting('collection_description', v)}
              placeholder="Content scheduled for removal..."
            />
          </div>
        </SettingRow>
      </SettingSection>

      {/* Plex Sync Settings */}
      <SettingSection title="Plex Sync" icon={RefreshCw} collapsible>
        <SettingRow label="Enable Plex Sync" description="Sync watch history and library from Plex">
          <Toggle
            checked={settings['plex_sync_enabled'] !== 'false'}
            onChange={(v) => updateSetting('plex_sync_enabled', v)}
          />
        </SettingRow>
        <SettingRow label="Sync Interval" description="How often to sync with Plex">
          <NumberInput
            value={getInt('plex_sync_interval', 60)}
            onChange={(v) => updateSetting('plex_sync_interval', v)}
            min={30}
            max={600}
            unit="seconds"
          />
        </SettingRow>
        <SettingRow label="Auto Import Plex Users" description="Automatically add Plex users to Flexerr">
          <Toggle
            checked={getBool('auto_import_plex_users')}
            onChange={(v) => updateSetting('auto_import_plex_users', v)}
          />
        </SettingRow>
        <SettingRow label="Server Owner is Admin" description="Automatically make Plex server owner an admin">
          <Toggle
            checked={getBool('server_owner_is_admin')}
            onChange={(v) => updateSetting('server_owner_is_admin', v)}
          />
        </SettingRow>
      </SettingSection>

      {/* Watchlist Settings */}
      <SettingSection title="Watchlist Restoration" icon={Film} collapsible>
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

      {/* Auto Convert Settings */}
      <SettingSection title="Auto Convert" icon={Video} collapsible defaultOpen={false}>
        <SettingRow label="Enable Auto Convert" description="Automatically convert incompatible video formats on import">
          <Toggle
            checked={getBool('auto_convert_enabled')}
            onChange={(v) => updateSetting('auto_convert_enabled', v)}
          />
        </SettingRow>
        <SettingRow label="Convert DV Profile 5" description="Convert Dolby Vision Profile 5 (incompatible) to HDR10">
          <Toggle
            checked={getBool('auto_convert_dv5')}
            onChange={(v) => updateSetting('auto_convert_dv5', v)}
          />
        </SettingRow>
        <SettingRow label="Hardware Acceleration" description="Use GPU for faster encoding (VAAPI for AMD)">
          <SelectInput
            value={getStr('auto_convert_hwaccel', 'vaapi')}
            onChange={(v) => updateSetting('auto_convert_hwaccel', v)}
            options={[
              { value: 'vaapi', label: 'VAAPI (AMD/Intel)' },
              { value: 'nvenc', label: 'NVENC (NVIDIA)' },
              { value: 'none', label: 'CPU Only' }
            ]}
          />
        </SettingRow>
        <SettingRow label="GPU Device" description="Path to GPU device for hardware acceleration">
          <div className="w-48">
            <TextInput
              value={getStr('auto_convert_gpu_device', '/dev/dri/renderD128')}
              onChange={(v) => updateSetting('auto_convert_gpu_device', v)}
              placeholder="/dev/dri/renderD128"
            />
          </div>
        </SettingRow>
        <SettingRow label="Output Codec" description="Video codec for converted files">
          <SelectInput
            value={getStr('auto_convert_codec', 'hevc')}
            onChange={(v) => updateSetting('auto_convert_codec', v)}
            options={[
              { value: 'hevc', label: 'HEVC (H.265)' },
              { value: 'h264', label: 'H.264' },
              { value: 'av1', label: 'AV1' }
            ]}
          />
        </SettingRow>
        <SettingRow label="Output Quality" description="CRF value (lower = better quality, larger file)">
          <NumberInput
            value={getInt('auto_convert_crf', 18)}
            onChange={(v) => updateSetting('auto_convert_crf', v)}
            min={0}
            max={51}
          />
        </SettingRow>
        <SettingRow label="Keep Original" description="Keep original file after successful conversion">
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
              placeholder=".original"
            />
          </div>
        </SettingRow>
        <SettingRow label="Temp Directory" description="Temporary directory for conversion work">
          <div className="w-64">
            <TextInput
              value={getStr('auto_convert_temp_path', '/tmp/flexerr-convert')}
              onChange={(v) => updateSetting('auto_convert_temp_path', v)}
              placeholder="/tmp/flexerr-convert"
            />
          </div>
        </SettingRow>
        <SettingRow label="Max Concurrent Jobs" description="Maximum simultaneous conversion jobs">
          <NumberInput
            value={getInt('auto_convert_max_jobs', 1)}
            onChange={(v) => updateSetting('auto_convert_max_jobs', v)}
            min={1}
            max={4}
            unit="jobs"
          />
        </SettingRow>
      </SettingSection>

      {/* Floating Save Bar */}
      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-700 p-4 z-50">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <p className="text-sm text-slate-400">You have unsaved changes</p>
            <div className="flex items-center gap-2">
              <button
                onClick={resetSettings}
                className="btn btn-secondary flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
              <button
                onClick={saveSettings}
                disabled={saving}
                className="btn btn-primary flex items-center gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
