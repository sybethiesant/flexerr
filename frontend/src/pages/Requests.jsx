import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, useAuth } from '../App';
import {
  Clock, Film, Tv, Loader2, CheckCircle, Download, XCircle,
  Filter, User
} from 'lucide-react';
import { RepairButton } from '../components/RepairButton';

function StatusBadge({ status }) {
  const config = {
    pending: { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Clock, text: 'Pending' },
    processing: { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Download, text: 'Downloading' },
    partial: { color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: Download, text: 'Partial' },
    available: { color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle, text: 'Available' },
    unavailable: { color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: XCircle, text: 'Unavailable' },
  };
  const { color, icon: Icon, text } = config[status] || config.pending;

  return (
    <span className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-sm border ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      <span>{text}</span>
    </span>
  );
}

export default function Requests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, pending, processing, available
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all'); // all, movie, tv
  const [userFilter, setUserFilter] = useState('all'); // all or username

  useEffect(() => {
    fetchRequests();
    if (user?.is_admin) {
      fetchUsers();
    }
  }, [user?.is_admin]);

  const fetchRequests = async () => {
    try {
      const res = await api.get('/requests');
      setRequests(res.data);
    } catch (err) {
      console.error('Error fetching requests:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  };

  const filteredRequests = requests.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (mediaTypeFilter !== 'all' && r.media_type !== mediaTypeFilter) return false;
    if (userFilter !== 'all' && r.requested_by !== userFilter) return false;
    return true;
  });

  const stats = {
    pending: requests.filter(r => r.status === 'pending').length,
    processing: requests.filter(r => r.status === 'processing').length,
    available: requests.filter(r => r.status === 'available').length,
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
      <div>
        <h1 className="text-2xl font-bold text-white">
          {user?.is_admin
            ? (userFilter !== 'all' ? `${userFilter}'s Requests` : 'All Requests')
            : 'My Requests'
          }
        </h1>
        <p className="text-slate-400 mt-1">
          {user?.is_admin
            ? (userFilter !== 'all' ? `Viewing requests from ${userFilter}` : 'Manage all user media requests')
            : 'Track your media requests and their status'
          }
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <button
          onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
          className={`p-4 rounded-lg text-center transition-all ${
            filter === 'pending'
              ? 'bg-yellow-500/20 ring-2 ring-yellow-500'
              : 'bg-slate-800 hover:bg-slate-700'
          }`}
        >
          <div className="text-2xl font-bold text-yellow-400">{stats.pending}</div>
          <div className="text-sm text-slate-400">Pending</div>
        </button>
        <button
          onClick={() => setFilter(filter === 'processing' ? 'all' : 'processing')}
          className={`p-4 rounded-lg text-center transition-all ${
            filter === 'processing'
              ? 'bg-blue-500/20 ring-2 ring-blue-500'
              : 'bg-slate-800 hover:bg-slate-700'
          }`}
        >
          <div className="text-2xl font-bold text-blue-400">{stats.processing}</div>
          <div className="text-sm text-slate-400">Downloading</div>
        </button>
        <button
          onClick={() => setFilter(filter === 'available' ? 'all' : 'available')}
          className={`p-4 rounded-lg text-center transition-all ${
            filter === 'available'
              ? 'bg-green-500/20 ring-2 ring-green-500'
              : 'bg-slate-800 hover:bg-slate-700'
          }`}
        >
          <div className="text-2xl font-bold text-green-400">{stats.available}</div>
          <div className="text-sm text-slate-400">Available</div>
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center flex-wrap gap-4">
        <div className="flex items-center space-x-2 text-slate-400">
          <Filter className="h-4 w-4" />
          <span className="text-sm">Filter:</span>
        </div>
        <div className="flex bg-slate-800 rounded-lg p-1">
          {[
            { id: 'all', label: 'All' },
            { id: 'movie', label: 'Movies' },
            { id: 'tv', label: 'TV Shows' },
          ].map(type => (
            <button
              key={type.id}
              onClick={() => setMediaTypeFilter(type.id)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                mediaTypeFilter === type.id
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
        {/* User Filter (Admin Only) */}
        {user?.is_admin && users.length > 0 && (
          <div className="flex items-center space-x-2">
            <User className="h-4 w-4 text-slate-400" />
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Users</option>
              {users.map(u => (
                <option key={u.id} value={u.username}>{u.username}</option>
              ))}
            </select>
          </div>
        )}
        {(filter !== 'all' || userFilter !== 'all') && (
          <button
            onClick={() => { setFilter('all'); setUserFilter('all'); }}
            className="text-sm text-primary-400 hover:text-primary-300"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Empty State */}
      {filteredRequests.length === 0 && (
        <div className="text-center py-16">
          <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <Clock className="h-10 w-10 text-slate-600" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">
            {requests.length === 0 ? 'No requests yet' : 'No matching requests'}
          </h2>
          <p className="text-slate-400 mb-6">
            {requests.length === 0
              ? 'Add content to your watchlist to start requesting'
              : 'Try adjusting your filters'
            }
          </p>
          {requests.length === 0 && (
            <Link to="/discover" className="btn btn-primary">
              Discover Content
            </Link>
          )}
        </div>
      )}

      {/* Requests List */}
      {filteredRequests.length > 0 && (
        <div className="space-y-3">
          {filteredRequests.map(request => (
            <Link
              key={request.id}
              to={`/discover/${request.media_type}/${request.tmdb_id}`}
              className="flex items-center bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition-colors group"
            >
              {/* Poster */}
              {request.poster_path ? (
                <img
                  src={request.poster_path}
                  alt={request.title}
                  className="w-16 h-24 object-cover rounded flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-24 bg-slate-700 rounded flex items-center justify-center flex-shrink-0">
                  {request.media_type === 'movie' ? (
                    <Film className="h-6 w-6 text-slate-500" />
                  ) : (
                    <Tv className="h-6 w-6 text-slate-500" />
                  )}
                </div>
              )}

              {/* Info */}
              <div className="flex-1 ml-4 min-w-0">
                <h3 className="font-medium text-white group-hover:text-primary-400 transition-colors truncate">
                  {request.title}
                </h3>
                <div className="flex items-center space-x-3 mt-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    request.media_type === 'movie'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-purple-500/20 text-purple-400'
                  }`}>
                    {request.media_type === 'movie' ? 'Movie' : 'TV'}
                  </span>
                  {request.year && (
                    <span className="text-slate-500 text-sm">{request.year}</span>
                  )}
                </div>
                {user?.is_admin && request.requested_by && (
                  <div className="flex items-center space-x-1 mt-2 text-slate-500 text-sm">
                    <User className="h-3 w-3" />
                    <span>Requested by {request.requested_by}</span>
                  </div>
                )}
                <div className="text-slate-500 text-xs mt-1">
                  Requested {new Date(request.added_at).toLocaleDateString()}
                  {request.available_at && (
                    <span> | Available {new Date(request.available_at).toLocaleDateString()}</span>
                  )}
                </div>
              </div>

              {/* Status & Repair */}
              <div className="ml-4 flex-shrink-0 flex items-center space-x-2">
                {request.status === 'available' && (
                  <RepairButton
                    tmdbId={request.tmdb_id}
                    mediaType={request.media_type}
                    title={request.title}
                    size="small"
                  />
                )}
                <StatusBadge status={request.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
