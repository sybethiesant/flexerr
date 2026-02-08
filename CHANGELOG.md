# Changelog

All notable changes to Flexerr will be documented in this file.

## [1.1.6-beta] - 2026-02-07

### Fixed

- **Plex Auto-Invite System**: Fixed end-to-end broken auto-invite flow for new users
  - Backend now returns proper 200 response with `invited` flag instead of 401 error
  - Frontend handles invite response gracefully - stops polling and shows friendly message
  - Fixed undefined variable `inviteEmail` in Plex invite API call (now uses `userPlexId`)
  - Fixed empty library array being sent as `[]` instead of omitted (which shares all libraries)

- **Leaving Soon Collection Sync**: Fixed stale items accumulating in Plex "Leaving Soon" collection
  - Items are now automatically removed from the Plex collection when completed, cancelled, or cleaned up
  - Covers all 7 exit points in both `processQueue()` and `cleanupStaleQueueItems()`
  - Added `removeFromLeavingSoonCollection()` helper method to rules engine

- **Setup Wizard**: Fixed Continue button staying disabled after selecting a Plex server
  - Backend returns `clientId` but frontend expected `clientIdentifier` - added fallback handling

- **Foreign Films Collection**: Fixed categorization rule incorrectly matching English-language movies

## [1.1.5-beta] - 2026-02-02

### Fixed

- **TMDB Search**: Fixed search for titles containing years (e.g., "Blade Runner 2049") which were incorrectly parsed
- **Plex Home Users**: Fixed iteration over Plex home users during watchlist sync - now properly handles all managed users

## [1.1.4-beta] - 2026-02-02

### Added

- **Configurable Debug Logging**: New admin UI for controlling log verbosity with 4 levels:
  - **OFF (0)**: Only critical errors logged
  - **BASIC (1)**: Errors, warnings, and key events
  - **VERBOSE (2)**: API calls, sync operations, state changes
  - **TRACE (3)**: Everything including function entry/exit and internal state

  Access via Settings → Debug tab (admin only). Useful for troubleshooting sync issues, VIPER analysis, and API problems.

### Technical Details

- Debug level persists across restarts (stored in database)
- 5-second cache to minimize database queries
- Structured logging with categories, timestamps, and optional data payloads
- New logger methods: `verbose()`, `trace()`, `apiRequest()`, `apiResponse()`, `enter()`, `exit()`, `state()`, `dbQuery()`, `dump()`

## [1.1.3-beta] - 2026-01-31

### Changed

- **Rebranded to VIPER**: Smart Episode Manager renamed to VIPER (Velocity-Informed Protection & Episode Removal)
  - Updated all log prefixes from `[SmartCleanup]` to `[VIPER]`
  - Updated Settings UI with VIPER branding and full acronym description
  - Updated all documentation references

### Improved

- **Longer Content Retention**: Adjusted default settings to keep content longer
  - Episodes after watching: 7 days (was 1)
  - Velocity buffer: 21 days (was 10)
  - Max episodes ahead: 60 (was 30)
  - Leaving Soon buffer: 21 days (was 15)
  - Watchlist grace period: 60 days (was 45)

- **Updated Cleanup Rules**:
  - Watched Movies: 60 days (was 30)
  - Inactive TV Shows: 90 days (was 60)
  - Old Unwatched Movies: 120 days (was 90)
  - Disabled overly aggressive "Unrequested" rules (no time limit)
  - Added new "Unwatchlisted Content (7 days)" rules for movies and TV shows

### Fixed

- **Plex Watchlist Sync**: Fixed items added via Flexerr not being pushed to Plex watchlist
  - Switched from broken search API to metadata API endpoint
  - Removed X-Plex-Client-Identifier header that caused 401 errors
  - Added IMDB ID matching for reliable Plex Discover lookups
  - Fixed PlexService constructor call in watchlist-trigger.js

- **Protection Feature**: Fixed protection not saving correctly to database

## [1.1.2] - 2026-01-29

### Fixed

- **Jellyfin Webhook Validation**: Added comprehensive input validation to Jellyfin webhook endpoint to prevent crashes from malformed events
- **Jellyfin Completion Detection**: Fixed critical bug where missing PlaybackInfo data defaulted to 0% instead of null, breaking episode completion detection
- **Jellyfin Watch Duration**: Implemented proper watch duration calculation by matching start/stop events and computing actual viewing time
- **Jellyfin Velocity Calculation**: Made 30-day velocity window configurable via `jellyfin_velocity_window_days` setting (default: 30)
- **Jellyfin Multi-Server Support**: Fixed seriesInfo query to properly filter by media_server_id for dual Plex+Jellyfin installations
- **Code Cleanup**: Removed 3 backup files (242 KB), eliminated duplicate axios requires, created shared httpsAgent for consistency

### Added

- **Jellyfin Configuration UI**: Added new settings section in Admin UI for Jellyfin-specific configuration
  - `jellyfin_completion_percentage` - Configurable episode completion threshold (50-100%, default 90%)
  - `jellyfin_velocity_window_days` - Configurable velocity calculation window (7-90 days, default 30)
- **Database Helper Function**: Added `getJellyfinRecentStartEvent()` for accurate watch duration tracking
- **Improved Error Handling**: All Jellyfin webhook database operations now wrapped in try-catch with detailed logging

### Changed

- **Jellyfin Webhook Endpoint**: Complete rewrite with proper validation, error handling, and configurable settings
- **Performance**: Moved repeated require() calls to top of server.js for better performance
- **Consistency**: Standardized httpsAgent usage across image proxy endpoints

### Technical Details

- All changes are backward compatible - existing Plex installations unaffected
- Jellyfin webhook now properly handles all event types with graceful fallbacks
- Watch duration calculation includes sanity checks (positive values, < 24 hours)
- Multi-server support ensures proper data isolation between Plex and Jellyfin instances

## [1.1.1-hotfix] - 2026-01-28

### Fixed

- **CRITICAL: VIPER Broken by Jellyfin Support**: Fixed fatal bug where the Jellyfin media server abstraction layer broke VIPER for ALL users. The abstraction layer was missing Plex-specific methods like `analyzeShowWatchProgress()` that VIPER depends on. Smart cleanup now correctly uses `PlexService` directly while Jellyfin support is improved.

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

- VIPER temporarily forced to use legacy `PlexService` until Jellyfin velocity tracking is implemented
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
- VIPER with velocity-based cleanup
- Leaving Soon collection for deletion grace periods
- Watchlist restoration (re-add triggers re-download)
- Rules engine for custom cleanup policies
- Media repair and quality upgrade support
- Admin dashboard with statistics and management
