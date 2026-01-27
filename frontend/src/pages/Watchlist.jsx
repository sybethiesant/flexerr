import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../App';
import {
  Heart, Film, Tv, Loader2, Trash2,
  CheckCircle, Clock, Download
} from 'lucide-react';

function StatusBadge({ status }) {
  const config = {
    pending: { color: 'bg-yellow-500/20 text-yellow-400', icon: Clock, text: 'Pending' },
    processing: { color: 'bg-blue-500/20 text-blue-400', icon: Download, text: 'Downloading' },
    partial: { color: 'bg-amber-500/20 text-amber-400', icon: Download, text: 'Partial' },
    available: { color: 'bg-green-500/20 text-green-400', icon: CheckCircle, text: 'Available' },
  };
  const { color, icon: Icon, text } = config[status] || config.pending;

  return (
    <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      <span>{text}</span>
    </span>
  );
}

export default function Watchlist() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState(null);

  useEffect(() => {
    fetchWatchlist();
  }, []);

  const fetchWatchlist = async () => {
    try {
      const res = await api.get('/watchlist');
      setItems(res.data);
    } catch (err) {
      console.error('Error fetching watchlist:', err);
    } finally {
      setLoading(false);
    }
  };

  const removeFromWatchlist = async (tmdbId, mediaType) => {
    setRemoving(tmdbId);
    try {
      await api.delete(`/watchlist/${tmdbId}/${mediaType}`);
      setItems(items.filter(i => !(i.tmdb_id === tmdbId && i.media_type === mediaType)));
    } catch (err) {
      console.error('Error removing from watchlist:', err);
    } finally {
      setRemoving(null);
    }
  };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">My Watchlist</h1>
          <p className="text-slate-400 mt-1">
            {items.length} item{items.length !== 1 ? 's' : ''} on your watchlist
          </p>
        </div>
        <Link
          to="/discover"
          className="btn btn-primary flex items-center space-x-2"
        >
          <Heart className="h-4 w-4" />
          <span>Add More</span>
        </Link>
      </div>

      {/* Empty State */}
      {items.length === 0 && (
        <div className="text-center py-16">
          <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <Heart className="h-10 w-10 text-slate-600" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Your watchlist is empty</h2>
          <p className="text-slate-400 mb-6">
            Start adding movies and TV shows you want to watch
          </p>
          <Link to="/discover" className="btn btn-primary">
            Discover Content
          </Link>
        </div>
      )}

      {/* Watchlist Grid */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map(item => (
            <div
              key={`${item.media_type}-${item.tmdb_id}`}
              className="bg-slate-800 rounded-lg overflow-hidden group"
            >
              <Link
                to={`/discover/${item.media_type}/${item.tmdb_id}`}
                className="flex"
              >
                {item.poster_path ? (
                  <img
                    src={item.poster_path}
                    alt={item.title}
                    className="w-24 h-36 object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-24 h-36 bg-slate-700 flex items-center justify-center flex-shrink-0">
                    {item.media_type === 'movie' ? (
                      <Film className="h-8 w-8 text-slate-500" />
                    ) : (
                      <Tv className="h-8 w-8 text-slate-500" />
                    )}
                  </div>
                )}
                <div className="flex-1 p-4 min-w-0">
                  <h3 className="font-medium text-white truncate group-hover:text-primary-400 transition-colors">
                    {item.title}
                  </h3>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      item.media_type === 'movie'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-purple-500/20 text-purple-400'
                    }`}>
                      {item.media_type === 'movie' ? 'Movie' : 'TV'}
                    </span>
                  </div>
                  <div className="mt-2">
                    <StatusBadge status={item.request_status || 'pending'} />
                  </div>
                  <p className="text-slate-500 text-xs mt-2">
                    Added {new Date(item.added_at).toLocaleDateString()}
                  </p>
                </div>
              </Link>
              <div className="px-4 pb-4">
                <button
                  onClick={() => removeFromWatchlist(item.tmdb_id, item.media_type)}
                  disabled={removing === item.tmdb_id}
                  className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-slate-700 hover:bg-red-500/20 hover:text-red-400 rounded-lg text-slate-400 transition-colors text-sm"
                >
                  {removing === item.tmdb_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  <span>Remove</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
