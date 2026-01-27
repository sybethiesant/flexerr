import React, { useState, useEffect } from 'react';
import { api } from '../App';
import {
  Users,
  Film,
  Tv,
  HardDrive,
  Trash2,
  Clock,
  CheckCircle,
  AlertTriangle,
  Server,
  Activity,
  TrendingUp,
  ListChecks,
  Heart,
  Loader2,
  RefreshCw,
  Download,
  Clapperboard,
  RotateCcw,
  XCircle,
  Play,
  Pause
} from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function StatCard({ icon: Icon, label, value, subValue, color = 'primary' }) {
  const colors = {
    primary: 'bg-primary-500/20 text-primary-400',
    green: 'bg-green-500/20 text-green-400',
    yellow: 'bg-yellow-500/20 text-yellow-400',
    red: 'bg-red-500/20 text-red-400',
    blue: 'bg-blue-500/20 text-blue-400',
    purple: 'bg-purple-500/20 text-purple-400',
    slate: 'bg-slate-500/20 text-slate-400'
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-sm text-slate-400">{label}</p>
        {subValue && <p className="text-xs text-slate-500 mt-1">{subValue}</p>}
      </div>
    </div>
  );
}

function ServiceStatus({ services }) {
  const getStatusColor = (service) => {
    if (!service.is_active) return 'bg-slate-500';
    if (service.last_connected) {
      const lastConn = new Date(service.last_connected);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return lastConn > hourAgo ? 'bg-green-500' : 'bg-yellow-500';
    }
    return 'bg-yellow-500';
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'plex': return Film;
      case 'sonarr': return Tv;
      case 'radarr': return Film;
      default: return Server;
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <Server className="h-4 w-4 text-slate-400" />
        Connected Services
      </h3>
      {services.length === 0 ? (
        <p className="text-slate-500 text-sm">No services configured</p>
      ) : (
        <div className="space-y-2">
          {services.map((service, i) => {
            const Icon = getTypeIcon(service.type);
            return (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-white">{service.name}</span>
                  <span className="text-xs text-slate-500 capitalize">({service.type})</span>
                </div>
                <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(service)}`} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RequestBreakdown({ stats }) {
  const total = stats.totalRequests || 0;
  const statuses = [
    { label: 'Available', value: stats.requestsByStatus?.available || 0, color: 'bg-green-500' },
    { label: 'Partial', value: stats.requestsByStatus?.partial || 0, color: 'bg-amber-500' },
    { label: 'Processing', value: stats.requestsByStatus?.processing || 0, color: 'bg-blue-500' },
    { label: 'Pending', value: stats.requestsByStatus?.pending || 0, color: 'bg-yellow-500' },
    { label: 'Failed', value: stats.requestsByStatus?.failed || 0, color: 'bg-red-500' }
  ];

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-slate-400" />
        Request Status
      </h3>
      <div className="space-y-3">
        {statuses.map((status) => (
          <div key={status.label}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-400">{status.label}</span>
              <span className="text-white">{status.value}</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full ${status.color} transition-all`}
                style={{ width: total > 0 ? `${(status.value / total) * 100}%` : '0%' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopRules({ rules }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-slate-400" />
        Top Rules by Matches
      </h3>
      {rules.length === 0 ? (
        <p className="text-slate-500 text-sm">No rules have run yet</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0">
              <span className="text-sm text-white truncate flex-1 mr-2">{rule.name}</span>
              <span className="text-sm font-medium text-primary-400">{rule.last_run_matches} matches</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TimeRangeStats({ stats }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-slate-400" />
        Activity Over Time
      </h3>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Last 7 Days</p>
          <div className="space-y-1">
            <p className="text-white"><span className="text-green-400">{stats.weekRequests || 0}</span> requests</p>
            <p className="text-white"><span className="text-blue-400">{stats.weekAvailable || 0}</span> available</p>
            <p className="text-white"><span className="text-red-400">{stats.weekDeletions || 0}</span> deleted</p>
            <p className="text-white"><span className="text-purple-400">{formatBytes(stats.weekStorageSaved)}</span> freed</p>
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Last 30 Days</p>
          <div className="space-y-1">
            <p className="text-white"><span className="text-green-400">{stats.monthRequests || 0}</span> requests</p>
            <p className="text-white"><span className="text-blue-400">{stats.monthAvailable || 0}</span> available</p>
            <p className="text-white"><span className="text-red-400">{stats.monthDeletions || 0}</span> deleted</p>
            <p className="text-white"><span className="text-purple-400">{formatBytes(stats.monthStorageSaved)}</span> freed</p>
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">All Time</p>
          <div className="space-y-1">
            <p className="text-white"><span className="text-green-400">{stats.allTimeRequests || 0}</span> requests</p>
            <p className="text-white"><span className="text-blue-400">{stats.allTimeAvailable || 0}</span> available</p>
            <p className="text-white"><span className="text-red-400">{stats.allTimeDeletions || 0}</span> deleted</p>
            <p className="text-white"><span className="text-purple-400">{formatBytes(stats.allTimeStorageSaved)}</span> freed</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversionJobs() {
  const [conversions, setConversions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  const loadConversions = async () => {
    try {
      const res = await api.get('/conversions?limit=10');
      setConversions(res.data);
    } catch (err) {
      console.error('Failed to load conversions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversions();
    // Refresh every 5 seconds to see progress updates
    const interval = setInterval(loadConversions, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRetry = async (jobId) => {
    setActionLoading(jobId);
    try {
      await api.post(`/conversions/${jobId}/retry`);
      loadConversions();
    } catch (err) {
      console.error('Failed to retry conversion:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (jobId) => {
    setActionLoading(jobId);
    try {
      await api.delete(`/conversions/${jobId}`);
      loadConversions();
    } catch (err) {
      console.error('Failed to cancel conversion:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (job) => {
    switch (job.status) {
      case 'completed':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400">Completed</span>;
      case 'processing':
        const percent = job.progress?.percent || 0;
        return (
          <span className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-400 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {percent}%
          </span>
        );
      case 'pending':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400">Pending</span>;
      case 'failed':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">Failed</span>;
      default:
        return <span className="px-2 py-0.5 text-xs rounded-full bg-slate-500/20 text-slate-400">{job.status}</span>;
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
          <Clapperboard className="h-4 w-4 text-slate-400" />
          Media Conversions
        </h3>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  if (!conversions?.isEnabled) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
          <Clapperboard className="h-4 w-4 text-slate-400" />
          Media Conversions
        </h3>
        <p className="text-slate-500 text-sm">Auto-conversion is disabled. Enable it in Settings.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <Clapperboard className="h-4 w-4 text-slate-400" />
        Media Conversions
        <span className="ml-auto text-xs text-slate-500">
          {conversions.settings?.type?.toUpperCase()} • {conversions.settings?.codec?.toUpperCase()}
        </span>
      </h3>

      {/* Stats Row */}
      <div className="flex gap-4 mb-4 text-sm">
        {conversions.stats?.processing > 0 && (
          <span className="flex items-center gap-1 text-blue-400">
            <Play className="h-3 w-3" /> {conversions.stats.processing} running
          </span>
        )}
        {conversions.stats?.pending > 0 && (
          <span className="flex items-center gap-1 text-yellow-400">
            <Pause className="h-3 w-3" /> {conversions.stats.pending} queued
          </span>
        )}
        {conversions.stats?.completed > 0 && (
          <span className="flex items-center gap-1 text-green-400">
            <CheckCircle className="h-3 w-3" /> {conversions.stats.completed} done
          </span>
        )}
        {conversions.stats?.failed > 0 && (
          <span className="flex items-center gap-1 text-red-400">
            <XCircle className="h-3 w-3" /> {conversions.stats.failed} failed
          </span>
        )}
      </div>

      {/* Jobs List */}
      {conversions.jobs?.length === 0 ? (
        <p className="text-slate-500 text-sm">No conversion jobs yet</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {conversions.jobs.map((job) => (
            <div key={job.id} className="py-2 px-2 bg-slate-700/50 rounded">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0 mr-3">
                  <p className="text-sm text-white truncate">{job.title}</p>
                  <p className="text-xs text-slate-500">
                    {job.conversion_type?.toUpperCase()} • {job.media_type}
                    {job.duration && <span> • {formatDuration(job.duration)}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(job)}
                  {job.status === 'failed' && (
                    <button
                      onClick={() => handleRetry(job.id)}
                      disabled={actionLoading === job.id}
                      className="p-1 hover:bg-slate-600 rounded"
                      title="Retry"
                    >
                      {actionLoading === job.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                      ) : (
                        <RotateCcw className="h-4 w-4 text-slate-400" />
                      )}
                    </button>
                  )}
                  {job.status === 'pending' && (
                    <button
                      onClick={() => handleCancel(job.id)}
                      disabled={actionLoading === job.id}
                      className="p-1 hover:bg-slate-600 rounded"
                      title="Cancel"
                    >
                      {actionLoading === job.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                      ) : (
                        <XCircle className="h-4 w-4 text-slate-400" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar for processing jobs */}
              {job.status === 'processing' && job.progress && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>{job.progress.currentTime || '00:00:00'}</span>
                    <span>{job.progress.percent || 0}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-600 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${job.progress.percent || 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Error message */}
              {job.status === 'failed' && job.error_message && (
                <p className="text-xs text-red-400 mt-1 truncate" title={job.error_message}>
                  {job.error_message.slice(0, 80)}...
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await api.get('/stats');
      setStats(res.data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadStats();
    // Refresh stats every 30 seconds
    const interval = setInterval(() => loadStats(), 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-slate-400 mt-1">System overview and statistics</p>
        </div>
        <button
          onClick={() => loadStats(true)}
          disabled={refreshing}
          className="btn btn-secondary flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Health Alerts */}
      {(stats?.recentErrors > 0 || stats?.recentWarnings > 0) && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <div>
              <p className="text-red-400 font-medium">System Alerts (Last 24 Hours)</p>
              <p className="text-slate-400 text-sm">
                {stats.recentErrors > 0 && <span className="text-red-400">{stats.recentErrors} errors</span>}
                {stats.recentErrors > 0 && stats.recentWarnings > 0 && ', '}
                {stats.recentWarnings > 0 && <span className="text-yellow-400">{stats.recentWarnings} warnings</span>}
                {' - '}Check the Logs page for details.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <StatCard
          icon={Users}
          label="Total Users"
          value={stats?.totalUsers || 0}
          subValue={`${stats?.adminUsers || 0} admins`}
          color="blue"
        />
        <StatCard
          icon={Download}
          label="Total Requests"
          value={stats?.totalRequests || 0}
          subValue={`${stats?.movieRequests || 0} movies, ${stats?.tvRequests || 0} TV`}
          color="green"
        />
        <StatCard
          icon={Heart}
          label="Watchlist Items"
          value={stats?.totalWatchlistItems || 0}
          subValue={`${stats?.watchlistMovies || 0} movies, ${stats?.watchlistTV || 0} TV`}
          color="purple"
        />
        <StatCard
          icon={ListChecks}
          label="Active Rules"
          value={stats?.activeRules || 0}
          subValue={`${stats?.totalRules || 0} total`}
          color="primary"
        />
        <StatCard
          icon={Clock}
          label="Queue Pending"
          value={stats?.queuePending || 0}
          subValue={`${stats?.queueCompleted || 0} completed`}
          color="yellow"
        />
        <StatCard
          icon={Server}
          label="Services"
          value={stats?.connectedServices || 0}
          subValue={`${stats?.services?.length || 0} configured`}
          color="slate"
        />
      </div>

      {/* Storage Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-500/30 rounded-lg p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-500/20 rounded-lg">
              <HardDrive className="h-6 w-6 text-green-400" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white">{formatBytes(stats?.allTimeStorageSaved)}</p>
              <p className="text-green-400">Total Storage Freed</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-500/30 rounded-lg p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-red-500/20 rounded-lg">
              <Trash2 className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white">{stats?.allTimeDeletions || 0}</p>
              <p className="text-red-400">Total Items Deleted</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-500/30 rounded-lg p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <CheckCircle className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white">{stats?.allTimeAvailable || 0}</p>
              <p className="text-blue-400">Total Made Available</p>
            </div>
          </div>
        </div>
      </div>

      {/* Media Conversions */}
      <ConversionJobs />

      {/* Time Range Stats */}
      <TimeRangeStats stats={stats || {}} />

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ServiceStatus services={stats?.services || []} />
        <RequestBreakdown stats={stats || {}} />
        <TopRules rules={stats?.topRules || []} />
      </div>

      {/* Scheduler Status */}
      {stats?.scheduler && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            Scheduler Status
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-slate-500">Status</p>
              <p className={`font-medium ${stats.scheduler.running ? 'text-green-400' : 'text-yellow-400'}`}>
                {stats.scheduler.running ? 'Running' : 'Stopped'}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Schedule</p>
              <p className="text-white">{stats.scheduler.schedule || 'Not set'}</p>
            </div>
            <div>
              <p className="text-slate-500">Next Run</p>
              <p className="text-white">
                {stats.scheduler.nextRun ? new Date(stats.scheduler.nextRun).toLocaleString() : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Last Run</p>
              <p className="text-white">
                {stats.scheduler.lastRun ? new Date(stats.scheduler.lastRun).toLocaleString() : 'Never'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
