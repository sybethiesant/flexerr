/**
 * TMDB Service for Flexerr
 * Handles all interactions with The Movie Database API
 */

const axios = require('axios');
const { getSetting } = require('../database');

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Default TMDB API key for Flexerr (like Overseerr, we ship with a default key)
// Users can override with their own key in settings if desired
const DEFAULT_TMDB_API_KEY = 'd88323267a243671a5da6ae5e8d7a66e';

class TMDBService {
  constructor() {
    this.apiKey = null;
    this.imageBaseUrl = TMDB_IMAGE_BASE;
  }

  /**
   * Get API key from settings, falling back to default
   */
  getApiKey() {
    if (!this.apiKey) {
      this.apiKey = getSetting('tmdb_api_key') || DEFAULT_TMDB_API_KEY;
    }
    return this.apiKey;
  }

  /**
   * Refresh API key from settings (call after settings change)
   */
  refreshApiKey() {
    this.apiKey = getSetting('tmdb_api_key') || DEFAULT_TMDB_API_KEY;
    return this.apiKey;
  }

  /**
   * Check if TMDB is configured (always true now with default key)
   */
  isConfigured() {
    return true;
  }

  /**
   * Check if using custom API key vs default
   */
  isUsingCustomKey() {
    const customKey = getSetting('tmdb_api_key');
    return customKey && customKey !== DEFAULT_TMDB_API_KEY;
  }

  /**
   * Make API request to TMDB
   */
  async request(endpoint, params = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('TMDB API key not configured');
    }

    try {
      const response = await axios.get(`${TMDB_BASE_URL}${endpoint}`, {
        params: {
          api_key: apiKey,
          ...params
        }
      });
      return response.data;
    } catch (error) {
      console.error(`[TMDB] Error fetching ${endpoint}:`, error.message);
      throw error;
    }
  }

  /**
   * Search for movies and TV shows
   */
  async searchMulti(query, page = 1) {
    const data = await this.request('/search/multi', { query, page });
    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results
        .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
        .map(r => this.formatSearchResult(r))
    };
  }

  /**
   * Search for movies only
   */
  async searchMovies(query, page = 1) {
    const data = await this.request('/search/movie', { query, page });
    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results.map(r => this.formatSearchResult({ ...r, media_type: 'movie' }))
    };
  }

  /**
   * Search for TV shows only
   */
  async searchTV(query, page = 1) {
    const data = await this.request('/search/tv', { query, page });
    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results.map(r => this.formatSearchResult({ ...r, media_type: 'tv' }))
    };
  }

  /**
   * Get movie details
   */
  async getMovie(tmdbId) {
    const data = await this.request(`/movie/${tmdbId}`, {
      append_to_response: 'credits,videos,recommendations,external_ids,release_dates'
    });
    return this.formatMovieDetails(data);
  }

  /**
   * Get TV show details
   */
  async getTVShow(tmdbId) {
    const data = await this.request(`/tv/${tmdbId}`, {
      append_to_response: 'credits,videos,recommendations,external_ids,content_ratings'
    });
    return this.formatTVDetails(data);
  }

  /**
   * Get TV season details
   */
  async getTVSeason(tmdbId, seasonNumber) {
    const data = await this.request(`/tv/${tmdbId}/season/${seasonNumber}`);
    return {
      id: data.id,
      season_number: data.season_number,
      name: data.name,
      overview: data.overview,
      poster_path: this.getImageUrl(data.poster_path, 'w300'),
      air_date: data.air_date,
      episodes: data.episodes.map(ep => ({
        id: ep.id,
        episode_number: ep.episode_number,
        name: ep.name,
        overview: ep.overview,
        still_path: this.getImageUrl(ep.still_path, 'w300'),
        air_date: ep.air_date,
        runtime: ep.runtime,
        vote_average: ep.vote_average
      }))
    };
  }

  /**
   * Get external IDs for a movie or TV show (TVDB, IMDB)
   */
  async getExternalIds(tmdbId, mediaType) {
    const endpoint = mediaType === 'movie'
      ? `/movie/${tmdbId}/external_ids`
      : `/tv/${tmdbId}/external_ids`;
    return await this.request(endpoint);
  }

  /**
   * Get trending content
   */
  async getTrending(mediaType = 'all', timeWindow = 'week', page = 1) {
    const data = await this.request(`/trending/${mediaType}/${timeWindow}`, { page });
    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results.map(r => this.formatSearchResult(r))
    };
  }

  /**
   * Get popular content
   */
  async getPopular(mediaType = 'movie', page = 1) {
    const endpoint = mediaType === 'movie' ? '/movie/popular' : '/tv/popular';
    const data = await this.request(endpoint, { page });
    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results.map(r => this.formatSearchResult({ ...r, media_type: mediaType }))
    };
  }

  /**
   * Get top rated content
   */
  async getTopRated(mediaType = 'movie', page = 1) {
    const endpoint = mediaType === 'movie' ? '/movie/top_rated' : '/tv/top_rated';
    const data = await this.request(endpoint, { page });
    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results.map(r => this.formatSearchResult({ ...r, media_type: mediaType }))
    };
  }

  /**
   * Get upcoming movies
   */
  async getUpcoming(page = 1) {
    const data = await this.request('/movie/upcoming', { page });
    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results.map(r => this.formatSearchResult({ ...r, media_type: 'movie' }))
    };
  }

  /**
   * Get recommendations based on a movie/show
   */
  async getRecommendations(tmdbId, mediaType, page = 1) {
    const endpoint = mediaType === 'movie'
      ? `/movie/${tmdbId}/recommendations`
      : `/tv/${tmdbId}/recommendations`;
    const data = await this.request(endpoint, { page });
    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results.map(r => this.formatSearchResult({ ...r, media_type: mediaType }))
    };
  }

  /**
   * Get similar content
   */
  async getSimilar(tmdbId, mediaType, page = 1) {
    const endpoint = mediaType === 'movie'
      ? `/movie/${tmdbId}/similar`
      : `/tv/${tmdbId}/similar`;
    const data = await this.request(endpoint, { page });
    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results.map(r => this.formatSearchResult({ ...r, media_type: mediaType }))
    };
  }

  /**
   * Discover movies with filters
   */
  async discoverMovies(filters = {}, page = 1) {
    const data = await this.request('/discover/movie', { ...filters, page });
    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results.map(r => this.formatSearchResult({ ...r, media_type: 'movie' }))
    };
  }

  /**
   * Discover TV shows with filters
   */
  async discoverTV(filters = {}, page = 1) {
    const data = await this.request('/discover/tv', { ...filters, page });
    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results.map(r => this.formatSearchResult({ ...r, media_type: 'tv' }))
    };
  }

  /**
   * Get movie/TV genres
   */
  async getGenres(mediaType = 'movie') {
    const endpoint = mediaType === 'movie' ? '/genre/movie/list' : '/genre/tv/list';
    const data = await this.request(endpoint);
    return data.genres;
  }

  /**
   * Get available streaming providers (Netflix, Disney+, etc.)
   * Data powered by JustWatch
   */
  async getWatchProviders(mediaType = 'movie', region = 'US') {
    const endpoint = mediaType === 'movie'
      ? '/watch/providers/movie'
      : '/watch/providers/tv';
    const data = await this.request(endpoint, { watch_region: region });

    // Return formatted provider list sorted by display_priority
    return (data.results || [])
      .sort((a, b) => a.display_priority - b.display_priority)
      .map(p => ({
        id: p.provider_id,
        name: p.provider_name,
        logo_path: this.getImageUrl(p.logo_path, 'w92'),
        display_priority: p.display_priority
      }));
  }

  /**
   * Get available watch provider regions
   */
  async getWatchProviderRegions() {
    const data = await this.request('/watch/providers/regions');
    return (data.results || [])
      .sort((a, b) => a.english_name.localeCompare(b.english_name))
      .map(r => ({
        code: r.iso_3166_1,
        name: r.english_name,
        native_name: r.native_name
      }));
  }

  /**
   * Get watch providers for a specific movie/TV show
   */
  async getItemWatchProviders(tmdbId, mediaType, region = 'US') {
    const endpoint = mediaType === 'movie'
      ? `/movie/${tmdbId}/watch/providers`
      : `/tv/${tmdbId}/watch/providers`;
    const data = await this.request(endpoint);

    // Get providers for the requested region
    const regionData = data.results?.[region];
    if (!regionData) return null;

    return {
      link: regionData.link,
      flatrate: (regionData.flatrate || []).map(p => ({
        id: p.provider_id,
        name: p.provider_name,
        logo_path: this.getImageUrl(p.logo_path, 'w92')
      })),
      rent: (regionData.rent || []).map(p => ({
        id: p.provider_id,
        name: p.provider_name,
        logo_path: this.getImageUrl(p.logo_path, 'w92')
      })),
      buy: (regionData.buy || []).map(p => ({
        id: p.provider_id,
        name: p.provider_name,
        logo_path: this.getImageUrl(p.logo_path, 'w92')
      }))
    };
  }

  /**
   * Advanced discover with all filter options
   * Supports: genres, year range, rating, runtime, providers, sort
   */
  async discoverWithFilters(mediaType = 'movie', options = {}) {
    const {
      page = 1,
      providers,        // Comma-separated provider IDs (e.g., "8,337")
      genres,           // Comma-separated genre IDs
      yearMin,
      yearMax,
      ratingMin,
      ratingMax,
      runtimeMin,
      runtimeMax,
      sortBy = 'popularity.desc',
      region = 'US'
    } = options;

    const params = {
      page,
      sort_by: sortBy,
      'vote_count.gte': 10  // Require at least some votes
    };

    // Provider filtering (requires watch_region)
    if (providers) {
      params.with_watch_providers = providers;
      params.watch_region = region;
    }

    // Genre filtering
    if (genres) {
      params.with_genres = genres;
    }

    // Year filtering
    if (mediaType === 'movie') {
      if (yearMin) params['primary_release_date.gte'] = `${yearMin}-01-01`;
      if (yearMax) params['primary_release_date.lte'] = `${yearMax}-12-31`;
    } else {
      if (yearMin) params['first_air_date.gte'] = `${yearMin}-01-01`;
      if (yearMax) params['first_air_date.lte'] = `${yearMax}-12-31`;
    }

    // Rating filtering
    if (ratingMin) params['vote_average.gte'] = ratingMin;
    if (ratingMax) params['vote_average.lte'] = ratingMax;

    // Runtime filtering (movies only)
    if (mediaType === 'movie') {
      if (runtimeMin) params['with_runtime.gte'] = runtimeMin;
      if (runtimeMax) params['with_runtime.lte'] = runtimeMax;
    }

    const endpoint = mediaType === 'movie' ? '/discover/movie' : '/discover/tv';
    const data = await this.request(endpoint, params);

    return {
      page: data.page,
      total_pages: data.total_pages,
      total_results: data.total_results,
      results: data.results.map(r => this.formatSearchResult({ ...r, media_type: mediaType }))
    };
  }

  /**
   * Find by external ID (IMDB, TVDB)
   */
  async findByExternalId(externalId, source = 'imdb_id') {
    const data = await this.request('/find/' + externalId, {
      external_source: source
    });
    return {
      movies: (data.movie_results || []).map(r => this.formatSearchResult({ ...r, media_type: 'movie' })),
      tv: (data.tv_results || []).map(r => this.formatSearchResult({ ...r, media_type: 'tv' })),
      episodes: (data.tv_episode_results || []).map(ep => ({
        id: ep.id,
        name: ep.name,
        overview: ep.overview,
        still_path: ep.still_path ? this.getImageUrl(ep.still_path, 'w300') : null,
        show_id: ep.show_id,
        season_number: ep.season_number,
        episode_number: ep.episode_number,
        air_date: ep.air_date,
        vote_average: ep.vote_average
      }))
    };
  }

  /**
   * Get poster/still image URL for queue items
   * Consolidated utility for both /api/queue and /api/leaving-soon endpoints
   * Handles movies, shows, and episodes with proper fallbacks
   *
   * @param {Object} item - Queue item with media_type, tmdb_id, and metadata
   * @param {Object} cache - Optional cache object to store lookups
   * @returns {Promise<string|null>} - Image URL or null
   */
  async getQueueItemImage(item, cache = {}) {
    try {
      if (item.media_type === 'episode') {
        // For episodes, extract TVDB ID from metadata
        const metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
        const guids = metadata?.guids || [];
        const tvdbGuid = guids.find(g => g.startsWith('tvdb://'));
        if (tvdbGuid) {
          const tvdbId = tvdbGuid.replace('tvdb://', '');
          const cacheKey = `episode-tvdb-${tvdbId}`;
          if (cache[cacheKey] !== undefined) return cache[cacheKey];

          const findResult = await this.findByExternalId(tvdbId, 'tvdb_id');
          const posterUrl = findResult.episodes?.[0]?.still_path || null;
          cache[cacheKey] = posterUrl;
          return posterUrl;
        }
      } else if (item.tmdb_id && (item.media_type === 'show' || item.media_type === 'movie')) {
        // Direct TMDB lookup for shows/movies with tmdb_id
        const cacheKey = `${item.media_type}-${item.tmdb_id}`;
        if (cache[cacheKey] !== undefined) return cache[cacheKey];

        const details = item.media_type === 'show'
          ? await this.getTVShow(item.tmdb_id)
          : await this.getMovie(item.tmdb_id);
        const posterUrl = details?.poster_path || null;
        cache[cacheKey] = posterUrl;
        return posterUrl;
      } else if (!item.tmdb_id && (item.media_type === 'show' || item.media_type === 'movie')) {
        // Fallback: try IMDB ID from metadata
        const metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
        const guids = metadata?.guids || [];
        const imdbGuid = guids.find(g => g.startsWith('imdb://'));
        if (imdbGuid) {
          const imdbId = imdbGuid.replace('imdb://', '');
          const cacheKey = `${item.media_type}-imdb-${imdbId}`;
          if (cache[cacheKey] !== undefined) return cache[cacheKey];

          const findResult = await this.findByExternalId(imdbId, 'imdb_id');
          const results = item.media_type === 'show' ? findResult.tv : findResult.movies;
          const posterUrl = results?.[0]?.poster_path || null;
          cache[cacheKey] = posterUrl;
          return posterUrl;
        }
      }
    } catch (e) {
      // Silently fail - return null for missing images
    }
    return null;
  }

  /**
   * Format search result for consistent output
   */
  formatSearchResult(item) {
    const isMovie = item.media_type === 'movie';
    return {
      id: item.id,
      media_type: item.media_type || (item.title ? 'movie' : 'tv'),
      title: item.title || item.name,
      original_title: item.original_title || item.original_name,
      overview: item.overview,
      poster_path: this.getImageUrl(item.poster_path, 'w342'),
      backdrop_path: this.getImageUrl(item.backdrop_path, 'w1280'),
      release_date: item.release_date || item.first_air_date,
      year: this.getYear(item.release_date || item.first_air_date),
      vote_average: item.vote_average,
      vote_count: item.vote_count,
      popularity: item.popularity,
      genre_ids: item.genre_ids || [],
      original_language: item.original_language
    };
  }

  /**
   * Format movie details
   */
  formatMovieDetails(data) {
    return {
      id: data.id,
      media_type: 'movie',
      title: data.title,
      original_title: data.original_title,
      tagline: data.tagline,
      overview: data.overview,
      poster_path: this.getImageUrl(data.poster_path, 'w500'),
      backdrop_path: this.getImageUrl(data.backdrop_path, 'original'),
      release_date: data.release_date,
      year: this.getYear(data.release_date),
      runtime: data.runtime,
      status: data.status,
      vote_average: data.vote_average,
      vote_count: data.vote_count,
      popularity: data.popularity,
      budget: data.budget,
      revenue: data.revenue,
      genres: data.genres,
      production_companies: data.production_companies,
      spoken_languages: data.spoken_languages,
      external_ids: {
        imdb_id: data.external_ids?.imdb_id,
        tvdb_id: null
      },
      credits: {
        cast: (data.credits?.cast || []).slice(0, 20).map(c => ({
          id: c.id,
          name: c.name,
          character: c.character,
          profile_path: this.getImageUrl(c.profile_path, 'w185')
        })),
        crew: (data.credits?.crew || [])
          .filter(c => ['Director', 'Writer', 'Screenplay'].includes(c.job))
          .map(c => ({
            id: c.id,
            name: c.name,
            job: c.job,
            profile_path: this.getImageUrl(c.profile_path, 'w185')
          }))
      },
      videos: (data.videos?.results || [])
        .filter(v => v.site === 'YouTube')
        .map(v => ({
          key: v.key,
          name: v.name,
          type: v.type
        })),
      recommendations: (data.recommendations?.results || []).slice(0, 12).map(r => this.formatSearchResult({ ...r, media_type: 'movie' })),
      certification: this.getCertification(data.release_dates?.results, 'US')
    };
  }

  /**
   * Format TV show details
   */
  formatTVDetails(data) {
    return {
      id: data.id,
      media_type: 'tv',
      title: data.name,
      original_title: data.original_name,
      tagline: data.tagline,
      overview: data.overview,
      poster_path: this.getImageUrl(data.poster_path, 'w500'),
      backdrop_path: this.getImageUrl(data.backdrop_path, 'original'),
      first_air_date: data.first_air_date,
      last_air_date: data.last_air_date,
      year: this.getYear(data.first_air_date),
      status: data.status,
      type: data.type,
      vote_average: data.vote_average,
      vote_count: data.vote_count,
      popularity: data.popularity,
      episode_run_time: data.episode_run_time,
      number_of_seasons: data.number_of_seasons,
      number_of_episodes: data.number_of_episodes,
      in_production: data.in_production,
      genres: data.genres,
      networks: data.networks?.map(n => ({
        id: n.id,
        name: n.name,
        logo_path: this.getImageUrl(n.logo_path, 'w92')
      })),
      production_companies: data.production_companies,
      seasons: data.seasons?.map(s => ({
        id: s.id,
        season_number: s.season_number,
        name: s.name,
        overview: s.overview,
        poster_path: this.getImageUrl(s.poster_path, 'w300'),
        air_date: s.air_date,
        episode_count: s.episode_count
      })),
      external_ids: {
        imdb_id: data.external_ids?.imdb_id,
        tvdb_id: data.external_ids?.tvdb_id
      },
      credits: {
        cast: (data.credits?.cast || []).slice(0, 20).map(c => ({
          id: c.id,
          name: c.name,
          character: c.character,
          profile_path: this.getImageUrl(c.profile_path, 'w185')
        })),
        crew: (data.credits?.crew || [])
          .filter(c => ['Creator', 'Executive Producer'].includes(c.job))
          .map(c => ({
            id: c.id,
            name: c.name,
            job: c.job,
            profile_path: this.getImageUrl(c.profile_path, 'w185')
          }))
      },
      created_by: data.created_by?.map(c => ({
        id: c.id,
        name: c.name,
        profile_path: this.getImageUrl(c.profile_path, 'w185')
      })),
      videos: (data.videos?.results || [])
        .filter(v => v.site === 'YouTube')
        .map(v => ({
          key: v.key,
          name: v.name,
          type: v.type
        })),
      recommendations: (data.recommendations?.results || []).slice(0, 12).map(r => this.formatSearchResult({ ...r, media_type: 'tv' })),
      certification: this.getTVCertification(data.content_ratings?.results, 'US')
    };
  }

  /**
   * Get full image URL
   */
  getImageUrl(path, size = 'original') {
    if (!path) return null;
    return `${this.imageBaseUrl}/${size}${path}`;
  }

  /**
   * Get year from date string
   */
  getYear(dateString) {
    if (!dateString) return null;
    return new Date(dateString).getFullYear();
  }

  /**
   * Get movie certification (rating)
   */
  getCertification(releaseDates, region = 'US') {
    if (!releaseDates) return null;
    const regionData = releaseDates.find(r => r.iso_3166_1 === region);
    if (!regionData) return null;
    const theatrical = regionData.release_dates.find(r => r.type === 3) || regionData.release_dates[0];
    return theatrical?.certification || null;
  }

  /**
   * Get TV certification (rating)
   */
  getTVCertification(ratings, region = 'US') {
    if (!ratings) return null;
    const regionRating = ratings.find(r => r.iso_3166_1 === region);
    return regionRating?.rating || null;
  }

  /**
   * Test API connection
   */
  async testConnection() {
    try {
      await this.request('/configuration');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new TMDBService();
