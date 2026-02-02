/**
 * Debug Logger Service
 * Provides configurable debug logging levels for troubleshooting
 *
 * Levels:
 * 0 = Off (only critical errors)
 * 1 = Basic (errors, warnings, key events)
 * 2 = Verbose (API calls, sync operations, state changes)
 * 3 = Trace (everything - internal state, variable values, function entry/exit)
 */

const { getSetting } = require('../database');

// Cache the debug level to avoid DB hits on every log
let cachedDebugLevel = null;
let lastCacheTime = 0;
const CACHE_TTL = 5000; // Refresh cache every 5 seconds

const DEBUG_LEVELS = {
  OFF: 0,
  BASIC: 1,
  VERBOSE: 2,
  TRACE: 3
};

const LEVEL_NAMES = ['OFF', 'BASIC', 'VERBOSE', 'TRACE'];

function getDebugLevel() {
  const now = Date.now();
  if (cachedDebugLevel === null || (now - lastCacheTime) > CACHE_TTL) {
    const setting = getSetting('debug_level');
    cachedDebugLevel = setting !== null ? parseInt(setting, 10) : 0;
    lastCacheTime = now;
  }
  return cachedDebugLevel;
}

function formatTimestamp() {
  return new Date().toISOString();
}

function formatMessage(level, category, message, data) {
  const timestamp = formatTimestamp();
  const levelName = ['ERROR', 'WARN', 'INFO', 'VERBOSE', 'TRACE'][level] || 'LOG';
  let output = `[${timestamp}] [${levelName}] [${category}] ${message}`;

  if (data !== undefined) {
    if (typeof data === 'object') {
      try {
        output += '\n  ' + JSON.stringify(data, null, 2).replace(/\n/g, '\n  ');
      } catch (e) {
        output += '\n  [Circular or non-serializable data]';
      }
    } else {
      output += ` | ${data}`;
    }
  }

  return output;
}

class DebugLogger {
  constructor(category) {
    this.category = category;
  }

  /**
   * Critical errors - always logged
   */
  error(message, data) {
    console.error(formatMessage(0, this.category, message, data));
  }

  /**
   * Warnings - logged at level 1+
   */
  warn(message, data) {
    if (getDebugLevel() >= DEBUG_LEVELS.BASIC) {
      console.warn(formatMessage(1, this.category, message, data));
    }
  }

  /**
   * Info - key events, logged at level 1+
   */
  info(message, data) {
    if (getDebugLevel() >= DEBUG_LEVELS.BASIC) {
      console.log(formatMessage(2, this.category, message, data));
    }
  }

  /**
   * Verbose - API calls, sync operations, logged at level 2+
   */
  verbose(message, data) {
    if (getDebugLevel() >= DEBUG_LEVELS.VERBOSE) {
      console.log(formatMessage(3, this.category, message, data));
    }
  }

  /**
   * Trace - everything, logged at level 3
   */
  trace(message, data) {
    if (getDebugLevel() >= DEBUG_LEVELS.TRACE) {
      console.log(formatMessage(4, this.category, message, data));
    }
  }

  /**
   * Log API request (verbose level)
   */
  apiRequest(method, url, params) {
    if (getDebugLevel() >= DEBUG_LEVELS.VERBOSE) {
      console.log(formatMessage(3, this.category, `API ${method} ${url}`, params));
    }
  }

  /**
   * Log API response (verbose level)
   */
  apiResponse(method, url, status, data) {
    if (getDebugLevel() >= DEBUG_LEVELS.VERBOSE) {
      const summary = data ? (typeof data === 'object' ? `${Object.keys(data).length} keys` : typeof data) : 'empty';
      console.log(formatMessage(3, this.category, `API ${method} ${url} -> ${status}`, { summary }));
    }
    // Log full response at trace level
    if (getDebugLevel() >= DEBUG_LEVELS.TRACE) {
      console.log(formatMessage(4, this.category, `API Response Body:`, data));
    }
  }

  /**
   * Log function entry (trace level)
   */
  enter(functionName, args) {
    if (getDebugLevel() >= DEBUG_LEVELS.TRACE) {
      console.log(formatMessage(4, this.category, `→ ${functionName}()`, args));
    }
  }

  /**
   * Log function exit (trace level)
   */
  exit(functionName, result) {
    if (getDebugLevel() >= DEBUG_LEVELS.TRACE) {
      console.log(formatMessage(4, this.category, `← ${functionName}()`, result));
    }
  }

  /**
   * Log state change (verbose level)
   */
  state(description, before, after) {
    if (getDebugLevel() >= DEBUG_LEVELS.VERBOSE) {
      console.log(formatMessage(3, this.category, `State: ${description}`, { before, after }));
    }
  }

  /**
   * Log database query (trace level)
   */
  dbQuery(query, params) {
    if (getDebugLevel() >= DEBUG_LEVELS.TRACE) {
      console.log(formatMessage(4, this.category, `DB Query: ${query.substring(0, 100)}...`, params));
    }
  }

  /**
   * Dump object for inspection (trace level)
   */
  dump(label, obj) {
    if (getDebugLevel() >= DEBUG_LEVELS.TRACE) {
      console.log(formatMessage(4, this.category, `DUMP: ${label}`, obj));
    }
  }
}

/**
 * Create a logger for a specific category/module
 */
function createLogger(category) {
  return new DebugLogger(category);
}

/**
 * Get current debug level
 */
function getCurrentLevel() {
  return getDebugLevel();
}

/**
 * Get debug level name
 */
function getLevelName(level) {
  return LEVEL_NAMES[level] || 'UNKNOWN';
}

/**
 * Force refresh of cached debug level
 */
function refreshCache() {
  cachedDebugLevel = null;
  lastCacheTime = 0;
}

module.exports = {
  createLogger,
  getCurrentLevel,
  getLevelName,
  refreshCache,
  DEBUG_LEVELS,
  LEVEL_NAMES
};
