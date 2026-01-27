const { db, getSetting, log } = require('../database');

/**
 * Watchlist Priority Service
 *
 * In Flexerr, this is handled internally by watchlist-trigger.js.
 * This stub exists for compatibility with scheduler.js.
 * Will be expanded when lifecycle management features are added.
 */
class WatchlistPriorityService {
  constructor() {
    this.isRunning = false;
    this.lastRun = null;
    this.lastResults = null;
  }

  async initialize() {
    // Flexerr handles watchlist-to-download via watchlist-trigger.js
    return this;
  }

  /**
   * Stub - Flexerr handles watchlist triggers internally
   */
  async run() {
    if (this.isRunning) {
      return { skipped: true, reason: 'Already running' };
    }

    this.isRunning = true;
    this.lastRun = new Date();

    try {
      // In Flexerr, watchlist additions are handled immediately
      // by the watchlist-trigger service when users add items
      this.lastResults = {
        processed: 0,
        newlyAdded: 0,
        restored: 0,
        errors: 0,
        message: 'Watchlist management handled by Flexerr internally'
      };

      return this.lastResults;
    } finally {
      this.isRunning = false;
    }
  }

  getStatus() {
    return {
      enabled: false,
      lastRun: this.lastRun,
      lastResults: this.lastResults,
      isRunning: this.isRunning,
      message: 'Lifecycle management coming soon'
    };
  }
}

// Singleton instance
let instance = null;

function getWatchlistPriorityService() {
  if (!instance) {
    instance = new WatchlistPriorityService();
  }
  return instance;
}

module.exports = { getWatchlistPriorityService, WatchlistPriorityService };
