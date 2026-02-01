const axios = require('axios');
const { db, log } = require('../database');

class SonarrService {
  constructor(url, apiKey, name = 'Sonarr') {
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
      service = db.prepare("SELECT * FROM services WHERE id = ? AND type = 'sonarr'").get(serviceId);
    } else {
      service = db.prepare("SELECT * FROM services WHERE type = 'sonarr' AND is_active = 1 AND is_default = 1").get();
      if (!service) {
        service = db.prepare("SELECT * FROM services WHERE type = 'sonarr' AND is_active = 1").get();
      }
    }
    if (!service) return null;
    return new SonarrService(service.url, service.api_key, service.name);
  }

  static getAllFromDb() {
    const services = db.prepare("SELECT * FROM services WHERE type = 'sonarr' AND is_active = 1").all();
    return services.map(s => new SonarrService(s.url, s.api_key, s.name));
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

  async getSeries() {
    const response = await this.client.get('/series');
    return response.data;
  }

  async getSeriesById(id) {
    const response = await this.client.get(`/series/${id}`);
    return response.data;
  }

  async getSeriesByTvdbId(tvdbId) {
    const series = await this.getSeries();
    return series.find(s => s.tvdbId === tvdbId);
  }

  async getEpisodes(seriesId) {
    const response = await this.client.get('/episode', {
      params: { seriesId }
    });
    return response.data;
  }

  async getEpisodeById(id) {
    const response = await this.client.get(`/episode/${id}`);
    return response.data;
  }

  async getEpisodeFiles(seriesId) {
    const response = await this.client.get('/episodefile', {
      params: { seriesId }
    });
    return response.data;
  }

  async deleteSeries(id, deleteFiles = false, addExclusion = true) {
    await this.client.delete(`/series/${id}`, {
      params: {
        deleteFiles,
        addImportListExclusion: addExclusion
      }
    });
    log('info', 'deletion', `Deleted series from Sonarr (${this.name})`, {
      media_id: id,
      delete_files: deleteFiles,
      add_exclusion: addExclusion
    });
  }

  async deleteEpisodeFile(episodeFileId) {
    await this.client.delete(`/episodefile/${episodeFileId}`);
    log('info', 'deletion', `Deleted episode file from Sonarr (${this.name})`, {
      media_id: episodeFileId
    });
  }

  async unmonitorSeries(id) {
    const series = await this.getSeriesById(id);
    series.monitored = false;
    await this.client.put(`/series/${id}`, series);
    log('info', 'rule', `Unmonitored series in Sonarr (${this.name})`, { media_id: id });
  }

  async unmonitorEpisodes(seriesId, episodeIds) {
    await this.client.put('/episode/monitor', {
      episodeIds: episodeIds,
      monitored: false
    });
    log('info', 'rule', `Unmonitored ${episodeIds.length} episodes in Sonarr (${this.name})`, {
      media_id: seriesId
    });
  }

  async getTags() {
    const response = await this.client.get('/tag');
    return response.data;
  }

  async addTag(seriesId, tagId) {
    const series = await this.getSeriesById(seriesId);
    const tags = series.tags || [];
    if (!tags.includes(tagId)) {
      series.tags = [...tags, tagId];
      await this.client.put(`/series/${seriesId}`, series);
    }
  }

  async removeTag(seriesId, tagId) {
    const series = await this.getSeriesById(seriesId);
    series.tags = (series.tags || []).filter(t => t !== tagId);
    await this.client.put(`/series/${seriesId}`, series);
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

  async getImportListExclusions() {
    const response = await this.client.get('/importlistexclusion');
    return response.data;
  }

  async addImportListExclusion(tvdbId, title) {
    const response = await this.client.post('/importlistexclusion', {
      tvdbId,
      title
    });
    return response.data;
  }

  async removeImportListExclusion(exclusionId) {
    await this.client.delete(`/importlistexclusion/${exclusionId}`);
    log('info', 'rule', `Removed exclusion from Sonarr (${this.name})`, { exclusion_id: exclusionId });
  }

  async removeExclusionByTvdbId(tvdbId) {
    const exclusions = await this.getImportListExclusions();
    const exclusion = exclusions.find(e => e.tvdbId === tvdbId);
    if (exclusion) {
      await this.removeImportListExclusion(exclusion.id);
      return true;
    }
    return false;
  }

  async monitorSeries(id) {
    const series = await this.getSeriesById(id);
    series.monitored = true;
    await this.client.put(`/series/${id}`, series);
    log('info', 'rule', `Re-monitored series in Sonarr (${this.name})`, { media_id: id });
  }

  async monitorAllEpisodes(seriesId) {
    const episodes = await this.getEpisodes(seriesId);
    const episodeIds = episodes.map(e => e.id);
    if (episodeIds.length > 0) {
      await this.client.put('/episode/monitor', {
        episodeIds,
        monitored: true
      });
      log('info', 'rule', `Re-monitored ${episodeIds.length} episodes in Sonarr (${this.name})`, {
        media_id: seriesId
      });
    }
    return episodeIds.length;
  }

  async addSeries(tvdbId, qualityProfileId, rootFolderPath, monitored = true, searchNow = true) {
    // First lookup the series
    const lookupResponse = await this.client.get('/series/lookup', {
      params: { term: `tvdb:${tvdbId}` }
    });
    const seriesData = lookupResponse.data[0];
    if (!seriesData) {
      throw new Error(`Series not found for TVDB ID: ${tvdbId}`);
    }

    // Add the series
    const response = await this.client.post('/series', {
      ...seriesData,
      qualityProfileId,
      rootFolderPath,
      monitored,
      addOptions: {
        searchForMissingEpisodes: searchNow
      }
    });

    log('info', 'rule', `Added series to Sonarr (${this.name})`, {
      media_id: response.data.id,
      tvdb_id: tvdbId,
      title: response.data.title
    });

    return response.data;
  }

  async getDiskSpace() {
    const response = await this.client.get('/diskspace');
    return response.data;
  }

  // Get series by matching Plex GUID
  async findSeriesByGuid(guids) {
    const series = await this.getSeries();
    for (const s of series) {
      // Check TVDB ID
      if (guids.some(g => g.includes(`tvdb://${s.tvdbId}`))) {
        return s;
      }
      // Check IMDB ID
      if (s.imdbId && guids.some(g => g.includes(`imdb://${s.imdbId}`))) {
        return s;
      }
    }
    return null;
  }

  // Get file size for a series
  async getSeriesSize(seriesId) {
    const files = await this.getEpisodeFiles(seriesId);
    return files.reduce((total, file) => total + (file.size || 0), 0);
  }

  // Monitor/unmonitor a specific episode
  async monitorEpisode(episodeId, monitored = true) {
    await this.client.put('/episode/monitor', {
      episodeIds: [episodeId],
      monitored
    });
    log('info', 'rule', `${monitored ? 'Monitored' : 'Unmonitored'} episode in Sonarr (${this.name})`, {
      media_id: episodeId
    });
  }

  // Trigger a search for a specific episode
  async searchEpisode(episodeId) {
    const response = await this.client.post('/command', {
      name: 'EpisodeSearch',
      episodeIds: [episodeId]
    });
    log('info', 'rule', `Triggered episode search in Sonarr (${this.name})`, {
      media_id: episodeId,
      command_id: response.data.id
    });
    return response.data;
  }

  // Trigger a search for multiple episodes
  async searchEpisodes(episodeIds) {
    const response = await this.client.post('/command', {
      name: 'EpisodeSearch',
      episodeIds
    });
    log('info', 'rule', `Triggered search for ${episodeIds.length} episodes in Sonarr (${this.name})`, {
      command_id: response.data.id
    });
    return response.data;
  }

  // Trigger a search for all missing episodes in a series
  async searchSeries(seriesId) {
    const response = await this.client.post('/command', {
      name: 'SeriesSearch',
      seriesId
    });
    log('info', 'rule', `Triggered series search in Sonarr (${this.name})`, { media_id: seriesId });
    return response.data;
  }

  // Trigger a season search
  async searchSeason(seriesId, seasonNumber) {
    const response = await this.client.post('/command', {
      name: 'SeasonSearch',
      seriesId,
      seasonNumber
    });
    return response.data;
  }

  // Get command status
  async getCommand(commandId) {
    const response = await this.client.get(`/command/${commandId}`);
    return response.data;
  }

  // Get blocklist entries
  async getBlocklist(page = 1, pageSize = 100) {
    const response = await this.client.get('/blocklist', {
      params: { page, pageSize }
    });
    return response.data;
  }

  // Add a release to blocklist
  async addToBlocklist(episodeIds, reason = 'Incompatible format') {
    // Sonarr requires the download ID to blocklist - we need to find the history entry
    // For manual blocking, we delete the file and add to blocklist in one operation
    log('info', 'convert', `Added release to Sonarr blocklist (${this.name})`, {
      episode_ids: episodeIds,
      reason
    });
  }

  // Get episode file details
  async getEpisodeFileById(fileId) {
    const response = await this.client.get(`/episodefile/${fileId}`);
    return response.data;
  }

  // Delete episode file and trigger new search
  async deleteAndResearch(episodeFileId, seriesId, episodeIds) {
    // Delete the file
    await this.deleteEpisodeFile(episodeFileId);

    // Trigger a search for the affected episodes
    if (episodeIds && episodeIds.length > 0) {
      await this.searchEpisodes(episodeIds);
    }

    return { deleted: true, searching: true };
  }

  // Get history for an episode (to find download info for blocklisting)
  async getHistory(episodeId, eventType = null) {
    const params = { episodeId };
    if (eventType) params.eventType = eventType;
    const response = await this.client.get('/history', { params });
    return response.data;
  }

  // Block a specific release by its download ID from history
  async blockRelease(downloadId) {
    const response = await this.client.post('/blocklist', {
      downloadId
    });
    log('info', 'convert', `Blocked release in Sonarr (${this.name})`, { download_id: downloadId });
    return response.data;
  }

  // Check if an episode file exists for a specific episode
  async episodeHasFile(seriesId, seasonNumber, episodeNumber) {
    const episodes = await this.getEpisodes(seriesId);
    const episode = episodes.find(e =>
      e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber
    );
    return episode?.hasFile || false;
  }

  // Get missing episodes for a series
  async getMissingEpisodes(seriesId) {
    const episodes = await this.getEpisodes(seriesId);
    return episodes.filter(e => !e.hasFile && e.monitored);
  }

  /**
   * Get detailed series completion status
   * Returns: 'available' | 'partial' | 'processing' | 'pending'
   *
   * - available: All aired episodes are downloaded (future unaired are OK to be missing)
   * - partial: Some aired episodes downloaded but some are missing
   * - processing: No episodes downloaded yet, but show exists in Sonarr
   * - pending: Show not in Sonarr
   */
  async getSeriesCompletionStatus(seriesId) {
    try {
      const episodes = await this.getEpisodes(seriesId);
      const now = new Date();

      // Filter to only aired episodes (airDateUtc in the past)
      const airedEpisodes = episodes.filter(ep => {
        if (!ep.airDateUtc) return false;
        const airDate = new Date(ep.airDateUtc);
        return airDate <= now;
      });

      // Count aired episodes with files
      const airedWithFiles = airedEpisodes.filter(ep => ep.hasFile).length;
      const totalAired = airedEpisodes.length;

      // Also count all episodes with files (for shows with only future episodes)
      const totalWithFiles = episodes.filter(ep => ep.hasFile).length;

      if (totalAired === 0) {
        // No aired episodes yet - show is waiting for future episodes
        // If it has some files (specials maybe), still consider available
        return totalWithFiles > 0 ? 'available' : 'processing';
      }

      if (airedWithFiles === 0) {
        // No downloaded episodes at all
        return 'processing';
      }

      if (airedWithFiles >= totalAired) {
        // All aired episodes are downloaded
        return 'available';
      }

      // Some but not all aired episodes downloaded
      return 'partial';
    } catch (error) {
      console.error(`[Sonarr] Error getting completion status for series ${seriesId}:`, error.message);
      return 'processing'; // Default to processing on error
    }
  }

  /**
   * Get series completion stats (for display purposes)
   */
  async getSeriesCompletionStats(seriesId) {
    try {
      const episodes = await this.getEpisodes(seriesId);
      const now = new Date();

      const airedEpisodes = episodes.filter(ep => {
        if (!ep.airDateUtc) return false;
        return new Date(ep.airDateUtc) <= now;
      });

      const airedWithFiles = airedEpisodes.filter(ep => ep.hasFile).length;
      const totalWithFiles = episodes.filter(ep => ep.hasFile).length;

      return {
        totalEpisodes: episodes.length,
        airedEpisodes: airedEpisodes.length,
        downloadedEpisodes: totalWithFiles,
        airedDownloaded: airedWithFiles,
        missingAired: airedEpisodes.length - airedWithFiles,
        futureEpisodes: episodes.length - airedEpisodes.length
      };
    } catch (error) {
      console.error(`[Sonarr] Error getting completion stats:`, error.message);
      return null;
    }
  }
}

module.exports = SonarrService;
