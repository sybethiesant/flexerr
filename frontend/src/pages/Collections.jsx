import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../App';
import {
  Loader2, Trash2, Shield, Clock, Filter, Search, X,
  ChevronDown, ChevronUp, RefreshCw, AlertTriangle, FlaskConical,
  LayoutGrid, List, ChevronLeft, ChevronRight
} from 'lucide-react';

const ITEMS_PER_PAGE = 24;

export default function Collections() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [actionLoading, setActionLoading] = useState(null);
  const [isDryRunMode, setIsDryRunMode] = useState(false);

  // New state for search, sort, pagination, and view
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('daysRemaining'); // daysRemaining, title, addedAt
  const [sortOrder, setSortOrder] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState('grid'); // grid or list
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all'); // all, movie, episode, show

  const loadItems = async () => {
    try {
      const [queueRes, settingsRes] = await Promise.all([
        api.get('/queue', { params: { status: filter || undefined } }),
        api.get('/settings')
      ]);
      setItems(queueRes.data);
      setIsDryRunMode(settingsRes.data.dry_run === 'true');
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, [filter]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, mediaTypeFilter, sortBy, sortOrder, filter]);

  // Filter and sort items
  const filteredAndSortedItems = useMemo(() => {
    let result = [...items];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(item =>
        item.title?.toLowerCase().includes(query) ||
        item.rule_name?.toLowerCase().includes(query) ||
        item.media_type?.toLowerCase().includes(query)
      );
    }

    // Media type filter
    if (mediaTypeFilter !== 'all') {
      result = result.filter(item => item.media_type === mediaTypeFilter);
    }

    // Sort
    result.sort((a, b) => {
      let aVal, bVal;
      switch (sortBy) {
        case 'daysRemaining':
          aVal = a.daysRemaining ?? 999;
          bVal = b.daysRemaining ?? 999;
          break;
        case 'title':
          aVal = a.title?.toLowerCase() || '';
          bVal = b.title?.toLowerCase() || '';
          break;
        case 'addedAt':
          aVal = new Date(a.added_at).getTime();
          bVal = new Date(b.added_at).getTime();
          break;
        case 'rule':
          aVal = a.rule_name?.toLowerCase() || '';
          bVal = b.rule_name?.toLowerCase() || '';
          break;
        default:
          return 0;
      }

      if (typeof aVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [items, searchQuery, mediaTypeFilter, sortBy, sortOrder]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedItems.length / ITEMS_PER_PAGE);
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedItems.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAndSortedItems, currentPage]);

  // Stats
  const pendingItems = items.filter(i => i.status === 'pending');
  const urgentItems = pendingItems.filter(i => i.daysRemaining <= 3 && !i.is_dry_run);
  const dryRunItems = items.filter(i => i.is_dry_run);
  const realItems = pendingItems.filter(i => !i.is_dry_run);

  // Get unique media types for filter
  const mediaTypes = useMemo(() => {
    const types = new Set(items.map(i => i.media_type).filter(Boolean));
    return Array.from(types).sort();
  }, [items]);

  const saveItem = async (item) => {
    setActionLoading(item.id);
    try {
      await api.delete(`/queue/${item.id}`);
      loadItems();
    } catch (err) {
      alert('Failed to save item: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoading(null);
    }
  };

  const deleteNow = async (item) => {
    if (!window.confirm(`Delete "${item.title}" immediately? This cannot be undone.`)) return;

    setActionLoading(item.id);
    try {
      await api.post(`/queue/${item.id}/delete-now`);
      loadItems();
    } catch (err) {
      alert('Failed to delete: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoading(null);
    }
  };

  const extendBuffer = async (item, days = 7) => {
    setActionLoading(item.id);
    try {
      await api.post(`/queue/${item.id}/extend`, { days });
      loadItems();
    } catch (err) {
      alert('Failed to extend buffer: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoading(null);
    }
  };

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Dry Run Banner */}
      {isDryRunMode && (
        <div className="bg-purple-500/20 border border-purple-500/50 rounded-lg p-4 flex items-center space-x-3">
          <FlaskConical className="h-6 w-6 text-purple-400 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-purple-300">Dry Run Mode Active</h3>
            <p className="text-purple-400/80 text-sm">
              Items shown here are previews only. Nothing will be deleted until you disable dry run mode in Settings.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Leaving Soon</h1>
          <p className="text-slate-400 text-sm">
            {realItems.length} items pending
            {dryRunItems.length > 0 && (
              <span className="text-purple-400 ml-2">
                ({dryRunItems.length} dry run)
              </span>
            )}
            {urgentItems.length > 0 && (
              <span className="text-yellow-400 ml-2">
                ({urgentItems.length} urgent)
              </span>
            )}
          </p>
        </div>
        <button onClick={loadItems} className="btn btn-ghost p-2 self-end sm:self-auto">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Search and Filters Bar */}
      <div className="card p-4 space-y-4">
        {/* Search */}
        <div className="relative">
          {!searchQuery && (
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          )}
          <input
            type="text"
            placeholder="Search by title, rule, or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`input ${searchQuery ? "pl-4" : "pl-10"} pr-10 w-full transition-all`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Status Filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="input w-32"
          >
            <option value="pending">Pending</option>
            <option value="completed">Deleted</option>
            <option value="cancelled">Saved</option>
            <option value="error">Errors</option>
            <option value="">All</option>
          </select>

          {/* Media Type Filter */}
          <select
            value={mediaTypeFilter}
            onChange={(e) => setMediaTypeFilter(e.target.value)}
            className="input w-32"
          >
            <option value="all">All Types</option>
            {mediaTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-');
              setSortBy(field);
              setSortOrder(order);
            }}
            className="input w-40"
          >
            <option value="daysRemaining-asc">Days Left (Low→High)</option>
            <option value="daysRemaining-desc">Days Left (High→Low)</option>
            <option value="title-asc">Title (A→Z)</option>
            <option value="title-desc">Title (Z→A)</option>
            <option value="addedAt-desc">Newest First</option>
            <option value="addedAt-asc">Oldest First</option>
            <option value="rule-asc">Rule (A→Z)</option>
          </select>

          {/* View Mode Toggle */}
          <div className="flex items-center border border-slate-600 rounded-lg overflow-hidden ml-auto">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 ${viewMode === 'grid' ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 ${viewMode === 'list' ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Results count */}
        {(searchQuery || mediaTypeFilter !== 'all') && (
          <p className="text-slate-400 text-sm">
            Showing {filteredAndSortedItems.length} of {items.length} items
          </p>
        )}
      </div>

      {/* Content */}
      {filteredAndSortedItems.length === 0 ? (
        <div className="card p-12 text-center">
          <Shield className="h-16 w-16 text-slate-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            {searchQuery || mediaTypeFilter !== 'all' ? 'No Matching Items' : 'Queue is Empty'}
          </h2>
          <p className="text-slate-400">
            {searchQuery || mediaTypeFilter !== 'all'
              ? 'Try adjusting your search or filters.'
              : 'No content is scheduled for deletion. Your library is clean!'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        /* Grid View */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {paginatedItems.map(item => (
            <GridCard
              key={item.id}
              item={item}
              actionLoading={actionLoading}
              onSave={saveItem}
              onDelete={deleteNow}
              onExtend={extendBuffer}
            />
          ))}
        </div>
      ) : (
        /* List View */
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="text-left p-3 text-sm font-medium text-slate-300">Title</th>
                <th className="text-left p-3 text-sm font-medium text-slate-300 hidden sm:table-cell">Type</th>
                <th className="text-left p-3 text-sm font-medium text-slate-300 hidden md:table-cell">Rule</th>
                <th className="text-center p-3 text-sm font-medium text-slate-300">Days</th>
                <th className="text-center p-3 text-sm font-medium text-slate-300">Status</th>
                <th className="text-right p-3 text-sm font-medium text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {paginatedItems.map(item => (
                <ListRow
                  key={item.id}
                  item={item}
                  actionLoading={actionLoading}
                  onSave={saveItem}
                  onDelete={deleteNow}
                  onExtend={extendBuffer}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center space-x-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="btn btn-ghost p-2 disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="flex items-center space-x-1">
            {/* First page */}
            {currentPage > 3 && (
              <>
                <button
                  onClick={() => setCurrentPage(1)}
                  className="btn btn-ghost px-3 py-1 text-sm"
                >
                  1
                </button>
                {currentPage > 4 && <span className="text-slate-500">...</span>}
              </>
            )}

            {/* Page numbers around current */}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(page => Math.abs(page - currentPage) <= 2)
              .map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`btn px-3 py-1 text-sm ${
                    page === currentPage ? 'btn-primary' : 'btn-ghost'
                  }`}
                >
                  {page}
                </button>
              ))}

            {/* Last page */}
            {currentPage < totalPages - 2 && (
              <>
                {currentPage < totalPages - 3 && <span className="text-slate-500">...</span>}
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  className="btn btn-ghost px-3 py-1 text-sm"
                >
                  {totalPages}
                </button>
              </>
            )}
          </div>

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="btn btn-ghost p-2 disabled:opacity-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <span className="text-slate-400 text-sm ml-4">
            Page {currentPage} of {totalPages}
          </span>
        </div>
      )}
    </div>
  );
}

// Grid Card Component
function GridCard({ item, actionLoading, onSave, onDelete, onExtend }) {
  return (
    <div
      className={`card overflow-hidden ${
        item.is_dry_run ? 'border-purple-500/50 opacity-80' :
        item.status === 'cancelled' ? 'opacity-60' :
        item.status === 'error' ? 'border-red-500/50' :
        item.daysRemaining <= 3 ? 'border-yellow-500/50' : ''
      }`}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-slate-700">
        {item.poster_url ? (
          <img
            src={item.poster_url}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-2xl text-slate-600">?</span>
          </div>
        )}

        {/* Dry Run Badge */}
        {!!item.is_dry_run && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-xs font-medium bg-purple-500 text-white flex items-center space-x-1">
            <FlaskConical className="h-3 w-3" />
            <span>DRY</span>
          </div>
        )}

        {/* Countdown/Status Badge */}
        {item.status === 'pending' ? (
          <div className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-xs font-medium ${
            item.is_dry_run
              ? 'bg-purple-900/80 text-purple-200'
              : item.daysRemaining <= 3
                ? 'bg-yellow-500 text-yellow-900'
                : 'bg-slate-900/80 text-white'
          }`}>
            {item.daysRemaining}d
          </div>
        ) : (
          <div className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-xs font-medium ${
            item.status === 'completed' ? 'bg-green-500 text-white' :
            item.status === 'cancelled' ? 'bg-blue-500 text-white' :
            'bg-red-500 text-white'
          }`}>
            {item.status === 'completed' ? 'Done' :
             item.status === 'cancelled' ? 'Saved' : 'Err'}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2">
        <h3 className="font-medium text-sm truncate" title={item.title}>
          {item.title}
        </h3>
        <p className="text-slate-400 text-xs truncate">
          {item.year && `${item.year} • `}{item.media_type}
        </p>
        {item.rule_name && (
          <p className="text-primary-400/80 text-xs truncate mt-0.5" title={`Rule: ${item.rule_name}`}>
            {item.rule_name}
          </p>
        )}

        {/* Actions */}
        {item.status === 'pending' && (
          <div className="flex items-center space-x-1 mt-2">
            <button
              onClick={() => onSave(item)}
              disabled={actionLoading === item.id}
              className="btn btn-secondary flex-1 text-xs py-1"
            >
              {actionLoading === item.id ? (
                <Loader2 className="h-3 w-3 animate-spin mx-auto" />
              ) : (
                'Save'
              )}
            </button>
            <button
              onClick={() => onExtend(item)}
              disabled={actionLoading === item.id}
              className="btn btn-ghost p-1"
              title="Extend 7 days"
            >
              <Clock className="h-3 w-3" />
            </button>
            <button
              onClick={() => onDelete(item)}
              disabled={actionLoading === item.id}
              className="btn btn-ghost p-1 text-red-400"
              title="Delete now"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// List Row Component
function ListRow({ item, actionLoading, onSave, onDelete, onExtend }) {
  return (
    <tr className={`hover:bg-slate-700/30 ${
      item.is_dry_run ? 'bg-purple-500/10' :
      item.status === 'cancelled' ? 'opacity-60' :
      item.status === 'error' ? 'bg-red-500/10' :
      item.daysRemaining <= 3 ? 'bg-yellow-500/10' : ''
    }`}>
      <td className="p-3">
        <div className="flex items-center space-x-3">
          {item.poster_url && (
            <img
              src={item.poster_url}
              alt=""
              className="w-8 h-12 object-cover rounded hidden sm:block"
              loading="lazy"
            />
          )}
          <div>
            <p className="font-medium truncate max-w-[200px] sm:max-w-[300px]" title={item.title}>
              {item.title}
            </p>
            <p className="text-slate-400 text-xs">
              {item.year}
            </p>
          </div>
        </div>
      </td>
      <td className="p-3 text-sm text-slate-300 hidden sm:table-cell">
        {item.media_type}
      </td>
      <td className="p-3 text-sm text-slate-400 hidden md:table-cell truncate max-w-[150px]" title={item.rule_name}>
        {item.rule_name}
      </td>
      <td className="p-3 text-center">
        {item.status === 'pending' && (
          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
            item.is_dry_run
              ? 'bg-purple-500/20 text-purple-300'
              : item.daysRemaining <= 3
                ? 'bg-yellow-500/20 text-yellow-300'
                : 'bg-slate-600 text-slate-300'
          }`}>
            {item.daysRemaining}d
          </span>
        )}
      </td>
      <td className="p-3 text-center">
        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-medium ${
          item.is_dry_run ? 'bg-purple-500/20 text-purple-300' :
          item.status === 'pending' ? 'bg-slate-600 text-slate-300' :
          item.status === 'completed' ? 'bg-green-500/20 text-green-300' :
          item.status === 'cancelled' ? 'bg-blue-500/20 text-blue-300' :
          'bg-red-500/20 text-red-300'
        }`}>
          {!!item.is_dry_run && <FlaskConical className="h-3 w-3" />}
          <span>
            {item.is_dry_run ? 'Dry Run' :
             item.status === 'pending' ? 'Pending' :
             item.status === 'completed' ? 'Deleted' :
             item.status === 'cancelled' ? 'Saved' : 'Error'}
          </span>
        </span>
      </td>
      <td className="p-3">
        {item.status === 'pending' && (
          <div className="flex items-center justify-end space-x-1">
            <button
              onClick={() => onSave(item)}
              disabled={actionLoading === item.id}
              className="btn btn-secondary text-xs py-1 px-2"
            >
              {actionLoading === item.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                'Save'
              )}
            </button>
            <button
              onClick={() => onExtend(item)}
              disabled={actionLoading === item.id}
              className="btn btn-ghost p-1.5"
              title="Extend 7 days"
            >
              <Clock className="h-3 w-3" />
            </button>
            <button
              onClick={() => onDelete(item)}
              disabled={actionLoading === item.id}
              className="btn btn-ghost p-1.5 text-red-400"
              title="Delete now"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
