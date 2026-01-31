import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../App';
import { Save, Trash2, Plus, X, Loader2, Eye, ArrowLeft, ChevronDown, ChevronUp, Info, HelpCircle, BookOpen } from 'lucide-react';
import HelpTooltip, { HELP_CONTENT } from '../components/HelpTooltip';

// Detailed condition field descriptions for the help modal
const CONDITION_HELP = {
  watched: {
    label: 'Watched',
    type: 'Yes/No',
    description: 'Whether the content has been watched by at least one user.',
    details: 'For movies, this means the movie was watched to completion (or past the "watched" threshold in Plex settings). For episodes, it checks if that specific episode was watched. For shows, it considers the show "watched" if any episode has been watched.',
    example: '"Watched is Yes" matches all content that has been viewed at least once.'
  },
  view_count: {
    label: 'View Count',
    type: 'Number',
    description: 'The total number of times content has been watched across all users.',
    details: 'This counts every view, so if 3 users each watch a movie once, the view count is 3. Useful for identifying rarely-watched content or popular favorites that are rewatched often.',
    example: '"View Count equals 1" finds content watched exactly once (potential one-and-done).'
  },
  days_since_watched: {
    label: 'Days Since Watched',
    type: 'Number',
    description: 'Number of days since the content was last watched by anyone.',
    details: 'Calculates the time elapsed since the most recent view by any user. Content that has never been watched will have a very high value (essentially infinite). Useful for cleaning up old watched content.',
    example: '"Days Since Watched greater than 30" finds content not watched in the last month.'
  },
  on_watchlist: {
    label: 'On Watchlist',
    type: 'Yes/No',
    description: 'Whether the content appears on any user\'s watchlist.',
    details: 'Checks if ANY user has this content on their watchlist. If someone has this content saved, it returns Yes. This is typically used to PROTECT content from deletion.',
    example: '"On Watchlist is No" matches content nobody has saved to watch later.'
  },
  days_since_activity: {
    label: 'Days Since Activity',
    type: 'Number',
    description: 'Days since any activity occurred on this content.',
    details: 'Broader than "Days Since Watched" - includes partial views, paused playback, and other interactions. Useful for finding truly abandoned content that nobody has even started watching recently.',
    example: '"Days Since Activity greater than 60" finds content with no interaction in 2 months.'
  },
  days_since_added: {
    label: 'Days Since Added',
    type: 'Number',
    description: 'Number of days since the content was added to your Plex library.',
    details: 'Calculated from when Plex first scanned the media into the library. Useful for cleaning up old content that was never watched, or for protecting recently added content.',
    example: '"Days Since Added greater than 90" finds content in your library for 3+ months.'
  },
  year: {
    label: 'Release Year',
    type: 'Number',
    description: 'The year the movie or show was originally released.',
    details: 'Uses the release year from the media metadata. For TV shows, this is typically the year the first episode aired. Useful for cleaning up old content or protecting recent releases.',
    example: '"Year less than 2015" matches content released before 2015.'
  },
  rating: {
    label: 'Rating',
    type: 'Number (0-10)',
    description: 'The audience or critic rating on a 0-10 scale.',
    details: 'Uses the rating configured in Plex (typically from TMDB, IMDB, or Rotten Tomatoes). Ratings are normalized to a 0-10 scale. Useful for cleaning up poorly-rated content.',
    example: '"Rating less than 5" matches below-average rated content.'
  },
  genre: {
    label: 'Genre',
    type: 'Text',
    description: 'The genre(s) assigned to the content.',
    details: 'Content can have multiple genres. Use "contains" to match content that includes a specific genre. Matching is case-insensitive. Common genres: Action, Comedy, Drama, Horror, Sci-Fi, Documentary, Animation, etc.',
    example: '"Genre contains Horror" matches all horror movies/shows.'
  },
  content_rating: {
    label: 'Content Rating',
    type: 'Text',
    description: 'The age/content rating (G, PG, PG-13, R, TV-MA, etc.).',
    details: 'Uses the certification/content rating from metadata. Common values: G, PG, PG-13, R, NC-17 for movies; TV-Y, TV-G, TV-PG, TV-14, TV-MA for TV shows. Exact match is required.',
    example: '"Content Rating equals TV-MA" matches mature TV content only.'
  },
  file_size_gb: {
    label: 'File Size (GB)',
    type: 'Number',
    description: 'The total file size of the media in gigabytes.',
    details: 'For movies, this is the size of the movie file(s). For shows, this is the total size of ALL episodes. Useful for targeting large files when storage is limited.',
    example: '"File Size greater than 50" finds content using over 50GB of storage.'
  },
  monitored: {
    label: 'Monitored (Sonarr/Radarr)',
    type: 'Yes/No',
    description: 'Whether the content is being actively monitored in Sonarr or Radarr.',
    details: 'Monitored content will receive automatic upgrades and (for shows) new episode downloads. Unmonitored content is essentially "archived" in the *arr apps. If not in Sonarr/Radarr, returns No.',
    example: '"Monitored is No" finds content not being tracked for upgrades.'
  },
  has_request: {
    label: 'Has Request',
    type: 'Yes/No',
    description: 'Whether there\'s an active request for this content in Flexerr.',
    details: 'Checks if anyone has requested this content through Flexerr. Includes pending, approved, and available requests. Useful for protecting content that was specifically requested by users.',
    example: '"Has Request is Yes" matches content that was user-requested.'
  }
};

const OPERATOR_HELP = {
  equals: { label: 'equals / is', description: 'Exact match. Value must be exactly what you specify.' },
  not_equals: { label: 'does not equal', description: 'Inverse match. Value must NOT be what you specify.' },
  greater_than: { label: 'greater than', description: 'Value must be higher than what you specify (not including the number itself).' },
  less_than: { label: 'less than', description: 'Value must be lower than what you specify (not including the number itself).' },
  greater_than_or_equals: { label: 'at least', description: 'Value must be equal to or higher than what you specify.' },
  less_than_or_equals: { label: 'at most', description: 'Value must be equal to or lower than what you specify.' },
  contains: { label: 'contains', description: 'Text includes the specified value anywhere (case-insensitive).' },
  not_contains: { label: 'does not contain', description: 'Text does NOT include the specified value.' }
};

// Detailed action descriptions for the help modal
const ACTIONS_HELP = {
  add_to_collection: {
    label: 'Add to Leaving Soon collection',
    category: 'Queue',
    description: 'Adds matching content to a Plex collection and the deletion queue.',
    details: 'This is the RECOMMENDED first action. Content is added to a visible Plex collection (default: "Leaving Soon") where users can see what\'s scheduled for removal. The content stays in the queue for the configured buffer period before any deletion actions run.',
    important: 'This action does NOT delete anything. It just queues content for future deletion.',
    color: 'green'
  },
  delete_from_plex: {
    label: 'Delete from Plex',
    category: 'Deletion',
    description: 'Removes the content from your Plex library.',
    details: 'Removes the library entry from Plex. The content will no longer appear in Plex for any user. Whether the actual media files are deleted depends on the "Delete Files from Disk" settings (see below).',
    important: 'Only runs after the buffer period expires (when processing from the queue).',
    color: 'red'
  },
  delete_from_sonarr: {
    label: 'Delete from Sonarr',
    category: 'Deletion',
    description: 'Removes the TV show from Sonarr completely.',
    details: 'Deletes the series from Sonarr\'s database and optionally removes the files. Automatically adds to Sonarr\'s import list exclusion to prevent automatic re-adding from Trakt, IMDB lists, etc.',
    important: 'Import list exclusion prevents automatic re-adds, but users can still manually request.',
    color: 'red'
  },
  delete_from_radarr: {
    label: 'Delete from Radarr',
    category: 'Deletion',
    description: 'Removes the movie from Radarr completely.',
    details: 'Deletes the movie from Radarr\'s database and optionally removes the files. Automatically adds to Radarr\'s import list exclusion to prevent automatic re-adding from Trakt, IMDB lists, etc.',
    important: 'Import list exclusion prevents automatic re-adds, but users can still manually request.',
    color: 'red'
  },
  unmonitor_sonarr: {
    label: 'Unmonitor in Sonarr',
    category: 'Soft Action',
    description: 'Stops Sonarr from monitoring the show for new episodes.',
    details: 'Sets the series to "unmonitored" in Sonarr. The show stays in your library and Sonarr, but no new episodes will be downloaded and no quality upgrades will occur. Good for shows you want to keep but are finished watching.',
    important: 'Non-destructive. The show remains in Sonarr and can be re-monitored anytime.',
    color: 'yellow'
  },
  unmonitor_radarr: {
    label: 'Unmonitor in Radarr',
    category: 'Soft Action',
    description: 'Stops Radarr from monitoring the movie for upgrades.',
    details: 'Sets the movie to "unmonitored" in Radarr. The movie stays in your library, but Radarr won\'t search for quality upgrades. Useful for movies you\'re happy with at current quality.',
    important: 'Non-destructive. The movie remains in Radarr and can be re-monitored anytime.',
    color: 'yellow'
  },
  clear_overseerr_request: {
    label: 'Clear request',
    category: 'Cleanup',
    description: 'Removes the request entry from Flexerr.',
    details: 'Clears the request record from Flexerr. This makes the content appear as "never requested". Combined with delete_from_sonarr/radarr (which adds to import exclusion list), this prevents import lists from re-adding the content.',
    important: 'Note: Users can still manually re-request through Flexerr.',
    color: 'blue'
  },
  add_tag: {
    label: 'Add tag',
    category: 'Organization',
    description: 'Adds a tag to the content in Sonarr/Radarr.',
    details: 'Applies a tag to the content in your *arr apps. Useful for marking content for later processing, organizing, or creating automation triggers in Sonarr/Radarr.',
    important: 'Non-destructive. Just adds metadata.',
    color: 'blue'
  },
  delete_files: {
    label: 'Delete files from disk',
    category: 'Deletion',
    description: 'Explicitly requests that media files be deleted from storage.',
    details: 'This action works WITH other delete actions. When checked, it tells the delete_from_sonarr/radarr actions to also remove the actual media files from your disk, not just the database entries.',
    important: 'See the "Understanding File Deletion" section below for how this interacts with global settings.',
    color: 'red'
  }
};

const TARGET_TYPES = [
  { value: 'movies', label: 'Movies' },
  { value: 'shows', label: 'TV Shows' },
  { value: 'seasons', label: 'Seasons' },
  { value: 'episodes', label: 'Episodes' }
];

const CONDITION_FIELDS = [
  { value: 'watched', label: 'Watched', type: 'boolean' },
  { value: 'view_count', label: 'View Count', type: 'number' },
  { value: 'days_since_watched', label: 'Days Since Watched', type: 'number' },
  { value: 'on_watchlist', label: 'On Watchlist', type: 'boolean' },
  { value: 'days_since_activity', label: 'Days Since Activity', type: 'number' },
  { value: 'days_since_added', label: 'Days Since Added', type: 'number' },
  { value: 'year', label: 'Release Year', type: 'number' },
  { value: 'rating', label: 'Rating', type: 'number' },
  { value: 'genre', label: 'Genre', type: 'text' },
  { value: 'content_rating', label: 'Content Rating', type: 'text' },
  { value: 'file_size_gb', label: 'File Size (GB)', type: 'number' },
  { value: 'monitored', label: 'Monitored (Sonarr/Radarr)', type: 'boolean' },
  { value: 'has_request', label: 'Has Request', type: 'boolean' }
];

const OPERATORS = {
  boolean: [
    { value: 'equals', label: 'is' }
  ],
  number: [
    { value: 'equals', label: 'equals' },
    { value: 'not_equals', label: 'does not equal' },
    { value: 'greater_than', label: 'greater than' },
    { value: 'less_than', label: 'less than' },
    { value: 'greater_than_or_equals', label: 'at least' },
    { value: 'less_than_or_equals', label: 'at most' }
  ],
  text: [
    { value: 'equals', label: 'equals' },
    { value: 'not_equals', label: 'does not equal' },
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' }
  ]
};

const ACTIONS = [
  { value: 'add_to_collection', label: 'Add to Leaving Soon collection', hasOptions: true },
  { value: 'delete_from_plex', label: 'Delete from Plex' },
  { value: 'delete_from_sonarr', label: 'Delete from Sonarr' },
  { value: 'delete_from_radarr', label: 'Delete from Radarr' },
  { value: 'unmonitor_sonarr', label: 'Unmonitor in Sonarr' },
  { value: 'unmonitor_radarr', label: 'Unmonitor in Radarr' },
  { value: 'clear_overseerr_request', label: 'Clear request' },
  { value: 'add_tag', label: 'Add tag', hasOptions: true },
  { value: 'delete_files', label: 'Delete files from disk' }
];

export default function RuleEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [rule, setRule] = useState({
    name: '',
    description: '',
    target_type: 'movies',
    target_library_ids: [],
    conditions: { operator: 'AND', conditions: [] },
    actions: [{ type: 'add_to_collection' }],
    buffer_days: 15,
    schedule: null,
    priority: 0,
    is_active: true
  });

  const [showConditionsHelp, setShowConditionsHelp] = useState(false);

  const [libraries, setLibraries] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    loadLibraries();
    if (!isNew) {
      loadRule();
    }
  }, [id]);

  const loadLibraries = async () => {
    try {
      const res = await api.get('/plex/libraries');
      setLibraries(res.data);
    } catch (err) {
      console.error('Failed to load libraries:', err);
    }
  };

  const loadRule = async () => {
    try {
      const res = await api.get(`/rules/${id}`);
      setRule(res.data);
    } catch (err) {
      console.error('Failed to load rule:', err);
      navigate('/admin/rules');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!rule.name) {
      alert('Please enter a rule name');
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        const res = await api.post('/rules', rule);
        navigate(`/admin/rules/${res.data.id}`);
      } else {
        await api.put(`/rules/${id}`, rule);
      }
      alert('Rule saved successfully');
    } catch (err) {
      alert('Failed to save rule: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (isNew) {
      alert('Please save the rule first to preview');
      return;
    }

    setPreviewing(true);
    try {
      const res = await api.get(`/rules/${id}/preview`);
      setPreview(res.data);
    } catch (err) {
      alert('Preview failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setPreviewing(false);
    }
  };

  const addCondition = () => {
    setRule(prev => ({
      ...prev,
      conditions: {
        ...prev.conditions,
        conditions: [
          ...prev.conditions.conditions,
          { field: 'watched', operator: 'equals', value: true }
        ]
      }
    }));
  };

  const updateCondition = (index, updates) => {
    setRule(prev => ({
      ...prev,
      conditions: {
        ...prev.conditions,
        conditions: prev.conditions.conditions.map((c, i) =>
          i === index ? { ...c, ...updates } : c
        )
      }
    }));
  };

  const removeCondition = (index) => {
    setRule(prev => ({
      ...prev,
      conditions: {
        ...prev.conditions,
        conditions: prev.conditions.conditions.filter((_, i) => i !== index)
      }
    }));
  };

  const toggleAction = (actionType) => {
    const exists = rule.actions.some(a => a.type === actionType);
    if (exists) {
      setRule(prev => ({
        ...prev,
        actions: prev.actions.filter(a => a.type !== actionType)
      }));
    } else {
      setRule(prev => ({
        ...prev,
        actions: [...prev.actions, { type: actionType }]
      }));
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button onClick={() => navigate('/admin/rules')} className="btn btn-ghost p-2">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold">{isNew ? 'Create Rule' : 'Edit Rule'}</h1>
        </div>
        <div className="flex items-center space-x-3">
          {!isNew && (
            <button
              onClick={handlePreview}
              disabled={previewing}
              className="btn btn-secondary flex items-center space-x-2"
            >
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              <span>Preview</span>
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary flex items-center space-x-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Preview Results */}
      {preview && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Preview Results ({preview.length} matches)</h2>
            <button onClick={() => setPreview(null)} className="btn btn-ghost p-1">
              <X className="h-4 w-4" />
            </button>
          </div>
          {preview.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 max-h-64 overflow-y-auto">
              {preview.map((item, i) => (
                <div key={i} className="bg-slate-700/50 rounded-lg p-2 text-center">
                  {item.poster && (
                    <img src={item.poster} alt={item.title} className="w-full h-24 object-cover rounded mb-2" />
                  )}
                  <p className="text-sm truncate">{item.title}</p>
                  <p className="text-xs text-slate-400">{item.year}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-400 text-center">No matches found</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Settings */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info */}
          <div className="card p-5 space-y-4">
            <h2 className="text-lg font-semibold">Basic Info</h2>

            <div>
              <label className="block text-sm font-medium text-white mb-1">
                Rule Name
                <HelpTooltip {...HELP_CONTENT.ruleName} />
              </label>
              <input
                type="text"
                value={rule.name}
                onChange={(e) => setRule(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Watched Movies Cleanup"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1">
                Description (optional)
                <HelpTooltip {...HELP_CONTENT.ruleDescription} />
              </label>
              <textarea
                value={rule.description || ''}
                onChange={(e) => setRule(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
                placeholder="What does this rule do?"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-1">
                  Target Type
                  <HelpTooltip {...HELP_CONTENT.targetType} />
                </label>
                <select
                  value={rule.target_type}
                  onChange={(e) => setRule(prev => ({ ...prev, target_type: e.target.value }))}
                >
                  {TARGET_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-1">
                  Buffer Days
                  <HelpTooltip {...HELP_CONTENT.ruleBufferDays} />
                </label>
                <input
                  type="number"
                  min="0"
                  value={rule.buffer_days}
                  onChange={(e) => setRule(prev => ({ ...prev, buffer_days: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>

          {/* Conditions */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-semibold">Conditions</h2>
                <button
                  type="button"
                  onClick={() => setShowConditionsHelp(true)}
                  className="flex items-center space-x-1 text-xs text-primary-400 hover:text-primary-300 bg-primary-500/10 hover:bg-primary-500/20 px-2 py-1 rounded transition-colors"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>View Guide</span>
                </button>
              </div>
            </div>

            <p className="text-slate-400 text-sm">
              Define conditions that content must match. Use AND/OR between conditions to control matching logic.
            </p>

            <div className="space-y-2">
              {rule.conditions.conditions.map((condition, index) => {
                const fieldConfig = CONDITION_FIELDS.find(f => f.value === condition.field);
                const fieldType = fieldConfig?.type || 'text';
                const operators = OPERATORS[fieldType] || OPERATORS.text;
                const isLastCondition = index === rule.conditions.conditions.length - 1;

                return (
                  <div key={index}>
                    <div className="flex items-center space-x-3 bg-slate-700/50 p-3 rounded-lg">
                      <select
                        value={condition.field}
                        onChange={(e) => {
                          const newField = CONDITION_FIELDS.find(f => f.value === e.target.value);
                          const newType = newField?.type || 'text';
                          updateCondition(index, {
                            field: e.target.value,
                            operator: OPERATORS[newType][0].value,
                            value: newType === 'boolean' ? true : newType === 'number' ? 0 : ''
                          });
                        }}
                        className="flex-1"
                      >
                        {CONDITION_FIELDS.map(f => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>

                      <select
                        value={condition.operator}
                        onChange={(e) => updateCondition(index, { operator: e.target.value })}
                        className="w-40"
                      >
                        {operators.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>

                      {fieldType === 'boolean' ? (
                        <select
                          value={condition.value ? 'true' : 'false'}
                          onChange={(e) => updateCondition(index, { value: e.target.value === 'true' })}
                          className="w-24"
                        >
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      ) : fieldType === 'number' ? (
                        <input
                          type="number"
                          value={condition.value}
                          onChange={(e) => updateCondition(index, { value: parseFloat(e.target.value) || 0 })}
                          className="w-24"
                        />
                      ) : (
                        <input
                          type="text"
                          value={condition.value}
                          onChange={(e) => updateCondition(index, { value: e.target.value })}
                          className="w-40"
                        />
                      )}

                      <button
                        onClick={() => removeCondition(index)}
                        className="btn btn-ghost p-2 text-red-400"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* AND/OR selector between conditions */}
                    {!isLastCondition && (
                      <div className="flex items-center justify-center my-2">
                        <div className="flex items-center bg-slate-800 rounded-lg overflow-hidden border border-slate-600">
                          <button
                            type="button"
                            onClick={() => updateCondition(index, { join: 'AND' })}
                            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                              (condition.join || 'AND') === 'AND'
                                ? 'bg-green-600 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-slate-700'
                            }`}
                          >
                            AND
                          </button>
                          <button
                            type="button"
                            onClick={() => updateCondition(index, { join: 'OR' })}
                            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                              condition.join === 'OR'
                                ? 'bg-yellow-600 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-slate-700'
                            }`}
                          >
                            OR
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={addCondition}
              className="btn btn-secondary w-full flex items-center justify-center space-x-2"
            >
              <Plus className="h-4 w-4" />
              <span>Add Condition</span>
            </button>
          </div>

          {/* Actions */}
          <div className="card p-5 space-y-4">
            <h2 className="text-lg font-semibold">Actions</h2>
            <p className="text-slate-400 text-sm">What should happen to matching content:</p>

            <div className="space-y-2">
              {ACTIONS.map(action => {
                const selectedAction = rule.actions.find(a => a.type === action.value);
                const isSelected = !!selectedAction;
                const hasExclusionOption = ['delete_from_sonarr', 'delete_from_radarr'].includes(action.value);

                return (
                  <div key={action.value}>
                    <label
                      className={`flex items-center space-x-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        isSelected ? 'bg-primary-600/20 border border-primary-500' : 'bg-slate-700/50 hover:bg-slate-700'
                      } ${hasExclusionOption && isSelected ? 'rounded-b-none' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleAction(action.value)}
                        className="rounded"
                      />
                      <span>{action.label}</span>
                    </label>

                    {/* Sub-option for exclusion list */}
                    {hasExclusionOption && isSelected && (
                      <div className="bg-slate-700/30 border border-t-0 border-primary-500/50 rounded-b-lg p-3 pl-10">
                        <label className="flex items-center space-x-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedAction?.add_exclusion !== false}
                            onChange={(e) => {
                              setRule(prev => ({
                                ...prev,
                                actions: prev.actions.map(a =>
                                  a.type === action.value
                                    ? { ...a, add_exclusion: e.target.checked }
                                    : a
                                )
                              }));
                            }}
                            className="rounded"
                          />
                          <span className="text-slate-300">Add to import exclusion list</span>
                          <span className="text-slate-500 text-xs">(prevents auto re-add from import lists)</span>
                        </label>
                        <p className="text-xs text-slate-500 mt-1 ml-6">
                          Uncheck to allow users to re-request this content after deletion
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Info box about VIPER */}
          {['episodes', 'shows', 'seasons'].includes(rule.target_type) && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <p className="text-blue-300 text-sm">
                <strong>Tip:</strong> For intelligent episode cleanup based on user watch progress,
                enable <strong>VIPER</strong> in Settings instead of creating
                episode-based rules. It automatically tracks each user's position and watch velocity.
              </p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status */}
          <div className="card p-5 space-y-4">
            <h2 className="text-lg font-semibold">Status</h2>

            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={rule.is_active}
                onChange={(e) => setRule(prev => ({ ...prev, is_active: e.target.checked }))}
                className="rounded"
              />
              <span className="flex-1">
                Rule is active
                <HelpTooltip {...HELP_CONTENT.ruleIsActive} />
              </span>
            </label>

            <div>
              <label className="block text-sm font-medium text-white mb-1">
                Priority
                <HelpTooltip {...HELP_CONTENT.rulePriority} />
              </label>
              <input
                type="number"
                min="0"
                value={rule.priority}
                onChange={(e) => setRule(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
              />
            </div>
          </div>

          {/* Libraries */}
          <div className="card p-5 space-y-4">
            <h2 className="text-lg font-semibold">
              Target Libraries
              <HelpTooltip {...HELP_CONTENT.targetLibraries} />
            </h2>
            <p className="text-slate-400 text-sm">Leave empty to target all libraries</p>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {libraries
                .filter(lib =>
                  (rule.target_type === 'movies' && lib.type === 'movie') ||
                  (['shows', 'seasons', 'episodes'].includes(rule.target_type) && lib.type === 'show')
                )
                .map(lib => (
                  <label key={lib.id} className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={rule.target_library_ids?.includes(lib.id)}
                      onChange={(e) => {
                        const ids = rule.target_library_ids || [];
                        setRule(prev => ({
                          ...prev,
                          target_library_ids: e.target.checked
                            ? [...ids, lib.id]
                            : ids.filter(id => id !== lib.id)
                        }));
                      }}
                      className="rounded"
                    />
                    <span>{lib.title}</span>
                  </label>
                ))}
            </div>
          </div>

          {/* Tips */}
          <div className="card p-5 bg-slate-800/50">
            <h3 className="font-medium mb-2">Tips</h3>
            <ul className="text-sm text-slate-400 space-y-2">
              <li>• Start with "Add to collection" to give users time to save content</li>
              <li>• Use "Days Since Watched" to target old content</li>
              <li>• "On Watchlist" protects content users want to keep</li>
              <li>• Preview your rule before enabling it</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Conditions Help Modal */}
      {showConditionsHelp && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <div className="flex items-center space-x-3">
                <BookOpen className="h-6 w-6 text-primary-400" />
                <h2 className="text-xl font-semibold">Conditions Reference Guide</h2>
              </div>
              <button
                onClick={() => setShowConditionsHelp(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="overflow-y-auto p-5 space-y-6">
              {/* AND/OR Explanation */}
              <div className="bg-slate-700/50 rounded-lg p-4">
                <h3 className="font-semibold text-primary-400 mb-2">How Conditions Work</h3>
                <p className="text-slate-300 text-sm mb-3">
                  Use the <span className="text-green-400 font-medium">AND</span> / <span className="text-yellow-400 font-medium">OR</span> buttons between conditions to control how they combine.
                  Conditions are evaluated left-to-right.
                </p>
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-green-400">AND</span>
                    <p className="text-slate-300 mt-1">
                      Both the condition above <strong>and</strong> the condition below must be true.
                    </p>
                    <p className="text-slate-400 mt-1 text-xs">
                      Narrows results - more restrictive
                    </p>
                  </div>
                  <div>
                    <span className="font-medium text-yellow-400">OR</span>
                    <p className="text-slate-300 mt-1">
                      Either the condition above <strong>or</strong> the condition below can be true.
                    </p>
                    <p className="text-slate-400 mt-1 text-xs">
                      Expands results - more inclusive
                    </p>
                  </div>
                </div>
                <div className="mt-3 bg-slate-800/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400 mb-2">
                    <strong>Example:</strong> Watched is Yes <span className="text-green-400">AND</span> Days Since Watched &gt; 30 <span className="text-yellow-400">OR</span> Rating &lt; 5
                  </p>
                  <p className="text-xs text-slate-500">
                    Matches: Content watched over 30 days ago, OR any content rated below 5
                  </p>
                </div>
              </div>

              {/* Condition Fields */}
              <div>
                <h3 className="font-semibold text-lg mb-3">Available Conditions</h3>
                <div className="space-y-3">
                  {Object.entries(CONDITION_HELP).map(([key, help]) => (
                    <div key={key} className="bg-slate-700/30 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-medium text-white">{help.label}</h4>
                        <span className="text-xs bg-slate-600 px-2 py-0.5 rounded text-slate-300">
                          {help.type}
                        </span>
                      </div>
                      <p className="text-slate-300 text-sm">{help.description}</p>
                      <p className="text-slate-400 text-sm mt-2">{help.details}</p>
                      <div className="mt-2 bg-slate-800/50 rounded px-3 py-2">
                        <span className="text-xs text-slate-500">Example: </span>
                        <span className="text-xs text-primary-300">{help.example}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Operators */}
              <div>
                <h3 className="font-semibold text-lg mb-3">Operators Explained</h3>
                <div className="grid md:grid-cols-2 gap-2">
                  {Object.entries(OPERATOR_HELP).map(([key, op]) => (
                    <div key={key} className="bg-slate-700/30 rounded-lg p-3">
                      <span className="font-medium text-primary-400">{op.label}</span>
                      <p className="text-slate-400 text-sm mt-1">{op.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Common Patterns */}
              <div>
                <h3 className="font-semibold text-lg mb-3">Common Rule Patterns</h3>
                <div className="space-y-3">
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                    <h4 className="font-medium text-blue-300">Watched Movie Cleanup</h4>
                    <p className="text-slate-400 text-sm mt-1">
                      <code className="bg-slate-700 px-1 rounded">Watched is Yes</code> AND{' '}
                      <code className="bg-slate-700 px-1 rounded">Days Since Watched &gt; 30</code> AND{' '}
                      <code className="bg-slate-700 px-1 rounded">On Watchlist is No</code>
                    </p>
                    <p className="text-slate-500 text-xs mt-2">
                      Finds movies watched over a month ago that nobody wants to keep.
                    </p>
                  </div>

                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                    <h4 className="font-medium text-green-300">Storage Saver</h4>
                    <p className="text-slate-400 text-sm mt-1">
                      <code className="bg-slate-700 px-1 rounded">File Size &gt; 50</code> AND{' '}
                      <code className="bg-slate-700 px-1 rounded">Watched is Yes</code> AND{' '}
                      <code className="bg-slate-700 px-1 rounded">Days Since Watched &gt; 14</code>
                    </p>
                    <p className="text-slate-500 text-xs mt-2">
                      Targets large files that have been watched recently.
                    </p>
                  </div>

                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                    <h4 className="font-medium text-yellow-300">Low-Quality Content</h4>
                    <p className="text-slate-400 text-sm mt-1">
                      <code className="bg-slate-700 px-1 rounded">Rating &lt; 5</code> AND{' '}
                      <code className="bg-slate-700 px-1 rounded">On Watchlist is No</code> AND{' '}
                      <code className="bg-slate-700 px-1 rounded">Days Since Added &gt; 60</code>
                    </p>
                    <p className="text-slate-500 text-xs mt-2">
                      Removes poorly-rated content nobody seems interested in.
                    </p>
                  </div>

                  <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                    <h4 className="font-medium text-purple-300">Abandoned Content</h4>
                    <p className="text-slate-400 text-sm mt-1">
                      <code className="bg-slate-700 px-1 rounded">Days Since Added &gt; 90</code> AND{' '}
                      <code className="bg-slate-700 px-1 rounded">Watched is No</code> AND{' '}
                      <code className="bg-slate-700 px-1 rounded">On Watchlist is No</code>
                    </p>
                    <p className="text-slate-500 text-xs mt-2">
                      Finds content added months ago that nobody has watched or saved.
                    </p>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-slate-600 pt-6">
                <h2 className="text-xl font-bold text-center mb-6">Actions Reference</h2>
              </div>

              {/* Actions Explanation */}
              <div>
                <h3 className="font-semibold text-lg mb-3">Available Actions</h3>
                <p className="text-slate-400 text-sm mb-4">
                  Actions determine what happens to content that matches your conditions. You can select multiple actions - they run in order.
                </p>
                <div className="space-y-3">
                  {Object.entries(ACTIONS_HELP).map(([key, action]) => (
                    <div key={key} className={`rounded-lg p-4 border ${
                      action.color === 'red' ? 'bg-red-500/10 border-red-500/30' :
                      action.color === 'yellow' ? 'bg-yellow-500/10 border-yellow-500/30' :
                      action.color === 'green' ? 'bg-green-500/10 border-green-500/30' :
                      'bg-blue-500/10 border-blue-500/30'
                    }`}>
                      <div className="flex items-start justify-between mb-2">
                        <h4 className={`font-medium ${
                          action.color === 'red' ? 'text-red-300' :
                          action.color === 'yellow' ? 'text-yellow-300' :
                          action.color === 'green' ? 'text-green-300' :
                          'text-blue-300'
                        }`}>{action.label}</h4>
                        <span className="text-xs bg-slate-600 px-2 py-0.5 rounded text-slate-300">
                          {action.category}
                        </span>
                      </div>
                      <p className="text-slate-300 text-sm">{action.description}</p>
                      <p className="text-slate-400 text-sm mt-2">{action.details}</p>
                      <div className="mt-2 bg-slate-800/50 rounded px-3 py-2">
                        <span className="text-xs text-yellow-400">Note: </span>
                        <span className="text-xs text-slate-300">{action.important}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* File Deletion Explanation */}
              <div className="bg-red-500/10 border-2 border-red-500/50 rounded-lg p-5">
                <h3 className="font-semibold text-lg mb-3 text-red-300 flex items-center space-x-2">
                  <Trash2 className="h-5 w-5" />
                  <span>Understanding File Deletion</span>
                </h3>

                <p className="text-slate-300 text-sm mb-4">
                  The <strong>"Delete files from disk"</strong> action controls whether actual media files are removed from your storage.
                </p>

                <div className="bg-slate-800/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-green-400 text-sm">✓</span>
                    </div>
                    <div>
                      <p className="text-white font-medium">Action NOT checked</p>
                      <p className="text-slate-400 text-sm">
                        Delete actions only remove library entries. Your actual media files stay on disk.
                        You can re-add them to Plex/Sonarr/Radarr later if needed.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-red-400 text-sm">!</span>
                    </div>
                    <div>
                      <p className="text-white font-medium">Action IS checked</p>
                      <p className="text-slate-400 text-sm">
                        Delete actions will <span className="text-red-400 font-medium">permanently remove media files</span> from your disk.
                        This frees up storage space but the files cannot be recovered.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-yellow-500/20 rounded-lg">
                  <p className="text-yellow-300 text-sm">
                    <strong>Tip:</strong> Only check "Delete files from disk" when you're certain you want to free up storage.
                    If you just want to clean up your library without losing files, leave it unchecked.
                  </p>
                </div>
              </div>

              {/* Action Flow */}
              <div className="bg-slate-700/50 rounded-lg p-4">
                <h3 className="font-semibold text-primary-400 mb-3">How Actions Execute</h3>
                <ol className="text-sm text-slate-300 space-y-2 list-decimal list-inside">
                  <li><strong>Rule runs</strong> → Conditions find matching content</li>
                  <li><strong>"Add to collection"</strong> runs immediately → Content goes to Leaving Soon queue</li>
                  <li><strong>Buffer period passes</strong> (e.g., 15 days) → Content sits in queue, users can save items</li>
                  <li><strong>Deletion actions run</strong> → Only AFTER buffer expires, destructive actions execute</li>
                </ol>
                <p className="text-slate-400 text-xs mt-3">
                  This means you can safely add both "Add to collection" AND "Delete from Plex" to the same rule -
                  the deletion won't happen until the buffer period expires.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-700 bg-slate-800/50">
              <button
                onClick={() => setShowConditionsHelp(false)}
                className="btn btn-primary w-full"
              >
                Got it, close guide
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
