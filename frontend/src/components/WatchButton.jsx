import React, { useState, useEffect } from 'react';
import { api } from '../App';
import { MonitorPlay, Loader2 } from 'lucide-react';

export function WatchButton({ tmdbId, mediaType, className = '', iconOnly = false }) {
  const [watchUrl, setWatchUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWatchUrl();
  }, [tmdbId, mediaType]);

  const fetchWatchUrl = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/plex/watch-url/${tmdbId}/${mediaType}`);
      setWatchUrl(res.data.watchUrl);
    } catch (e) {
      setWatchUrl(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <button disabled className={`flex items-center justify-center ${iconOnly ? 'p-1.5' : 'space-x-2 px-3 py-2'} bg-slate-700 rounded-lg text-slate-500 text-sm ${className}`}>
        <Loader2 className={`${iconOnly ? 'h-3 w-3' : 'h-4 w-4'} animate-spin`} />
      </button>
    );
  }

  if (!watchUrl) {
    return null;
  }

  return (
    <a
      href={watchUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center justify-center ${iconOnly ? 'p-1.5' : 'space-x-2 px-3 py-2'} bg-orange-500 hover:bg-orange-600 rounded-lg text-white transition-colors text-sm ${className}`}
      onClick={(e) => e.stopPropagation()}
      title="Watch on Plex"
    >
      <MonitorPlay className={iconOnly ? 'h-3 w-3' : 'h-4 w-4'} />
      {!iconOnly && <span>Watch</span>}
    </a>
  );
}
