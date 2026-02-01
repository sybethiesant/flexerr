import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FolderTree,
  Plus,
  Edit2,
  Trash2,
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Film,
  Tv,
  ArrowRight,
  FolderInput,
  Layers,
  FolderOpen
} from 'lucide-react';
import { useToast } from '../components/Toast';
import { api } from '../App';

export default function Categorization() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [applying, setApplying] = useState(false);
  const [selectedItems, setSelectedItems] = useState({ movies: [], shows: [] });
  const [syncingCollections, setSyncingCollections] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      const res = await api.get('/categorization');
      const data = res.data;
      if (Array.isArray(data)) {
        setRules(data);
      } else if (data.error) {
        showToast(data.error, 'error');
        setRules([]);
      } else {
        setRules([]);
      }
    } catch (error) {
      showToast('Failed to fetch rules', 'error');
      setRules([]);
    } finally {
      setLoading(false);
    }
  };

  const deleteRule = async (id, name) => {
    if (!window.confirm(`Delete rule "${name}"?`)) return;

    try {
      await api.delete(`/categorization/${id}`);
      showToast('Rule deleted', 'success');
      fetchRules();
    } catch (error) {
      showToast('Failed to delete rule', 'error');
    }
  };

  const toggleRule = async (id, currentStatus) => {
    try {
      await api.put(`/categorization/${id}`, { is_active: !currentStatus });
      fetchRules();
    } catch (error) {
      showToast('Failed to update rule', 'error');
    }
  };

  const analyzeLibrary = async () => {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await api.get('/categorization/analyze');
      const data = res.data;
      setAnalysis(data);
      setSelectedItems({
        movies: data.movies.map(m => m.id),
        shows: data.shows.map(s => s.id)
      });
    } catch (error) {
      showToast('Failed to analyze library', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const applyChanges = async () => {
    if (!analysis) return;

    const moviesToApply = analysis.movies.filter(m => selectedItems.movies.includes(m.id));
    const showsToApply = analysis.shows.filter(s => selectedItems.shows.includes(s.id));

    if (moviesToApply.length === 0 && showsToApply.length === 0) {
      showToast('No items selected', 'warning');
      return;
    }

    if (!window.confirm(`Move ${moviesToApply.length} movies and ${showsToApply.length} shows to their new locations?`)) {
      return;
    }

    setApplying(true);
    try {
      const res = await api.post('/categorization/apply', {
        movies: moviesToApply,
        shows: showsToApply
      });
      const result = res.data;

      if (result.success?.length > 0) {
        showToast(`Successfully moved ${result.success.length} items`, 'success');
      }
      if (result.failed?.length > 0) {
        showToast(`Failed to move ${result.failed.length} items`, 'error');
      }

      // Re-analyze to update the list
      await analyzeLibrary();
    } catch (error) {
      showToast('Failed to apply changes', 'error');
    } finally {
      setApplying(false);
    }
  };

  const toggleItemSelection = (type, id) => {
    setSelectedItems(prev => ({
      ...prev,
      [type]: prev[type].includes(id)
        ? prev[type].filter(i => i !== id)
        : [...prev[type], id]
    }));
  };

  const selectAll = (type) => {
    if (!analysis) return;
    const items = type === 'movies' ? analysis.movies : analysis.shows;
    setSelectedItems(prev => ({
      ...prev,
      [type]: items.map(i => i.id)
    }));
  };

  const selectNone = (type) => {
    setSelectedItems(prev => ({
      ...prev,
      [type]: []
    }));
  };

  const syncCollections = async () => {
    setSyncingCollections(true);
    try {
      const res = await api.post('/categorization/sync-all');
      const data = res.data;

      if (data.success) {
        const totalAdded = data.results?.reduce((sum, r) => sum + (r.added?.length || 0), 0) || 0;
        const totalRemoved = data.results?.reduce((sum, r) => sum + (r.removed?.length || 0), 0) || 0;

        if (totalAdded > 0 || totalRemoved > 0) {
          showToast(`Synced collections: ${totalAdded} added, ${totalRemoved} removed`, 'success');
        } else {
          showToast('Collections are up to date', 'success');
        }
        fetchRules(); // Refresh to get updated match counts
      } else {
        showToast(data.error || 'Sync failed', 'error');
      }
    } catch (error) {
      showToast('Failed to sync collections', 'error');
    } finally {
      setSyncingCollections(false);
    }
  };

  const hasCollectionRules = rules.some(r => r.mode === 'collection');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Categorization Rules</h1>
          <p className="text-slate-400 mt-1">
            Automatically organize media into Plex collections or different root folders
          </p>
        </div>
        <div className="flex items-center space-x-3">
          {hasCollectionRules && (
            <button
              onClick={syncCollections}
              disabled={syncingCollections}
              className="btn-secondary flex items-center space-x-2"
            >
              {syncingCollections ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span>{syncingCollections ? 'Syncing...' : 'Sync Collections'}</span>
            </button>
          )}
          <Link
            to="/admin/categorization/new"
            className="btn-primary flex items-center space-x-2"
          >
            <Plus className="h-4 w-4" />
            <span>New Rule</span>
          </Link>
        </div>
      </div>

      {/* Rules List */}
      <div className="card">
        <div className="p-4 border-b border-slate-700">
          <h2 className="font-semibold flex items-center space-x-2">
            <FolderTree className="h-5 w-5 text-primary-400" />
            <span>Active Rules</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Collection rules can match multiple items. Library rules use first-match priority.
          </p>
        </div>

        {rules.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <FolderTree className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No categorization rules yet</p>
            <p className="text-sm mt-1">Create a rule to automatically organize your media</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {rules.map(rule => (
              <div
                key={rule.id}
                className={`p-4 flex items-center justify-between ${
                  !rule.is_active ? 'opacity-50' : ''
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center space-x-3">
                    {/* Mode badge */}
                    <span className={`px-2 py-0.5 rounded text-xs font-medium flex items-center space-x-1 ${
                      rule.mode === 'collection'
                        ? 'bg-primary-500/20 text-primary-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {rule.mode === 'collection' ? (
                        <><Layers className="h-3 w-3" /><span>Collection</span></>
                      ) : (
                        <><FolderOpen className="h-3 w-3" /><span>Library</span></>
                      )}
                    </span>
                    {/* Target type badge */}
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      rule.target_type === 'movies' ? 'bg-blue-500/20 text-blue-400' :
                      rule.target_type === 'shows' ? 'bg-purple-500/20 text-purple-400' :
                      'bg-slate-500/20 text-slate-400'
                    }`}>
                      {rule.target_type === 'movies' ? 'Movies' :
                       rule.target_type === 'shows' ? 'TV Shows' : 'All'}
                    </span>
                    <h3 className="font-medium">{rule.name}</h3>
                    {rule.priority > 0 && (
                      <span className="text-xs text-slate-500">Priority: {rule.priority}</span>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-sm text-slate-400 mt-1">{rule.description}</p>
                  )}
                  <div className="flex items-center space-x-4 mt-2 text-xs text-slate-500">
                    {rule.conditions?.conditions?.length > 0 && (
                      <span>{rule.conditions.conditions.length} condition(s)</span>
                    )}
                    {/* Collection name for collection mode */}
                    {rule.mode === 'collection' && rule.collection_name && (
                      <span className="flex items-center space-x-1 text-primary-400">
                        <Layers className="h-3 w-3" />
                        <span>"{rule.collection_name}"</span>
                      </span>
                    )}
                    {/* Root folders for library mode */}
                    {rule.mode === 'library' && rule.radarr_root_folder && (
                      <span className="flex items-center space-x-1">
                        <Film className="h-3 w-3" />
                        <span>{rule.radarr_root_folder}</span>
                      </span>
                    )}
                    {rule.mode === 'library' && rule.sonarr_root_folder && (
                      <span className="flex items-center space-x-1">
                        <Tv className="h-3 w-3" />
                        <span>{rule.sonarr_root_folder}</span>
                      </span>
                    )}
                    {rule.last_matched_count > 0 && (
                      <span className="text-green-400">{rule.last_matched_count} matched</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => toggleRule(rule.id, rule.is_active)}
                    className={`p-2 rounded-lg transition-colors ${
                      rule.is_active
                        ? 'text-green-400 hover:bg-green-500/20'
                        : 'text-slate-500 hover:bg-slate-700'
                    }`}
                    title={rule.is_active ? 'Disable' : 'Enable'}
                  >
                    {rule.is_active ? <CheckCircle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                  </button>
                  <Link
                    to={`/admin/categorization/${rule.id}`}
                    className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="h-5 w-5" />
                  </Link>
                  <button
                    onClick={() => deleteRule(rule.id, rule.name)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Batch Organize Section */}
      <div className="card">
        <div className="p-4 border-b border-slate-700">
          <h2 className="font-semibold flex items-center space-x-2">
            <FolderInput className="h-5 w-5 text-accent-400" />
            <span>Batch Organize Existing Library</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Analyze your existing library and move items to their correct locations based on current rules
          </p>
        </div>

        <div className="p-4">
          <button
            onClick={analyzeLibrary}
            disabled={analyzing || rules.length === 0}
            className="btn-secondary flex items-center space-x-2"
          >
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span>{analyzing ? 'Analyzing...' : 'Analyze Library'}</span>
          </button>

          {rules.length === 0 && (
            <p className="text-sm text-slate-500 mt-2">
              Create at least one categorization rule to analyze your library
            </p>
          )}
        </div>

        {/* Analysis Results */}
        {analysis && (
          <div className="border-t border-slate-700">
            {analysis.movies.length === 0 && analysis.shows.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-400" />
                <p>All media is already in the correct location!</p>
              </div>
            ) : (
              <>
                {/* Movies to move */}
                {analysis.movies.length > 0 && (
                  <div className="p-4 border-b border-slate-700">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium flex items-center space-x-2">
                        <Film className="h-4 w-4 text-blue-400" />
                        <span>Movies to Move ({analysis.movies.length})</span>
                      </h3>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => selectAll('movies')}
                          className="text-xs text-primary-400 hover:text-primary-300"
                        >
                          Select All
                        </button>
                        <span className="text-slate-600">|</span>
                        <button
                          onClick={() => selectNone('movies')}
                          className="text-xs text-slate-400 hover:text-slate-300"
                        >
                          Select None
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {analysis.movies.map(movie => (
                        <label
                          key={movie.id}
                          className="flex items-center space-x-3 p-2 rounded-lg hover:bg-slate-700/50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedItems.movies.includes(movie.id)}
                            onChange={() => toggleItemSelection('movies', movie.id)}
                            className="rounded w-4 h-4 bg-slate-700 border-slate-600 text-primary-600"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{movie.title} ({movie.year})</div>
                            <div className="text-xs text-slate-500 flex items-center space-x-2">
                              <span className="truncate">{movie.currentRootFolder}</span>
                              <ArrowRight className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate text-green-400">{movie.newRootFolder}</span>
                            </div>
                          </div>
                          <span className="text-xs text-slate-500">{movie.ruleName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Shows to move */}
                {analysis.shows.length > 0 && (
                  <div className="p-4 border-b border-slate-700">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium flex items-center space-x-2">
                        <Tv className="h-4 w-4 text-purple-400" />
                        <span>TV Shows to Move ({analysis.shows.length})</span>
                      </h3>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => selectAll('shows')}
                          className="text-xs text-primary-400 hover:text-primary-300"
                        >
                          Select All
                        </button>
                        <span className="text-slate-600">|</span>
                        <button
                          onClick={() => selectNone('shows')}
                          className="text-xs text-slate-400 hover:text-slate-300"
                        >
                          Select None
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {analysis.shows.map(show => (
                        <label
                          key={show.id}
                          className="flex items-center space-x-3 p-2 rounded-lg hover:bg-slate-700/50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedItems.shows.includes(show.id)}
                            onChange={() => toggleItemSelection('shows', show.id)}
                            className="rounded w-4 h-4 bg-slate-700 border-slate-600 text-primary-600"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{show.title} ({show.year})</div>
                            <div className="text-xs text-slate-500 flex items-center space-x-2">
                              <span className="truncate">{show.currentRootFolder}</span>
                              <ArrowRight className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate text-green-400">{show.newRootFolder}</span>
                            </div>
                          </div>
                          <span className="text-xs text-slate-500">{show.ruleName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Apply button */}
                <div className="p-4">
                  <button
                    onClick={applyChanges}
                    disabled={applying || (selectedItems.movies.length === 0 && selectedItems.shows.length === 0)}
                    className="btn-primary flex items-center space-x-2"
                  >
                    {applying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    <span>
                      {applying ? 'Moving...' : `Move ${selectedItems.movies.length + selectedItems.shows.length} Selected Items`}
                    </span>
                  </button>
                  <p className="text-xs text-slate-500 mt-2">
                    This will move files on disk and update Radarr/Sonarr records
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="card p-5 bg-slate-800/50">
        <h3 className="font-medium mb-3">How Categorization Works</h3>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium flex items-center space-x-2 mb-2 text-primary-400">
              <Layers className="h-4 w-4" />
              <span>Collection Mode</span>
            </h4>
            <ul className="text-sm text-slate-400 space-y-1">
              <li>• Items appear in Plex collections within your existing library</li>
              <li>• Items can match multiple collection rules</li>
              <li>• Collections sync automatically every 30 minutes</li>
              <li>• Use "Sync Collections" to update immediately</li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-medium flex items-center space-x-2 mb-2 text-amber-400">
              <FolderOpen className="h-4 w-4" />
              <span>Library Mode</span>
            </h4>
            <ul className="text-sm text-slate-400 space-y-1">
              <li>• Files are placed in specific root folders on disk</li>
              <li>• First matching rule wins (by priority)</li>
              <li>• Use for separate Plex libraries (Anime, Kids, etc.)</li>
              <li>• Use "Batch Organize" to move existing items</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
