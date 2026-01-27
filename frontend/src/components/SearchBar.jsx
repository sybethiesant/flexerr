import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Film, Tv, Loader2 } from 'lucide-react';
import { api } from '../App';

export default function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.trim().length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get('/discover/search', { params: { q: query } });
        setResults(res.data.results.slice(0, 8));
        setShowDropdown(true);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  const handleSelect = (item) => {
    setQuery('');
    setShowDropdown(false);
    navigate(`/discover/${item.media_type}/${item.id}`);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      setShowDropdown(false);
      navigate(`/discover?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div ref={searchRef} className="relative w-full max-w-xl mx-auto">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setShowDropdown(true)}
            placeholder="Search movies and TV shows..."
            className="w-full pl-10 pr-10 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 animate-spin" />
          )}
          {!loading && query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults([]);
                setShowDropdown(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </form>

      {/* Dropdown Results */}
      {showDropdown && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden z-50">
          {results.map((item) => (
            <button
              key={`${item.media_type}-${item.id}`}
              onClick={() => handleSelect(item)}
              className="w-full flex items-center space-x-3 p-3 hover:bg-slate-700 transition-colors text-left"
            >
              {item.poster_path ? (
                <img
                  src={item.poster_path}
                  alt={item.title}
                  className="w-10 h-14 object-cover rounded"
                />
              ) : (
                <div className="w-10 h-14 bg-slate-700 rounded flex items-center justify-center">
                  {item.media_type === 'movie' ? (
                    <Film className="h-5 w-5 text-slate-500" />
                  ) : (
                    <Tv className="h-5 w-5 text-slate-500" />
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate">{item.title}</p>
                <div className="flex items-center space-x-2 text-sm text-slate-400">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    item.media_type === 'movie' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                  }`}>
                    {item.media_type === 'movie' ? 'Movie' : 'TV'}
                  </span>
                  {item.year && <span>{item.year}</span>}
                </div>
              </div>
            </button>
          ))}
          <button
            onClick={handleSubmit}
            className="w-full p-3 text-center text-primary-400 hover:bg-slate-700 border-t border-slate-700"
          >
            View all results for "{query}"
          </button>
        </div>
      )}
    </div>
  );
}
