import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, useAuth } from '../App';
import {
  ArrowLeft, Star, Clock, Calendar, Heart, Check, Loader2,
  Film, Tv, Play, ExternalLink, Users, AlertCircle, Wrench, X,
  AlertTriangle, Zap, Trash2, RefreshCw, ChevronRight, ChevronLeft,
  Eye, EyeOff, MonitorPlay, BarChart3, Database, Activity, Shield, ShieldCheck
} from 'lucide-react';

// Season Episodes Modal - Shows episodes with watch buttons
function SeasonEpisodesModal({ isOpen, onClose, tmdbId, seasonNumber, showTitle, onWatchEpisode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [seasonData, setSeasonData] = useState(null);
  const [error, setError] = useState(null);
  const [repairingEpisode, setRepairingEpisode] = useState(null);
  const [repairSubmitting, setRepairSubmitting] = useState(false);
  const [repairSuccess, setRepairSuccess] = useState(null);
  const [statsEpisode, setStatsEpisode] = useState(null);
  const [statsData, setStatsData] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && tmdbId && seasonNumber !== null) {
      fetchSeasonData();
      setRepairingEpisode(null);
      setRepairSuccess(null);
      setStatsEpisode(null);
      setStatsData(null);
    }
  }, [isOpen, tmdbId, seasonNumber]);

  const fetchEpisodeStats = async (ratingKey) => {
    setStatsLoading(true);
    try {
      const res = await api.get(`/stats/plex/${ratingKey}`);
      setStatsData(res.data);
    } catch (err) {
      console.error('Error fetching episode stats:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleEpisodeRepair = async (requestType) => {
    if (!repairingEpisode) return;
    setRepairSubmitting(true);
    try {
      const epLabel = `S${String(seasonNumber).padStart(2, '0')}E${String(repairingEpisode.episodeNumber).padStart(2, '0')}`;
      await api.post('/repairs', {
        tmdbId,
        mediaType: 'tv',
        requestType,
        reason: `Episode ${epLabel}: ${repairingEpisode.title || 'Unknown'}`
      });
      setRepairSuccess(repairingEpisode.episodeNumber);
      setTimeout(() => {
        setRepairingEpisode(null);
        setRepairSuccess(null);
      }, 1500);
    } catch (e) {
      console.error('Repair request failed:', e);
    } finally {
      setRepairSubmitting(false);
    }
  };

  const fetchSeasonData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Always fetch from TMDB first to get full episode list
      const tmdbRes = await api.get(`/discover/tv/${tmdbId}/season/${seasonNumber}`);
      const tmdbEpisodes = tmdbRes.data.episodes?.map(ep => ({
        episodeNumber: ep.episode_number,
        title: ep.name,
        summary: ep.overview,
        thumb: ep.still_path,
        airDate: ep.air_date,
        runtime: ep.runtime,
        fromTmdb: true
      })) || [];

      // Try to overlay Plex data for watch status and availability
      let machineIdentifier = null;
      try {
        const plexRes = await api.get(`/plex/episodes/${tmdbId}`, {
          params: { season: seasonNumber }
        });
        const plexSeason = plexRes.data.seasons?.find(s => s.seasonNumber === seasonNumber);
        machineIdentifier = plexRes.data.machineIdentifier;

        if (plexSeason?.episodes) {
          // Merge Plex data into TMDB episodes
          tmdbEpisodes.forEach(ep => {
            const plexEp = plexSeason.episodes.find(p => p.episodeNumber === ep.episodeNumber);
            if (plexEp) {
              ep.ratingKey = plexEp.ratingKey;
              ep.viewCount = plexEp.viewCount;
              ep.lastViewedAt = plexEp.lastViewedAt;
              ep.onPlex = true;
              // Use Plex thumb if available
              if (plexEp.thumb) ep.thumb = plexEp.thumb;
            }
          });
        }
      } catch (plexErr) {
        // Plex data unavailable, continue with TMDB only
        console.log('Plex data unavailable, showing TMDB episodes only');
      }

      setSeasonData({
        seasonNumber,
        title: `Season ${seasonNumber}`,
        episodes: tmdbEpisodes,
        machineIdentifier
      });
    } catch (e) {
      setError('Failed to load episodes');
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (ms) => {
    if (!ms) return '';
    const minutes = Math.round(ms / 60000);
    return `${minutes}m`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">{showTitle}</h2>
              <p className="text-slate-400">Season {seasonNumber}</p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400">{error}</div>
          ) : seasonData?.episodes?.length === 0 ? (
            <div className="text-center py-12 text-slate-400">No episodes found</div>
          ) : (
            <div className="space-y-3">
              {seasonData?.episodes?.map(ep => (
                <div
                  key={ep.episodeNumber}
                  className="bg-slate-700/50 rounded-lg overflow-hidden hover:bg-slate-700/70 transition-colors"
                >
                  <div className="flex items-start gap-4 p-4">
                    {/* Episode Thumbnail */}
                    <div className="flex-shrink-0 w-32 aspect-video rounded overflow-hidden bg-slate-600">
                      {ep.thumb ? (
                        <img
                          src={ep.thumb}
                          alt={ep.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-500">
                          <Tv className="h-8 w-8" />
                        </div>
                      )}
                    </div>

                    {/* Episode Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm text-primary-400 font-medium">E{ep.episodeNumber}</span>
                        <h3 className="text-white font-medium truncate">{ep.title}</h3>
                        {/* Watch status indicator */}
                        {ep.viewCount > 0 && (
                          <Eye className="h-4 w-4 text-green-400 flex-shrink-0" title="Watched" />
                        )}
                        {ep.viewCount === 0 && ep.viewOffset > 0 && (
                          <div className="flex items-center gap-1 text-yellow-400" title="In Progress">
                            <Clock className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      {ep.summary && (
                        <p className="text-sm text-slate-400 line-clamp-2">{ep.summary}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                        {ep.duration && <span>{formatDuration(ep.duration)}</span>}
                        {ep.airDate && <span>{ep.airDate}</span>}
                        {ep.runtime && <span>{ep.runtime}m</span>}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {/* Stats Button (Admin only) */}
                      {user?.is_admin && ep.ratingKey && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (statsEpisode?.ratingKey === ep.ratingKey) {
                              setStatsEpisode(null);
                              setStatsData(null);
                            } else {
                              setStatsEpisode(ep);
                              fetchEpisodeStats(ep.ratingKey);
                            }
                          }}
                          className={`btn px-3 py-2 flex items-center gap-2 ${
                            statsEpisode?.ratingKey === ep.ratingKey
                              ? 'bg-primary-500/30 text-primary-400 border border-primary-500/30'
                              : 'bg-slate-600/50 hover:bg-slate-600 text-slate-300'
                          }`}
                          title="View Statistics"
                        >
                          <BarChart3 className="h-4 w-4" />
                        </button>
                      )}
                      {/* Watch Button */}
                      {ep.watchUrl && (
                        <a
                          href={ep.watchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn bg-primary-500 hover:bg-primary-600 text-white px-3 py-2 flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MonitorPlay className="h-4 w-4" />
                          <span className="hidden sm:inline">Watch</span>
                        </a>
                      )}
                      {/* Replace Button - only show if episode has a file (watchUrl indicates it exists in Plex) */}
                      {ep.watchUrl && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRepairingEpisode(ep);
                          }}
                          className="btn bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 px-3 py-2 flex items-center gap-2"
                          title="Replace Video"
                        >
                          <RefreshCw className="h-4 w-4" />
                          <span className="hidden sm:inline">Replace</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar for partially watched */}
                  {ep.viewOffset > 0 && ep.duration > 0 && (
                    <div className="h-1 bg-slate-600">
                      <div
                        className="h-full bg-primary-500"
                        style={{ width: `${Math.min(100, (ep.viewOffset / ep.duration) * 100)}%` }}
                      />
                    </div>
                  )}

                  {/* Episode Stats Panel */}
                  {statsEpisode?.ratingKey === ep.ratingKey && (
                    <div className="border-t border-slate-600 p-4 bg-slate-800/50">
                      {statsLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
                        </div>
                      ) : statsData ? (
                        <div className="space-y-3 text-sm">
                          {/* Plex Info */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                              <span className="text-slate-400 text-xs">Views:</span>
                              <p className="text-white">{statsData.plex_info?.view_count || 0}</p>
                            </div>
                            <div>
                              <span className="text-slate-400 text-xs">Last Viewed:</span>
                              <p className={statsData.plex_info?.last_viewed_at ? 'text-white' : 'text-slate-500'}>
                                {statsData.plex_info?.last_viewed_at
                                  ? new Date(statsData.plex_info.last_viewed_at).toLocaleDateString()
                                  : 'Never'}
                              </p>
                            </div>
                            <div>
                              <span className="text-slate-400 text-xs">Added:</span>
                              <p className="text-white">
                                {statsData.plex_info?.added_at
                                  ? new Date(statsData.plex_info.added_at).toLocaleDateString()
                                  : 'Unknown'}
                              </p>
                            </div>
                            <div>
                              <span className="text-slate-400 text-xs">Quality:</span>
                              <p className="text-white">
                                {statsData.plex_info?.resolution || 'Unknown'}
                                {statsData.plex_info?.video_codec && ` (${statsData.plex_info.video_codec})`}
                              </p>
                            </div>
                          </div>

                          {/* File Size */}
                          {statsData.plex_info?.file_size > 0 && (
                            <div className="text-xs text-slate-400">
                              File Size: {(statsData.plex_info.file_size / (1024 * 1024 * 1024)).toFixed(2)} GB
                            </div>
                          )}

                          {/* Watch History */}
                          {statsData.watch_history?.length > 0 && (
                            <div>
                              <span className="text-slate-400 text-xs">Recent watches:</span>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {statsData.watch_history.slice(0, 5).map(wh => (
                                  <span key={wh.id} className="text-xs bg-slate-700 px-2 py-1 rounded">
                                    {wh.username} - {new Date(wh.watched_at).toLocaleDateString()}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Queue Status */}
                          {statsData.queue_items?.length > 0 && (
                            <div className="text-xs text-red-400 bg-red-500/10 p-2 rounded">
                              Scheduled for deletion: {new Date(statsData.queue_items[0].action_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-slate-500 text-sm">No stats available</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-700">
          <button onClick={onClose} className="w-full btn bg-slate-700 hover:bg-slate-600 text-white">
            Close
          </button>
        </div>

        {/* Episode Repair Mini-Modal */}
        {repairingEpisode && (
          <div className="absolute inset-0 bg-slate-900/95 flex items-center justify-center p-6">
            <div className="bg-slate-800 rounded-lg p-6 max-w-sm w-full">
              {repairSuccess === repairingEpisode.episodeNumber ? (
                <div className="text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
                    <Check className="h-6 w-6 text-green-400" />
                  </div>
                  <p className="text-green-400 font-medium">Repair request submitted!</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-medium text-white">Replace Episode</h3>
                      <p className="text-sm text-slate-400">
                        S{String(seasonNumber).padStart(2, '0')}E{String(repairingEpisode.episodeNumber).padStart(2, '0')} - {repairingEpisode.title}
                      </p>
                    </div>
                    <button
                      onClick={() => setRepairingEpisode(null)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <p className="text-slate-300 text-sm mb-4">What's wrong with this episode?</p>
                  <div className="space-y-2">
                    <button
                      onClick={() => handleEpisodeRepair('better_quality')}
                      disabled={repairSubmitting}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-600 hover:border-primary-500 hover:bg-primary-500/10 transition-all text-left"
                    >
                      <Zap className="h-5 w-5 text-blue-400" />
                      <div className="flex-1">
                        <p className="font-medium text-white text-sm">Better Quality</p>
                        <p className="text-xs text-slate-400">Search for higher quality</p>
                      </div>
                      {repairSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    </button>
                    <button
                      onClick={() => handleEpisodeRepair('wrong_content')}
                      disabled={repairSubmitting}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-600 hover:border-red-500 hover:bg-red-500/10 transition-all text-left"
                    >
                      <Trash2 className="h-5 w-5 text-red-400" />
                      <div className="flex-1">
                        <p className="font-medium text-white text-sm">Wrong Video</p>
                        <p className="text-xs text-slate-400">Delete and re-download</p>
                      </div>
                      {repairSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Replacement Modal - Simple 2-option flow with episode selection for TV
function ReplacementModal({ isOpen, onClose, tmdbId, mediaType, title, onSubmit }) {
  const [step, setStep] = useState('select'); // 'episodes' | 'select'
  const [selectedEpisodes, setSelectedEpisodes] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [tvdbId, setTvdbId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setStep(mediaType === 'tv' ? 'episodes' : 'select');
      setSelectedEpisodes([]);
      setEpisodes([]);
      setError(null);
      if (mediaType === 'tv') {
        fetchEpisodes();
      }
    }
  }, [isOpen, tmdbId, mediaType]);

  const fetchEpisodes = async () => {
    setLoadingEpisodes(true);
    try {
      const res = await api.get(`/repairs/episodes/${tmdbId}`);
      setEpisodes(res.data.episodes.filter(ep => ep.hasFile));
      setTvdbId(res.data.tvdbId);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load episodes');
    } finally {
      setLoadingEpisodes(false);
    }
  };

  const toggleEpisode = (episode) => {
    setSelectedEpisodes(prev => {
      const exists = prev.find(e => e.episodeId === episode.id);
      if (exists) {
        return prev.filter(e => e.episodeId !== episode.id);
      } else {
        return [...prev, {
          episodeId: episode.id,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          episodeFileId: episode.episodeFileId
        }];
      }
    });
  };

  const selectAllInSeason = (seasonNumber) => {
    const seasonEpisodes = episodes.filter(ep => ep.seasonNumber === seasonNumber);
    const allSelected = seasonEpisodes.every(ep =>
      selectedEpisodes.find(s => s.episodeId === ep.id)
    );

    if (allSelected) {
      // Deselect all in season
      setSelectedEpisodes(prev =>
        prev.filter(s => !seasonEpisodes.find(ep => ep.id === s.episodeId))
      );
    } else {
      // Select all in season
      const newSelections = seasonEpisodes
        .filter(ep => !selectedEpisodes.find(s => s.episodeId === ep.id))
        .map(ep => ({
          episodeId: ep.id,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          episodeFileId: ep.episodeFileId
        }));
      setSelectedEpisodes(prev => [...prev, ...newSelections]);
    }
  };

  const handleSubmit = async (requestType) => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        tmdbId,
        mediaType,
        tvdbId,
        requestType,
        episodeData: mediaType === 'tv' ? selectedEpisodes : null
      });
      onClose();
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // Group episodes by season
  const seasonGroups = episodes.reduce((acc, ep) => {
    if (!acc[ep.seasonNumber]) {
      acc[ep.seasonNumber] = [];
    }
    acc[ep.seasonNumber].push(ep);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-slate-800 rounded-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white flex items-center space-x-2">
              <Wrench className="h-5 w-5 text-primary-400" />
              <span>Replace Video</span>
            </h2>
            <button onClick={onClose} className="text-slate-400 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="text-slate-400 text-sm mt-1">{title}</p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Episode Selection Step (TV only) */}
          {step === 'episodes' && (
            <>
              <p className="text-slate-300 mb-4">
                Which episodes need replacing?
              </p>

              {loadingEpisodes ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
                </div>
              ) : episodes.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  No downloaded episodes found
                </div>
              ) : (
                <div className="space-y-4 max-h-[300px] overflow-y-auto">
                  {Object.entries(seasonGroups).map(([season, eps]) => (
                    <div key={season} className="bg-slate-700/50 rounded-lg overflow-hidden">
                      <button
                        onClick={() => selectAllInSeason(parseInt(season))}
                        className="w-full flex items-center justify-between p-3 hover:bg-slate-700/80 transition-colors"
                      >
                        <span className="font-medium text-white">Season {season}</span>
                        <span className="text-sm text-slate-400">
                          {eps.filter(ep => selectedEpisodes.find(s => s.episodeId === ep.id)).length}/{eps.length} selected
                        </span>
                      </button>
                      <div className="border-t border-slate-600">
                        {eps.map(ep => (
                          <label
                            key={ep.id}
                            className="flex items-center justify-between p-2 px-3 hover:bg-slate-700/30 cursor-pointer"
                          >
                            <div className="flex items-center space-x-3">
                              <input
                                type="checkbox"
                                checked={!!selectedEpisodes.find(s => s.episodeId === ep.id)}
                                onChange={() => toggleEpisode(ep)}
                                className="rounded border-slate-600 bg-slate-700 text-primary-500 focus:ring-primary-500"
                              />
                              <span className="text-slate-300">
                                E{ep.episodeNumber.toString().padStart(2, '0')}
                                {ep.title && <span className="text-slate-500 ml-2">- {ep.title}</span>}
                              </span>
                            </div>
                            {ep.quality && (
                              <span className="text-xs text-slate-500">{ep.quality}</span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Option Selection Step */}
          {step === 'select' && (
            <>
              {mediaType === 'tv' && selectedEpisodes.length > 0 && (
                <div className="bg-slate-700/50 rounded-lg p-3 mb-4">
                  <p className="text-sm text-slate-400">Selected episodes:</p>
                  <p className="text-white">
                    {selectedEpisodes.map(ep => `S${ep.seasonNumber}E${ep.episodeNumber}`).join(', ')}
                  </p>
                </div>
              )}

              <p className="text-slate-300 mb-4">
                What's wrong with {mediaType === 'tv' && selectedEpisodes.length > 0 ? 'these episodes' : 'this video'}?
              </p>

              <div className="space-y-3">
                {/* Better Quality Option */}
                <button
                  onClick={() => handleSubmit('better_quality')}
                  disabled={submitting}
                  className="w-full flex items-center space-x-4 p-4 rounded-lg border border-slate-600 hover:border-primary-500 hover:bg-primary-500/10 transition-all text-left group"
                >
                  <div className="p-3 rounded-full bg-blue-500/20 text-blue-400 group-hover:bg-blue-500/30">
                    <Zap className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-white">Better Quality</p>
                    <p className="text-sm text-slate-400">
                      Search for a higher quality version. Current file will be kept as backup until a better one is found.
                    </p>
                  </div>
                  {submitting ? (
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-primary-400" />
                  )}
                </button>

                {/* Wrong Video Option */}
                <button
                  onClick={() => handleSubmit('wrong_content')}
                  disabled={submitting}
                  className="w-full flex items-center space-x-4 p-4 rounded-lg border border-slate-600 hover:border-red-500 hover:bg-red-500/10 transition-all text-left group"
                >
                  <div className="p-3 rounded-full bg-red-500/20 text-red-400 group-hover:bg-red-500/30">
                    <Trash2 className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-white">Wrong Video</p>
                    <p className="text-sm text-slate-400">
                      This is completely wrong. Delete it, blacklist the release, and search for the correct file.
                    </p>
                  </div>
                  {submitting ? (
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-red-400" />
                  )}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-700">
          <div className="flex space-x-3">
            {step === 'select' && mediaType === 'tv' ? (
              <button
                onClick={() => setStep('episodes')}
                className="btn bg-slate-700 hover:bg-slate-600 text-white flex items-center space-x-2"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>Back</span>
              </button>
            ) : (
              <button
                onClick={onClose}
                className="flex-1 btn bg-slate-700 hover:bg-slate-600 text-white"
              >
                Cancel
              </button>
            )}

            {step === 'episodes' && (
              <button
                onClick={() => setStep('select')}
                disabled={selectedEpisodes.length === 0}
                className="flex-1 btn btn-primary flex items-center justify-center space-x-2"
              >
                <span>Continue</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Media Statistics Modal (Admin only)
function StatsModal({ isOpen, onClose, tmdbId, mediaType, title, isProtected }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      fetchStats();
    }
  }, [isOpen, tmdbId, mediaType]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/stats/media/${mediaType}/${tmdbId}`);
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
    return `${gb.toFixed(2)} GB`;
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
            <h2 className="text-lg font-semibold text-white">Media Statistics</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
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
              {/* Title */}
              <div className="text-center pb-2 border-b border-slate-700">
                <h3 className="text-xl text-white font-medium">{title}</h3>
                <p className="text-slate-400 text-sm">TMDB ID: {stats.tmdb_id} - {stats.media_type === 'movie' ? 'Movie' : 'TV Series'}</p>
              </div>

              {/* Protection Status */}
              {isProtected && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-6 w-6 text-emerald-400" />
                    <div>
                      <h4 className="text-sm font-medium text-emerald-400">Protected from Deletion</h4>
                      <p className="text-xs text-emerald-300/70">This item will be skipped by all cleanup rules and VIPER</p>
                    </div>
                  </div>
                </div>
              )}

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

              {/* Queue Items (Scheduled for deletion) */}
              {stats.queue_items?.length > 0 && !isProtected && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-red-400 mb-3 flex items-center gap-2">
                    <Trash2 className="h-4 w-4" />
                    Scheduled for Deletion
                  </h4>
                  {stats.queue_items.map(qi => (
                    <div key={qi.id} className="text-sm">
                      <p className="text-white">Rule: {qi.rule_name || 'Unknown'}</p>
                      <p className="text-slate-400">Scheduled: {formatDate(qi.action_at)}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Protected - would have been deleted */}
              {stats.queue_items?.length > 0 && isProtected && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-amber-400 mb-3 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    Would Be Scheduled for Deletion (Protected)
                  </h4>
                  {stats.queue_items.map(qi => (
                    <div key={qi.id} className="text-sm">
                      <p className="text-white">Rule: {qi.rule_name || 'Unknown'}</p>
                      <p className="text-slate-400">Scheduled: {formatDate(qi.action_at)}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Watch History */}
              {stats.watch_history?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Recent Watch History
                  </h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {stats.watch_history.slice(0, 10).map(wh => (
                      <div key={wh.id} className="flex justify-between text-sm p-2 bg-slate-700/30 rounded">
                        <span className="text-white">{wh.username}</span>
                        <span className="text-slate-400">{formatDate(wh.watched_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recently Watched Episodes (for TV) */}
              {stats.recently_watched_by?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Recently Watched
                  </h4>
                  <div className="space-y-2">
                    {stats.recently_watched_by.map((rw, idx) => (
                      <div key={idx} className="p-3 bg-slate-700/30 rounded">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-white font-medium">{rw.username}</span>
                            <div className="text-sm text-slate-400 mt-1">
                              S{rw.seasonNumber}E{rw.episodeNumber}: {rw.episodeTitle}
                            </div>
                          </div>
                          <div className="text-right text-xs">
                            {rw.isActive ? (
                              <span className="text-green-400">Active</span>
                            ) : (
                              <span className="text-slate-500">Inactive</span>
                            )}
                            <div className="text-slate-500 mt-1">
                              {rw.daysSinceLastWatch != null ? (
                                rw.daysSinceLastWatch === 0 ? 'Today' :
                                rw.daysSinceLastWatch === 1 ? 'Yesterday' :
                                rw.daysSinceLastWatch + ' days ago'
                              ) : 'Unknown'}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-slate-500 mt-2">
                          Progress: {rw.totalWatched}/{rw.totalEpisodes} episodes
                          {rw.velocity > 0 && " - " + rw.velocity.toFixed(1) + " eps/day"}
                        </div>
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

export default function MediaDetails() {
  const { mediaType, id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [requestStatus, setRequestStatus] = useState(null);
  const [onWatchlist, setOnWatchlist] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showRepairModal, setShowRepairModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [plexWatchUrl, setPlexWatchUrl] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(null);

  // Protection state
  const [isProtected, setIsProtected] = useState(false);
  const [protectionLoading, setProtectionLoading] = useState(false);

  useEffect(() => {
    fetchDetails();
  }, [mediaType, id]);

  // Fetch media server watch URL - check if content is available in media server
  useEffect(() => {
    if (details) {
      fetchPlexWatchUrl();
      fetchProtectionStatus();
    }
  }, [details, id, mediaType]);

  const fetchPlexWatchUrl = async () => {
    try {
      const res = await api.get(`/plex/watch-url/${id}/${mediaType}`);
      setPlexWatchUrl(res.data.watchUrl);
    } catch (e) {
      // Not available in media server
      setPlexWatchUrl(null);
    }
  };

  const fetchProtectionStatus = async () => {
    try {
      const res = await api.get(`/protection/${mediaType}/${id}`);
      setIsProtected(res.data.protected);
    } catch (e) {
      // Protection check failed - assume not protected
      setIsProtected(false);
    }
  };

  const toggleProtection = async () => {
    setProtectionLoading(true);
    try {
      const res = await api.post(`/protection/${mediaType}/${id}`, {
        title: details?.title,
        protect: !isProtected
      });
      setIsProtected(res.data.protected);
    } catch (e) {
      console.error('Failed to toggle protection:', e);
    } finally {
      setProtectionLoading(false);
    }
  };

  const fetchDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = mediaType === 'movie' ? `/discover/movie/${id}` : `/discover/tv/${id}`;
      const res = await api.get(endpoint);
      setDetails(res.data);

      // Check request/watchlist status
      try {
        const statusRes = await api.get(`/requests/status/${id}`, { params: { media_type: mediaType } });
        setRequestStatus(statusRes.data.status);
        setOnWatchlist(statusRes.data.on_watchlist);
      } catch (e) {
        // No existing request
      }
    } catch (err) {
      console.error('Error fetching details:', err);
      setError(err.response?.data?.error || 'Failed to load details');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToWatchlist = async () => {
    setAdding(true);
    try {
      const res = await api.post('/watchlist', {
        tmdbId: parseInt(id),
        mediaType: mediaType
      });
      if (res.data.success) {
        setOnWatchlist(true);
        setRequestStatus(res.data.request?.status || 'pending');
      }
    } catch (err) {
      console.error('Error adding to watchlist:', err);
      setError(err.response?.data?.error || 'Failed to add to watchlist');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveFromWatchlist = async () => {
    setAdding(true);
    try {
      await api.delete(`/watchlist/${id}/${mediaType}`);
      setOnWatchlist(false);
      setRequestStatus(null);
    } catch (err) {
      console.error('Error removing from watchlist:', err);
    } finally {
      setAdding(false);
    }
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
      <div className="text-center py-24">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <p className="text-white text-lg mb-4">{error}</p>
        <button onClick={() => navigate(-1)} className="btn btn-primary">
          Go Back
        </button>
      </div>
    );
  }

  if (!details) return null;

  const getStatusBadge = () => {
    if (!requestStatus) return null;
    const badges = {
      pending: { color: 'bg-yellow-500/20 text-yellow-400', text: 'Pending' },
      processing: { color: 'bg-blue-500/20 text-blue-400', text: 'Downloading' },
      partial: { color: 'bg-amber-500/20 text-amber-400', text: 'Partial' },
      available: { color: 'bg-green-500/20 text-green-400', text: 'Available' },
      unavailable: { color: 'bg-red-500/20 text-red-400', text: 'Unavailable' }
    };
    const badge = badges[requestStatus] || badges.pending;
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${badge.color}`}>
        {badge.text}
      </span>
    );
  };

  return (
    <div className="space-y-8">
      {/* Back Button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-5 w-5" />
        <span>Back</span>
      </button>

      {/* Backdrop */}
      {details.backdrop_path && (
        <div className="absolute inset-0 h-[400px] -z-10">
          <img
            src={details.backdrop_path}
            alt=""
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/50 via-slate-900/90 to-slate-900" />
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-col md:flex-row gap-8">
        {/* Poster */}
        <div className="flex-shrink-0">
          {details.poster_path ? (
            <div className="relative">
              <img
                src={details.poster_path}
                alt={details.title}
                className="w-64 rounded-lg shadow-xl mx-auto md:mx-0"
              />
              {/* Protection badge on poster */}
              {isProtected && (
                <div className="absolute top-2 right-2 bg-emerald-500/90 text-white p-2 rounded-full shadow-lg" title="Protected from deletion">
                  <ShieldCheck className="h-5 w-5" />
                </div>
              )}
            </div>
          ) : (
            <div className="w-64 aspect-[2/3] bg-slate-800 rounded-lg flex items-center justify-center relative">
              {mediaType === 'movie' ? (
                <Film className="h-16 w-16 text-slate-600" />
              ) : (
                <Tv className="h-16 w-16 text-slate-600" />
              )}
              {isProtected && (
                <div className="absolute top-2 right-2 bg-emerald-500/90 text-white p-2 rounded-full shadow-lg" title="Protected from deletion">
                  <ShieldCheck className="h-5 w-5" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 space-y-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                mediaType === 'movie' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
              }`}>
                {mediaType === 'movie' ? 'Movie' : 'TV Series'}
              </span>
              {getStatusBadge()}
              {isProtected && (
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-emerald-500/20 text-emerald-400 flex items-center gap-1">
                  <ShieldCheck className="h-4 w-4" />
                  Protected
                </span>
              )}
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white">{details.title}</h1>
            {details.tagline && (
              <p className="text-lg text-slate-400 italic mt-1">{details.tagline}</p>
            )}
          </div>

          {/* Meta Info */}
          <div className="flex flex-wrap items-center gap-4 text-slate-400">
            {details.vote_average > 0 && (
              <div className="flex items-center space-x-1">
                <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                <span className="text-white font-medium">{details.vote_average.toFixed(1)}</span>
                <span className="text-sm">({details.vote_count} votes)</span>
              </div>
            )}
            {details.year && (
              <div className="flex items-center space-x-1">
                <Calendar className="h-4 w-4" />
                <span>{details.year}</span>
              </div>
            )}
            {details.runtime && (
              <div className="flex items-center space-x-1">
                <Clock className="h-4 w-4" />
                <span>{Math.floor(details.runtime / 60)}h {details.runtime % 60}m</span>
              </div>
            )}
            {details.certification && (
              <span className="px-2 py-0.5 border border-slate-500 rounded text-sm">
                {details.certification}
              </span>
            )}
            {details.number_of_seasons && (
              <span>{details.number_of_seasons} Season{details.number_of_seasons !== 1 ? 's' : ''}</span>
            )}
          </div>

          {/* Genres */}
          {details.genres && details.genres.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {details.genres.map(genre => (
                <span
                  key={genre.id}
                  className="px-3 py-1 bg-slate-800 rounded-full text-sm text-slate-300"
                >
                  {genre.name}
                </span>
              ))}
            </div>
          )}

          {/* Overview */}
          {details.overview && (
            <p className="text-slate-300 leading-relaxed">{details.overview}</p>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3 pt-4">
            {onWatchlist ? (
              <button
                onClick={handleRemoveFromWatchlist}
                disabled={adding}
                className="btn flex items-center space-x-2 bg-primary-600 hover:bg-primary-700 text-white"
              >
                {adding ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Check className="h-5 w-5" />
                )}
                <span>On Watchlist</span>
              </button>
            ) : (
              <button
                onClick={handleAddToWatchlist}
                disabled={adding}
                className="btn btn-primary flex items-center space-x-2"
              >
                {adding ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Heart className="h-5 w-5" />
                )}
                <span>Add to Watchlist</span>
              </button>
            )}

            {/* Watch on Media Server */}
            {plexWatchUrl && (
              <a
                href={plexWatchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn bg-emerald-600 hover:bg-emerald-700 text-white flex items-center space-x-2"
              >
                <MonitorPlay className="h-5 w-5" />
                <span>Watch</span>
              </a>
            )}

            {details.videos && details.videos.length > 0 && (
              <a
                href={`https://www.youtube.com/watch?v=${details.videos[0].key}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn bg-slate-700 hover:bg-slate-600 text-white flex items-center space-x-2"
              >
                <Play className="h-5 w-5" />
                <span>Watch Trailer</span>
              </a>
            )}

            {/* Replace Video */}
            {requestStatus === 'available' && (
              <button
                onClick={() => setShowRepairModal(true)}
                className="btn bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 flex items-center space-x-2"
              >
                <RefreshCw className="h-5 w-5" />
                <span>Replace Video</span>
              </button>
            )}

            {/* Protection Toggle - Show for all content */}
            <button
              onClick={toggleProtection}
              disabled={protectionLoading}
              className={`btn flex items-center space-x-2 ${
                isProtected
                  ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
              }`}
              title={isProtected
                ? 'Remove protection - allow cleanup'
                : requestStatus === 'available'
                  ? 'Protect from all cleanup rules'
                  : 'Protect and trigger download'}
            >
              {protectionLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isProtected ? (
                <ShieldCheck className="h-5 w-5" />
              ) : (
                <Shield className="h-5 w-5" />
              )}
              <span>{isProtected ? 'Protected' : 'Protect'}</span>
            </button>

            {/* Stats Button (Admin only) */}
            {user?.is_admin && (
              <button
                onClick={() => setShowStatsModal(true)}
                className="btn bg-slate-600/50 hover:bg-slate-600 text-slate-300 flex items-center space-x-2"
              >
                <BarChart3 className="h-5 w-5" />
                <span>Stats</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cast */}
      {details.credits?.cast && details.credits.cast.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-white mb-4">Cast</h2>
          <div className="flex overflow-x-auto space-x-4 pb-4 -mx-4 px-4">
            {details.credits.cast.slice(0, 12).map(person => (
              <div key={person.id} className="flex-shrink-0 w-28 text-center">
                {person.profile_path ? (
                  <img
                    src={person.profile_path}
                    alt={person.name}
                    className="w-20 h-20 rounded-full object-cover mx-auto"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-slate-700 mx-auto flex items-center justify-center">
                    <Users className="h-8 w-8 text-slate-500" />
                  </div>
                )}
                <p className="text-white text-sm mt-2 truncate">{person.name}</p>
                <p className="text-slate-400 text-xs truncate">{person.character}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Seasons (for TV) */}
      {details.seasons && details.seasons.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-white mb-4">Seasons</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {details.seasons.filter(s => s.season_number > 0).map(season => (
              <button
                key={season.id}
                onClick={() => setSelectedSeason(season.season_number)}
                className="bg-slate-800 rounded-lg overflow-hidden text-left hover:ring-2 hover:ring-primary-500 transition-all group"
              >
                {season.poster_path ? (
                  <div className="relative">
                    <img
                      src={season.poster_path}
                      alt={season.name}
                      className="w-full aspect-[2/3] object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <Play className="h-10 w-10 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ) : (
                  <div className="w-full aspect-[2/3] bg-slate-700 flex items-center justify-center group-hover:bg-slate-600 transition-colors">
                    <Tv className="h-8 w-8 text-slate-500" />
                  </div>
                )}
                <div className="p-3">
                  <p className="text-white font-medium truncate">{season.name}</p>
                  <p className="text-slate-400 text-sm">{season.episode_count} episodes</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {details.recommendations && details.recommendations.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-white mb-4">You Might Also Like</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {details.recommendations.slice(0, 6).map(item => (
              <Link
                key={item.id}
                to={`/discover/${item.media_type}/${item.id}`}
                className="bg-slate-800 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all"
              >
                {item.poster_path ? (
                  <img
                    src={item.poster_path}
                    alt={item.title}
                    className="w-full aspect-[2/3] object-cover"
                  />
                ) : (
                  <div className="w-full aspect-[2/3] bg-slate-700 flex items-center justify-center">
                    <Film className="h-8 w-8 text-slate-500" />
                  </div>
                )}
                <div className="p-3">
                  <p className="text-white font-medium truncate">{item.title}</p>
                  <div className="flex items-center space-x-2 text-sm text-slate-400">
                    <Star className="h-3 w-3 text-yellow-500" />
                    <span>{item.vote_average?.toFixed(1)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Replacement Modal */}
      <ReplacementModal
        isOpen={showRepairModal}
        onClose={() => setShowRepairModal(false)}
        tmdbId={parseInt(id)}
        mediaType={mediaType}
        title={details.title}
        onSubmit={async (data) => {
          await api.post('/repairs', data);
        }}
      />

      {/* Season Episodes Modal */}
      <SeasonEpisodesModal
        isOpen={selectedSeason !== null}
        onClose={() => setSelectedSeason(null)}
        tmdbId={parseInt(id)}
        seasonNumber={selectedSeason}
        showTitle={details.title}
      />

      {/* Stats Modal (Admin only) */}
      <StatsModal
        isOpen={showStatsModal}
        onClose={() => setShowStatsModal(false)}
        tmdbId={parseInt(id)}
        mediaType={mediaType}
        title={details.title}
        isProtected={isProtected}
      />
    </div>
  );
}
