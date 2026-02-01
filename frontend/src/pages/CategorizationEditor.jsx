import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Save,
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  FolderTree,
  Film,
  Tv,
  Layers,
  FolderOpen
} from 'lucide-react';
import { useToast } from '../components/Toast';
import { api } from '../App';

// Condition fields available for categorization
const CONDITION_FIELDS = [
  // Basic Info
  { value: 'genre', label: 'Genre', type: 'text', category: 'Basic Info' },
  { value: 'language', label: 'Original Language', type: 'text', category: 'Basic Info' },
  { value: 'origin_country', label: 'Origin Country', type: 'text', category: 'Basic Info' },
  { value: 'year', label: 'Year', type: 'number', category: 'Basic Info' },
  { value: 'rating', label: 'Rating (0-10)', type: 'number', category: 'Basic Info' },
  { value: 'popularity', label: 'Popularity Score', type: 'number', category: 'Basic Info' },

  // Content Type
  { value: 'is_anime', label: 'Is Anime', type: 'boolean', category: 'Content Type' },
  { value: 'is_documentary', label: 'Is Documentary', type: 'boolean', category: 'Content Type' },
  { value: 'is_reality', label: 'Is Reality TV', type: 'boolean', category: 'Content Type' },
  { value: 'is_kids', label: 'Is Kids/Family', type: 'boolean', category: 'Content Type' },

  // Production
  { value: 'studio', label: 'Studio / Production Company', type: 'text', category: 'Production' },
  { value: 'network', label: 'Network', type: 'text', category: 'Production' },

  // Other
  { value: 'title', label: 'Title', type: 'text', category: 'Other' },
  { value: 'overview', label: 'Overview/Description', type: 'text', category: 'Other' },
  { value: 'status', label: 'Status', type: 'text', category: 'Other' }
];

const OPERATORS = {
  text: [
    { value: 'contains', label: 'Contains' },
    { value: 'not_contains', label: 'Does not contain' },
    { value: 'equals', label: 'Equals' },
    { value: 'not_equals', label: 'Does not equal' },
    { value: 'in', label: 'Is one of (comma-separated)' },
    { value: 'not_in', label: 'Is not one of' }
  ],
  number: [
    { value: 'equals', label: 'Equals' },
    { value: 'not_equals', label: 'Does not equal' },
    { value: 'greater_than', label: 'Greater than' },
    { value: 'less_than', label: 'Less than' },
    { value: 'greater_than_or_equals', label: 'Greater than or equals' },
    { value: 'less_than_or_equals', label: 'Less than or equals' }
  ],
  boolean: [
    { value: 'is_true', label: 'Is true' },
    { value: 'is_false', label: 'Is false' }
  ]
};

// Predefined options for dropdown fields
const FIELD_OPTIONS = {
  genre: [
    'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary',
    'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Kids', 'Music',
    'Mystery', 'News', 'Reality', 'Romance', 'Science Fiction', 'Soap',
    'Talk', 'Thriller', 'War', 'Western'
  ],
  language: [
    { value: 'en', label: 'English' },
    { value: 'ja', label: 'Japanese' },
    { value: 'ko', label: 'Korean' },
    { value: 'es', label: 'Spanish' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'it', label: 'Italian' },
    { value: 'pt', label: 'Portuguese' },
    { value: 'ru', label: 'Russian' },
    { value: 'zh', label: 'Chinese' },
    { value: 'hi', label: 'Hindi' },
    { value: 'ar', label: 'Arabic' },
    { value: 'th', label: 'Thai' },
    { value: 'tr', label: 'Turkish' },
    { value: 'pl', label: 'Polish' },
    { value: 'nl', label: 'Dutch' },
    { value: 'sv', label: 'Swedish' },
    { value: 'da', label: 'Danish' },
    { value: 'no', label: 'Norwegian' },
    { value: 'fi', label: 'Finnish' }
  ],
  origin_country: [
    { value: 'US', label: 'United States' },
    { value: 'GB', label: 'United Kingdom' },
    { value: 'JP', label: 'Japan' },
    { value: 'KR', label: 'South Korea' },
    { value: 'CA', label: 'Canada' },
    { value: 'AU', label: 'Australia' },
    { value: 'DE', label: 'Germany' },
    { value: 'FR', label: 'France' },
    { value: 'ES', label: 'Spain' },
    { value: 'IT', label: 'Italy' },
    { value: 'IN', label: 'India' },
    { value: 'CN', label: 'China' },
    { value: 'BR', label: 'Brazil' },
    { value: 'MX', label: 'Mexico' },
    { value: 'NZ', label: 'New Zealand' },
    { value: 'SE', label: 'Sweden' },
    { value: 'NO', label: 'Norway' },
    { value: 'DK', label: 'Denmark' }
  ],
  status: [
    { value: 'Returning Series', label: 'Returning Series' },
    { value: 'Ended', label: 'Ended' },
    { value: 'Canceled', label: 'Canceled' },
    { value: 'In Production', label: 'In Production' },
    { value: 'Released', label: 'Released (Movie)' },
    { value: 'Post Production', label: 'Post Production' },
    { value: 'Rumored', label: 'Rumored' }
  ]
};

export default function CategorizationEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isNew = !id || id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [newFolderPath, setNewFolderPath] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(null); // 'radarr' or 'sonarr'

  const [rule, setRule] = useState({
    name: '',
    description: '',
    target_type: 'all',
    conditions: { operator: 'AND', conditions: [] },
    mode: 'collection',
    collection_name: '',
    radarr_root_folder: '',
    radarr_quality_profile_id: null,
    radarr_tags: [],
    sonarr_root_folder: '',
    sonarr_quality_profile_id: null,
    sonarr_tags: [],
    priority: 0,
    is_active: true
  });

  useEffect(() => {
    fetchOptions();
    if (!isNew) {
      fetchRule();
    }
  }, [id]);

  const fetchOptions = async () => {
    try {
      const res = await api.get('/categorization/options');
      setOptions(res.data);
    } catch (error) {
      showToast('Failed to fetch options', 'error');
    } finally {
      setLoadingOptions(false);
    }
  };

  const createRootFolder = async (service) => {
    if (!newFolderPath.trim()) {
      showToast('Enter a folder path', 'error');
      return;
    }

    setCreatingFolder(service);
    try {
      await api.post('/categorization/rootfolder', {
        path: newFolderPath.trim(),
        service
      });

      showToast(`Created ${newFolderPath}`, 'success');
      setNewFolderPath('');

      // Refresh options to get the new folder
      await fetchOptions();

      // Auto-select the new folder
      if (service === 'radarr') {
        setRule(prev => ({ ...prev, radarr_root_folder: newFolderPath.trim() }));
      } else {
        setRule(prev => ({ ...prev, sonarr_root_folder: newFolderPath.trim() }));
      }
    } catch (error) {
      showToast(error.response?.data?.error || error.message, 'error');
    } finally {
      setCreatingFolder(null);
    }
  };

  const fetchRule = async () => {
    try {
      const res = await api.get(`/categorization/${id}`);
      setRule(res.data);
    } catch (error) {
      showToast('Failed to fetch rule', 'error');
      navigate('/admin/categorization');
    } finally {
      setLoading(false);
    }
  };

  const saveRule = async () => {
    if (!rule.name.trim()) {
      showToast('Rule name is required', 'error');
      return;
    }

    // Validate based on mode
    if (rule.mode === 'collection') {
      if (!rule.collection_name?.trim()) {
        showToast('Collection name is required for collection mode', 'error');
        return;
      }
    } else {
      // Library mode - validate that at least one root folder is set
      if (!rule.radarr_root_folder && !rule.sonarr_root_folder) {
        showToast('Set at least one root folder (Radarr or Sonarr)', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      if (isNew) {
        await api.post('/categorization', rule);
      } else {
        await api.put(`/categorization/${id}`, rule);
      }

      showToast(isNew ? 'Rule created' : 'Rule updated', 'success');
      navigate('/admin/categorization');
    } catch (error) {
      showToast(error.response?.data?.error || error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addCondition = () => {
    setRule(prev => ({
      ...prev,
      conditions: {
        ...prev.conditions,
        conditions: [
          ...prev.conditions.conditions,
          { field: 'genre', op: 'contains', value: '' }
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

  const getFieldType = (fieldValue) => {
    const field = CONDITION_FIELDS.find(f => f.value === fieldValue);
    return field?.type || 'text';
  };

  // Group condition fields by category
  const groupedFields = CONDITION_FIELDS.reduce((acc, field) => {
    if (!acc[field.category]) acc[field.category] = [];
    acc[field.category].push(field);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/admin/categorization')}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">
              {isNew ? 'New Categorization Rule' : 'Edit Categorization Rule'}
            </h1>
            <p className="text-slate-400 mt-1">
              Define conditions to automatically categorize media
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={rule.is_active}
              onChange={(e) => setRule(prev => ({ ...prev, is_active: e.target.checked }))}
              className="rounded w-4 h-4 bg-slate-700 border-slate-600 text-primary-600 focus:ring-primary-500 focus:ring-offset-slate-800"
            />
            <span className="text-sm">Active</span>
          </label>
          <button
            onClick={saveRule}
            disabled={saving}
            className="btn-primary flex items-center space-x-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span>{saving ? 'Saving...' : 'Save Rule'}</span>
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Main Editor - Full Width */}
        <div className="space-y-6">
          {/* Basic Info */}
          <div className="card p-5 space-y-4">
            <h2 className="font-semibold flex items-center space-x-2">
              <FolderTree className="h-5 w-5 text-primary-400" />
              <span>Rule Details</span>
            </h2>

            <div>
              <label className="block text-sm font-medium mb-2">Rule Name</label>
              <input
                type="text"
                value={rule.name}
                onChange={(e) => setRule(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Anime to Anime Folder"
                className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Description (optional)</label>
              <input
                type="text"
                value={rule.description || ''}
                onChange={(e) => setRule(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Brief description of what this rule does"
                className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* Mode Selection */}
            <div>
              <label className="block text-sm font-medium mb-2">Organization Mode</label>
              <div className="flex items-center space-x-6">
                <label className="flex items-center space-x-2 cursor-pointer group">
                  <input
                    type="radio"
                    name="mode"
                    value="collection"
                    checked={rule.mode === 'collection'}
                    onChange={(e) => setRule(prev => ({ ...prev, mode: e.target.value }))}
                    className="w-4 h-4 text-primary-600 bg-slate-700 border-slate-600 focus:ring-primary-500"
                  />
                  <Layers className="h-4 w-4 text-primary-400" />
                  <span>Collection</span>
                  <span className="text-xs text-slate-500">(Group in Plex)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer group">
                  <input
                    type="radio"
                    name="mode"
                    value="library"
                    checked={rule.mode === 'library'}
                    onChange={(e) => setRule(prev => ({ ...prev, mode: e.target.value }))}
                    className="w-4 h-4 text-primary-600 bg-slate-700 border-slate-600 focus:ring-primary-500"
                  />
                  <FolderOpen className="h-4 w-4 text-amber-400" />
                  <span>Library</span>
                  <span className="text-xs text-slate-500">(Separate folder)</span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {rule.mode === 'collection'
                  ? 'Items will appear in a Plex collection within existing library. Items can match multiple collection rules.'
                  : 'Items will be placed in a specific root folder. Only the first matching library rule applies.'}
              </p>
            </div>

            {/* Collection Name - only for collection mode */}
            {rule.mode === 'collection' && (
              <div>
                <label className="block text-sm font-medium mb-2">Collection Name</label>
                <input
                  type="text"
                  value={rule.collection_name || ''}
                  onChange={(e) => setRule(prev => ({ ...prev, collection_name: e.target.value }))}
                  placeholder="e.g., Horror Movies, Anime, Sci-Fi"
                  className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-slate-500 mt-1">This will create a collection in Plex with matching items</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Target Type</label>
                <select
                  value={rule.target_type}
                  onChange={(e) => setRule(prev => ({ ...prev, target_type: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="all">All Media</option>
                  <option value="movies">Movies Only</option>
                  <option value="shows">TV Shows Only</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Priority</label>
                <input
                  type="number"
                  value={rule.priority}
                  onChange={(e) => setRule(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
                  min="0"
                  className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-slate-500 mt-1">Higher priority rules are evaluated first</p>
              </div>
            </div>
          </div>

          {/* Conditions */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Conditions</h2>
              <div className="flex items-center space-x-3">
                <select
                  value={rule.conditions.operator}
                  onChange={(e) => setRule(prev => ({
                    ...prev,
                    conditions: { ...prev.conditions, operator: e.target.value }
                  }))}
                  className="px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="AND">Match ALL (AND)</option>
                  <option value="OR">Match ANY (OR)</option>
                </select>
                <button
                  onClick={addCondition}
                  className="btn-secondary flex items-center space-x-1 text-sm py-1.5"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add Condition</span>
                </button>
              </div>
            </div>

            {rule.conditions.conditions.length === 0 ? (
              <div className="p-6 text-center text-slate-400 border border-dashed border-slate-700 rounded-lg">
                <p>No conditions added yet</p>
                <p className="text-sm mt-1">Rules without conditions will match all media of the target type</p>
              </div>
            ) : (
              <div className="space-y-3">
                {rule.conditions.conditions.map((condition, index) => {
                  const fieldType = getFieldType(condition.field);
                  const operators = OPERATORS[fieldType] || OPERATORS.text;

                  return (
                    <div key={index} className="p-4 bg-slate-700/50 rounded-lg">
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                        {/* Field selector - 3 cols */}
                        <select
                          value={condition.field}
                          onChange={(e) => {
                            const newType = getFieldType(e.target.value);
                            updateCondition(index, {
                              field: e.target.value,
                              op: OPERATORS[newType][0].value,
                              value: newType === 'boolean' ? '' : ''
                            });
                          }}
                          className="md:col-span-3 px-3 py-2.5 rounded-lg border border-slate-600 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          {Object.entries(groupedFields).map(([category, fields]) => (
                            <optgroup key={category} label={category}>
                              {fields.map(f => (
                                <option key={f.value} value={f.value}>{f.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>

                        {/* Operator selector - 3 cols */}
                        <select
                          value={condition.op}
                          onChange={(e) => updateCondition(index, { op: e.target.value })}
                          className="md:col-span-3 px-3 py-2.5 rounded-lg border border-slate-600 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          {operators.map(op => (
                            <option key={op.value} value={op.value}>{op.label}</option>
                          ))}
                        </select>

                        {/* Value field - 5 cols */}
                        {fieldType !== 'boolean' && (
                          FIELD_OPTIONS[condition.field] ? (
                            <select
                              value={condition.value}
                              onChange={(e) => updateCondition(index, { value: e.target.value })}
                              className="md:col-span-5 px-3 py-2.5 rounded-lg border border-slate-600 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                            >
                              <option value="">-- Select Value --</option>
                              {FIELD_OPTIONS[condition.field].map(opt =>
                                typeof opt === 'string' ? (
                                  <option key={opt} value={opt}>{opt}</option>
                                ) : (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                )
                              )}
                            </select>
                          ) : (
                            <input
                              type={fieldType === 'number' ? 'number' : 'text'}
                              value={condition.value}
                              onChange={(e) => updateCondition(index, { value: e.target.value })}
                              placeholder={fieldType === 'number' ? '0' : 'Enter value...'}
                              className="md:col-span-5 px-3 py-2.5 rounded-lg border border-slate-600 bg-slate-800 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                          )
                        )}

                        {/* Spacer for boolean fields */}
                        {fieldType === 'boolean' && <div className="md:col-span-5" />}

                        {/* Delete button - 1 col */}
                        <button
                          onClick={() => removeCondition(index)}
                          className="md:col-span-1 p-2.5 text-slate-400 hover:text-red-400 hover:bg-red-500/20 rounded-lg transition-colors flex items-center justify-center"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Destination Settings - only for library mode */}
          {rule.mode === 'library' && (
          <div className="card p-5 space-y-6">
            <h2 className="font-semibold flex items-center space-x-2">
              <FolderOpen className="h-5 w-5 text-amber-400" />
              <span>Destination Settings</span>
            </h2>

            {/* Radarr Settings */}
            {(rule.target_type === 'all' || rule.target_type === 'movies') && (
              <div className="space-y-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <h3 className="font-medium flex items-center space-x-2 text-blue-400">
                  <Film className="h-4 w-4" />
                  <span>Radarr (Movies)</span>
                </h3>

                <div>
                  <label className="block text-sm font-medium mb-2">Root Folder</label>
                  {loadingOptions ? (
                    <div className="flex items-center space-x-2 text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading folders...</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <select
                        value={rule.radarr_root_folder || ''}
                        onChange={(e) => setRule(prev => ({ ...prev, radarr_root_folder: e.target.value || null }))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="">-- Use Radarr Default --</option>
                        {/* Show current value if not in options list */}
                        {rule.radarr_root_folder && !options?.radarr?.rootFolders?.some(f => f.path === rule.radarr_root_folder) && (
                          <option value={rule.radarr_root_folder}>{rule.radarr_root_folder} (current)</option>
                        )}
                        {options?.radarr?.rootFolders?.map(folder => (
                          <option key={folder.path} value={folder.path}>
                            {folder.path} ({Math.round(folder.freeSpace / 1024 / 1024 / 1024)}GB free)
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={newFolderPath}
                          onChange={(e) => setNewFolderPath(e.target.value)}
                          placeholder="/Media/Movies-NewCategory"
                          className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-600 bg-slate-800 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <button
                          onClick={() => createRootFolder('radarr')}
                          disabled={creatingFolder === 'radarr' || !newFolderPath.trim()}
                          className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
                        >
                          {creatingFolder === 'radarr' ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Plus className="h-3 w-3" />
                          )}
                          <span>Add</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Quality Profile</label>
                  <select
                    value={rule.radarr_quality_profile_id || ''}
                    onChange={(e) => setRule(prev => ({ ...prev, radarr_quality_profile_id: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">-- Use Radarr Default --</option>
                    {options?.radarr?.qualityProfiles?.map(profile => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Sonarr Settings */}
            {(rule.target_type === 'all' || rule.target_type === 'shows') && (
              <div className="space-y-4 p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <h3 className="font-medium flex items-center space-x-2 text-purple-400">
                  <Tv className="h-4 w-4" />
                  <span>Sonarr (TV Shows)</span>
                </h3>

                <div>
                  <label className="block text-sm font-medium mb-2">Root Folder</label>
                  {loadingOptions ? (
                    <div className="flex items-center space-x-2 text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading folders...</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <select
                        value={rule.sonarr_root_folder || ''}
                        onChange={(e) => setRule(prev => ({ ...prev, sonarr_root_folder: e.target.value || null }))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="">-- Use Sonarr Default --</option>
                        {/* Show current value if not in options list */}
                        {rule.sonarr_root_folder && !options?.sonarr?.rootFolders?.some(f => f.path === rule.sonarr_root_folder) && (
                          <option value={rule.sonarr_root_folder}>{rule.sonarr_root_folder} (current)</option>
                        )}
                        {options?.sonarr?.rootFolders?.map(folder => (
                          <option key={folder.path} value={folder.path}>
                            {folder.path} ({Math.round(folder.freeSpace / 1024 / 1024 / 1024)}GB free)
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={newFolderPath}
                          onChange={(e) => setNewFolderPath(e.target.value)}
                          placeholder="/Media/TVShows-NewCategory"
                          className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-600 bg-slate-800 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <button
                          onClick={() => createRootFolder('sonarr')}
                          disabled={creatingFolder === 'sonarr' || !newFolderPath.trim()}
                          className="px-3 py-1.5 text-sm rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
                        >
                          {creatingFolder === 'sonarr' ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Plus className="h-3 w-3" />
                          )}
                          <span>Add</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Quality Profile</label>
                  <select
                    value={rule.sonarr_quality_profile_id || ''}
                    onChange={(e) => setRule(prev => ({ ...prev, sonarr_quality_profile_id: e.target.value ? parseInt(e.target.value) : null }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">-- Use Sonarr Default --</option>
                    {options?.sonarr?.qualityProfiles?.map(profile => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
          )}
        </div>

        {/* Quick Start Templates */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm">Quick Start Templates</h3>
            <span className="text-xs text-slate-500">Click to apply a template</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setRule(prev => ({
                ...prev,
                name: prev.name || 'Anime',
                collection_name: prev.collection_name || 'Anime',
                conditions: { operator: 'AND', conditions: [{ field: 'is_anime', op: 'is_true', value: '' }] }
              }))}
              className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
            >
              Anime
            </button>
            <button
              onClick={() => setRule(prev => ({
                ...prev,
                name: prev.name || 'Documentaries',
                collection_name: prev.collection_name || 'Documentaries',
                conditions: { operator: 'AND', conditions: [{ field: 'is_documentary', op: 'is_true', value: '' }] }
              }))}
              className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
            >
              Documentaries
            </button>
            <button
              onClick={() => setRule(prev => ({
                ...prev,
                name: prev.name || 'Kids & Family',
                collection_name: prev.collection_name || 'Kids & Family',
                conditions: { operator: 'AND', conditions: [{ field: 'is_kids', op: 'is_true', value: '' }] }
              }))}
              className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
            >
              Kids & Family
            </button>
            <button
              onClick={() => setRule(prev => ({
                ...prev,
                name: prev.name || 'Foreign Films',
                collection_name: prev.collection_name || 'Foreign Films',
                conditions: { operator: 'AND', conditions: [{ field: 'language', op: 'not_equals', value: 'en' }] }
              }))}
              className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
            >
              Foreign (Non-English)
            </button>
            <button
              onClick={() => setRule(prev => ({
                ...prev,
                name: prev.name || 'Reality TV',
                collection_name: prev.collection_name || 'Reality TV',
                conditions: { operator: 'AND', conditions: [{ field: 'is_reality', op: 'is_true', value: '' }] }
              }))}
              className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
            >
              Reality TV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
