import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../App';
import {
  TrendingUp, Star, Film, Tv, Loader2, ChevronLeft, ChevronRight,
  SlidersHorizontal, X, Calendar, Clock, ArrowUpDown, Globe, Search
} from 'lucide-react';
import PlatformBar from '../components/PlatformBar';
import FilterDropdown, { RangeSlider } from '../components/FilterDropdown';

// Default enabled provider IDs (popular US streaming services)
const DEFAULT_ENABLED_PROVIDER_IDS = [8, 9, 337, 1899, 15, 386, 350, 2303, 283];

// Debounce hook
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// Media card component
function MediaCard({ item, providers }) {
  return (
    <Link
      to={`/discover/${item.media_type}/${item.id}`}
      className="group relative bg-slate-800 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all"
    >
      <div className="aspect-[2/3] relative overflow-hidden">
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
              <Film className="h-12 w-12 text-slate-500" />
            ) : (
              <Tv className="h-12 w-12 text-slate-500" />
            )}
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        {/* Description on hover */}
        <div className="absolute inset-x-0 bottom-0 p-3 transform translate-y-full group-hover:translate-y-0 transition-transform duration-200">
          <p className="text-white text-sm line-clamp-4">{item.overview || 'No description available.'}</p>
        </div>
      </div>
      <div className="p-3">
        <h3 className="font-medium text-white truncate">{item.title}</h3>
        <div className="flex items-center justify-between mt-1">
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            item.media_type === 'movie' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
          }`}>
            {item.media_type === 'movie' ? 'Movie' : 'TV'}
          </span>
          <div className="flex items-center space-x-1 text-sm text-slate-400">
            {item.vote_average > 0 && (
              <>
                <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                <span>{item.vote_average.toFixed(1)}</span>
              </>
            )}
            {item.year && <span>({item.year})</span>}
          </div>
        </div>
        {/* Provider icons */}
        {item.providers && item.providers.length > 0 && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {item.providers.slice(0, 4).map(p => (
              <img
                key={p.id}
                src={p.logo_path}
                alt={p.name}
                title={p.name}
                className="w-5 h-5 rounded"
              />
            ))}
            {item.providers.length > 4 && (
              <span className="text-xs text-slate-400">+{item.providers.length - 4}</span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}

// Media grid component - uses auto-fill to avoid blank spaces
function MediaGrid({ items, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {[...Array(20)].map((_, i) => (
          <div key={i} className="bg-slate-800 rounded-lg overflow-hidden animate-pulse">
            <div className="aspect-[2/3] bg-slate-700" />
            <div className="p-3 space-y-2">
              <div className="h-4 bg-slate-700 rounded w-3/4" />
              <div className="h-3 bg-slate-700 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <Film className="w-16 h-16 mx-auto mb-4 opacity-50" />
        <p className="text-lg">No results found</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {items.map(item => (
        <MediaCard key={`${item.media_type}-${item.id}`} item={item} />
      ))}
    </div>
  );
}

// Mobile filter drawer
function FilterDrawer({ isOpen, onClose, children }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="absolute inset-y-0 right-0 w-full max-w-sm bg-slate-900 shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Filters</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-6">
          {children}
        </div>
      </div>
    </div>
  );
}

// Sort options
const SORT_OPTIONS = [
  { value: 'popularity.desc', label: 'Most Popular' },
  { value: 'popularity.asc', label: 'Least Popular' },
  { value: 'vote_average.desc', label: 'Highest Rated' },
  { value: 'vote_average.asc', label: 'Lowest Rated' },
  { value: 'primary_release_date.desc', label: 'Newest First' },
  { value: 'primary_release_date.asc', label: 'Oldest First' },
];

// Current year for range
const CURRENT_YEAR = new Date().getFullYear();

export default function Discover() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Parse filters from URL
  const parseUrlFilters = useCallback(() => {
    return {
      query: searchParams.get('q') || '',
      type: searchParams.get('type') || 'movie',
      providers: searchParams.get('providers')?.split(',').map(Number).filter(Boolean) || [],
      genres: searchParams.get('genres')?.split(',').map(Number).filter(Boolean) || [],
      yearMin: parseInt(searchParams.get('year_min')) || 1900,
      yearMax: parseInt(searchParams.get('year_max')) || CURRENT_YEAR,
      ratingMin: parseFloat(searchParams.get('rating_min')) || 0,
      ratingMax: parseFloat(searchParams.get('rating_max')) || 10,
      sort: searchParams.get('sort') || 'popularity.desc',
      region: searchParams.get('region') || 'US',
      page: parseInt(searchParams.get('page')) || 1,
    };
  }, [searchParams]);

  const [filters, setFilters] = useState(parseUrlFilters);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Data states
  const [providers, setProviders] = useState([]);
  const [enabledProviderIds, setEnabledProviderIds] = useState(DEFAULT_ENABLED_PROVIDER_IDS);
  const [genres, setGenres] = useState([]);
  const [regions, setRegions] = useState([]);
  const [content, setContent] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);

  // Loading states
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loadingGenres, setLoadingGenres] = useState(true);
  const [loadingContent, setLoadingContent] = useState(true);

  // Debounce filters for API calls
  const debouncedFilters = useDebounce(filters, 300);

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams();

    if (filters.query) params.set('q', filters.query);
    if (filters.type !== 'movie') params.set('type', filters.type);
    if (filters.providers.length) params.set('providers', filters.providers.join(','));
    if (filters.genres.length) params.set('genres', filters.genres.join(','));
    if (filters.yearMin !== 1900) params.set('year_min', filters.yearMin.toString());
    if (filters.yearMax !== CURRENT_YEAR) params.set('year_max', filters.yearMax.toString());
    if (filters.ratingMin > 0) params.set('rating_min', filters.ratingMin.toString());
    if (filters.ratingMax < 10) params.set('rating_max', filters.ratingMax.toString());
    if (filters.sort !== 'popularity.desc') params.set('sort', filters.sort);
    if (filters.region !== 'US') params.set('region', filters.region);
    if (filters.page > 1) params.set('page', filters.page.toString());

    setSearchParams(params, { replace: true });
  }, [filters, setSearchParams]);

  // Fetch enabled provider IDs from settings (once on mount)
  useEffect(() => {
    const fetchEnabledProviders = async () => {
      try {
        const res = await api.get('/discover/enabled-providers');
        if (res.data.providerIds && res.data.providerIds.length > 0) {
          setEnabledProviderIds(res.data.providerIds);
        }
      } catch (err) {
        // Use defaults if settings not available
        console.warn('Using default providers:', err.message);
      }
    };
    fetchEnabledProviders();
  }, []);

  // Fetch providers (filtered to enabled only)
  useEffect(() => {
    const fetchProviders = async () => {
      setLoadingProviders(true);
      try {
        const res = await api.get('/discover/providers', {
          params: { type: filters.type, region: filters.region }
        });
        // Filter to only show enabled providers
        const allProviders = res.data.providers || [];
        const enabled = allProviders.filter(p => enabledProviderIds.includes(p.id));
        // Sort by enabled order (maintain admin's selection order) then by display_priority
        const enabledOrder = new Map(enabledProviderIds.map((id, idx) => [id, idx]));
        enabled.sort((a, b) => {
          const orderA = enabledOrder.get(a.id) ?? 999;
          const orderB = enabledOrder.get(b.id) ?? 999;
          if (orderA !== orderB) return orderA - orderB;
          return (a.display_priority || 0) - (b.display_priority || 0);
        });
        setProviders(enabled);
      } catch (err) {
        console.error('Failed to fetch providers:', err);
      } finally {
        setLoadingProviders(false);
      }
    };
    fetchProviders();
  }, [filters.type, filters.region, enabledProviderIds]);

  // Fetch genres
  useEffect(() => {
    const fetchGenres = async () => {
      setLoadingGenres(true);
      try {
        const res = await api.get('/discover/genres', {
          params: { type: filters.type }
        });
        setGenres(res.data || []);
      } catch (err) {
        console.error('Failed to fetch genres:', err);
      } finally {
        setLoadingGenres(false);
      }
    };
    fetchGenres();
  }, [filters.type]);

  // Fetch regions (once)
  useEffect(() => {
    const fetchRegions = async () => {
      try {
        const res = await api.get('/discover/regions');
        setRegions(res.data || []);
      } catch (err) {
        console.error('Failed to fetch regions:', err);
      }
    };
    fetchRegions();
  }, []);

  // Fetch content
  useEffect(() => {
    const fetchContent = async () => {
      setLoadingContent(true);
      try {
        // If there's a search query, use search endpoint
        if (debouncedFilters.query) {
          const res = await api.get('/discover/search', {
            params: {
              q: debouncedFilters.query,
              page: debouncedFilters.page,
              media_type: debouncedFilters.type !== 'all' ? debouncedFilters.type : undefined
            }
          });
          setContent(res.data.results || []);
          setTotalPages(Math.min(res.data.total_pages || 1, 500));
          setTotalResults(res.data.total_results || 0);
        } else {
          // Use discover endpoint with filters
          const params = {
            type: debouncedFilters.type,
            page: debouncedFilters.page,
            sort: debouncedFilters.sort,
            region: debouncedFilters.region
          };

          if (debouncedFilters.providers.length) {
            params.providers = debouncedFilters.providers.join(',');
          }
          if (debouncedFilters.genres.length) {
            params.genres = debouncedFilters.genres.join(',');
          }
          if (debouncedFilters.yearMin > 1900) {
            params.year_min = debouncedFilters.yearMin;
          }
          if (debouncedFilters.yearMax < CURRENT_YEAR) {
            params.year_max = debouncedFilters.yearMax;
          }
          if (debouncedFilters.ratingMin > 0) {
            params.rating_min = debouncedFilters.ratingMin;
          }
          if (debouncedFilters.ratingMax < 10) {
            params.rating_max = debouncedFilters.ratingMax;
          }

          const res = await api.get('/discover', { params });
          setContent(res.data.results || []);
          setTotalPages(Math.min(res.data.total_pages || 1, 500));
          setTotalResults(res.data.total_results || 0);
        }
      } catch (err) {
        console.error('Failed to fetch content:', err);
        setContent([]);
      } finally {
        setLoadingContent(false);
      }
    };
    fetchContent();
  }, [debouncedFilters]);

  // Filter update helper
  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: key !== 'page' ? 1 : value // Reset page when changing filters
    }));
  }, []);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setFilters({
      query: '',
      type: 'movie',
      providers: [],
      genres: [],
      yearMin: 1900,
      yearMax: CURRENT_YEAR,
      ratingMin: 0,
      ratingMax: 10,
      sort: 'popularity.desc',
      region: 'US',
      page: 1
    });
  }, []);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      filters.providers.length > 0 ||
      filters.genres.length > 0 ||
      filters.yearMin > 1900 ||
      filters.yearMax < CURRENT_YEAR ||
      filters.ratingMin > 0 ||
      filters.ratingMax < 10 ||
      filters.sort !== 'popularity.desc'
    );
  }, [filters]);

  // Genre options for dropdown
  const genreOptions = useMemo(() => {
    return genres.map(g => ({ value: g.id, label: g.name }));
  }, [genres]);

  // Region options for dropdown
  const regionOptions = useMemo(() => {
    return regions.map(r => ({ value: r.code, label: r.name }));
  }, [regions]);

  // Filter panel content (reused in desktop and mobile)
  const FilterPanelContent = () => (
    <>
      {/* Media Type Toggle */}
      <div>
        <label className="text-sm font-medium text-slate-300 mb-2 block">Type</label>
        <div className="flex bg-slate-800 rounded-lg p-1">
          {[
            { id: 'movie', label: 'Movies', icon: Film },
            { id: 'tv', label: 'TV Shows', icon: Tv },
          ].map(type => {
            const Icon = type.icon;
            return (
              <button
                key={type.id}
                onClick={() => updateFilter('type', type.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md transition-colors ${
                  filters.type === type.id
                    ? 'bg-primary-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{type.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Genres */}
      <div>
        <label className="text-sm font-medium text-slate-300 mb-2 block">Genres</label>
        <FilterDropdown
          label=""
          options={genreOptions}
          selected={filters.genres}
          onChange={(v) => updateFilter('genres', v)}
          multi
          searchable
          placeholder="All genres"
          className="w-full"
        />
      </div>

      {/* Year Range */}
      <RangeSlider
        label="Year"
        min={1900}
        max={CURRENT_YEAR}
        value={[filters.yearMin, filters.yearMax]}
        onChange={([min, max]) => {
          setFilters(prev => ({ ...prev, yearMin: min, yearMax: max, page: 1 }));
        }}
        step={1}
      />

      {/* Rating Range */}
      <RangeSlider
        label="Rating"
        min={0}
        max={10}
        value={[filters.ratingMin, filters.ratingMax]}
        onChange={([min, max]) => {
          setFilters(prev => ({ ...prev, ratingMin: min, ratingMax: max, page: 1 }));
        }}
        step={0.5}
        formatValue={(v) => v.toFixed(1)}
      />

      {/* Sort */}
      <div>
        <label className="text-sm font-medium text-slate-300 mb-2 block">Sort By</label>
        <FilterDropdown
          label=""
          icon={ArrowUpDown}
          options={SORT_OPTIONS}
          selected={filters.sort ? [filters.sort] : []}
          onChange={(v) => updateFilter('sort', v[0] || 'popularity.desc')}
          placeholder="Popularity"
          className="w-full"
        />
      </div>

      {/* Region */}
      <div>
        <label className="text-sm font-medium text-slate-300 mb-2 block">Region</label>
        <FilterDropdown
          label=""
          icon={Globe}
          options={regionOptions}
          selected={filters.region ? [filters.region] : []}
          onChange={(v) => updateFilter('region', v[0] || 'US')}
          searchable
          placeholder="United States"
          className="w-full"
        />
      </div>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <button
          onClick={clearAllFilters}
          className="w-full py-2 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors"
        >
          Clear all filters
        </button>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Discover</h1>
          <p className="text-slate-400 mt-1">
            {filters.query
              ? `Search results for "${filters.query}"`
              : 'Find movies and TV shows to add to your watchlist'
            }
          </p>
        </div>

        {/* Mobile filter button */}
        <button
          onClick={() => setShowMobileFilters(true)}
          className="lg:hidden flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Filters</span>
          {hasActiveFilters && (
            <span className="w-2 h-2 bg-blue-500 rounded-full" />
          )}
        </button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          type="text"
          value={filters.query}
          onChange={(e) => updateFilter('query', e.target.value)}
          placeholder="Search movies and TV shows..."
          className="w-full pl-12 pr-4 py-3 bg-slate-800 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        {filters.query && (
          <button
            onClick={() => updateFilter('query', '')}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-700 rounded-full transition-colors"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        )}
      </div>

      {/* Platform Bar */}
      {!filters.query && (
        <PlatformBar
          providers={providers}
          selected={filters.providers}
          onChange={(v) => updateFilter('providers', v)}
          loading={loadingProviders}
        />
      )}

      {/* Main content area with sidebar on desktop */}
      <div className="flex gap-6">
        {/* Desktop Filter Sidebar */}
        {!filters.query && (
          <div className="hidden lg:block w-64 flex-shrink-0 space-y-4">
            <FilterPanelContent />
          </div>
        )}

        {/* Results */}
        <div className="flex-1 min-w-0">
          {/* Results count and active filters summary */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-slate-400">
              {totalResults.toLocaleString()} result{totalResults !== 1 ? 's' : ''}
            </span>
            {hasActiveFilters && !filters.query && (
              <button
                onClick={clearAllFilters}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Grid */}
          <MediaGrid items={content} loading={loadingContent} />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <button
                onClick={() => updateFilter('page', Math.max(1, filters.page - 1))}
                disabled={filters.page === 1}
                className="flex items-center gap-1 px-4 py-2 bg-slate-800 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>
              <span className="text-slate-400">
                Page {filters.page} of {totalPages}
              </span>
              <button
                onClick={() => updateFilter('page', Math.min(totalPages, filters.page + 1))}
                disabled={filters.page === totalPages}
                className="flex items-center gap-1 px-4 py-2 bg-slate-800 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* JustWatch Attribution */}
      <div className="text-center text-xs text-slate-500 border-t border-slate-800 pt-4">
        Streaming availability powered by JustWatch
      </div>

      {/* Mobile Filter Drawer */}
      <FilterDrawer
        isOpen={showMobileFilters}
        onClose={() => setShowMobileFilters(false)}
      >
        <FilterPanelContent />
      </FilterDrawer>
    </div>
  );
}
