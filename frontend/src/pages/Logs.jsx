import React, { useState, useEffect } from 'react';
import { api } from '../App';
import {
  Loader2, RefreshCw, Download, Filter,
  CheckCircle, XCircle, AlertTriangle, Info, X
} from 'lucide-react';

function formatDate(dateString) {
  // SQLite stores CURRENT_TIMESTAMP in UTC, but without timezone suffix
  // Append 'Z' if missing to ensure proper UTC interpretation
  let normalizedDate = dateString;
  if (dateString && !dateString.endsWith('Z') && !dateString.includes('+') && !dateString.includes('-', 10)) {
    normalizedDate = dateString.replace(' ', 'T') + 'Z';
  }
  const date = new Date(normalizedDate);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [filters, setFilters] = useState({
    level: '',
    category: '',
    limit: 50,
    offset: 0
  });

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await api.get('/logs', { params: filters });
      setLogs(res.data.logs);
      setTotal(res.data.total);
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [filters]);

  const exportLogs = () => {
    window.open('/api/logs/export', '_blank');
  };

  const getLevelIcon = (level) => {
    switch (level) {
      case 'error':
        return <XCircle className="h-4 w-4 text-red-400" />;
      case 'warn':
        return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
      case 'info':
        return <Info className="h-4 w-4 text-blue-400" />;
      default:
        return <CheckCircle className="h-4 w-4 text-slate-400" />;
    }
  };

  const getLevelBadge = (level) => {
    const classes = {
      error: 'badge-danger',
      warn: 'badge-warning',
      info: 'badge-info',
      debug: 'bg-slate-600 text-slate-300'
    };
    return `badge ${classes[level] || classes.debug}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Activity Logs</h1>
          <p className="text-slate-400 mt-1">{total} total entries</p>
        </div>
        <div className="flex items-center space-x-3">
          <button onClick={exportLogs} className="btn btn-secondary flex items-center space-x-2">
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </button>
          <button onClick={loadLogs} className="btn btn-ghost p-2">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-400">Filters:</span>
          </div>

          <select
            value={filters.level}
            onChange={(e) => setFilters(prev => ({ ...prev, level: e.target.value, offset: 0 }))}
            className="w-32 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Levels</option>
            <option value="error">Errors</option>
            <option value="warn">Warnings</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>

          <select
            value={filters.category}
            onChange={(e) => setFilters(prev => ({ ...prev, category: e.target.value, offset: 0 }))}
            className="w-40 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Categories</option>
            <option value="rule">Rules</option>
            <option value="deletion">Deletions</option>
            <option value="connection">Connections</option>
            <option value="system">System</option>
          </select>

          <select
            value={filters.limit}
            onChange={(e) => setFilters(prev => ({ ...prev, limit: parseInt(e.target.value), offset: 0 }))}
            className="w-32 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="25">25 per page</option>
            <option value="50">50 per page</option>
            <option value="100">100 per page</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : logs.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-slate-400">No logs found</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-700/50">
                <tr>
                  <th className="text-left p-3 text-sm font-medium text-slate-300">Time</th>
                  <th className="text-left p-3 text-sm font-medium text-slate-300">Level</th>
                  <th className="text-left p-3 text-sm font-medium text-slate-300">Category</th>
                  <th className="text-left p-3 text-sm font-medium text-slate-300">Action</th>
                  <th className="text-left p-3 text-sm font-medium text-slate-300">Media</th>
                  <th className="text-left p-3 text-sm font-medium text-slate-300">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {logs.map(log => (
                  <tr
                    key={log.id}
                    className="hover:bg-slate-700/30 cursor-pointer"
                    onClick={() => setSelectedLog(log)}
                  >
                    <td className="p-3 text-sm whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="p-3">
                      <span className={getLevelBadge(log.level)}>
                        {log.level}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-slate-400 capitalize">
                      {log.category}
                    </td>
                    <td className="p-3 text-sm">
                      {log.action}
                    </td>
                    <td className="p-3 text-sm text-slate-400">
                      {log.media_title || '-'}
                    </td>
                    <td className="p-3 text-sm text-slate-500 max-w-xs truncate">
                      {log.details && Object.keys(log.details).length > 0 ? (
                        <span>
                          {JSON.stringify(log.details).slice(0, 50)}...
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between p-4 border-t border-slate-700">
            <p className="text-sm text-slate-400">
              Showing {filters.offset + 1} - {Math.min(filters.offset + filters.limit, total)} of {total}
            </p>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setFilters(prev => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
                disabled={filters.offset === 0}
                className="btn btn-secondary text-sm"
              >
                Previous
              </button>
              <button
                onClick={() => setFilters(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
                disabled={filters.offset + filters.limit >= total}
                className="btn btn-secondary text-sm"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setSelectedLog(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h3 className="text-lg font-semibold text-white">Log Details</h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[calc(80vh-120px)] space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 uppercase">Time</label>
                  <p className="text-white">{formatDate(selectedLog.created_at)}</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase">Level</label>
                  <p><span className={getLevelBadge(selectedLog.level)}>{selectedLog.level}</span></p>
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase">Category</label>
                  <p className="text-white capitalize">{selectedLog.category}</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase">Action</label>
                  <p className="text-white">{selectedLog.action}</p>
                </div>
              </div>

              {selectedLog.media_title && (
                <div>
                  <label className="text-xs text-slate-400 uppercase">Media</label>
                  <p className="text-white">{selectedLog.media_title}</p>
                </div>
              )}

              {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
                <div>
                  <label className="text-xs text-slate-400 uppercase">Details</label>
                  <pre className="mt-2 p-3 bg-slate-900 rounded-lg text-sm text-slate-300 overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(selectedLog.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
