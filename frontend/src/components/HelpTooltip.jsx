import React, { useState, useRef, useEffect } from 'react';
import { HelpCircle, X } from 'lucide-react';

/**
 * HelpTooltip - Interactive help tooltip component
 * Shows a "?" icon that displays detailed help text when clicked or hovered
 *
 * @param {string} title - Short title for the help topic
 * @param {string} content - Detailed explanation
 * @param {string} example - Optional example usage
 * @param {string} className - Additional CSS classes
 */
export default function HelpTooltip({ title, content, example, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipRef = useRef(null);
  const buttonRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target) &&
          buttonRef.current && !buttonRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="ml-1.5 text-slate-400 hover:text-primary-400 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 focus:ring-offset-slate-800 rounded-full"
        aria-label={`Help: ${title}`}
      >
        <HelpCircle className="h-4 w-4" />
      </button>

      {isOpen && (
        <div
          ref={tooltipRef}
          className="absolute z-50 bottom-full left-0 mb-2 w-72 max-w-[calc(100vw-2rem)]"
          style={{ minWidth: '280px' }}
        >
          <div className="bg-slate-700 rounded-lg shadow-xl border border-slate-600 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-600/50 border-b border-slate-600">
              <span className="font-medium text-sm text-slate-200">{title}</span>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-3 space-y-2">
              <p className="text-sm text-slate-300 leading-relaxed">{content}</p>

              {example && (
                <div className="mt-2 pt-2 border-t border-slate-600">
                  <p className="text-xs text-slate-400 font-medium mb-1">Example:</p>
                  <p className="text-xs text-slate-400 bg-slate-800/50 rounded px-2 py-1.5 font-mono">
                    {example}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Arrow */}
          <div className="absolute left-3 bottom-0 translate-y-full">
            <div className="border-8 border-transparent border-t-slate-700" />
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * Help content definitions for all configurable settings
 * Use these throughout the app for consistent help text
 */
export const HELP_CONTENT = {
  // === GENERAL SETTINGS ===
  collectionName: {
    title: 'Collection Name',
    content: 'The name of the Plex collection where items pending deletion will be placed. Users can browse this collection in Plex to see what\'s scheduled for removal and save items they want to keep.',
    example: '"Leaving Soon" or "Auto-Cleanup Queue"'
  },
  bufferDays: {
    title: 'Buffer Days',
    content: 'How many days content stays in the "Leaving Soon" collection before being permanently deleted. This gives users time to watch or save content before it\'s removed. Setting this to 0 means immediate deletion.',
    example: '15 days = content stays in queue for 2 weeks before deletion'
  },
  maxDeletionsPerRun: {
    title: 'Max Deletions Per Run',
    content: 'Safety limit to prevent accidentally deleting too much content in a single rule execution. If a rule matches more items than this limit, only this many will be processed. Useful for catching overly broad rules.',
    example: '50 means at most 50 items deleted per scheduled run'
  },
  logRetentionDays: {
    title: 'Log Retention',
    content: 'How long to keep activity logs in the database. Older logs are automatically deleted to save space. Set higher for better audit trails, lower for smaller database size.',
    example: '30 days = logs older than a month are deleted'
  },
  dryRunMode: {
    title: 'Dry Run Mode',
    content: 'When enabled, rules will log what WOULD be deleted without actually deleting anything. Essential for testing new rules. Disable only when you\'re confident in your rule configuration.',
    example: 'Enable while setting up, disable for live operation'
  },
  deleteFiles: {
    title: 'Delete Files from Disk',
    content: 'When enabled, deletions will also remove the actual media files from your disk, not just the library entries. If disabled, files remain on disk but are removed from Plex. WARNING: Deleted files cannot be recovered.',
    example: 'Enable to free disk space, disable to keep files as backup'
  },

  // === SMART CLEANUP SETTINGS ===
  velocityMonitoring: {
    title: 'Velocity Monitoring',
    content: 'Tracks how fast each user watches episodes to detect binge sessions. When someone starts watching faster than usual, the system can proactively prepare content they\'ll need soon.',
    example: 'User normally watches 1 ep/day, suddenly watches 5 in a day = velocity spike detected'
  },
  velocityCheckInterval: {
    title: 'Velocity Check Interval',
    content: 'How often (in minutes) the system checks for changes in user watch velocity. Lower values detect changes faster but use more resources. Recommended: 60-180 minutes.',
    example: '120 = checks every 2 hours'
  },
  velocityChangeThreshold: {
    title: 'Velocity Change Threshold',
    content: 'Percentage change in watch speed that triggers an action. For example, 50% means if someone watches 1.5x faster or slower than their average, an alert or re-download is triggered.',
    example: '50% threshold: Normal pace = 1 ep/day, triggers at 1.5+ or 0.5 ep/day'
  },
  velocityLookbackEpisodes: {
    title: 'Lookback Episodes',
    content: 'Number of recently watched episodes used to calculate a user\'s current watch velocity. More episodes = smoother average but slower to detect changes. Fewer = more reactive but noisier.',
    example: '5 = calculates pace based on last 5 episodes watched'
  },
  velocityChangeAction: {
    title: 'On Velocity Change',
    content: 'What to do when a significant velocity change is detected. "Trigger Re-download" proactively gets episodes the user will need. "Send Alert" notifies you. "Both" does both actions.',
    example: 'Re-download = automatically fetches next episodes when binge detected'
  },
  redownloadEnabled: {
    title: 'Proactive Re-download',
    content: 'When enabled, automatically re-downloads deleted episodes from Sonarr when a slower viewer is approaching them. Ensures content is available just-in-time without permanently storing it.',
    example: 'Episode deleted after User A watched it, re-downloads when User B is 3 episodes away'
  },
  redownloadCheckInterval: {
    title: 'Re-download Check Interval',
    content: 'How often (in minutes) to check if any deleted episodes need to be re-downloaded for slower viewers. More frequent checks ensure timely downloads but use more resources.',
    example: '360 = checks every 6 hours'
  },
  redownloadLeadDays: {
    title: 'Re-download Lead Time',
    content: 'Days before a user needs an episode to trigger re-download. Accounts for download time and user schedule variations. Higher values are safer but use more storage temporarily.',
    example: '3 = starts downloading when user is ~3 days away from needing it'
  },
  emergencyBufferHours: {
    title: 'Emergency Buffer',
    content: 'If a user will need an episode within this many hours and it\'s not available, prioritize the download. Used for urgent situations where the normal lead time wasn\'t enough.',
    example: '24 = urgent download if user needs episode within next 24 hours'
  },
  minimumEpisodesKept: {
    title: 'Minimum Episodes Kept',
    content: 'Always keep at least this many episodes per show, regardless of watch status. Acts as a safety net to ensure shows are never completely deleted. Set to 0 to disable.',
    example: '2 = always keep at least 2 episodes of any show'
  },
  protectEpisodesAhead: {
    title: 'Protect Episodes Ahead',
    content: 'Always protect this many episodes ahead of the slowest active viewer\'s current position. Ensures there\'s always content ready to watch without waiting for downloads.',
    example: '3 = if slowest viewer is at S2E05, protect up to S2E08'
  },
  velocityBufferDays: {
    title: 'Velocity Buffer Days',
    content: 'Extra protection based on projected watch pace. Calculates how far each user will get in X days based on their velocity and protects those episodes.',
    example: '7 = protect episodes user is projected to reach in the next week'
  },
  activeViewerDays: {
    title: 'Active Viewer Window',
    content: 'How recently a user must have watched to be considered an "active" viewer. Inactive viewers are ignored when determining which episodes to protect. Prevents one-time viewers from blocking cleanup.',
    example: '30 = only consider users who watched something in the last month'
  },
  requireAllUsersWatched: {
    title: 'Require All Users Watched',
    content: 'When enabled, an episode is only eligible for deletion when ALL active viewers have watched past it. When disabled, episodes can be deleted if ANY user has passed them.',
    example: 'Enable for shared households, disable for personal servers'
  },
  includeSpecials: {
    title: 'Include Specials',
    content: 'Whether to apply smart cleanup rules to Season 0 (Specials). Some users want specials cleaned up like regular episodes, others want them kept indefinitely.',
    example: 'Enable to clean up watched specials, disable to keep all specials'
  },

  // === SCHEDULE SETTINGS ===
  schedule: {
    title: 'Rule Evaluation Schedule',
    content: 'Controls when Flexerr automatically scans your library and runs all active rules. At the scheduled time, each rule evaluates your media and adds matching items to the "Leaving Soon" queue. The queue is then processed hourly to delete items whose buffer period has expired. Format: minute hour day-of-month month day-of-week.',
    example: '"0 2 * * *" = scan library and evaluate rules daily at 2:00 AM'
  },
  timezone: {
    title: 'Timezone',
    content: 'The timezone used for the rule evaluation schedule above. Ensures rules run at the expected local time regardless of server timezone. Choose your local timezone for intuitive scheduling.',
    example: 'America/New_York = Eastern Time'
  },

  // === RULE EDITOR SETTINGS ===
  ruleName: {
    title: 'Rule Name',
    content: 'A descriptive name for this rule. Shown in the rules list, logs, and notifications. Use clear names that describe what the rule does.',
    example: '"Watched Movies 30+ Days" or "Low-Rated TV Cleanup"'
  },
  ruleDescription: {
    title: 'Rule Description',
    content: 'Optional longer description explaining the rule\'s purpose and behavior. Helpful for documenting complex rules or explaining to other users.',
    example: '"Removes movies watched over 30 days ago unless on a watchlist"'
  },
  targetType: {
    title: 'Target Type',
    content: 'What type of media this rule targets. Movies = individual films. Shows = entire TV series. Seasons = individual seasons. Episodes = individual episodes.',
    example: 'Use "Episodes" for granular cleanup, "Shows" to remove entire series at once'
  },
  ruleBufferDays: {
    title: 'Buffer Days',
    content: 'Days content stays in "Leaving Soon" before deletion. Overrides the global default for this specific rule. Set to 0 for immediate deletion (use carefully!).',
    example: '3 for aggressive cleanup, 30 for cautious cleanup'
  },
  conditionOperator: {
    title: 'Condition Logic (AND/OR)',
    content: 'AND = content must match ALL conditions to be selected. OR = content matches if ANY condition is true. AND is more restrictive, OR is more inclusive.',
    example: 'AND: watched + 30 days old = both must be true. OR: watched OR 30 days old = either works'
  },
  ruleIsActive: {
    title: 'Rule Active',
    content: 'Whether this rule runs on schedule. Inactive rules are ignored during scheduled runs but can still be run manually. Use to temporarily disable rules without deleting them.',
    example: 'Disable during holidays when users may want to rewatch content'
  },
  rulePriority: {
    title: 'Rule Priority',
    content: 'Order in which rules execute (higher numbers run first). Useful when rules might conflict or when order matters. Rules with same priority run in creation order.',
    example: 'Priority 100 runs before priority 50'
  },
  targetLibraries: {
    title: 'Target Libraries',
    content: 'Limit this rule to specific Plex libraries. Leave empty to apply to all libraries of the matching type. Useful for different rules for different library purposes.',
    example: 'Apply different rules to "Kids TV" vs "Adult TV" libraries'
  },

  // === SMART MODE SETTINGS ===
  smartEnabled: {
    title: 'Smart Mode',
    content: 'Enables intelligent multi-user episode tracking. Instead of simple "watched = delete", tracks where each user is in a show and their watch pace to make smarter decisions.',
    example: 'User A at S3, User B at S1 = protects S1-S2 for User B'
  },
  smartMinDaysSinceWatch: {
    title: 'Min Days Since Watch',
    content: 'Minimum days after the last user watched an episode before it becomes a deletion candidate. Prevents recently watched content from being immediately queued.',
    example: '15 = episode must be unwatched for 15+ days by all users'
  },
  smartActiveViewerDays: {
    title: 'Active Viewer Threshold',
    content: 'Days since a user\'s last watch activity to consider them "active" for a show. Inactive users don\'t block episode deletion. Prevents abandoned watchings from blocking cleanup.',
    example: '30 = user must have watched within 30 days to be considered active'
  },
  smartVelocityBuffer: {
    title: 'Velocity Buffer Days',
    content: 'Protect episodes a user is projected to reach within X days based on their watch pace. Higher values are safer but clean up less aggressively.',
    example: '7 = if user watches 1 ep/day and is at E05, protect through E12'
  },
  smartMinEpisodesAhead: {
    title: 'Min Episodes Ahead',
    content: 'Always keep at least this many episodes ahead of the slowest active viewer. Acts as a safety net regardless of velocity calculations.',
    example: '3 = always keep 3+ unwatched episodes ahead of slowest viewer'
  },
  smartRequireAllWatched: {
    title: 'Require All Users Watched',
    content: 'When enabled, ALL active users must have watched past an episode before it can be deleted. When disabled, episodes can be deleted once ANY user has passed them.',
    example: 'Enable for family servers where everyone watches the same shows'
  },
  smartProactiveRedownload: {
    title: 'Auto Re-download',
    content: 'Automatically triggers Sonarr to re-download deleted episodes when a slower viewer is approaching them. Ensures content is available just-in-time.',
    example: 'Episode deleted after User A watched, re-downloaded when User B approaches'
  },
  smartRedownloadLeadDays: {
    title: 'Re-download Lead Time',
    content: 'Days before a user needs an episode to trigger automatic re-download. Accounts for download time. Set higher if you have slow download speeds.',
    example: '3 = triggers download when user is 3 days away from needing episode'
  },

  // === CONDITION FIELDS ===
  conditionWatched: {
    title: 'Watched',
    content: 'Whether the content has been watched by at least one user. For episodes, this is view completion. For shows/movies, considers the entire item watched.',
    example: '"Watched is Yes" matches all watched content'
  },
  conditionViewCount: {
    title: 'View Count',
    content: 'Number of times content has been watched (by any user). Useful for identifying rarely watched content or frequently rewatched favorites.',
    example: '"View Count greater than 0" = watched at least once'
  },
  conditionDaysSinceWatched: {
    title: 'Days Since Watched',
    content: 'Days since the content was last watched by anyone. Useful for cleaning up old watched content while keeping recent views.',
    example: '"Days Since Watched greater than 30" = not watched in last month'
  },
  conditionOnWatchlist: {
    title: 'On Watchlist',
    content: 'Whether the content appears on any user\'s Plex or Overseerr watchlist. Watchlisted content is typically protected from deletion as users explicitly want it.',
    example: '"On Watchlist is No" = not on anyone\'s watchlist'
  },
  conditionDaysSinceActivity: {
    title: 'Days Since Activity',
    content: 'Days since any activity (watch, partial view, etc.) on the content. Broader than "watched" as it includes partial views and other interactions.',
    example: '"Days Since Activity greater than 60" = no interaction in 2 months'
  },
  conditionDaysSinceAdded: {
    title: 'Days Since Added',
    content: 'Days since the content was added to Plex. Useful for cleaning up old content that was never watched.',
    example: '"Days Since Added greater than 90" = in library for 3+ months'
  },
  conditionYear: {
    title: 'Release Year',
    content: 'The year the movie/show was released. Useful for cleaning up old content or protecting recent releases.',
    example: '"Year less than 2020" = released before 2020'
  },
  conditionRating: {
    title: 'Rating',
    content: 'The audience/critic rating (0-10 scale). Uses the rating source configured in Plex. Useful for cleaning up poorly rated content.',
    example: '"Rating less than 5" = below average rating'
  },
  conditionGenre: {
    title: 'Genre',
    content: 'Content genre(s). Use "contains" to match content that includes the genre. Case-insensitive matching.',
    example: '"Genre contains Horror" matches horror movies'
  },
  conditionContentRating: {
    title: 'Content Rating',
    content: 'Age rating (G, PG, PG-13, R, TV-MA, etc.). Exact match required. Useful for different rules for kids vs adult content.',
    example: '"Content Rating equals TV-MA" = mature content only'
  },
  conditionFileSizeGb: {
    title: 'File Size (GB)',
    content: 'Total file size in gigabytes. Useful for targeting large files when storage is limited. For shows, this is the total size of all episodes.',
    example: '"File Size greater than 50" = files over 50GB'
  },
  conditionMonitored: {
    title: 'Monitored (Sonarr/Radarr)',
    content: 'Whether the content is being monitored in Sonarr/Radarr for upgrades/new episodes. Unmonitored content may be safe to delete.',
    example: '"Monitored is No" = not being tracked in *arr'
  },
  conditionHasRequest: {
    title: 'Has Overseerr Request',
    content: 'Whether there\'s an active Overseerr/Jellyseerr request for this content. Content with pending requests should typically be protected.',
    example: '"Has Request is Yes" = someone requested this content'
  },

  // === ACTION DESCRIPTIONS ===
  actionAddToCollection: {
    title: 'Add to Collection',
    content: 'Adds matching content to the "Leaving Soon" Plex collection. The buffer period determines how long it stays before other deletion actions run.',
    example: 'Content appears in Plex under Collections > Leaving Soon'
  },
  actionDeleteFromPlex: {
    title: 'Delete from Plex',
    content: 'Removes the content from Plex library. If "Delete Files" is enabled in settings, also removes the media files from disk.',
    example: 'Content disappears from Plex but may still exist on disk'
  },
  actionDeleteFromSonarr: {
    title: 'Delete from Sonarr',
    content: 'Removes the series from Sonarr. Can optionally delete files. Prevents Sonarr from re-downloading the content.',
    example: 'Show removed from Sonarr entirely'
  },
  actionDeleteFromRadarr: {
    title: 'Delete from Radarr',
    content: 'Removes the movie from Radarr. Can optionally delete files. Prevents Radarr from re-downloading the content.',
    example: 'Movie removed from Radarr entirely'
  },
  actionUnmonitorSonarr: {
    title: 'Unmonitor in Sonarr',
    content: 'Stops Sonarr from monitoring the series for new episodes and quality upgrades. Content stays in library but won\'t be auto-downloaded.',
    example: 'Show stays but no new episodes downloaded'
  },
  actionUnmonitorRadarr: {
    title: 'Unmonitor in Radarr',
    content: 'Stops Radarr from monitoring the movie for quality upgrades. Movie stays in library but won\'t get better quality versions.',
    example: 'Movie stays but no quality upgrades'
  },
  actionClearOverseerrRequest: {
    title: 'Clear Overseerr Request',
    content: 'Removes the request from Overseerr/Jellyseerr. Useful for cleaning up completed requests so users know the content was available.',
    example: 'Request disappears from Overseerr request list'
  },
  actionAddTag: {
    title: 'Add Tag',
    content: 'Adds a tag to the content in Sonarr/Radarr. Useful for marking content for later processing or organization.',
    example: 'Tag "pending-deletion" added to content'
  },
  actionDeleteFiles: {
    title: 'Delete Files from Disk',
    content: 'Permanently deletes the media files from your storage. WARNING: This cannot be undone! Use with caution.',
    example: 'Files physically removed from disk, freeing storage space'
  },

  // === NOTIFICATION SETTINGS ===
  webhookType: {
    title: 'Notification Type',
    content: 'The notification service to use. Discord and Slack provide rich embeds with posters. Gotify/Pushover/ntfy are push notification services.',
    example: 'Discord for server channels, Pushover for mobile alerts'
  },
  webhookUrl: {
    title: 'Webhook URL',
    content: 'The URL where notifications are sent. For Discord/Slack, this is the webhook URL from channel settings. For Gotify/ntfy, this is your server URL.',
    example: 'Discord: https://discord.com/api/webhooks/...'
  },
  triggerQueueAdd: {
    title: 'Queue Add Trigger',
    content: 'Send notification when items are added to the "Leaving Soon" collection. Useful for alerting users that content is scheduled for removal.',
    example: 'Notification: "Movie X was added to Leaving Soon (15 days remaining)"'
  },
  triggerDelete: {
    title: 'Delete Trigger',
    content: 'Send notification when content is permanently deleted. Confirms cleanup actions and provides an audit trail.',
    example: 'Notification: "Movie X was deleted from library"'
  },
  triggerRuleComplete: {
    title: 'Rule Complete Trigger',
    content: 'Send notification when a rule finishes executing. Includes summary of matches and actions taken.',
    example: 'Notification: "Rule \'Watched Movies\' completed: 5 items processed"'
  },
  triggerError: {
    title: 'Error Trigger',
    content: 'Send notification when an error occurs. Important for catching connection issues or rule failures.',
    example: 'Notification: "Error: Failed to connect to Plex server"'
  },
  triggerServiceDown: {
    title: 'Service Down Trigger',
    content: 'Send notification when a connected service (Plex, Sonarr, etc.) becomes unreachable.',
    example: 'Notification: "Warning: Sonarr connection lost"'
  }
};
