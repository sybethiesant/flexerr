/**
 * MediaServerFactory
 *
 * Factory for creating media server instances.
 * Handles instantiation of the correct server type (Plex or Jellyfin).
 */

const PlexMediaServer = require('./plex-media-server');
const JellyfinMediaServer = require('./jellyfin-media-server');
const { db, getMediaServers, getPrimaryMediaServer, getMediaServerById, getMediaServerByType } = require('../../database');

class MediaServerFactory {
  /**
   * Create a media server instance from a database record
   * @param {Object} serverRecord - Database record from media_servers table
   * @returns {MediaServer|null}
   */
  static fromRecord(serverRecord) {
    if (!serverRecord) return null;

    switch (serverRecord.type) {
      case 'plex':
        return PlexMediaServer.fromMediaServer(serverRecord);
      case 'jellyfin':
        return JellyfinMediaServer.fromMediaServer(serverRecord);
      default:
        console.warn(`[MediaServerFactory] Unknown server type: ${serverRecord.type}`);
        return null;
    }
  }

  /**
   * Get the primary media server
   * @returns {MediaServer|null}
   */
  static getPrimary() {
    const server = getPrimaryMediaServer();
    if (server) {
      return this.fromRecord(server);
    }

    // Fallback: Check legacy services table for Plex
    const legacyPlex = db.prepare("SELECT * FROM services WHERE type = 'plex' AND is_active = 1").get();
    if (legacyPlex) {
      return new PlexMediaServer({
        id: legacyPlex.id,
        name: legacyPlex.name,
        url: legacyPlex.url,
        apiKey: legacyPlex.api_key
      });
    }

    return null;
  }

  /**
   * Get a media server by ID
   * @param {number} id
   * @returns {MediaServer|null}
   */
  static getById(id) {
    const server = getMediaServerById(id);
    return this.fromRecord(server);
  }

  /**
   * Get a media server by type
   * @param {'plex'|'jellyfin'} type
   * @returns {MediaServer|null}
   */
  static getByType(type) {
    const server = getMediaServerByType(type);
    if (server) {
      return this.fromRecord(server);
    }

    // Fallback: Check legacy services table for Plex
    if (type === 'plex') {
      const legacyPlex = db.prepare("SELECT * FROM services WHERE type = 'plex' AND is_active = 1").get();
      if (legacyPlex) {
        return new PlexMediaServer({
          id: legacyPlex.id,
          name: legacyPlex.name,
          url: legacyPlex.url,
          apiKey: legacyPlex.api_key
        });
      }
    }

    return null;
  }

  /**
   * Get all configured media servers
   * @returns {MediaServer[]}
   */
  static getAll() {
    const servers = getMediaServers();
    const instances = servers.map(s => this.fromRecord(s)).filter(Boolean);

    // Include legacy Plex if not already in media_servers
    if (!servers.some(s => s.type === 'plex')) {
      const legacyPlex = db.prepare("SELECT * FROM services WHERE type = 'plex' AND is_active = 1").get();
      if (legacyPlex) {
        instances.unshift(new PlexMediaServer({
          id: legacyPlex.id,
          name: legacyPlex.name,
          url: legacyPlex.url,
          apiKey: legacyPlex.api_key
        }));
      }
    }

    return instances;
  }

  /**
   * Get a Plex server instance (for backwards compatibility)
   * @returns {PlexMediaServer|null}
   */
  static getPlex() {
    return this.getByType('plex');
  }

  /**
   * Get a Jellyfin server instance
   * @returns {JellyfinMediaServer|null}
   */
  static getJellyfin() {
    return this.getByType('jellyfin');
  }

  /**
   * Check if any media server is configured
   * @returns {boolean}
   */
  static hasAnyServer() {
    const servers = this.getAll();
    return servers.length > 0;
  }

  /**
   * Check if a Plex server is configured
   * @returns {boolean}
   */
  static hasPlexServer() {
    return this.getPlex() !== null;
  }

  /**
   * Check if a Jellyfin server is configured
   * @returns {boolean}
   */
  static hasJellyfinServer() {
    return this.getJellyfin() !== null;
  }

  /**
   * Get the configured server types
   * @returns {string[]}
   */
  static getConfiguredTypes() {
    const types = [];
    if (this.hasPlexServer()) types.push('plex');
    if (this.hasJellyfinServer()) types.push('jellyfin');
    return types;
  }

  /**
   * Create a new Plex server instance from configuration
   * @param {Object} config
   * @returns {PlexMediaServer}
   */
  static createPlex(config) {
    return new PlexMediaServer(config);
  }

  /**
   * Create a new Jellyfin server instance from configuration
   * @param {Object} config
   * @returns {JellyfinMediaServer}
   */
  static createJellyfin(config) {
    return new JellyfinMediaServer(config);
  }

  /**
   * Test connection to a server without saving
   * @param {'plex'|'jellyfin'} type
   * @param {Object} config
   * @returns {Promise<{success: boolean, error?: string, version?: string, name?: string}>}
   */
  static async testConnection(type, config) {
    let server;
    switch (type) {
      case 'plex':
        server = new PlexMediaServer(config);
        break;
      case 'jellyfin':
        server = new JellyfinMediaServer(config);
        break;
      default:
        return { success: false, error: `Unknown server type: ${type}` };
    }

    return server.testConnection();
  }
}

module.exports = MediaServerFactory;
