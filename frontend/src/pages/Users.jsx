import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, useAuth } from '../App';
import {
  Users as UsersIcon, Shield, ShieldCheck, Crown, Loader2,
  AlertCircle, CheckCircle, Clock, Mail, User, Heart, X,
  Film, Tv, Download
} from 'lucide-react';

function WatchlistModal({ user, onClose }) {
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWatchlist();
  }, [user.id]);

  const fetchWatchlist = async () => {
    try {
      const res = await api.get(`/users/${user.id}/watchlist`);
      setWatchlist(res.data.watchlist);
    } catch (err) {
      console.error('Error fetching watchlist:', err);
    } finally {
      setLoading(false);
    }
  };

  const activeItems = watchlist.filter(w => w.is_active);
  const inactiveItems = watchlist.filter(w => !w.is_active);

  const getStatusBadge = (status) => {
    const config = {
      pending: { color: 'bg-yellow-500/20 text-yellow-400', icon: Clock, text: 'Pending' },
      processing: { color: 'bg-blue-500/20 text-blue-400', icon: Download, text: 'Downloading' },
      partial: { color: 'bg-amber-500/20 text-amber-400', icon: Download, text: 'Partial' },
      available: { color: 'bg-green-500/20 text-green-400', icon: CheckCircle, text: 'Available' },
    };
    const { color, icon: Icon, text } = config[status] || config.pending;
    return (
      <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs ${color}`}>
        <Icon className="h-3 w-3" />
        <span>{text}</span>
      </span>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-slate-800 rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center space-x-3">
            <Heart className="h-5 w-5 text-red-400" />
            <h2 className="text-lg font-semibold text-white">{user.username}'s Watchlist</h2>
            <span className="text-sm text-slate-400">({activeItems.length} active)</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 text-primary-500 animate-spin" />
            </div>
          ) : watchlist.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              No items in watchlist
            </div>
          ) : (
            <div className="space-y-4">
              {/* Active Items */}
              {activeItems.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-slate-300 mb-2">Active ({activeItems.length})</h3>
                  <div className="space-y-2">
                    {activeItems.map(item => (
                      <Link
                        key={item.id}
                        to={`/discover/${item.media_type}/${item.tmdb_id}`}
                        className="flex items-center space-x-3 p-2 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors"
                      >
                        {item.poster_path ? (
                          <img src={item.poster_path} alt="" className="w-10 h-14 object-cover rounded" />
                        ) : (
                          <div className="w-10 h-14 bg-slate-600 rounded flex items-center justify-center">
                            {item.media_type === 'movie' ? <Film className="h-4 w-4 text-slate-400" /> : <Tv className="h-4 w-4 text-slate-400" />}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium truncate">{item.title}</p>
                          <div className="flex items-center space-x-2 text-xs text-slate-400">
                            <span className={item.media_type === 'movie' ? 'text-blue-400' : 'text-purple-400'}>
                              {item.media_type === 'movie' ? 'Movie' : 'TV'}
                            </span>
                            <span>•</span>
                            <span>Added {new Date(item.added_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        {getStatusBadge(item.request_status)}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Inactive Items */}
              {inactiveItems.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-slate-500 mb-2">Removed ({inactiveItems.length})</h3>
                  <div className="space-y-2 opacity-60">
                    {inactiveItems.map(item => (
                      <div
                        key={item.id}
                        className="flex items-center space-x-3 p-2 bg-slate-700/30 rounded-lg"
                      >
                        <div className="w-10 h-14 bg-slate-600/50 rounded flex items-center justify-center">
                          {item.media_type === 'movie' ? <Film className="h-4 w-4 text-slate-500" /> : <Tv className="h-4 w-4 text-slate-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-400 font-medium truncate">{item.title}</p>
                          <div className="flex items-center space-x-2 text-xs text-slate-500">
                            <span>{item.media_type === 'movie' ? 'Movie' : 'TV'}</span>
                            <span>•</span>
                            <span>Removed {item.removed_at ? new Date(item.removed_at).toLocaleDateString() : 'N/A'}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updating, setUpdating] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await api.get('/users');
      setUsers(response.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const toggleAdmin = async (userId, currentStatus) => {
    try {
      setUpdating(userId);
      await api.put(`/users/${userId}`, { is_admin: !currentStatus });
      setUsers(users.map(u =>
        u.id === userId ? { ...u, is_admin: !currentStatus } : u
      ));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update user');
    } finally {
      setUpdating(null);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-12 w-12 text-primary-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center space-x-3">
        <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
        <span className="text-red-400">{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center space-x-2">
            <UsersIcon className="h-7 w-7 text-primary-400" />
            <span>User Management</span>
          </h1>
          <p className="text-slate-400 mt-1">
            Manage user permissions and access
          </p>
        </div>
        <div className="bg-slate-800 rounded-lg px-4 py-2">
          <span className="text-slate-400 text-sm">{users.length} users</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center space-x-2">
          <Crown className="h-4 w-4 text-yellow-400" />
          <span className="text-slate-400">Server Owner</span>
        </div>
        <div className="flex items-center space-x-2">
          <ShieldCheck className="h-4 w-4 text-primary-400" />
          <span className="text-slate-400">Admin</span>
        </div>
        <div className="flex items-center space-x-2">
          <User className="h-4 w-4 text-slate-400" />
          <span className="text-slate-400">Regular User</span>
        </div>
      </div>

      {/* Users List */}
      <div className="bg-slate-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-700/50">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-300">User</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-300 hidden md:table-cell">Email</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-300 hidden lg:table-cell">Last Login</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-slate-300 hidden lg:table-cell">Joined</th>
              <th className="text-center px-4 py-3 text-sm font-medium text-slate-300">Role</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-slate-700/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center space-x-3">
                    {user.thumb ? (
                      <img
                        src={user.thumb}
                        alt={user.username}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center">
                        <User className="h-5 w-5 text-slate-400" />
                      </div>
                    )}
                    <div>
                      <p className="text-white font-medium flex items-center space-x-2">
                        <span>{user.username}</span>
                        {user.id === currentUser?.id && (
                          <span className="text-xs bg-primary-500/20 text-primary-400 px-2 py-0.5 rounded">
                            You
                          </span>
                        )}
                      </p>
                      <p className="text-slate-500 text-sm md:hidden">{user.email || 'No email'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <div className="flex items-center space-x-2 text-slate-400">
                    <Mail className="h-4 w-4" />
                    <span>{user.email || 'No email'}</span>
                  </div>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <div className="flex items-center space-x-2 text-slate-400 text-sm">
                    <Clock className="h-4 w-4" />
                    <span>{formatDate(user.last_login)}</span>
                  </div>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <span className="text-slate-400 text-sm">{formatDate(user.created_at)}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  {user.is_owner ? (
                    <span className="inline-flex items-center space-x-1 bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded text-sm">
                      <Crown className="h-3 w-3" />
                      <span>Owner</span>
                    </span>
                  ) : user.is_admin ? (
                    <span className="inline-flex items-center space-x-1 bg-primary-500/20 text-primary-400 px-2 py-1 rounded text-sm">
                      <ShieldCheck className="h-3 w-3" />
                      <span>Admin</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center space-x-1 bg-slate-600/50 text-slate-400 px-2 py-1 rounded text-sm">
                      <User className="h-3 w-3" />
                      <span>User</span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end space-x-2">
                    <button
                      onClick={() => setSelectedUser(user)}
                      className="px-3 py-1.5 rounded text-sm font-medium bg-slate-600/50 text-slate-300 hover:bg-slate-600 transition-colors"
                    >
                      <Heart className="h-4 w-4 inline mr-1" />
                      Watchlist
                    </button>
                    {user.is_owner ? (
                      <span className="text-slate-500 text-sm px-3">Protected</span>
                    ) : (
                      <button
                        onClick={() => toggleAdmin(user.id, user.is_admin)}
                        disabled={updating === user.id}
                        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                          user.is_admin
                            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                            : 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {updating === user.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : user.is_admin ? (
                          'Remove Admin'
                        ) : (
                          'Make Admin'
                        )}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Info Box */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <h3 className="text-white font-medium mb-2 flex items-center space-x-2">
          <Shield className="h-4 w-4 text-primary-400" />
          <span>About Permissions</span>
        </h3>
        <ul className="text-slate-400 text-sm space-y-1">
          <li><strong className="text-slate-300">Server Owner:</strong> The Plex server owner. Always has admin privileges and cannot be demoted.</li>
          <li><strong className="text-slate-300">Admin:</strong> Can access settings, manage services, view logs, and manage other users.</li>
          <li><strong className="text-slate-300">Regular User:</strong> Can browse, add to watchlist, and view their own requests.</li>
        </ul>
      </div>

      {/* Watchlist Modal */}
      {selectedUser && (
        <WatchlistModal user={selectedUser} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
}
