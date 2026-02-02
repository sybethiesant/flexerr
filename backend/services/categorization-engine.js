/**
 * Categorization Engine
 *
 * Evaluates categorization rules to determine which root folder
 * and quality profile to use when adding media to Sonarr/Radarr.
 */

const { db } = require('../database');

class CategorizationEngine {
  constructor() {
    this.rulesCache = null;
    this.cacheTime = null;
    this.cacheTTL = 60000; // 1 minute cache
  }

  /**
   * Get all active categorization rules, sorted by priority
   */
  getRules() {
    const now = Date.now();
    if (this.rulesCache && this.cacheTime && (now - this.cacheTime) < this.cacheTTL) {
      return this.rulesCache;
    }

    const rules = db.prepare(`
      SELECT * FROM categorization_rules
      WHERE is_active = 1
      ORDER BY priority DESC, id ASC
    `).all();

    // Parse JSON fields
    this.rulesCache = rules.map(rule => ({
      ...rule,
      conditions: JSON.parse(rule.conditions || '{"operator":"AND","conditions":[]}'),
      radarr_tags: JSON.parse(rule.radarr_tags || '[]'),
      sonarr_tags: JSON.parse(rule.sonarr_tags || '[]')
    }));
    this.cacheTime = now;

    return this.rulesCache;
  }

  /**
   * Clear the rules cache (call after rule changes)
   */
  clearCache() {
    this.rulesCache = null;
    this.cacheTime = null;
  }

  /**
   * Evaluate categorization rules for a media item
   * Returns the first matching rule's settings, or null if no match
   *
   * @param {Object} mediaInfo - Media metadata from TMDB/lookup
   * @param {string} mediaType - 'movie' or 'tv'
   * @returns {Object|null} - { rootFolder, qualityProfileId, tags } or null
   */
  evaluate(mediaInfo, mediaType) {
    const rules = this.getRules();
    const targetType = mediaType === 'movie' ? 'movies' : 'shows';

    for (const rule of rules) {
      // Check if rule applies to this media type
      if (rule.target_type !== 'all' && rule.target_type !== targetType) {
        continue;
      }

      // Evaluate conditions
      if (this.evaluateConditions(rule.conditions, mediaInfo, mediaType)) {
        console.log(`[Categorization] Rule "${rule.name}" matched for "${mediaInfo.title || mediaInfo.name}"`);

        // Update match count
        db.prepare('UPDATE categorization_rules SET last_matched_count = last_matched_count + 1 WHERE id = ?')
          .run(rule.id);

        // Return appropriate settings based on media type
        if (mediaType === 'movie') {
          return {
            ruleId: rule.id,
            ruleName: rule.name,
            mode: rule.mode || 'library',
            collectionName: rule.collection_name,
            rootFolder: rule.radarr_root_folder,
            qualityProfileId: rule.radarr_quality_profile_id,
            tags: rule.radarr_tags || []
          };
        } else {
          return {
            ruleId: rule.id,
            ruleName: rule.name,
            mode: rule.mode || 'library',
            collectionName: rule.collection_name,
            rootFolder: rule.sonarr_root_folder,
            qualityProfileId: rule.sonarr_quality_profile_id,
            tags: rule.sonarr_tags || []
          };
        }
      }
    }

    return null; // No matching rule
  }

  /**
   * Evaluate a condition tree against media info
   */
  evaluateConditions(conditionTree, mediaInfo, mediaType) {
    if (!conditionTree || !conditionTree.conditions || conditionTree.conditions.length === 0) {
      return true; // Empty conditions = always match
    }

    const { operator, conditions } = conditionTree;

    if (operator === 'AND') {
      return conditions.every(cond => this.evaluateSingleCondition(cond, mediaInfo, mediaType));
    } else if (operator === 'OR') {
      return conditions.some(cond => this.evaluateSingleCondition(cond, mediaInfo, mediaType));
    }

    return false;
  }

  /**
   * Evaluate a single condition
   */
  evaluateSingleCondition(condition, mediaInfo, mediaType) {
    // Handle nested condition groups
    if (condition.operator && condition.conditions) {
      return this.evaluateConditions(condition, mediaInfo, mediaType);
    }

    const { field, op, value } = condition;
    let itemValue = this.getFieldValue(field, mediaInfo, mediaType);

    // Normalize for comparison
    if (typeof itemValue === 'string') {
      itemValue = itemValue.toLowerCase();
    }
    let compareValue = value;
    if (typeof compareValue === 'string') {
      compareValue = compareValue.toLowerCase();
    }

    return this.compareValues(itemValue, op, compareValue);
  }

  /**
   * Get field value from media info
   */
  getFieldValue(field, mediaInfo, mediaType) {
    switch (field) {
      // Basic info
      case 'title':
        return mediaInfo.title || mediaInfo.name || '';
      case 'year':
        return mediaInfo.release_date
          ? new Date(mediaInfo.release_date).getFullYear()
          : mediaInfo.first_air_date
            ? new Date(mediaInfo.first_air_date).getFullYear()
            : 0;
      case 'genre':
        // Genre can be an array of objects with 'name' or just names
        if (mediaInfo.genres && Array.isArray(mediaInfo.genres)) {
          return mediaInfo.genres.map(g => typeof g === 'string' ? g : g.name).join(', ');
        }
        if (mediaInfo.genre_ids && Array.isArray(mediaInfo.genre_ids)) {
          // Map genre IDs to names (common TMDB genre IDs)
          return this.mapGenreIds(mediaInfo.genre_ids);
        }
        return '';
      case 'language':
      case 'original_language':
        return mediaInfo.original_language || '';
      case 'content_rating':
        // For TV, it might be in content_ratings, for movies in release_dates
        return mediaInfo.content_rating || '';
      case 'studio':
      case 'network':
        if (mediaInfo.production_companies && Array.isArray(mediaInfo.production_companies)) {
          return mediaInfo.production_companies.map(c => c.name).join(', ');
        }
        if (mediaInfo.networks && Array.isArray(mediaInfo.networks)) {
          return mediaInfo.networks.map(n => n.name).join(', ');
        }
        return '';
      case 'rating':
        return mediaInfo.vote_average || 0;
      case 'popularity':
        return mediaInfo.popularity || 0;
      case 'overview':
        return mediaInfo.overview || '';
      case 'status':
        return mediaInfo.status || '';
      case 'origin_country':
        if (mediaInfo.origin_country && Array.isArray(mediaInfo.origin_country)) {
          return mediaInfo.origin_country.join(', ');
        }
        return mediaInfo.origin_country || '';
      case 'is_anime':
        // Check if anime by genre or origin country
        const genres = this.getFieldValue('genre', mediaInfo, mediaType);
        const origin = this.getFieldValue('origin_country', mediaInfo, mediaType);
        return genres.toLowerCase().includes('animation') && origin.toLowerCase().includes('jp');
      case 'is_documentary':
        return this.getFieldValue('genre', mediaInfo, mediaType).toLowerCase().includes('documentary');
      case 'is_reality':
        return this.getFieldValue('genre', mediaInfo, mediaType).toLowerCase().includes('reality');
      case 'is_kids':
        const genreStr = this.getFieldValue('genre', mediaInfo, mediaType).toLowerCase();
        return genreStr.includes('kids') || genreStr.includes('children') || genreStr.includes('family');
      default:
        return mediaInfo[field] || '';
    }
  }

  /**
   * Map TMDB genre IDs to names
   */
  mapGenreIds(ids) {
    const genreMap = {
      // Movie genres
      28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
      80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
      14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
      9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
      10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
      // TV genres
      10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News',
      10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap',
      10767: 'Talk', 10768: 'War & Politics'
    };
    return ids.map(id => genreMap[id] || '').filter(g => g).join(', ');
  }

  /**
   * Map language name to ISO 639-1 code
   * Used when Radarr/Sonarr returns full language names instead of codes
   */
  mapLanguageNameToCode(name) {
    if (!name) return '';
    const languageMap = {
      'english': 'en', 'spanish': 'es', 'french': 'fr', 'german': 'de',
      'italian': 'it', 'portuguese': 'pt', 'russian': 'ru', 'japanese': 'ja',
      'chinese': 'zh', 'korean': 'ko', 'arabic': 'ar', 'hindi': 'hi',
      'dutch': 'nl', 'polish': 'pl', 'swedish': 'sv', 'danish': 'da',
      'norwegian': 'no', 'finnish': 'fi', 'turkish': 'tr', 'greek': 'el',
      'hebrew': 'he', 'thai': 'th', 'vietnamese': 'vi', 'indonesian': 'id',
      'czech': 'cs', 'hungarian': 'hu', 'romanian': 'ro', 'ukrainian': 'uk',
      'catalan': 'ca', 'croatian': 'hr', 'serbian': 'sr', 'slovak': 'sk',
      'slovenian': 'sl', 'bulgarian': 'bg', 'malay': 'ms', 'tagalog': 'tl',
      'afrikaans': 'af', 'icelandic': 'is', 'estonian': 'et', 'latvian': 'lv',
      'lithuanian': 'lt', 'persian': 'fa', 'bengali': 'bn', 'tamil': 'ta',
      'telugu': 'te', 'kannada': 'kn', 'malayalam': 'ml', 'punjabi': 'pa',
      'marathi': 'mr', 'gujarati': 'gu', 'urdu': 'ur', 'nepali': 'ne',
      'sinhalese': 'si', 'burmese': 'my', 'khmer': 'km', 'lao': 'lo',
      'mongolian': 'mn', 'tibetan': 'bo', 'georgian': 'ka', 'armenian': 'hy',
      'azerbaijani': 'az', 'kazakh': 'kk', 'uzbek': 'uz', 'swahili': 'sw',
      'amharic': 'am', 'somali': 'so', 'hausa': 'ha', 'yoruba': 'yo',
      'igbo': 'ig', 'zulu': 'zu', 'xhosa': 'xh', 'welsh': 'cy',
      'irish': 'ga', 'scottish gaelic': 'gd', 'basque': 'eu', 'galician': 'gl',
      'mandarin': 'zh', 'cantonese': 'zh'
    };
    const normalized = name.toLowerCase().trim();
    return languageMap[normalized] || normalized;
  }

  /**
   * Compare values using the specified operator
   */
  compareValues(itemValue, op, compareValue) {
    switch (op) {
      case 'equals':
        return itemValue === compareValue;
      case 'not_equals':
        return itemValue !== compareValue;
      case 'contains':
        return String(itemValue).includes(String(compareValue));
      case 'not_contains':
        return !String(itemValue).includes(String(compareValue));
      case 'greater_than':
        return Number(itemValue) > Number(compareValue);
      case 'less_than':
        return Number(itemValue) < Number(compareValue);
      case 'greater_than_or_equals':
        return Number(itemValue) >= Number(compareValue);
      case 'less_than_or_equals':
        return Number(itemValue) <= Number(compareValue);
      case 'in':
        // Value is comma-separated list
        const inValues = String(compareValue).split(',').map(v => v.trim().toLowerCase());
        return inValues.some(v => String(itemValue).toLowerCase().includes(v));
      case 'not_in':
        const notInValues = String(compareValue).split(',').map(v => v.trim().toLowerCase());
        return !notInValues.some(v => String(itemValue).toLowerCase().includes(v));
      case 'is_true':
        return itemValue === true || itemValue === 'true' || itemValue === 1;
      case 'is_false':
        return itemValue === false || itemValue === 'false' || itemValue === 0 || !itemValue;
      default:
        return false;
    }
  }

  /**
   * Preview which items would match a rule
   * Used for testing rules before saving
   */
  async previewRule(rule, sampleItems) {
    const matches = [];

    for (const item of sampleItems) {
      const mediaType = item.media_type || (item.first_air_date ? 'tv' : 'movie');
      if (this.evaluateConditions(rule.conditions, item, mediaType)) {
        matches.push({
          id: item.id,
          title: item.title || item.name,
          year: item.release_date?.substring(0, 4) || item.first_air_date?.substring(0, 4),
          genres: this.getFieldValue('genre', item, mediaType),
          language: item.original_language
        });
      }
    }

    return matches;
  }

  /**
   * Batch categorize existing library items
   * Returns list of items that need to be moved
   */
  async analyzeLibrary(radarr, sonarr) {
    const results = {
      movies: [],
      shows: []
    };

    // Analyze movies if Radarr is configured
    if (radarr) {
      try {
        const movies = await radarr.getAllMovies();
        const rootFolders = await radarr.getRootFolders();
        const qualityProfiles = await radarr.getQualityProfiles();

        for (const movie of movies) {
          // Build media info from Radarr movie data
          const mediaInfo = {
            title: movie.title,
            year: movie.year,
            genres: movie.genres || [],
            original_language: this.mapLanguageNameToCode(movie.originalLanguage?.name || ''),
            overview: movie.overview,
            rating: movie.ratings?.tmdb?.value || 0,
            status: movie.status
          };

          const match = this.evaluate(mediaInfo, 'movie');
          if (match && match.rootFolder && match.rootFolder !== movie.rootFolderPath) {
            results.movies.push({
              id: movie.id,
              tmdbId: movie.tmdbId,
              title: movie.title,
              year: movie.year,
              currentRootFolder: movie.rootFolderPath,
              newRootFolder: match.rootFolder,
              currentQualityProfile: qualityProfiles.find(p => p.id === movie.qualityProfileId)?.name,
              newQualityProfile: match.qualityProfileId
                ? qualityProfiles.find(p => p.id === match.qualityProfileId)?.name
                : null,
              ruleName: match.ruleName
            });
          }
        }
      } catch (error) {
        console.error('[Categorization] Error analyzing Radarr library:', error);
      }
    }

    // Analyze shows if Sonarr is configured
    if (sonarr) {
      try {
        const shows = await sonarr.getAllSeries();
        const rootFolders = await sonarr.getRootFolders();
        const qualityProfiles = await sonarr.getQualityProfiles();

        for (const show of shows) {
          const mediaInfo = {
            name: show.title,
            first_air_date: show.firstAired,
            genres: show.genres || [],
            original_language: this.mapLanguageNameToCode(show.originalLanguage?.name || ''),
            overview: show.overview,
            rating: show.ratings?.value || 0,
            status: show.status,
            networks: show.network ? [{ name: show.network }] : []
          };

          const match = this.evaluate(mediaInfo, 'tv');
          if (match && match.rootFolder && match.rootFolder !== show.rootFolderPath) {
            results.shows.push({
              id: show.id,
              tvdbId: show.tvdbId,
              title: show.title,
              year: show.year,
              currentRootFolder: show.rootFolderPath,
              newRootFolder: match.rootFolder,
              currentQualityProfile: qualityProfiles.find(p => p.id === show.qualityProfileId)?.name,
              newQualityProfile: match.qualityProfileId
                ? qualityProfiles.find(p => p.id === match.qualityProfileId)?.name
                : null,
              ruleName: match.ruleName
            });
          }
        }
      } catch (error) {
        console.error('[Categorization] Error analyzing Sonarr library:', error);
      }
    }

    return results;
  }

  /**
   * Apply categorization to existing items (move to new root folders)
   */
  async applyToExisting(radarr, sonarr, itemsToMove) {
    const results = {
      success: [],
      failed: []
    };

    // Move movies
    if (radarr && itemsToMove.movies) {
      for (const movie of itemsToMove.movies) {
        try {
          // Radarr API: Update movie with new rootFolderPath and moveFiles=true
          await radarr.updateMovie(movie.id, {
            rootFolderPath: movie.newRootFolder,
            qualityProfileId: movie.newQualityProfileId || undefined,
            moveFiles: true
          });
          results.success.push({ type: 'movie', ...movie });
        } catch (error) {
          results.failed.push({ type: 'movie', ...movie, error: error.message });
        }
      }
    }

    // Move shows
    if (sonarr && itemsToMove.shows) {
      for (const show of itemsToMove.shows) {
        try {
          await sonarr.updateSeries(show.id, {
            rootFolderPath: show.newRootFolder,
            qualityProfileId: show.newQualityProfileId || undefined,
            moveFiles: true
          });
          results.success.push({ type: 'show', ...show });
        } catch (error) {
          results.failed.push({ type: 'show', ...show, error: error.message });
        }
      }
    }

    return results;
  }

  /**
   * Evaluate ALL collection-mode rules for a media item
   * Returns array of ALL matching collection rules (for multi-collection support)
   *
   * @param {Object} mediaInfo - Media metadata from TMDB/lookup
   * @param {string} mediaType - 'movie' or 'tv'
   * @returns {Array} - Array of { ruleId, ruleName, collectionName }
   */
  evaluateAllCollections(mediaInfo, mediaType) {
    const rules = this.getRules().filter(r => r.mode === 'collection' && r.collection_name);
    const targetType = mediaType === 'movie' ? 'movies' : 'shows';
    const matches = [];

    for (const rule of rules) {
      // Check if rule applies to this media type
      if (rule.target_type !== 'all' && rule.target_type !== targetType) {
        continue;
      }

      // Evaluate conditions
      if (this.evaluateConditions(rule.conditions, mediaInfo, mediaType)) {
        matches.push({
          ruleId: rule.id,
          ruleName: rule.name,
          collectionName: rule.collection_name
        });
      }
    }

    return matches;
  }

  /**
   * Get the first matching library-mode rule
   * Used for determining root folder when adding new items
   *
   * @param {Object} mediaInfo - Media metadata from TMDB/lookup
   * @param {string} mediaType - 'movie' or 'tv'
   * @returns {Object|null} - Matching library rule or null
   */
  evaluateLibraryRule(mediaInfo, mediaType) {
    const rules = this.getRules().filter(r => r.mode === 'library' || !r.mode);
    const targetType = mediaType === 'movie' ? 'movies' : 'shows';

    for (const rule of rules) {
      // Check if rule applies to this media type
      if (rule.target_type !== 'all' && rule.target_type !== targetType) {
        continue;
      }

      // Evaluate conditions
      if (this.evaluateConditions(rule.conditions, mediaInfo, mediaType)) {
        console.log(`[Categorization] Library rule "${rule.name}" matched for "${mediaInfo.title || mediaInfo.name}"`);

        // Return appropriate settings based on media type
        if (mediaType === 'movie') {
          return {
            ruleId: rule.id,
            ruleName: rule.name,
            mode: 'library',
            rootFolder: rule.radarr_root_folder,
            qualityProfileId: rule.radarr_quality_profile_id,
            tags: rule.radarr_tags || []
          };
        } else {
          return {
            ruleId: rule.id,
            ruleName: rule.name,
            mode: 'library',
            rootFolder: rule.sonarr_root_folder,
            qualityProfileId: rule.sonarr_quality_profile_id,
            tags: rule.sonarr_tags || []
          };
        }
      }
    }

    return null;
  }
}

module.exports = new CategorizationEngine();
