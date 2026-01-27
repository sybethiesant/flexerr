import React, { useState, useEffect } from 'react';
import { api } from '../App';
import {
  Wrench, X, Loader2, Zap, Trash2, ChevronRight, ChevronLeft
} from 'lucide-react';

// Compact repair button for media cards
export function RepairButton({ tmdbId, mediaType, title, size = 'normal' }) {
  const [showModal, setShowModal] = useState(false);

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowModal(true);
  };

  const isSmall = size === 'small';

  return (
    <>
      <button
        onClick={handleClick}
        className={`flex items-center justify-center space-x-1 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 rounded-lg transition-colors ${
          isSmall ? 'p-1.5' : 'px-2 py-1.5'
        }`}
        title="Replace Video"
      >
        <Wrench className={isSmall ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        {!isSmall && <span className="text-xs">Replace</span>}
      </button>

      <ReplacementModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        tmdbId={tmdbId}
        mediaType={mediaType}
        title={title}
      />
    </>
  );
}

// Full replacement modal
function ReplacementModal({ isOpen, onClose, tmdbId, mediaType, title }) {
  const [step, setStep] = useState('select');
  const [selectedEpisodes, setSelectedEpisodes] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [tvdbId, setTvdbId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStep(mediaType === 'tv' ? 'episodes' : 'select');
      setSelectedEpisodes([]);
      setEpisodes([]);
      setError(null);
      setSuccess(false);
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
      setSelectedEpisodes(prev =>
        prev.filter(s => !seasonEpisodes.find(ep => ep.id === s.episodeId))
      );
    } else {
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
      await api.post('/repairs', {
        tmdbId,
        mediaType,
        tvdbId,
        requestType,
        episodeData: mediaType === 'tv' ? selectedEpisodes : null
      });
      setSuccess(true);
      setTimeout(() => onClose(), 1500);
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const seasonGroups = episodes.reduce((acc, ep) => {
    if (!acc[ep.seasonNumber]) {
      acc[ep.seasonNumber] = [];
    }
    acc[ep.seasonNumber].push(ep);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
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
          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <Wrench className="h-8 w-8 text-green-400" />
              </div>
              <p className="text-green-400 font-medium">Repair request submitted!</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Episode Selection Step (TV only) */}
              {step === 'episodes' && (
                <>
                  <p className="text-slate-300 mb-4">Which episodes need replacing?</p>

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
                          Search for a higher quality version. Current file kept as backup.
                        </p>
                      </div>
                      {submitting ? (
                        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-primary-400" />
                      )}
                    </button>

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
                          Delete, blacklist, and search for the correct file.
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
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
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
        )}
      </div>
    </div>
  );
}

export default RepairButton;
