const cron = require('node-cron');
const { db, getSetting, log } = require('../database');
const RulesEngine = require('./rules-engine');
const Viper = require('./smart-episodes');
const { getWatchlistPriorityService } = require('./watchlist-priority');
const WatchlistTriggerService = require('./watchlist-trigger');
const PlexSync = require('./plex-sync');

class Scheduler {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
    this.rulesEngine = new RulesEngine();
    this.viper = new Viper();
    this.watchlistPriority = getWatchlistPriorityService();
    this.lastVelocityCheck = null;
    this.lastRedownloadCheck = null;
    this.lastWatchlistCheck = null;
    this.lastPlexSync = null;
    this.lastVelocityCleanup = null;
  }

  // Initialize the scheduler with configured schedule
  async start() {
    const schedule = getSetting('schedule') || '0 2 * * *'; // Default: 2 AM daily

    // Validate cron expression
    if (!cron.validate(schedule)) {
      log('error', 'system', `Invalid cron schedule: ${schedule}`);
      throw new Error(`Invalid cron schedule: ${schedule}`);
    }

    // Cancel existing jobs
    this.stop();

    // Schedule main rules job
    const mainJob = cron.schedule(schedule, async () => {
      await this.runScheduledTask();
    }, {
      scheduled: true,
      timezone: getSetting('timezone') || 'UTC'
    });

    this.jobs.set('main', mainJob);

    // Schedule queue processor (runs every hour to check for expired buffers)
    const queueJob = cron.schedule('0 * * * *', async () => {
      await this.processQueue();
    }, {
      scheduled: true,
      timezone: getSetting('timezone') || 'UTC'
    });

    this.jobs.set('queue', queueJob);

    // Schedule log cleanup (runs daily at 3 AM)
    const cleanupJob = cron.schedule('0 3 * * *', async () => {
      await this.cleanupLogs();
    }, {
      scheduled: true,
      timezone: getSetting('timezone') || 'UTC'
    });

    this.jobs.set('cleanup', cleanupJob);

    // Schedule smart episode monitoring jobs
    await this.scheduleSmartMonitoring();

    // Schedule watchlist priority monitoring
    await this.scheduleWatchlistPriority();

    // Schedule Plex watchlist sync (every 60 seconds)
    await this.schedulePlexWatchlistSync();

    // Schedule Plex library/history sync (every 60 seconds)
    await this.schedulePlexSync();

    // Schedule velocity-based cleanup
    await this.scheduleVelocityCleanup();

    log('info', 'system', `Scheduler started with schedule: ${schedule}`);
    console.log(`[Scheduler] Started with schedule: ${schedule}`);
  }

  // Stop all scheduled jobs
  stop() {
    for (const [name, job] of this.jobs) {
      job.stop();
      console.log(`[Scheduler] Stopped job: ${name}`);
    }
    this.jobs.clear();
  }

  // Restart with new schedule
  async restart() {
    this.stop();
    await this.start();
  }

  // Run the main scheduled task
  async runScheduledTask() {
    if (this.isRunning) {
      log('warn', 'system', 'Scheduled task already running, skipping');
      return;
    }

    this.isRunning = true;
    log('info', 'system', 'Starting scheduled rule execution');

    try {
      const results = await this.rulesEngine.runAllRules();
      log('info', 'system', 'Scheduled rule execution complete', {
        rules_run: results.rulesRun,
        matches: results.matches,
        queue_processed: results.queueProcessed
      });
    } catch (error) {
      log('error', 'system', 'Scheduled rule execution failed', {
        error: error.message
      });
    } finally {
      this.isRunning = false;
    }
  }

  // Process the queue (items with expired buffers)
  async processQueue() {
    if (this.isRunning) return;

    try {
      this.isRunning = true;
      const processed = await this.rulesEngine.processQueue();
      if (processed > 0) {
        log('info', 'system', `Queue processor: ${processed} items processed`);
      }
    } catch (error) {
      log('error', 'system', 'Queue processing failed', { error: error.message });
    } finally {
      this.isRunning = false;
    }
  }

  // Clean up old logs
  async cleanupLogs() {
    const retentionDays = parseInt(getSetting('log_retention_days')) || 30;
    const { db } = require('../database');

    const result = db.prepare(`
      DELETE FROM logs
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `).run(retentionDays);

    if (result.changes > 0) {
      log('info', 'system', `Cleaned up ${result.changes} old log entries`);
    }
  }

  // Clean up stale queue items that no longer match rules
  async cleanupStaleQueue() {
    if (this.isRunning) {
      console.log('[Scheduler] Skipping queue cleanup - another task is running');
      return;
    }

    try {
      console.log('[Scheduler] Running queue cleanup...');
      const result = await this.rulesEngine.cleanupStaleQueueItems();
      if (result.removed > 0) {
        console.log(`[Scheduler] Queue cleanup: removed ${result.removed} stale items`);
      }
    } catch (error) {
      console.error('[Scheduler] Queue cleanup failed:', error.message);
      log('error', 'system', 'Queue cleanup failed', { error: error.message });
    }
  }

  // Manual trigger
  async runNow(dryRun = null) {
    if (this.isRunning) {
      throw new Error('A task is already running');
    }

    this.isRunning = true;
    try {
      const results = await this.rulesEngine.runAllRules(dryRun);
      return results;
    } finally {
      this.isRunning = false;
    }
  }

  // Run a single rule
  async runRule(ruleId, dryRun = true) {
    if (this.isRunning) {
      throw new Error('A task is already running');
    }

    const rule = this.rulesEngine.getRule(ruleId);
    if (!rule) {
      throw new Error('Rule not found');
    }

    this.isRunning = true;
    try {
      const matches = await this.rulesEngine.evaluateRule(rule, dryRun);
      const results = [];

      for (const match of matches) {
        const actionResults = await this.rulesEngine.executeActions(rule, match, dryRun);
        results.push({
          item: match.item.title,
          library: match.library,
          actions: actionResults
        });
      }

      return {
        rule: rule.name,
        matches: matches.length,
        dryRun,
        results
      };
    } finally {
      this.isRunning = false;
    }
  }

  // Force reset the running lock (emergency use)
  resetLock() {
    const wasRunning = this.isRunning;
    this.isRunning = false;
    return wasRunning;
  }

  // Preview what a rule would match (always dry run, no actions)
  async previewRule(ruleId) {
    const rule = this.rulesEngine.getRule(ruleId);
    if (!rule) {
      throw new Error('Rule not found');
    }

    const matches = await this.rulesEngine.evaluateRule(rule, true);

    return matches.map(m => ({
      ratingKey: m.item.ratingKey,
      title: m.item.title,
      year: m.item.year,
      type: m.item.type,
      library: m.library,
      poster: m.item.thumb,
      viewCount: m.item.viewCount,
      lastViewedAt: m.item.lastViewedAt,
      onWatchlist: m.context.onWatchlist,
      fileSize: m.context.fileSize
    }));
  }

  // Schedule smart episode monitoring jobs
  async scheduleSmartMonitoring() {
    const timezone = getSetting('timezone') || 'UTC';

    // Get configured intervals (in minutes)
    const velocityInterval = parseInt(getSetting('smart_velocity_check_interval')) || 120;
    const redownloadInterval = parseInt(getSetting('smart_redownload_check_interval')) || 360;
    const velocityEnabled = getSetting('smart_velocity_monitoring_enabled') === 'true';
    const redownloadEnabled = getSetting('smart_redownload_enabled') === 'true';

    // Clear existing smart jobs
    if (this.jobs.has('velocity')) {
      this.jobs.get('velocity').stop();
      this.jobs.delete('velocity');
    }
    if (this.jobs.has('redownload')) {
      this.jobs.get('redownload').stop();
      this.jobs.delete('redownload');
    }

    // Schedule velocity monitoring
    if (velocityEnabled) {
      // Convert minutes to cron expression (run every N minutes)
      const velocityCron = this.minutesToCron(velocityInterval);
      const velocityJob = cron.schedule(velocityCron, async () => {
        await this.runVelocityCheck();
      }, {
        scheduled: true,
        timezone
      });
      this.jobs.set('velocity', velocityJob);
      console.log(`[Scheduler] Velocity monitoring scheduled: every ${velocityInterval} minutes`);
    }

    // Schedule redownload checks
    if (redownloadEnabled) {
      const redownloadCron = this.minutesToCron(redownloadInterval);
      const redownloadJob = cron.schedule(redownloadCron, async () => {
        await this.runRedownloadCheck();
      }, {
        scheduled: true,
        timezone
      });
      this.jobs.set('redownload', redownloadJob);
      console.log(`[Scheduler] Redownload check scheduled: every ${redownloadInterval} minutes`);
    }
  }

  // Convert minutes to a cron expression
  minutesToCron(minutes) {
    if (minutes < 60) {
      // Every N minutes: */N * * * *
      return `*/${minutes} * * * *`;
    } else if (minutes < 1440) {
      // Every N hours: 0 */H * * *
      const hours = Math.floor(minutes / 60);
      return `0 */${hours} * * *`;
    } else {
      // Daily: 0 0 * * *
      return '0 0 * * *';
    }
  }

  // Run velocity change detection
  async runVelocityCheck() {
    if (this.isRunning) {
      console.log('[Scheduler] Skipping velocity check - another task is running');
      return;
    }

    try {
      console.log('[Scheduler] Running velocity check...');
      await this.viper.initialize();
      const result = await this.viper.handleVelocityChanges();

      this.lastVelocityCheck = {
        timestamp: new Date(),
        changesDetected: result.changesDetected || 0,
        actionsTriggered: result.actionsTriggered?.length || 0
      };

      if (result.changesDetected > 0) {
        log('info', 'viper', `Velocity check: ${result.changesDetected} changes detected`, {
          details: JSON.stringify(result)
        });
      }
    } catch (error) {
      console.error('[Scheduler] Velocity check failed:', error.message);
      log('error', 'viper', 'Velocity check failed', { error: error.message });
    }
  }

  // Run proactive redownload check
  async runRedownloadCheck() {
    if (this.isRunning) {
      console.log('[Scheduler] Skipping redownload check - another task is running');
      return;
    }

    try {
      console.log('[Scheduler] Running redownload check...');
      await this.viper.initialize();

      // First check for emergencies
      const emergencyResult = await this.viper.runEmergencyRedownloads();

      // Then run standard proactive redownloads
      const redownloadResult = await this.viper.runProactiveRedownloads();

      this.lastRedownloadCheck = {
        timestamp: new Date(),
        emergencies: emergencyResult.processed || 0,
        proactive: redownloadResult.processed || 0
      };

      const totalProcessed = (emergencyResult.processed || 0) + (redownloadResult.processed || 0);
      if (totalProcessed > 0) {
        log('info', 'viper', `Redownload check: ${totalProcessed} episodes processed`, {
          emergencies: emergencyResult.processed || 0,
          proactive: redownloadResult.processed || 0
        });
      }
    } catch (error) {
      console.error('[Scheduler] Redownload check failed:', error.message);
      log('error', 'viper', 'Redownload check failed', { error: error.message });
    }
  }

  // Refresh smart monitoring schedules (called when settings change)
  async refreshSmartMonitoring() {
    console.log('[Scheduler] Refreshing smart monitoring schedules...');
    await this.scheduleSmartMonitoring();
  }

  // Schedule watchlist priority monitoring
  async scheduleWatchlistPriority() {
    const timezone = getSetting('timezone') || 'UTC';
    const enabled = getSetting('watchlist_priority_enabled') === 'true';
    const interval = parseInt(getSetting('watchlist_priority_interval')) || 1; // Default: every 1 minute

    // Clear existing job
    if (this.jobs.has('watchlist-priority')) {
      this.jobs.get('watchlist-priority').stop();
      this.jobs.delete('watchlist-priority');
    }

    if (!enabled) {
      console.log('[Scheduler] Watchlist priority monitoring is disabled');
      return;
    }

    // Schedule watchlist priority check
    const watchlistCron = this.minutesToCron(interval);
    const watchlistJob = cron.schedule(watchlistCron, async () => {
      await this.runWatchlistPriorityCheck();
    }, {
      scheduled: true,
      timezone
    });

    this.jobs.set('watchlist-priority', watchlistJob);
    console.log(`[Scheduler] Watchlist priority monitoring scheduled: every ${interval} minute(s)`);
  }

  // Run watchlist priority check
  async runWatchlistPriorityCheck() {
    try {
      const result = await this.watchlistPriority.run();

      this.lastWatchlistCheck = {
        timestamp: new Date(),
        checked: result.checked || 0,
        actionsRequired: result.actionsRequired || 0,
        errors: result.errors?.length || 0
      };

      if (result.actionsRequired > 0) {
        console.log(`[Scheduler] Watchlist priority: ${result.actionsRequired} items restored/re-monitored`);
      }
    } catch (error) {
      console.error('[Scheduler] Watchlist priority check failed:', error.message);
      log('error', 'watchlist-priority', 'Check failed', { error: error.message });
    }
  }

  // Refresh watchlist priority schedule (called when settings change)
  async refreshWatchlistPriority() {
    console.log('[Scheduler] Refreshing watchlist priority schedule...');
    await this.scheduleWatchlistPriority();
  }

  // Manual trigger for watchlist priority
  async runWatchlistPriorityNow() {
    return await this.watchlistPriority.run();
  }

  // Schedule Plex watchlist sync (runs every 60 seconds for bi-directional sync)
  async schedulePlexWatchlistSync() {
    // Clear existing job
    if (this.jobs.has('plex-watchlist-sync')) {
      this.jobs.get('plex-watchlist-sync').stop();
      this.jobs.delete('plex-watchlist-sync');
    }

    // Schedule every 60 seconds
    const syncJob = cron.schedule('* * * * *', async () => {
      await this.runPlexWatchlistSync();
    }, {
      scheduled: true,
      timezone: getSetting('timezone') || 'UTC'
    });

    this.jobs.set('plex-watchlist-sync', syncJob);
    console.log('[Scheduler] Plex watchlist sync scheduled: every 60 seconds');
  }

  // Run Plex watchlist sync for all users
  async runPlexWatchlistSync() {
    try {
      // Get all users with Plex tokens
      const plexUsers = db.prepare('SELECT id, plex_token, username FROM users WHERE plex_token IS NOT NULL').all();

      for (const user of plexUsers) {
        try {
          await WatchlistTriggerService.syncPlexWatchlist(user.id, user.plex_token);
        } catch (userError) {
          console.warn(`[Scheduler] Plex watchlist sync failed for user ${user.username}:`, userError.message);
        }
      }

      // Sync Jellyfin users' favorites
      const jellyfinUsers = db.prepare(`
        SELECT u.id, u.username, u.jellyfin_user_id, u.media_server_id
        FROM users u
        JOIN media_servers ms ON u.media_server_id = ms.id
        WHERE ms.type = 'jellyfin' AND ms.is_active = 1 AND u.jellyfin_user_id IS NOT NULL
      `).all();

      for (const user of jellyfinUsers) {
        try {
          await WatchlistTriggerService.syncJellyfinFavorites(user.id, user.jellyfin_user_id, user.media_server_id);
        } catch (userError) {
          console.warn(`[Scheduler] Jellyfin favorites sync failed for user ${user.username}:`, userError.message);
        }
      }

      // Process any pending requests that weren't sent to Sonarr/Radarr
      try {
        const result = await WatchlistTriggerService.processPendingRequests();
        if (result.processed > 0) {
          console.log(`[Scheduler] Processed ${result.processed}/${result.total} pending requests`);
        }
      } catch (pendingError) {
        console.warn('[Scheduler] Error processing pending requests:', pendingError.message);
      }

      // Check availability of processing requests
      try {
        await WatchlistTriggerService.checkAvailability();
      } catch (availError) {
        console.warn('[Scheduler] Error checking availability:', availError.message);
      }
    } catch (error) {
      console.error('[Scheduler] Watchlist sync failed:', error.message);
    }
  }

  // Schedule Plex library and watch history sync
  async schedulePlexSync() {
    const timezone = getSetting('timezone') || 'UTC';
    const interval = parseInt(getSetting('plex_sync_interval')) || 60; // Default: 60 seconds
    const enabled = getSetting('plex_sync_enabled') !== 'false'; // Enabled by default

    // Clear existing job
    if (this.jobs.has('plex-sync')) {
      this.jobs.get('plex-sync').stop();
      this.jobs.delete('plex-sync');
    }

    if (!enabled) {
      console.log('[Scheduler] Plex sync is disabled');
      return;
    }

    // Schedule based on interval (in seconds)
    // Use setInterval for sub-minute intervals
    if (interval < 60) {
      const intervalId = setInterval(async () => {
        await this.runPlexSync();
      }, interval * 1000);

      // Store reference with a stop method
      this.jobs.set('plex-sync', {
        stop: () => clearInterval(intervalId)
      });
      console.log(`[Scheduler] Plex sync scheduled: every ${interval} seconds`);
    } else {
      // Use cron for minute+ intervals
      const cronExpr = this.secondsToCron(interval);
      const syncJob = cron.schedule(cronExpr, async () => {
        await this.runPlexSync();
      }, {
        scheduled: true,
        timezone
      });
      this.jobs.set('plex-sync', syncJob);
      console.log(`[Scheduler] Plex sync scheduled: ${cronExpr}`);
    }
  }

  // Convert seconds to cron expression
  secondsToCron(seconds) {
    if (seconds < 60) {
      // Every N seconds not directly supported, use every minute
      return '* * * * *';
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `*/${minutes} * * * *`;
    } else if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `0 */${hours} * * *`;
    }
    return '0 * * * *'; // Default: hourly
  }

  // Run Plex library and watch history sync
  async runPlexSync() {
    try {
      const result = await PlexSync.runSync();

      this.lastPlexSync = {
        timestamp: new Date(),
        ...result
      };

      // Only log if there were actual changes
      if (result.library?.added > 0 || result.library?.removed > 0 ||
          result.watchHistory?.entries > 0 || result.users?.imported > 0) {
        console.log('[Scheduler] Plex sync:', {
          library: result.library,
          history: result.watchHistory,
          users: result.users
        });
      }
    } catch (error) {
      console.error('[Scheduler] Plex sync failed:', error.message);
      log('error', 'plex-sync', 'Sync failed', { error: error.message });
    }
  }

  // Force full Plex sync (clears cache)
  async forceFullPlexSync() {
    return await PlexSync.forceFullSync();
  }

  // Get Plex sync status
  getPlexSyncStatus() {
    return {
      ...PlexSync.getStatus(),
      lastSync: this.lastPlexSync
    };
  }

  // =========================================
  // VELOCITY-BASED CLEANUP
  // =========================================

  // Schedule velocity-based cleanup
  async scheduleVelocityCleanup() {
    const timezone = getSetting('timezone') || 'UTC';
    const enabled = getSetting('velocity_cleanup_enabled') === 'true';
    const schedule = getSetting('velocity_cleanup_schedule') || '0 3 * * *'; // Default: 3 AM daily

    // Clear existing job
    if (this.jobs.has('velocity-cleanup')) {
      this.jobs.get('velocity-cleanup').stop();
      this.jobs.delete('velocity-cleanup');
    }

    if (!enabled) {
      console.log('[Scheduler] Velocity-based cleanup is disabled');
      return;
    }

    // Validate cron expression
    if (!cron.validate(schedule)) {
      console.error(`[Scheduler] Invalid velocity cleanup schedule: ${schedule}`);
      return;
    }

    const cleanupJob = cron.schedule(schedule, async () => {
      await this.runVelocityCleanup();
    }, {
      scheduled: true,
      timezone
    });

    this.jobs.set('velocity-cleanup', cleanupJob);
    console.log(`[Scheduler] Velocity cleanup scheduled: ${schedule}`);
  }

  // Run velocity-based cleanup
  async runVelocityCleanup(dryRunOverride = null) {
    if (this.isRunning) {
      console.log('[Scheduler] Skipping velocity cleanup - another task is running');
      return { skipped: true };
    }

    // Use override if provided, otherwise read from settings
    const dryRun = dryRunOverride !== null ? dryRunOverride : getSetting('dry_run') === 'true';

    try {
      this.isRunning = true;
      console.log(`[Scheduler] Running velocity cleanup (dryRun: ${dryRun})...`);

      await this.viper.initialize();

      // Run episode cleanup (velocity-based)
      const episodeResults = await this.viper.runVelocityCleanup(dryRun);

      // Run movie cleanup
      const movieResults = await this.viper.runMovieCleanup(dryRun);

      this.lastVelocityCleanup = {
        timestamp: new Date(),
        dryRun,
        episodes: {
          analyzed: episodeResults.episodesAnalyzed || 0,
          candidates: episodeResults.deletionCandidates?.length || 0,
          deleted: episodeResults.deleted?.length || 0
        },
        movies: {
          analyzed: movieResults.moviesAnalyzed || 0,
          candidates: movieResults.deletionCandidates?.length || 0,
          deleted: movieResults.deleted?.length || 0
        }
      };

      // Log summary
      const totalCandidates = (episodeResults.deletionCandidates?.length || 0) +
                             (movieResults.deletionCandidates?.length || 0);
      const totalDeleted = (episodeResults.deleted?.length || 0) +
                          (movieResults.deleted?.length || 0);

      if (totalCandidates > 0 || totalDeleted > 0) {
        console.log(`[Scheduler] Velocity cleanup complete:`, {
          dryRun,
          episodeCandidates: episodeResults.deletionCandidates?.length || 0,
          movieCandidates: movieResults.deletionCandidates?.length || 0,
          deleted: totalDeleted
        });

        log(dryRun ? 'info' : 'warn', 'velocity-cleanup',
          `Cleanup ${dryRun ? 'analysis' : 'execution'} complete`, {
          episode_candidates: episodeResults.deletionCandidates?.length || 0,
          movie_candidates: movieResults.deletionCandidates?.length || 0,
          deleted: totalDeleted,
          dry_run: dryRun
        });
      }

      return {
        episodes: episodeResults,
        movies: movieResults
      };
    } catch (error) {
      console.error('[Scheduler] Velocity cleanup failed:', error.message);
      log('error', 'velocity-cleanup', 'Cleanup failed', { error: error.message });
      return { error: error.message };
    } finally {
      this.isRunning = false;
    }
  }

  // Manual trigger for velocity cleanup
  async runVelocityCleanupNow(dryRun = true) {
    // Pass the dryRun parameter directly to runVelocityCleanup
    return await this.runVelocityCleanup(dryRun);
  }

  // Get velocity cleanup status and summary
  async getVelocityCleanupStatus() {
    await this.viper.initialize();
    const summary = await this.viper.getCleanupSummary();

    return {
      enabled: getSetting('velocity_cleanup_enabled') === 'true',
      schedule: getSetting('velocity_cleanup_schedule') || '0 3 * * *',
      dryRun: getSetting('dry_run') === 'true',
      lastRun: this.lastVelocityCleanup,
      summary
    };
  }

  // Get scheduler status
  getStatus() {
    const velocityInterval = parseInt(getSetting('smart_velocity_check_interval')) || 120;
    const redownloadInterval = parseInt(getSetting('smart_redownload_check_interval')) || 360;
    const watchlistInterval = parseInt(getSetting('watchlist_priority_interval')) || 1;
    const plexSyncInterval = parseInt(getSetting('plex_sync_interval')) || 60;

    return {
      running: this.jobs.size > 0, // Scheduler is "running" if jobs are scheduled
      isRunning: this.isRunning,   // A job is currently executing
      jobs: Array.from(this.jobs.keys()),
      schedule: getSetting('schedule') || '0 2 * * *',
      timezone: getSetting('timezone') || 'UTC',
      dryRun: getSetting('dry_run') === 'true',
      smartMonitoring: {
        velocityEnabled: getSetting('smart_velocity_monitoring_enabled') === 'true',
        velocityInterval: velocityInterval,
        lastVelocityCheck: this.lastVelocityCheck,
        redownloadEnabled: getSetting('smart_redownload_enabled') === 'true',
        redownloadInterval: redownloadInterval,
        lastRedownloadCheck: this.lastRedownloadCheck
      },
      watchlistPriority: {
        enabled: getSetting('watchlist_priority_enabled') === 'true',
        interval: watchlistInterval,
        lastCheck: this.lastWatchlistCheck,
        ...this.watchlistPriority.getStatus()
      },
      plexSync: {
        enabled: getSetting('plex_sync_enabled') !== 'false',
        interval: plexSyncInterval,
        lastSync: this.lastPlexSync,
        ...PlexSync.getStatus()
      },
      velocityCleanup: {
        enabled: getSetting('velocity_cleanup_enabled') === 'true',
        schedule: getSetting('velocity_cleanup_schedule') || '0 3 * * *',
        dryRun: getSetting('dry_run') === 'true',
        lastRun: this.lastVelocityCleanup
      }
    };
  }
}

// Singleton instance
const scheduler = new Scheduler();

module.exports = scheduler;
