const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_PATH)) {
  fs.mkdirSync(DATA_PATH, { recursive: true });
}

const db = new Database(path.join(DATA_PATH, 'flexerr.sqlite'));

// Enable foreign keys and WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
const initSchema = () => {
  db.exec(`
    -- =====================
    -- SETTINGS
    -- =====================
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Service connections (Plex, Sonarr, Radarr)
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      api_key TEXT,
      is_default BOOLEAN DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      settings JSON,
      last_connected DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =====================
    -- USERS (Multi-user Plex OAuth)
    -- =====================
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plex_id TEXT UNIQUE NOT NULL,
      plex_token TEXT,
      username TEXT NOT NULL,
      email TEXT,
      thumb TEXT,
      is_admin BOOLEAN DEFAULT 0,
      is_owner BOOLEAN DEFAULT 0,
      permissions JSON DEFAULT '{}',
      settings JSON DEFAULT '{}',
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Sessions (JWT Refresh Tokens)
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- =====================
    -- MEDIA REQUESTS
    -- =====================
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tmdb_id INTEGER NOT NULL,
      tvdb_id INTEGER,
      imdb_id TEXT,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      poster_path TEXT,
      backdrop_path TEXT,
      overview TEXT,
      status TEXT DEFAULT 'pending',
      seasons JSON,
      sonarr_id INTEGER,
      radarr_id INTEGER,
      root_folder TEXT,
      quality_profile_id INTEGER,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      available_at DATETIME,
      deleted_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(tmdb_id, media_type)
    );

    -- =====================
    -- WATCHLIST (Per-User with removal tracking)
    -- =====================
    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      poster_path TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      removed_at DATETIME,
      is_active BOOLEAN DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, tmdb_id, media_type)
    );

    -- =====================
    -- WATCH HISTORY (For velocity tracking)
    -- =====================
    CREATE TABLE IF NOT EXISTS watch_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plex_rating_key TEXT NOT NULL,
      tmdb_id INTEGER,
      media_type TEXT NOT NULL,
      title TEXT,
      season_number INTEGER,
      episode_number INTEGER,
      watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- =====================
    -- USER VELOCITY (Watch speed per show)
    -- =====================
    CREATE TABLE IF NOT EXISTS user_velocity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tmdb_id INTEGER NOT NULL,
      current_position INTEGER DEFAULT 0,
      current_season INTEGER DEFAULT 1,
      current_episode INTEGER DEFAULT 0,
      episodes_per_day REAL DEFAULT 0,
      last_watched_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, tmdb_id)
    );

    -- =====================
    -- LIFECYCLE TRACKING
    -- =====================
    CREATE TABLE IF NOT EXISTS lifecycle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      plex_rating_key TEXT,
      sonarr_id INTEGER,
      radarr_id INTEGER,
      status TEXT DEFAULT 'available',
      episode_status JSON,
      deletion_scheduled_at DATETIME,
      deleted_at DATETIME,
      added_to_exclusion BOOLEAN DEFAULT 0,
      UNIQUE(tmdb_id, media_type)
    );

    -- =====================
    -- CLEANUP RULES
    -- =====================
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      target_type TEXT NOT NULL,
      target_library_ids JSON,
      conditions JSON NOT NULL,
      actions JSON NOT NULL,
      buffer_days INTEGER DEFAULT 15,
      schedule TEXT,
      priority INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      notify_webhook_ids JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_run DATETIME,
      last_run_matches INTEGER DEFAULT 0,
      -- Smart Mode options (for episodes/shows)
      smart_enabled BOOLEAN DEFAULT 0,
      smart_min_days_since_watch INTEGER DEFAULT 15,
      smart_velocity_buffer_days INTEGER DEFAULT 7,
      smart_protect_episodes_ahead INTEGER DEFAULT 3,
      smart_active_viewer_days INTEGER DEFAULT 30,
      smart_require_all_users_watched BOOLEAN DEFAULT 1,
      smart_proactive_redownload BOOLEAN DEFAULT 1,
      smart_redownload_lead_days INTEGER DEFAULT 3
    );

    -- Rule templates
    CREATE TABLE IF NOT EXISTS rule_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      rule_config JSON NOT NULL,
      author TEXT,
      is_builtin BOOLEAN DEFAULT 0,
      downloads INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =====================
    -- LEAVING SOON QUEUE
    -- =====================
    CREATE TABLE IF NOT EXISTS queue_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER,
      tmdb_id INTEGER,
      plex_id TEXT,
      plex_rating_key TEXT,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      poster_url TEXT,
      metadata JSON,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      action_at DATETIME NOT NULL,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      is_dry_run BOOLEAN DEFAULT 0,
      FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE SET NULL
    );

    -- =====================
    -- ACTIVITY LOGS
    -- =====================
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT DEFAULT 'info',
      category TEXT,
      user_id INTEGER,
      rule_id INTEGER,
      action TEXT NOT NULL,
      media_type TEXT,
      tmdb_id INTEGER,
      media_title TEXT,
      details JSON,
      size_bytes INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE SET NULL
    );

    -- =====================
    -- NOTIFICATIONS
    -- =====================
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT,
      settings JSON,
      is_active BOOLEAN DEFAULT 1,
      on_request BOOLEAN DEFAULT 1,
      on_available BOOLEAN DEFAULT 1,
      on_leaving_soon BOOLEAN DEFAULT 1,
      on_delete BOOLEAN DEFAULT 1,
      on_restore BOOLEAN DEFAULT 1,
      on_error BOOLEAN DEFAULT 1,
      min_severity TEXT DEFAULT 'info',
      user_ids JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =====================
    -- STATISTICS
    -- =====================
    CREATE TABLE IF NOT EXISTS stats_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      requests_count INTEGER DEFAULT 0,
      available_count INTEGER DEFAULT 0,
      deletions_count INTEGER DEFAULT 0,
      restorations_count INTEGER DEFAULT 0,
      storage_saved_bytes INTEGER DEFAULT 0,
      active_users INTEGER DEFAULT 0,
      rules_run INTEGER DEFAULT 0,
      queue_size INTEGER DEFAULT 0,
      UNIQUE(date)
    );

    -- =====================
    -- EXCLUSIONS (Items protected from cleanup)
    -- =====================
    CREATE TABLE IF NOT EXISTS exclusions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      plex_id TEXT,
      plex_user_id TEXT,
      tmdb_id INTEGER,
      media_type TEXT,
      title TEXT,
      value TEXT,
      reason TEXT,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =====================
    -- REPAIR REQUESTS (Quality upgrades, DV fixes)
    -- =====================
    CREATE TABLE IF NOT EXISTS repair_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tmdb_id INTEGER NOT NULL,
      tvdb_id INTEGER,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      poster_path TEXT,
      radarr_id INTEGER,
      sonarr_id INTEGER,
      request_type TEXT NOT NULL,
      reason TEXT,
      current_quality TEXT,
      requested_quality TEXT,
      current_file_path TEXT,
      file_size_bytes INTEGER,
      dv_profile TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      processed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_repair_requests_user ON repair_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_repair_requests_status ON repair_requests(status);
    CREATE INDEX IF NOT EXISTS idx_repair_requests_tmdb ON repair_requests(tmdb_id, media_type);

    -- =====================
    -- RESTORATIONS (Track re-watchlist restorations)
    -- =====================
    CREATE TABLE IF NOT EXISTS restorations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      original_deletion_at DATETIME,
      restored_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      removed_from_exclusion BOOLEAN DEFAULT 0,
      re_added_to_sonarr BOOLEAN DEFAULT 0,
      re_added_to_radarr BOOLEAN DEFAULT 0,
      search_triggered BOOLEAN DEFAULT 0,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_restorations_user ON restorations(user_id);
    CREATE INDEX IF NOT EXISTS idx_restorations_tmdb ON restorations(tmdb_id, media_type);
    CREATE INDEX IF NOT EXISTS idx_restorations_status ON restorations(status);

    -- =====================
    -- INDEXES
    -- =====================
    CREATE INDEX IF NOT EXISTS idx_users_plex_id ON users(plex_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_requests_tmdb ON requests(tmdb_id, media_type);
    CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
    CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
    CREATE INDEX IF NOT EXISTS idx_watchlist_tmdb ON watchlist(tmdb_id, media_type);
    CREATE INDEX IF NOT EXISTS idx_watch_history_user ON watch_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_watch_history_tmdb ON watch_history(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_velocity_user ON user_velocity(user_id);
    CREATE INDEX IF NOT EXISTS idx_lifecycle_tmdb ON lifecycle(tmdb_id, media_type);
    CREATE INDEX IF NOT EXISTS idx_lifecycle_status ON lifecycle(status);
    CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_items(status);
    CREATE INDEX IF NOT EXISTS idx_queue_action_at ON queue_items(action_at);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_exclusions_type ON exclusions(type);
    CREATE INDEX IF NOT EXISTS idx_exclusions_plex_id ON exclusions(plex_id);
  `);

  // Insert default settings if not exist
  const defaultSettings = [
    ['setup_complete', 'false'],
    ['tmdb_api_key', ''],
    ['plex_client_id', 'flexerr-media-manager'],

    // Lifecycle settings
    ['buffer_days', '15'],
    ['collection_name', 'Leaving Soon'],
    ['collection_description', 'Content scheduled for removal. Add to your watchlist to keep!'],
    ['dry_run', 'true'],
    ['delete_files', 'false'],
    ['timezone', 'UTC'],
    ['schedule', '0 2 * * *'],
    ['max_deletions_per_run', '50'],
    ['log_retention_days', '30'],

    // Smart cleanup settings
    ['smart_cleanup_enabled', 'true'],
    ['smart_min_days_since_watch', '15'],
    ['smart_velocity_buffer_days', '7'],
    ['smart_protect_episodes_ahead', '3'],
    ['smart_active_viewer_days', '30'],
    ['smart_require_all_users_watched', 'true'],
    ['smart_proactive_redownload', 'true'],
    ['smart_redownload_lead_days', '3'],
    // Far-ahead episode trimming (delete unwatched episodes too far ahead of viewers)
    ['smart_trim_ahead_enabled', 'true'],
    ['smart_max_episodes_ahead', '10'],
    // Watchlist grace period (days to wait before trimming newly watchlisted shows)
    ['smart_watchlist_grace_days', '14'],

    // Velocity-based cleanup settings
    ['velocity_cleanup_enabled', 'true'],
    ['velocity_cleanup_schedule', '0 3 * * *'],

    // Watchlist restoration settings
    ['watchlist_restoration_enabled', 'true'],
    ['watchlist_check_interval', '1'],

    // Sync settings
    ['plex_sync_enabled', 'true'],
    ['plex_sync_interval', '60'],
    ['watch_history_sync_interval', '60'],
    ['velocity_calculation_interval', '60'],

    // User sync settings (from Plex server)
    ['auto_import_plex_users', 'true'],
    ['server_owner_is_admin', 'true'],

    // Plex sync state (persisted across restarts)
    ['plex_sync_last_library', ''],
    ['plex_sync_last_history', ''],
    ['plex_sync_last_users', ''],
    ['plex_sync_library_cache', '{}'],

    // Media repair settings
    ['repair_auto_dv_fix', 'true'],
    ['repair_dv_scan_enabled', 'true'],
    ['repair_dv_scan_schedule', '0 4 * * *'],
    ['repair_ffmpeg_path', 'ffmpeg'],
    ['repair_dovi_tool_path', 'dovi_tool'],
    ['repair_temp_path', '/tmp/flexerr-repair']
  ];

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of defaultSettings) {
    insertSetting.run(key, value);
  }

  // Insert built-in rule templates
  const builtinTemplates = [
    {
      name: 'Smart Episode Cleanup',
      description: 'Intelligently delete episodes based on multi-user watch progress. Keeps episodes ahead of active viewers and respects watch pace.',
      category: 'smart',
      rule_config: JSON.stringify({
        target_type: 'episodes',
        smart_enabled: true,
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'on_watchlist', operator: 'equals', value: false }
          ]
        },
        actions: [
          { type: 'add_to_collection' },
          { type: 'delete_from_plex' },
          { type: 'delete_from_sonarr' }
        ],
        buffer_days: 0,
        smart_options: {
          smart_min_days_since_watch: 15,
          smart_velocity_buffer_days: 7,
          smart_protect_episodes_ahead: 3,
          smart_active_viewer_days: 30,
          smart_require_all_users_watched: true,
          smart_proactive_redownload: true,
          smart_redownload_lead_days: 3
        }
      }),
      author: 'Flexerr',
      is_builtin: 1
    },
    {
      name: 'Watched Episode Cleanup (Simple)',
      description: 'Delete watched episodes after a configurable number of days. Protects episodes on watchlists.',
      category: 'cleanup',
      rule_config: JSON.stringify({
        target_type: 'episodes',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'watched', operator: 'equals', value: true },
            { field: 'on_watchlist', operator: 'equals', value: false },
            { field: 'days_since_watched', operator: 'greater_than', value: 7 }
          ]
        },
        actions: [
          { type: 'add_to_collection' },
          { type: 'delete_from_plex' },
          { type: 'delete_from_sonarr' }
        ],
        buffer_days: 15
      }),
      author: 'Flexerr',
      is_builtin: 1
    },
    {
      name: 'Inactive TV Shows',
      description: 'Remove shows with no activity in 60+ days that are not on any watchlist',
      category: 'cleanup',
      rule_config: JSON.stringify({
        target_type: 'shows',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'on_watchlist', operator: 'equals', value: false },
            { field: 'days_since_activity', operator: 'greater_than', value: 60 }
          ]
        },
        actions: [
          { type: 'add_to_collection' },
          { type: 'delete_from_plex' },
          { type: 'delete_from_sonarr' }
        ],
        buffer_days: 15
      }),
      author: 'Flexerr',
      is_builtin: 1
    },
    {
      name: 'Watched Movies Cleanup',
      description: 'Remove movies watched 30+ days ago that are not on any watchlist',
      category: 'cleanup',
      rule_config: JSON.stringify({
        target_type: 'movies',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'watched', operator: 'equals', value: true },
            { field: 'on_watchlist', operator: 'equals', value: false },
            { field: 'days_since_watched', operator: 'greater_than', value: 30 }
          ]
        },
        actions: [
          { type: 'add_to_collection' },
          { type: 'delete_from_plex' },
          { type: 'delete_from_radarr' }
        ],
        buffer_days: 15
      }),
      author: 'Flexerr',
      is_builtin: 1
    },
    {
      name: 'Storage Saver (Movies)',
      description: 'Aggressive cleanup for movies - short buffers for watched content',
      category: 'storage',
      rule_config: JSON.stringify({
        target_type: 'movies',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'watched', operator: 'equals', value: true },
            { field: 'on_watchlist', operator: 'equals', value: false },
            { field: 'days_since_watched', operator: 'greater_than', value: 7 }
          ]
        },
        actions: [
          { type: 'add_to_collection' },
          { type: 'delete_from_plex' },
          { type: 'delete_from_radarr' },
          { type: 'delete_files' }
        ],
        buffer_days: 3
      }),
      author: 'Flexerr',
      is_builtin: 1
    },
    {
      name: 'Storage Saver (TV Shows)',
      description: 'Aggressive cleanup for TV shows - removes shows with no recent activity',
      category: 'storage',
      rule_config: JSON.stringify({
        target_type: 'shows',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'on_watchlist', operator: 'equals', value: false },
            { field: 'days_since_activity', operator: 'greater_than', value: 14 }
          ]
        },
        actions: [
          { type: 'add_to_collection' },
          { type: 'delete_from_plex' },
          { type: 'delete_from_sonarr' },
          { type: 'delete_files' }
        ],
        buffer_days: 3
      }),
      author: 'Flexerr',
      is_builtin: 1
    },
    {
      name: 'Low-Rated Movies',
      description: 'Remove watched movies with low ratings (below 5/10)',
      category: 'cleanup',
      rule_config: JSON.stringify({
        target_type: 'movies',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'watched', operator: 'equals', value: true },
            { field: 'on_watchlist', operator: 'equals', value: false },
            { field: 'rating', operator: 'less_than', value: 5 }
          ]
        },
        actions: [
          { type: 'add_to_collection' },
          { type: 'delete_from_plex' },
          { type: 'delete_from_radarr' }
        ],
        buffer_days: 7
      }),
      author: 'Flexerr',
      is_builtin: 1
    },
    {
      name: 'Old Unwatched Movies',
      description: 'Remove movies added more than 90 days ago that have never been watched',
      category: 'cleanup',
      rule_config: JSON.stringify({
        target_type: 'movies',
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'watched', operator: 'equals', value: false },
            { field: 'on_watchlist', operator: 'equals', value: false },
            { field: 'days_since_added', operator: 'greater_than', value: 90 }
          ]
        },
        actions: [
          { type: 'add_to_collection' },
          { type: 'delete_from_plex' },
          { type: 'delete_from_radarr' }
        ],
        buffer_days: 15
      }),
      author: 'Flexerr',
      is_builtin: 1
    }
  ];

  // Delete old builtin templates and re-insert
  db.prepare('DELETE FROM rule_templates WHERE is_builtin = 1').run();

  const insertTemplate = db.prepare(`
    INSERT INTO rule_templates (name, description, category, rule_config, author, is_builtin)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const template of builtinTemplates) {
    insertTemplate.run(
      template.name,
      template.description,
      template.category,
      template.rule_config,
      template.author,
      template.is_builtin
    );
  }

  // Run migrations for existing databases
  runMigrations();

  console.log('[Database] Flexerr schema initialized successfully');
};

// Migration function to add missing columns to existing databases
const runMigrations = () => {
  // Check and add missing columns to exclusions table
  const exclusionColumns = db.prepare("PRAGMA table_info(exclusions)").all();
  const exclusionColumnNames = exclusionColumns.map(c => c.name);

  if (!exclusionColumnNames.includes('tmdb_id')) {
    console.log('[Database] Adding tmdb_id column to exclusions table');
    db.exec('ALTER TABLE exclusions ADD COLUMN tmdb_id INTEGER');
  }

  if (!exclusionColumnNames.includes('media_type')) {
    console.log('[Database] Adding media_type column to exclusions table');
    db.exec('ALTER TABLE exclusions ADD COLUMN media_type TEXT');
  }

  if (!exclusionColumnNames.includes('title')) {
    console.log('[Database] Adding title column to exclusions table');
    db.exec('ALTER TABLE exclusions ADD COLUMN title TEXT');
  }

  // Check and add missing columns to queue_items table
  const queueColumns = db.prepare("PRAGMA table_info(queue_items)").all();
  const queueColumnNames = queueColumns.map(c => c.name);

  if (!queueColumnNames.includes('tmdb_id')) {
    console.log('[Database] Adding tmdb_id column to queue_items table');
    db.exec('ALTER TABLE queue_items ADD COLUMN tmdb_id INTEGER');
  }

  if (!queueColumnNames.includes('media_type')) {
    console.log('[Database] Adding media_type column to queue_items table');
    db.exec('ALTER TABLE queue_items ADD COLUMN media_type TEXT');
  }

  if (!queueColumnNames.includes('title')) {
    console.log('[Database] Adding title column to queue_items table');
    db.exec('ALTER TABLE queue_items ADD COLUMN title TEXT');
  }

  if (!queueColumnNames.includes('plex_id')) {
    console.log('[Database] Adding plex_id column to queue_items table');
    db.exec('ALTER TABLE queue_items ADD COLUMN plex_id TEXT');
  }

  // Check and add missing columns to stats_daily table
  const statsColumns = db.prepare("PRAGMA table_info(stats_daily)").all();
  const statsColumnNames = statsColumns.map(c => c.name);

  if (!statsColumnNames.includes('rules_run')) {
    console.log('[Database] Adding rules_run column to stats_daily table');
    db.exec('ALTER TABLE stats_daily ADD COLUMN rules_run INTEGER DEFAULT 0');
  }

  if (!statsColumnNames.includes('queue_size')) {
    console.log('[Database] Adding queue_size column to stats_daily table');
    db.exec('ALTER TABLE stats_daily ADD COLUMN queue_size INTEGER DEFAULT 0');
  }

  // Check and add missing columns to repair_requests table
  const repairColumns = db.prepare("PRAGMA table_info(repair_requests)").all();
  const repairColumnNames = repairColumns.map(c => c.name);

  if (!repairColumnNames.includes('tvdb_id')) {
    console.log('[Database] Adding tvdb_id column to repair_requests table');
    db.exec('ALTER TABLE repair_requests ADD COLUMN tvdb_id INTEGER');
  }
};

// Helper functions
const getSetting = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
};

const setSetting = (key, value) => {
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(key, value);
};

const getAllSettings = () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
};

const log = (level, category, action, details = {}) => {
  db.prepare(`
    INSERT INTO logs (level, category, user_id, rule_id, action, media_type, tmdb_id, media_title, details, size_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    level,
    category,
    details.user_id || null,
    details.rule_id || null,
    action,
    details.media_type || null,
    details.tmdb_id || null,
    details.media_title || null,
    JSON.stringify(details),
    details.size_bytes || null
  );
};

// User helper functions
const getUserById = (id) => {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
};

const getUserByPlexId = (plexId) => {
  return db.prepare('SELECT * FROM users WHERE plex_id = ?').get(plexId);
};

const createOrUpdateUser = (userData) => {
  const existing = getUserByPlexId(userData.plex_id);

  if (existing) {
    db.prepare(`
      UPDATE users SET
        plex_token = ?,
        username = ?,
        email = ?,
        thumb = ?,
        is_owner = ?,
        last_login = CURRENT_TIMESTAMP
      WHERE plex_id = ?
    `).run(
      userData.plex_token,
      userData.username,
      userData.email || existing.email,
      userData.thumb || existing.thumb,
      userData.is_owner ? 1 : existing.is_owner,
      userData.plex_id
    );
    return getUserByPlexId(userData.plex_id);
  } else {
    const result = db.prepare(`
      INSERT INTO users (plex_id, plex_token, username, email, thumb, is_admin, is_owner, last_login)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      userData.plex_id,
      userData.plex_token,
      userData.username,
      userData.email || null,
      userData.thumb || null,
      userData.is_admin ? 1 : 0,
      userData.is_owner ? 1 : 0
    );
    return getUserById(result.lastInsertRowid);
  }
};

// Session helper functions
const createSession = (userId, tokenHash, expiresAt) => {
  const result = db.prepare(`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).run(userId, tokenHash, expiresAt);
  return result.lastInsertRowid;
};

const getSessionByTokenHash = (tokenHash) => {
  return db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
};

const deleteSession = (id) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
};

const cleanExpiredSessions = () => {
  db.prepare('DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP').run();
};

// Initialize on load
initSchema();

module.exports = {
  db,
  getSetting,
  setSetting,
  getAllSettings,
  log,
  initSchema,
  getUserById,
  getUserByPlexId,
  createOrUpdateUser,
  createSession,
  getSessionByTokenHash,
  deleteSession,
  cleanExpiredSessions
};
