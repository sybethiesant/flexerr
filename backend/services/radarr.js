const axios = require('axios');
const { db, log } = require('../database');

class RadarrService {
  constructor(url, apiKey, name = 'Radarr') {
    this.url = url?.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.name = name;
    this.client = null;
    if (this.url && this.apiKey) {
      this.initClient();
    }
  }

  initClient() {
    this.client = axios.create({
      baseURL: `${this.url}/api/v3`,
      headers: {
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  static fromDb(serviceId = null) {
    let service;
    if (serviceId) {
      service = db.prepare("SELECT * FROM services WHERE id = ? AND type = 'radarr'").get(serviceId);
    } else {
      service = db.prepare("SELECT * FROM services WHERE type = 'radarr' AND is_active = 1 AND is_default = 1").get();
      if (!service) {
        service = db.prepare("SELECT * FROM services WHERE type = 'radarr' AND is_active = 1").get();
      }
    }
    if (!service) return null;
    return new RadarrService(service.url, service.api_key, service.name);
  }

  static getAllFromDb() {
    const services = db.prepare("SELECT * FROM services WHERE type = 'radarr' AND is_active = 1").all();
    return services.map(s => new RadarrService(s.url, s.api_key, s.name));
  }

  async testConnection() {
    try {
      const response = await this.client.get('/system/status');
      return {
        success: true,
        version: response.data.version,
        instanceName: response.data.instanceName
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  async getMovies() {
    const response = await this.client.get('/movie');
    return response.data;
  }

  async getMovieById(id) {
    const response = await this.client.get(`/movie/${id}`);
    return response.data;
  }

  async getMovieByTmdbId(tmdbId) {
    const movies = await this.getMovies();
    return movies.find(m => m.tmdbId === tmdbId);
  }

  async getMovieByImdbId(imdbId) {
    const movies = await this.getMovies();
    return movies.find(m => m.imdbId === imdbId);
  }

  async deleteMovie(id, deleteFiles = false, addExclusion = true) {
    await this.client.delete(`/movie/${id}`, {
      params: {
        deleteFiles,
        addImportExclusion: addExclusion
      }
    });
    log('info', 'deletion', `Deleted movie from Radarr (${this.name})`, {
      media_id: id,
      delete_files: deleteFiles,
      add_exclusion: addExclusion
    });
  }

  async unmonitorMovie(id) {
    const movie = await this.getMovieById(id);
    movie.monitored = false;
    await this.client.put(`/movie/${id}`, movie);
    log('info', 'rule', `Unmonitored movie in Radarr (${this.name})`, { media_id: id });
  }

  async getTags() {
    const response = await this.client.get('/tag');
    return response.data;
  }

  async addTag(movieId, tagId) {
    const movie = await this.getMovieById(movieId);
    const tags = movie.tags || [];
    if (!tags.includes(tagId)) {
      movie.tags = [...tags, tagId];
      await this.client.put(`/movie/${movieId}`, movie);
    }
  }

  async removeTag(movieId, tagId) {
    const movie = await this.getMovieById(movieId);
    movie.tags = (movie.tags || []).filter(t => t !== tagId);
    await this.client.put(`/movie/${movieId}`, movie);
  }

  async createTag(label) {
    const response = await this.client.post('/tag', { label });
    return response.data;
  }

  async getOrCreateTag(label) {
    const tags = await this.getTags();
    let tag = tags.find(t => t.label.toLowerCase() === label.toLowerCase());
    if (!tag) {
      tag = await this.createTag(label);
    }
    return tag;
  }

  async getQualityProfiles() {
    const response = await this.client.get('/qualityprofile');
    return response.data;
  }

  async getRootFolders() {
    const response = await this.client.get('/rootfolder');
    return response.data;
  }

  async addRootFolder(path) {
    const response = await this.client.post('/rootfolder', { path });
    log('info', 'categorization', `Added root folder to Radarr (${this.name})`, { details: { path } });
    return response.data;
  }

  async getImportListExclusions() {
    const response = await this.client.get('/exclusions');
    return response.data;
  }

  async addImportListExclusion(tmdbId, title, year) {
    const response = await this.client.post('/exclusions', {
      tmdbId,
      movieTitle: title,
      movieYear: year
    });
    return response.data;
  }

  async removeImportListExclusion(exclusionId) {
    await this.client.delete(`/exclusions/${exclusionId}`);
    log('info', 'rule', `Removed exclusion from Radarr (${this.name})`, { exclusion_id: exclusionId });
  }

  async removeExclusionByTmdbId(tmdbId) {
    const exclusions = await this.getImportListExclusions();
    const exclusion = exclusions.find(e => e.tmdbId === tmdbId);
    if (exclusion) {
      await this.removeImportListExclusion(exclusion.id);
      return true;
    }
    return false;
  }

  async monitorMovie(id) {
    const movie = await this.getMovieById(id);
    movie.monitored = true;
    await this.client.put(`/movie/${id}`, movie);
    log('info', 'rule', `Re-monitored movie in Radarr (${this.name})`, { media_id: id });
  }

  async searchMovie(movieId) {
    const response = await this.client.post('/command', {
      name: 'MoviesSearch',
      movieIds: [movieId]
    });
    log('info', 'rule', `Triggered movie search in Radarr (${this.name})`, { media_id: movieId });
    return response.data;
  }

  async addMovie(tmdbId, qualityProfileId, rootFolderPath, monitored = true, searchNow = true) {
    // First lookup the movie
    const lookupResponse = await this.client.get('/movie/lookup/tmdb', {
      params: { tmdbId }
    });
    const movieData = lookupResponse.data;
    if (!movieData) {
      throw new Error(`Movie not found for TMDB ID: ${tmdbId}`);
    }

    // Add the movie
    const response = await this.client.post('/movie', {
      ...movieData,
      qualityProfileId,
      rootFolderPath,
      monitored,
      addOptions: {
        searchForMovie: searchNow
      }
    });

    log('info', 'rule', `Added movie to Radarr (${this.name})`, {
      media_id: response.data.id,
      tmdb_id: tmdbId,
      title: response.data.title
    });

    return response.data;
  }

  async updateMovie(movieId, updates) {
    // First get the current movie data
    const getResponse = await this.client.get(`/movie/${movieId}`);
    const movieData = getResponse.data;

    // Apply updates
    const updatedMovie = {
      ...movieData,
      ...updates
    };

    // If moveFiles is specified, we need to use the movie editor endpoint
    if (updates.moveFiles && updates.rootFolderPath) {
      const response = await this.client.put('/movie/editor', {
        movieIds: [movieId],
        rootFolderPath: updates.rootFolderPath,
        moveFiles: true
      });
      log('info', 'categorization', `Moved movie to new root folder in Radarr (${this.name})`, {
        media_id: movieId,
        title: movieData.title,
        newRootFolder: updates.rootFolderPath
      });
      return response.data;
    }

    // Standard update
    const response = await this.client.put(`/movie/${movieId}`, updatedMovie);
    log('info', 'categorization', `Updated movie in Radarr (${this.name})`, {
      media_id: movieId,
      title: movieData.title
    });
    return response.data;
  }

  async getDiskSpace() {
    const response = await this.client.get('/diskspace');
    return response.data;
  }

  // Get movie by matching Plex GUID
  async findMovieByGuid(guids) {
    const movies = await this.getMovies();
    for (const m of movies) {
      // Check TMDB ID
      if (guids.some(g => g.includes(`tmdb://${m.tmdbId}`))) {
        return m;
      }
      // Check IMDB ID
      if (m.imdbId && guids.some(g => g.includes(`imdb://${m.imdbId}`))) {
        return m;
      }
    }
    return null;
  }

  // Find movie by file path (handles Plex metadata mismatches)
  async findMovieByPath(filePath) {
    if (!filePath) return null;
    const movies = await this.getMovies();

    // Normalize path for comparison (handle different mount points)
    const normalizedPath = filePath.toLowerCase();

    for (const m of movies) {
      // Check if movie path is contained in the file path
      if (m.path && normalizedPath.includes(m.path.toLowerCase())) {
        return m;
      }
      // Check the movie file path directly
      if (m.movieFile?.path && normalizedPath.includes(m.movieFile.path.toLowerCase())) {
        return m;
      }
      // Also check if just the folder name matches
      if (m.folderName) {
        const folderName = m.folderName.toLowerCase();
        if (normalizedPath.includes(folderName)) {
          return m;
        }
      }
    }
    return null;
  }

  // Get file size for a movie
  async getMovieSize(movieId) {
    const movie = await this.getMovieById(movieId);
    return movie.movieFile?.size || 0;
  }

  // Get movie file info
  async getMovieFile(movieId) {
    const movie = await this.getMovieById(movieId);
    return movie.movieFile;
  }

  async deleteMovieFile(movieFileId) {
    await this.client.delete(`/moviefile/${movieFileId}`);
    log('info', 'deletion', `Deleted movie file from Radarr (${this.name})`, {
      media_id: movieFileId
    });
  }

  // Get blocklist entries
  async getBlocklist(page = 1, pageSize = 100) {
    const response = await this.client.get('/blocklist', {
      params: { page, pageSize }
    });
    return response.data;
  }

  // Get history for a movie (to find download info for blocklisting)
  async getHistory(movieId, eventType = null) {
    const params = { movieId };
    if (eventType) params.eventType = eventType;
    const response = await this.client.get('/history', { params });
    return response.data;
  }

  // Block a specific release by its download ID from history
  async blockRelease(downloadId) {
    const response = await this.client.post('/blocklist', {
      downloadId
    });
    log('info', 'convert', `Blocked release in Radarr (${this.name})`, { download_id: downloadId });
    return response.data;
  }

  // Delete movie file and trigger new search
  async deleteAndResearch(movieFileId, movieId) {
    // Delete the file
    await this.deleteMovieFile(movieFileId);

    // Trigger a search for the movie
    await this.searchMovie(movieId);

    return { deleted: true, searching: true };
  }

  // Get movie file by ID
  async getMovieFileById(fileId) {
    const response = await this.client.get(`/moviefile/${fileId}`);
    return response.data;
  }
}

module.exports = RadarrService;
