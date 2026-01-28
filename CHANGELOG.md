# Changelog

All notable changes to Flexerr will be documented in this file.

## [1.1.1-hotfix] - 2026-01-28

### Fixed

- **CRITICAL: Smart Cleanup Broken by Jellyfin Support**: Fixed fatal bug where the Jellyfin media server abstraction layer broke smart cleanup for ALL users. The abstraction layer was missing Plex-specific methods like `analyzeShowWatchProgress()` that smart cleanup depends on. Smart cleanup now correctly uses `PlexService` directly while Jellyfin support is improved.

- **Sonarr Auto-Redownload Bug**: Fixed critical bug where deleted episodes were NOT being unmonitored in Sonarr, causing them to automatically re-download. Now ALL deleted episodes are properly unmonitored to prevent unwanted redownloads.

- **Protection Now Auto-Monitors**: When a TV show or movie is protected, Flexerr now automatically:
  - Sets the series/movie to `monitored: true` in Sonarr/Radarr
  - Monitors ALL episodes in the series (for TV shows)
  - Triggers a search to download any missing content
  - Ensures protected content is always available

### Improved

- **Better Error Handling**: Smart cleanup now logs detailed error information with stack traces for debugging
- **Episode Count Tracking**: Fixed episode counting to happen immediately after analysis, preventing 0 counts when errors occur later
- **Error Reporting**: Analysis results now show successful vs failed shows separately

### Technical Details

- Smart Episode Manager temporarily forced to use legacy `PlexService` until Jellyfin velocity tracking is implemented
- Added comprehensive Jellyfin implementation audit documenting ~45% feature parity
- MediaServerFactory architecture confirmed ready for dual-server operation

## [1.1.0-beta] - 2026-01-28

### Added

- **Jellyfin Support (Beta)**: Added experimental support for Jellyfin as an alternative to Plex. This is a beta feature and requires community testing.

  **New Backend Components:**
  - `MediaServer` abstract base class defining unified interface for media servers
  - `PlexMediaServer` - Refactored Plex implementation using the new interface
  - `JellyfinMediaServer` - New Jellyfin implementation with full API support
  - `MediaServerFactory` - Factory for instantiating the appropriate server type
  - `media-sync.js` - Generalized sync service that works with any media server

  **Database Schema Updates:**
  - New `media_servers` table for storing server configurations
  - Added `media_server_type` and `media_server_id` columns to `users` table
  - Added `media_server_id` and `media_item_key` columns to tracking tables

  **Authentication:**
  - Jellyfin uses username/password authentication (Plex uses OAuth)
  - Added `authenticateJellyfin()`, `loginJellyfin()`, and `setupFirstJellyfinUser()` methods

  **Jellyfin Feature Workarounds:**
  - Uses Jellyfin **Favorites** as watchlist equivalent (Jellyfin lacks native watchlist)
  - Watch history retrieved via played items with `IsPlayed` filter
  - External IDs (TMDB, TVDB, IMDB) extracted from Jellyfin's `ProviderIds`

### Notes

- Jellyfin support requires additional testing - please report issues on GitHub
- Setup page UI changes for server type selection coming in next update
- Existing Plex installations are unaffected - this is additive functionality

## [1.0.1] - 2026-01-28

### Fixed

- **Position Format Mismatch**: Fixed critical bug where velocity tracking used `season*100+episode` format (e.g., S5E13 = 513) but Plex analysis used sequential indexing (1, 2, 3...). This caused incorrect "watched" detection and premature episode deletion.

- **Velocity Lookup Failure**: Fixed velocity data lookup that was failing because it searched by Plex rating key, but velocity is stored with title hash. Added title hash fallback to ensure user watch positions are found correctly.

- **Buffer Zone Calculation**: Fixed buffer protection to correctly identify episodes within a user's approach buffer. Episodes are now properly protected based on user position + (velocity × buffer days).

- **Per-User Independent Buffers**: Each user now has their own independent buffer zone. Episodes in the "gap" between users' buffers are correctly identified for cleanup, while episodes within ANY user's buffer remain protected.

### Added

- **Episode Stats Persistence**: New `episode_stats` table tracks episode analysis history, including deleted episodes. Stats page now shows historical data even after episodes are deleted from Plex.

- **Redownload Check Interval Setting**: Added configurable redownload check interval to the Settings UI (under Proactive Re-download section). Default is 360 minutes, configurable from 30 to 1440 minutes.

### Changed

- **Default Settings**: Updated `maxEpisodesAhead` default from 10 to 200 to properly support users with high watch velocities (10+ episodes/day).

## [1.0.0] - 2026-01-25

### Added

- Initial release
- Plex OAuth authentication with multi-user support
- Watchlist integration with automatic Sonarr/Radarr downloads
- Smart Episode Manager with velocity-based cleanup
- Leaving Soon collection for deletion grace periods
- Watchlist restoration (re-add triggers re-download)
- Rules engine for custom cleanup policies
- Media repair and quality upgrade support
- Admin dashboard with statistics and management
