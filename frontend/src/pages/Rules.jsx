import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../App';
import {
  Plus, Play, Pause, Trash2, Edit, Copy, Eye,
  Loader2, CheckCircle, AlertCircle, Clock, X, PlayCircle
} from 'lucide-react';

export default function Rules() {
  const [rules, setRules] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runningRules, setRunningRules] = useState({}); // { ruleId: { status, startedAt, ... } }
  const [showTemplates, setShowTemplates] = useState(false);
  const [resultModal, setResultModal] = useState(null); // { ruleId, results }
  const [runAllLoading, setRunAllLoading] = useState(false);
  const navigate = useNavigate();
  const pollIntervals = useRef({});
  const statusPollInterval = useRef(null);

  const loadRules = async () => {
    try {
      const [rulesRes, templatesRes] = await Promise.all([
        api.get('/rules'),
        api.get('/templates')
      ]);
      setRules(rulesRes.data);
      setTemplates(templatesRes.data);
    } catch (err) {
      console.error('Failed to load rules:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load running statuses from backend (persistent across navigation)
  const loadRunningStatuses = async () => {
    try {
      const res = await api.get('/rules/status/all');
      const statuses = res.data;

      // Check if any rules are running
      const hasRunning = Object.values(statuses).some(s => s.status === 'running');

      // Merge with current state, handling completed rules
      setRunningRules(prev => {
        const updated = { ...prev };
        let runAllJustCompleted = false;
        let runAllResults = null;

        for (const [ruleId, status] of Object.entries(statuses)) {
          const prevStatus = prev[ruleId];

          // If status changed from running to completed/error, show results
          if (prevStatus?.status === 'running' && status.status === 'completed') {
            if (status.isPartOfRunAll) {
              runAllJustCompleted = true;
              runAllResults = status.results;
            } else {
              setResultModal({ ruleId, results: status.results, dryRun: status.dryRun });
            }
          }

          updated[ruleId] = status;
        }

        // Show run-all completion modal (only once when first rule completes)
        if (runAllJustCompleted && runAllResults && !resultModal) {
          setResultModal({
            ruleId: 'all',
            results: runAllResults,
            dryRun: false,
            isRunAll: true
          });
        }

        return updated;
      });

      // If nothing is running, we can slow down polling
      return hasRunning;
    } catch (err) {
      console.error('Failed to load running statuses:', err);
      return false;
    }
  };

  useEffect(() => {
    loadRules();
    loadRunningStatuses();

    // Start polling for status updates
    statusPollInterval.current = setInterval(async () => {
      const hasRunning = await loadRunningStatuses();
      // If running, also refresh rules list to get updated last_run info
      if (!hasRunning) {
        loadRules();
      }
    }, 3000);

    // Cleanup polling on unmount
    return () => {
      Object.values(pollIntervals.current).forEach(clearInterval);
      if (statusPollInterval.current) {
        clearInterval(statusPollInterval.current);
      }
    };
  }, []);

  const toggleRule = async (rule) => {
    try {
      await api.put(`/rules/${rule.id}`, { is_active: !rule.is_active });
      loadRules();
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  };

  const deleteRule = async (rule) => {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      await api.delete(`/rules/${rule.id}`);
      loadRules();
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  const pollRuleStatus = async (ruleId) => {
    try {
      const res = await api.get(`/rules/${ruleId}/status`);
      const status = res.data;

      if (status.status === 'completed' || status.status === 'error') {
        // Stop polling
        if (pollIntervals.current[ruleId]) {
          clearInterval(pollIntervals.current[ruleId]);
          delete pollIntervals.current[ruleId];
        }

        // Update state
        setRunningRules(prev => ({ ...prev, [ruleId]: status }));

        // Show results
        if (status.status === 'completed') {
          setResultModal({ ruleId, results: status.results, dryRun: status.dryRun });
        } else {
          alert(`Rule failed: ${status.error}`);
        }

        // Clear server status
        await api.delete(`/rules/${ruleId}/status`);

        // Reload rules to get updated last_run info
        loadRules();
      } else {
        setRunningRules(prev => ({ ...prev, [ruleId]: status }));
      }
    } catch (err) {
      console.error('Failed to poll rule status:', err);
    }
  };

  const runRule = async (rule) => {
    try {
      const res = await api.post(`/rules/${rule.id}/run`, {});

      if (res.data.status === 'started' || res.data.status === 'already_running') {
        // Mark as running and start polling
        setRunningRules(prev => ({
          ...prev,
          [rule.id]: { status: 'running', startedAt: new Date().toISOString() }
        }));

        // Start polling every 2 seconds
        if (!pollIntervals.current[rule.id]) {
          pollIntervals.current[rule.id] = setInterval(() => pollRuleStatus(rule.id), 2000);
          // Also poll immediately
          pollRuleStatus(rule.id);
        }
      }
    } catch (err) {
      alert('Failed to start rule: ' + (err.response?.data?.error || err.message));
    }
  };

  const runAllRules = async () => {
    if (runAllLoading) return;

    try {
      setRunAllLoading(true);
      const res = await api.post('/rules/run-all');

      if (res.data.status === 'started') {
        // Mark all returned rules as running
        const updates = {};
        for (const rule of res.data.rules) {
          updates[rule.id] = { status: 'running', startedAt: new Date().toISOString(), isPartOfRunAll: true };
        }
        setRunningRules(prev => ({ ...prev, ...updates }));
      } else if (res.data.status === 'no_rules') {
        alert('No active rules to run');
      }
    } catch (err) {
      alert('Failed to run all rules: ' + (err.response?.data?.error || err.message));
    } finally {
      setRunAllLoading(false);
    }
  };

  const applyTemplate = async (template) => {
    const name = prompt('Rule name:', template.name);
    if (!name) return;

    try {
      const res = await api.post(`/templates/${template.id}/use`, { customName: name });
      navigate(`/admin/rules/${res.data.id}`);
    } catch (err) {
      alert('Failed to create rule: ' + (err.response?.data?.error || err.message));
    }
  };

  const closeResultModal = async () => {
    // If this was a run-all, clear all completed statuses
    if (resultModal?.isRunAll) {
      // Clear all completed run-all statuses from backend
      for (const [ruleId, status] of Object.entries(runningRules)) {
        if (status.isPartOfRunAll && status.status === 'completed') {
          try {
            await api.delete(`/rules/${ruleId}/status`);
          } catch (e) {
            // Ignore errors
          }
        }
      }
      // Clear from local state
      setRunningRules(prev => {
        const updated = {};
        for (const [ruleId, status] of Object.entries(prev)) {
          if (!(status.isPartOfRunAll && status.status === 'completed')) {
            updated[ruleId] = status;
          }
        }
        return updated;
      });
    } else if (resultModal?.ruleId) {
      // Clear single rule status
      try {
        await api.delete(`/rules/${resultModal.ruleId}/status`);
      } catch (e) {
        // Ignore errors
      }
      setRunningRules(prev => {
        const updated = { ...prev };
        delete updated[resultModal.ruleId];
        return updated;
      });
    }

    setResultModal(null);
    loadRules(); // Refresh to get updated last_run info
  };

  const formatDuration = (startedAt, completedAt) => {
    if (!startedAt) return '';
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    const seconds = Math.round((end - start) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  // Check if any rules are currently running
  const anyRunning = Object.values(runningRules).some(s => s.status === 'running');
  const runningCount = Object.values(runningRules).filter(s => s.status === 'running').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold text-white">Rules</h1>
          {anyRunning && (
            <span className="badge bg-primary-500/20 text-primary-400 flex items-center space-x-2 px-3 py-1">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{runningCount} rule{runningCount !== 1 ? 's' : ''} running</span>
            </span>
          )}
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={runAllRules}
            disabled={anyRunning || runAllLoading}
            className="btn btn-secondary flex items-center space-x-2"
            title="Run all active rules"
          >
            {runAllLoading || anyRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            <span>Run All</span>
          </button>
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="btn btn-secondary"
          >
            {showTemplates ? 'Hide Templates' : 'Templates'}
          </button>
          <Link to="/admin/rules/new" className="btn btn-primary flex items-center space-x-2">
            <Plus className="h-4 w-4" />
            <span>Create Rule</span>
          </Link>
        </div>
      </div>

      {/* Templates Section */}
      {showTemplates && (
        <div className="card p-5">
          <h2 className="text-lg font-semibold mb-4">Rule Templates</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(template => (
              <div key={template.id} className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium">{template.name}</h3>
                    <p className="text-sm text-slate-400 mt-1">{template.description}</p>
                    <span className="badge badge-info mt-2">{template.category}</span>
                  </div>
                </div>
                <button
                  onClick={() => applyTemplate(template)}
                  className="btn btn-secondary w-full mt-3 text-sm"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Use Template
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rules List */}
      {rules.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-slate-400 mb-4">
            <ScrollText className="h-16 w-16 mx-auto opacity-50" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No Rules Yet</h2>
          <p className="text-slate-400 mb-6">Create your first rule to start managing your library</p>
          <div className="flex items-center justify-center space-x-4">
            <Link to="/admin/rules/new" className="btn btn-primary">
              Create Rule
            </Link>
            <button onClick={() => setShowTemplates(true)} className="btn btn-secondary">
              Browse Templates
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {rules.map(rule => {
            const ruleStatus = runningRules[rule.id];
            const isRunning = ruleStatus?.status === 'running';

            return (
              <div
                key={rule.id}
                className={`card p-5 ${!rule.is_active ? 'opacity-60' : ''} ${isRunning ? 'ring-2 ring-primary-500' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <h3 className="text-lg font-semibold">{rule.name}</h3>
                      <span className={`badge ${rule.is_active ? 'badge-success' : 'badge-warning'}`}>
                        {rule.is_active ? 'Active' : 'Disabled'}
                      </span>
                      <span className="badge badge-info capitalize">{rule.target_type}</span>
                      {isRunning && (
                        <span className="badge bg-primary-500/20 text-primary-400 flex items-center space-x-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Running...</span>
                        </span>
                      )}
                    </div>
                    {rule.description && (
                      <p className="text-slate-400 mt-1">{rule.description}</p>
                    )}
                    <div className="flex items-center space-x-4 mt-3 text-sm text-slate-500">
                      <span className="flex items-center space-x-1">
                        <Clock className="h-4 w-4" />
                        <span>Buffer: {rule.buffer_days} days</span>
                      </span>
                      {isRunning && ruleStatus.startedAt && (
                        <span className="text-primary-400">
                          Running for {formatDuration(ruleStatus.startedAt)}
                        </span>
                      )}
                      {!isRunning && rule.last_run && (
                        <span>
                          Last run: {new Date(rule.last_run).toLocaleDateString()} ({rule.last_run_matches} matches)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => runRule(rule)}
                      disabled={isRunning}
                      className="btn btn-ghost p-2"
                      title="Run Rule"
                    >
                      {isRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </button>
                    <Link
                      to={`/admin/rules/${rule.id}`}
                      className="btn btn-ghost p-2"
                      title="Edit"
                    >
                      <Edit className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => toggleRule(rule)}
                      className="btn btn-ghost p-2"
                      title={rule.is_active ? 'Disable' : 'Enable'}
                    >
                      {rule.is_active ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4 text-green-400" />
                      )}
                    </button>
                    <button
                      onClick={() => deleteRule(rule)}
                      className="btn btn-ghost p-2 text-red-400"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Conditions Preview */}
                <div className="mt-4 pt-4 border-t border-slate-700">
                  <p className="text-sm text-slate-400 mb-2">Conditions:</p>
                  <div className="flex flex-wrap gap-2">
                    {rule.conditions?.conditions?.map((c, i) => (
                      <span key={i} className="bg-slate-700 px-2 py-1 rounded text-xs">
                        {c.field} {c.operator} {String(c.value)}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Actions Preview */}
                <div className="mt-3">
                  <p className="text-sm text-slate-400 mb-2">Actions:</p>
                  <div className="flex flex-wrap gap-2">
                    {rule.actions?.map((a, i) => (
                      <span key={i} className="bg-slate-700 px-2 py-1 rounded text-xs">
                        {a.type.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Results Modal */}
      {resultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={closeResultModal}>
          <div className="bg-slate-800 rounded-xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white flex items-center space-x-2">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                  <span>{resultModal.isRunAll ? 'All Rules Completed' : 'Rule Completed'}</span>
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  {resultModal.isRunAll
                    ? `${resultModal.results?.rulesRun || 0} rules executed`
                    : (resultModal.dryRun ? 'Dry run' : 'Live run') + ' finished'}
                </p>
              </div>
              <button onClick={closeResultModal} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-slate-700/50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-white">{resultModal.results?.matches || 0}</div>
                  <div className="text-sm text-slate-400">Matches Found</div>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-white">{resultModal.results?.queued || resultModal.results?.queueProcessed || 0}</div>
                  <div className="text-sm text-slate-400">Added to Queue</div>
                </div>
              </div>

              {resultModal.isRunAll && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm">
                  Successfully ran {resultModal.results?.rulesRun || 0} active rules.
                </div>
              )}

              {resultModal.dryRun && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">
                  This was a dry run. No changes were made. Items were added to the "Leaving Soon" queue for review.
                </div>
              )}

              {!resultModal.dryRun && resultModal.results?.deleted > 0 && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mt-3">
                  {resultModal.results.deleted} items were deleted.
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-700">
              <button onClick={closeResultModal} className="w-full btn btn-primary">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScrollText(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"/>
      <path d="M19 17V5a2 2 0 0 0-2-2H4"/>
      <path d="M15 8h-5"/>
      <path d="M15 12h-5"/>
    </svg>
  );
}
