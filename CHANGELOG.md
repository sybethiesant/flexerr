# Changelog

All notable changes to Flexerr will be documented in this file.

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
