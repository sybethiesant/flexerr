/**
 * Media Server Module
 *
 * Provides abstraction layer for different media server implementations.
 * Supports Plex and Jellyfin with a unified interface.
 */

const MediaServer = require('./media-server');
const PlexMediaServer = require('./plex-media-server');
const JellyfinMediaServer = require('./jellyfin-media-server');
const MediaServerFactory = require('./media-server-factory');

module.exports = {
  MediaServer,
  PlexMediaServer,
  JellyfinMediaServer,
  MediaServerFactory
};
