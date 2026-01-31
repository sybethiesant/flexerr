import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, useAuth } from '../App';
import {
  Heart, Film, Tv, Star, Clock, CheckCircle, Download,
  TrendingUp, Compass, Loader2, ArrowRight, Play
} from 'lucide-react';

function MediaCard({ item, size = 'normal' }) {
  const isSmall = size === 'small';
  return (
    <Link
      to={`/discover/${item.media_type}/${item.id || item.tmdb_id}`}
      className="group bg-slate-800 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all flex-shrink-0"
      style={{ width: isSmall ? '140px' : '180px' }}
    >
      <div className="aspect-[2/3] relative">
        {item.poster_path ? (
          <img
            src={item.poster_path}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-slate-700 flex items-center justify-center">
            {item.media_type === 'movie' ? (
              <Film className="h-8 w-8 text-slate-500" />
            ) : (
              <Tv className="h-8 w-8 text-slate-500" />
            )}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
          <div className="flex items-center space-x-1 text-xs text-white">
            <Play className="h-3 w-3" />
            <span>View Details</span>
          </div>
        </div>
      </div>
      <div className="p-2">
        <h3 className={`font-medium text-white truncate ${isSmall ? 'text-sm' : ''}`}>{item.title}</h3>
        <div className="flex items-center justify-between mt-0.5">
          <span className={`px-1 py-0.5 rounded text-xs ${
            item.media_type === 'movie' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
          }`}>
            {item.media_type === 'movie' ? 'Movie' : 'TV'}
          </span>
          {item.vote_average > 0 && (
            <div className="flex items-center space-x-0.5 text-xs text-slate-400">
              <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
              <span>{item.vote_average?.toFixed(1)}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function StatusBadge({ status }) {
  const config = {
    pending: { color: 'text-yellow-400', icon: Clock },
    processing: { color: 'text-blue-400', icon: Download },
    partial: { color: 'text-amber-400', icon: Download },
    available: { color: 'text-green-400', icon: CheckCircle },
  };
  const { color, icon: Icon } = config[status] || config.pending;
  return <Icon className={`h-4 w-4 ${color}`} />;
}

function HorizontalScroll({ children }) {
  return (
    <div className="flex overflow-x-auto space-x-4 pb-4 -mx-4 px-4 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
      {children}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState([]);
  const [requests, setRequests] = useState([]);
  const [trending, setTrending] = useState([]);

  useEffect(() => {
    // Sync Plex watchlist on first load, then fetch data
    syncAndFetchData();
  }, []);

  const [stats, setStats] = useState({
    watchlistCount: 0,
    pendingCount: 0,
    processingCount: 0,
    availableCount: 0,
  });

  const syncAndFetchData = async () => {
    try {
      // Sync Plex watchlist first (silent - don't block on errors)
      try {
        await api.post('/watchlist/sync');
      } catch (syncErr) {
        console.warn('Watchlist sync skipped:', syncErr.message);
      }

      // Then fetch all data
      const [watchlistRes, requestsRes, trendingRes] = await Promise.all([
        api.get('/watchlist'),
        api.get('/requests'),
        api.get('/discover/trending', { params: { media_type: 'all' } })
      ]);

      // Calculate stats from FULL data, not truncated
      const allWatchlist = watchlistRes.data;
      const allRequests = requestsRes.data;

      setStats({
        watchlistCount: allWatchlist.length,
        pendingCount: allRequests.filter(r => r.status === 'pending').length,
        processingCount: allRequests.filter(r => r.status === 'processing').length,
        // Available includes both 'available' and 'partial' status
        availableCount: allRequests.filter(r => r.status === 'available' || r.status === 'partial').length,
      });

      // Only display first 10 in UI
      setWatchlist(allWatchlist.slice(0, 10));
      setRequests(allRequests.slice(0, 10));
      setTrending(trendingRes.data.results.slice(0, 10));
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
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
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-white">
          Welcome back, {user?.username}
        </h1>
        <p className="text-slate-400 mt-1">
          Here's what's happening with your media requests
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link
          to="/watchlist"
          className="bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition-colors group"
        >
          <div className="flex items-center justify-between">
            <Heart className="h-8 w-8 text-red-400" />
            <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-primary-400 transition-colors" />
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-white">{stats.watchlistCount}</div>
            <div className="text-sm text-slate-400">On Watchlist</div>
          </div>
        </Link>

        <Link
          to="/requests"
          className="bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition-colors group"
        >
          <div className="flex items-center justify-between">
            <Clock className="h-8 w-8 text-yellow-400" />
            <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-primary-400 transition-colors" />
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-white">{stats.pendingCount}</div>
            <div className="text-sm text-slate-400">Pending</div>
          </div>
        </Link>

        <Link
          to="/requests?status=processing"
          className="bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition-colors group"
        >
          <div className="flex items-center justify-between">
            <Download className="h-8 w-8 text-blue-400" />
            <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-primary-400 transition-colors" />
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-white">{stats.processingCount}</div>
            <div className="text-sm text-slate-400">Downloading</div>
          </div>
        </Link>

        <Link
          to="/requests?status=available"
          className="bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition-colors group"
        >
          <div className="flex items-center justify-between">
            <CheckCircle className="h-8 w-8 text-green-400" />
            <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-primary-400 transition-colors" />
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-white">{stats.availableCount}</div>
            <div className="text-sm text-slate-400">Available</div>
          </div>
        </Link>
      </div>

      {/* My Watchlist */}
      {watchlist.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white flex items-center space-x-2">
              <Heart className="h-5 w-5 text-red-400" />
              <span>My Watchlist</span>
            </h2>
            <Link
              to="/watchlist"
              className="text-sm text-primary-400 hover:text-primary-300 flex items-center space-x-1"
            >
              <span>View All</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <HorizontalScroll>
            {watchlist.map(item => (
              <div key={`${item.media_type}-${item.tmdb_id}`} className="relative flex-shrink-0" style={{ width: '140px' }}>
                <MediaCard
                  item={{
                    ...item,
                    id: item.tmdb_id,
                    vote_average: null
                  }}
                  size="small"
                />
                <div className="absolute top-2 right-2">
                  <StatusBadge status={item.request_status} />
                </div>
              </div>
            ))}
          </HorizontalScroll>
        </div>
      )}

      {/* Recent Requests */}
      {requests.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white flex items-center space-x-2">
              <Clock className="h-5 w-5 text-primary-400" />
              <span>Recent Requests</span>
            </h2>
            <Link
              to="/requests"
              className="text-sm text-primary-400 hover:text-primary-300 flex items-center space-x-1"
            >
              <span>View All</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="bg-slate-800 rounded-lg divide-y divide-slate-700">
            {requests.slice(0, 5).map(request => (
              <Link
                key={request.id}
                to={`/discover/${request.media_type}/${request.tmdb_id}`}
                className="flex items-center p-3 hover:bg-slate-700 transition-colors"
              >
                {request.poster_path ? (
                  <img
                    src={request.poster_path}
                    alt={request.title}
                    className="w-10 h-15 object-cover rounded"
                  />
                ) : (
                  <div className="w-10 h-15 bg-slate-700 rounded flex items-center justify-center">
                    {request.media_type === 'movie' ? (
                      <Film className="h-4 w-4 text-slate-500" />
                    ) : (
                      <Tv className="h-4 w-4 text-slate-500" />
                    )}
                  </div>
                )}
                <div className="flex-1 ml-3 min-w-0">
                  <p className="text-white font-medium truncate">{request.title}</p>
                  <p className="text-slate-500 text-xs">
                    {new Date(request.added_at).toLocaleDateString()}
                  </p>
                </div>
                <StatusBadge status={request.status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Trending */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white flex items-center space-x-2">
            <TrendingUp className="h-5 w-5 text-orange-400" />
            <span>Trending This Week</span>
          </h2>
          <Link
            to="/discover"
            className="text-sm text-primary-400 hover:text-primary-300 flex items-center space-x-1"
          >
            <span>Discover More</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <HorizontalScroll>
          {trending.map(item => (
            <MediaCard key={`${item.media_type}-${item.id}`} item={item} />
          ))}
        </HorizontalScroll>
      </div>

      {/* Empty State for new users */}
      {watchlist.length === 0 && requests.length === 0 && (
        <div className="text-center py-12 bg-slate-800 rounded-lg">
          <div className="w-20 h-20 rounded-full bg-slate-700 flex items-center justify-center mx-auto mb-4">
            <Compass className="h-10 w-10 text-primary-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Ready to discover?</h2>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            Start by exploring trending movies and TV shows. Add content to your watchlist
            and Flexerr will automatically request it for you.
          </p>
          <Link to="/discover" className="btn btn-primary">
            Start Exploring
          </Link>
        </div>
      )}
    </div>
  );
}
