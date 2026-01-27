import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, useAuth } from '../App';
import {
  Clock, Film, Tv, Loader2, Heart, Shield, AlertTriangle,
  Calendar, Trash2, CheckCircle, XCircle, Timer, Info,
  BarChart3, Eye, Users, Database, Activity, X, HardDrive
} from 'lucide-react';

function CountdownBadge({ daysRemaining, isExpired }) {
  if (isExpired) {
    return (
      <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs bg-red-500/20 text-red-400">
        <XCircle className="h-3 w-3" />
        <span>Expired</span>
      </span>
    );
  }

  if (daysRemaining <= 1) {
    return (
      <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs bg-red-500/20 text-red-400 animate-pulse">
        <AlertTriangle className="h-3 w-3" />
        <span>Today!</span>
      </span>
    );
  }

  if (daysRemaining <= 3) {
    return (
      <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs bg-orange-500/20 text-orange-400">
        <Timer className="h-3 w-3" />
        <span>{daysRemaining} days</span>
      </span>
    );
  }

  if (daysRemaining <= 7) {
    return (
      <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs bg-yellow-500/20 text-yellow-400">
        <Clock className="h-3 w-3" />
        <span>{daysRemaining} days</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs bg-slate-500/20 text-slate-400">
      <Calendar className="h-3 w-3" />
      <span>{daysRemaining} days</span>
    </span>
  );
}

function MediaTypeBadge({ type }) {
  const config = {
    movie: { color: 'bg-blue-500/20 text-blue-400', icon: Film, text: 'Movie' },
    tv: { color: 'bg-purple-500/20 text-purple-400', icon: Tv, text: 'TV Show' },
    show: { color: 'bg-purple-500/20 text-purple-400', icon: Tv, text: 'TV Show' },
    episode: { color: 'bg-indigo-500/20 text-indigo-400', icon: Tv, text: 'Episode' },
  };
  const { color, icon: Icon, text } = config[type] || config.movie;

  return (
    <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      <span>{text}</span>
    </span>
  );
}

// Stats Modal for queue items
function StatsModal({ isOpen, onClose, plexRatingKey, title }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && plexRatingKey) {
      fetchStats();
    }
  }, [isOpen, plexRatingKey]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/stats/plex/${plexRatingKey}`);
      setStats(res.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  const formatBytes = (bytes) => {
    if (!bytes) return 'Unknown';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  const formatDuration = (ms) => {
    if (!ms) return 'Unknown';
    const minutes = Math.round(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-slate-800 rounded-lg w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center space-x-3">
            <BarChart3 className="h-5 w-5 text-primary-400" />
            <h2 className="text-lg font-semibold text-white">Item Statistics</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 text-primary-500 animate-spin" />
            </div>
          ) : !stats ? (
            <div className="text-center py-8 text-slate-400">
              No statistics available
            </div>
          ) : (
            <>
              {/* Title & Type */}
              <div className="text-center pb-2 border-b border-slate-700">
                <h3 className="text-xl text-white font-medium">{stats.title || title}</h3>
                {stats.episode_info && (
                  <p className="text-primary-400 text-sm mt-1">
                    {stats.episode_info.show_title} - S{String(stats.episode_info.season).padStart(2, '0')}E{String(stats.episode_info.episode).padStart(2, '0')}
                  </p>
                )}
                <p className="text-slate-400 text-sm mt-1">
                  Plex ID: {stats.plex_rating_key} • {stats.media_type}
                  {stats.tmdb_id && ` • TMDB: ${stats.tmdb_id}`}
                </p>
              </div>

              {/* Plex Info */}
              {stats.plex_info && (
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Plex Library Info
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-slate-400">View Count:</span>
                      <span className="text-white ml-2">{stats.plex_info.view_count}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Last Viewed:</span>
                      <span className={`ml-2 ${stats.plex_info.last_viewed_at ? 'text-white' : 'text-slate-500'}`}>
                        {formatDate(stats.plex_info.last_viewed_at)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Added to Plex:</span>
                      <span className="text-white ml-2">{formatDate(stats.plex_info.added_at)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Duration:</span>
                      <span className="text-white ml-2">{formatDuration(stats.plex_info.duration)}</span>
                    </div>
                    {stats.plex_info.file_size > 0 && (
                      <div>
                        <span className="text-slate-400">File Size:</span>
                        <span className="text-white ml-2">{formatBytes(stats.plex_info.file_size)}</span>
                      </div>
                    )}
                    {stats.plex_info.resolution && (
                      <div>
                        <span className="text-slate-400">Quality:</span>
                        <span className="text-white ml-2">
                          {stats.plex_info.resolution}
                          {stats.plex_info.video_codec && ` (${stats.plex_info.video_codec})`}
                        </span>
                      </div>
                    )}
                  </div>
                  {stats.plex_info.summary && (
                    <p className="text-slate-400 text-xs mt-3 line-clamp-2">{stats.plex_info.summary}</p>
                  )}
                </div>
              )}

              {/* Watchlisted By */}
              <div>
                <h4 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                  <Heart className="h-4 w-4 text-red-400" />
                  Watchlisted By ({stats.watchlisted_by?.length || 0})
                </h4>
                {stats.watchlisted_by?.length > 0 ? (
                  <div className="space-y-2">
                    {stats.watchlisted_by.map(w => (
                      <div key={w.id} className={`flex items-center justify-between p-2 rounded ${w.is_active ? 'bg-slate-700/50' : 'bg-slate-700/30 opacity-60'}`}>
                        <div className="flex items-center space-x-2">
                          {w.user_thumb ? (
                            <img src={w.user_thumb} alt="" className="w-6 h-6 rounded-full" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center">
                              <Users className="h-3 w-3 text-slate-400" />
                            </div>
                          )}
                          <span className="text-white">{w.username}</span>
                          {!w.is_active && <span className="text-xs text-slate-500">(removed)</span>}
                        </div>
                        <span className="text-xs text-slate-400">
                          {w.is_active ? `Added ${formatDate(w.added_at)}` : `Removed ${formatDate(w.removed_at)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 text-sm">Not on any user's watchlist</p>
                )}
              </div>

              {/* Request Info */}
              {stats.request && (
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Request Info
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-slate-400">Status:</span>
                      <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                        stats.request.status === 'available' ? 'bg-green-500/20 text-green-400' :
                        stats.request.status === 'processing' ? 'bg-blue-500/20 text-blue-400' :
                        stats.request.status === 'partial' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {stats.request.status}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Requested By:</span>
                      <span className="text-white ml-2">{stats.request.requested_by_name}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Requested At:</span>
                      <span className="text-white ml-2">{formatDate(stats.request.added_at)}</span>
                    </div>
                    {stats.request.available_at && (
                      <div>
                        <span className="text-slate-400">Available At:</span>
                        <span className="text-white ml-2">{formatDate(stats.request.available_at)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Queue Info (Scheduled for deletion) */}
              {stats.queue_items?.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-red-400 mb-3 flex items-center gap-2">
                    <Trash2 className="h-4 w-4" />
                    Scheduled for Deletion
                  </h4>
                  {stats.queue_items.map(qi => (
                    <div key={qi.id} className="text-sm space-y-1">
                      <p className="text-white">Rule: {qi.rule_name || 'Unknown'}</p>
                      {qi.rule_description && (
                        <p className="text-slate-400 text-xs">{qi.rule_description}</p>
                      )}
                      <p className="text-slate-400">Scheduled: {formatDate(qi.action_at)}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Watch History (Flexerr database) */}
              {stats.watch_history?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Watch History (Tracked)
                  </h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {stats.watch_history.slice(0, 10).map(wh => (
                      <div key={wh.id} className="flex justify-between text-sm p-2 bg-slate-700/30 rounded">
                        <span className="text-white">{wh.username}</span>
                        <span className="text-slate-400">{formatDate(wh.watched_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Plex Watch History */}
              {stats.plex_watch_history?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Recent Plex Views
                  </h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {stats.plex_watch_history.map((wh, i) => (
                      <div key={i} className="flex justify-between text-sm p-2 bg-slate-700/30 rounded">
                        <span className="text-slate-400">Account #{wh.account_id}</span>
                        <span className="text-slate-400">{formatDate(wh.viewed_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Velocity Data (for TV) */}
              {stats.velocity_data?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    User Viewing Progress
                  </h4>
                  <div className="space-y-2">
                    {stats.velocity_data.map(v => (
                      <div key={v.id} className="flex justify-between items-center text-sm p-2 bg-slate-700/30 rounded">
                        <span className="text-white">{v.username}</span>
                        <div className="text-right text-slate-400">
                          <span>S{v.current_season}E{v.current_episode}</span>
                          {v.episodes_per_day > 0 && (
                            <span className="ml-2 text-xs">({v.episodes_per_day.toFixed(1)} eps/day)</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LeavingSoon() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [protecting, setProtecting] = useState(null);
  const [filter, setFilter] = useState('all'); // all, movies, shows, episodes
  const [selectedItem, setSelectedItem] = useState(null); // For stats modal

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [itemsRes, statsRes] = await Promise.all([
        api.get('/leaving-soon'),
        api.get('/leaving-soon/stats')
      ]);
      setItems(itemsRes.data);
      setStats(statsRes.data);
    } catch (err) {
      console.error('Error fetching leaving soon:', err);
    } finally {
      setLoading(false);
    }
  };

  const protectItem = async (item) => {
    setProtecting(item.id);
    try {
      const res = await api.post(`/leaving-soon/${item.id}/protect`);
      if (res.data.success) {
        // Update item in list
        setItems(items.map(i =>
          i.id === item.id
            ? { ...i, onYourWatchlist: true, isProtected: true, protectedBy: [...(i.protectedBy || []), user?.username || 'You'] }
            : i
        ));
      }
    } catch (err) {
      console.error('Error protecting item:', err);
    } finally {
      setProtecting(null);
    }
  };

  const filteredItems = items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'movies') return item.media_type === 'movie';
    if (filter === 'shows') return item.media_type === 'show' || item.media_type === 'tv';
    if (filter === 'episodes') return item.media_type === 'episode';
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-12 w-12 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center space-x-2">
            <Clock className="h-7 w-7 text-orange-400" />
            <span>Leaving Soon</span>
          </h1>
          <p className="text-slate-400 mt-1">
            Content scheduled for removal. Add to your watchlist to keep it!
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-white">{stats.total || 0}</div>
            <div className="text-slate-400 text-sm">Total Leaving</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-red-400">{stats.within_day || 0}</div>
            <div className="text-slate-400 text-sm">Within 24h</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4">
            <div className="text-2xl font-bold text-orange-400">{stats.within_week || 0}</div>
            <div className="text-slate-400 text-sm">Within 7 days</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4">
            <div className="flex items-center space-x-4">
              <div>
                <div className="text-lg font-bold text-blue-400">{stats.movies || 0}</div>
                <div className="text-slate-500 text-xs">Movies</div>
              </div>
              <div>
                <div className="text-lg font-bold text-purple-400">{stats.shows || 0}</div>
                <div className="text-slate-500 text-xs">Shows</div>
              </div>
              <div>
                <div className="text-lg font-bold text-indigo-400">{stats.episodes || 0}</div>
                <div className="text-slate-500 text-xs">Episodes</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex space-x-2 border-b border-slate-700 pb-2">
        {['all', 'movies', 'shows', 'episodes'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Empty State */}
      {filteredItems.length === 0 && (
        <div className="text-center p-12">
          <div className="w-24 h-24 rounded-full bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="h-16 w-16 text-slate-600" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Nothing leaving soon!</h2>
          <p className="text-slate-400">
            All your content is safe for now.
          </p>
        </div>
      )}

      {/* Items List */}
      {filteredItems.length > 0 && (
        <div className="space-y-3">
          {filteredItems.map(item => (
            <div
              key={item.id}
              className={`bg-slate-800 rounded-lg overflow-hidden ${
                item.isProtected ? 'border border-green-500/30' : ''
              } hover:bg-slate-800/80 transition-colors`}
            >
              <div className="flex">
                {/* Poster - clickable for stats */}
                <button
                  onClick={() => user?.is_admin && setSelectedItem(item)}
                  className={`flex-shrink-0 ${user?.is_admin ? 'cursor-pointer hover:opacity-80' : ''}`}
                >
                  {item.poster_url ? (
                    <img
                      src={item.poster_url}
                      alt={item.title}
                      className="w-20 h-30 object-cover"
                    />
                  ) : (
                    <div className="w-20 h-30 bg-slate-700 flex items-center justify-center">
                      {item.media_type === 'movie' ? (
                        <Film className="h-8 w-8 text-slate-500" />
                      ) : (
                        <Tv className="h-8 w-8 text-slate-500" />
                      )}
                    </div>
                  )}
                </button>

                {/* Content */}
                <div className="flex-1 p-4 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-medium text-white truncate">
                        {item.title}
                        {item.year && <span className="text-slate-500 ml-2">({item.year})</span>}
                      </h3>
                      <div className="flex items-center flex-wrap gap-2 mt-1">
                        <MediaTypeBadge type={item.media_type} />
                        <CountdownBadge daysRemaining={item.daysRemaining} isExpired={item.isExpired} />
                        {item.isProtected && (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
                            <Shield className="h-3 w-3" />
                            <span>Protected</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {/* Stats button (admin only) */}
                      {user?.is_admin && (
                        <button
                          onClick={() => setSelectedItem(item)}
                          className="p-2 bg-slate-600/50 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
                          title="View Statistics"
                        >
                          <BarChart3 className="h-4 w-4" />
                        </button>
                      )}
                      {item.onYourWatchlist ? (
                        <span className="inline-flex items-center space-x-1 px-3 py-2 bg-green-500/20 text-green-400 rounded-lg text-sm">
                          <Heart className="h-4 w-4 fill-current" />
                          <span>On Watchlist</span>
                        </span>
                      ) : (
                        <button
                          onClick={() => protectItem(item)}
                          disabled={protecting === item.id || !item.tmdb_id}
                          className="inline-flex items-center space-x-1 px-3 py-2 bg-primary-500 hover:bg-primary-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm transition-colors"
                        >
                          {protecting === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Heart className="h-4 w-4" />
                          )}
                          <span>Keep It</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="mt-3 flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span className="flex items-center space-x-1">
                      <Calendar className="h-3 w-3" />
                      <span>Scheduled: {new Date(item.action_at).toLocaleDateString()}</span>
                    </span>
                    {item.rule_name && (
                      <span className="flex items-center space-x-1">
                        <Info className="h-3 w-3" />
                        <span>Rule: {item.rule_name}</span>
                      </span>
                    )}
                    {item.protectedBy && item.protectedBy.length > 0 && (
                      <span className="flex items-center space-x-1 text-green-400">
                        <Shield className="h-3 w-3" />
                        <span>Protected by: {item.protectedBy.join(', ')}</span>
                      </span>
                    )}
                  </div>

                  {/* Rule Description */}
                  {item.rule_description && (
                    <p className="mt-2 text-xs text-slate-500 line-clamp-1">
                      {item.rule_description}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info Box */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <Info className="h-5 w-5 text-slate-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-slate-400">
            <p className="font-medium text-slate-300 mb-1">How it works</p>
            <p>
              Content is automatically scheduled for removal based on your cleanup rules.
              Click "Keep It" to add an item to your watchlist, which will protect it from deletion
              and trigger a re-download if needed.
            </p>
          </div>
        </div>
      </div>

      {/* Stats Modal */}
      {selectedItem && (
        <StatsModal
          isOpen={!!selectedItem}
          onClose={() => setSelectedItem(null)}
          plexRatingKey={selectedItem.plex_rating_key || selectedItem.plex_id}
          title={selectedItem.title}
        />
      )}
    </div>
  );
}
