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
    -- EPISODE STATS (Persistent episode analysis)
    -- =====================
    CREATE TABLE IF NOT EXISTS episode_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      show_rating_key TEXT NOT NULL,
      show_title TEXT,
      season_number INTEGER NOT NULL,
      episode_number INTEGER NOT NULL,
      episode_title TEXT,
      velocity_position INTEGER,

      -- Current analysis state
      is_available INTEGER DEFAULT 1,
      safe_to_delete INTEGER DEFAULT 0,
      deletion_reason TEXT,

      -- User tracking (JSON arrays)
      users_beyond TEXT,
      users_approaching TEXT,

      -- Deletion tracking
      deleted_at DATETIME,
      deleted_by_cleanup INTEGER DEFAULT 0,

      -- Timestamps
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      UNIQUE(show_rating_key, season_number, episode_number)
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
      name: 'VIPER Episode Cleanup',
      description: 'VIPER (Velocity-Informed Protection & Episode Removal) - Intelligently delete episodes based on multi-user watch progress. Keeps episodes ahead of active viewers and respects watch pace.',
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
  // =====================
  // MEDIA SERVERS TABLE (for Jellyfin support)
  // =====================
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      api_key TEXT,
      admin_user_id TEXT,
      admin_token TEXT,
      is_primary BOOLEAN DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      settings JSON DEFAULT '{}',
      last_connected DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_media_servers_type ON media_servers(type);
  `);

  // Check and add missing columns to users table for multi-server support
  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  const userColumnNames = userColumns.map(c => c.name);

  if (!userColumnNames.includes('media_server_type')) {
    console.log('[Database] Adding media_server_type column to users table');
    db.exec("ALTER TABLE users ADD COLUMN media_server_type TEXT DEFAULT 'plex'");
  }

  if (!userColumnNames.includes('media_server_id')) {
    console.log('[Database] Adding media_server_id column to users table');
    db.exec('ALTER TABLE users ADD COLUMN media_server_id INTEGER REFERENCES media_servers(id)');
  }

  if (!userColumnNames.includes('jellyfin_user_id')) {
    console.log('[Database] Adding jellyfin_user_id column to users table');
    db.exec('ALTER TABLE users ADD COLUMN jellyfin_user_id TEXT');
  }

  // Migrate existing plex_id values to ensure backwards compatibility
  // plex_id remains the user's identifier on the media server (works for both Plex and Jellyfin)

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

  // Check and add missing columns to watchlist table
  const watchlistColumns = db.prepare("PRAGMA table_info(watchlist)").all();
  const watchlistColumnNames = watchlistColumns.map(c => c.name);

  if (!watchlistColumnNames.includes('imdb_id')) {
    console.log('[Database] Adding imdb_id column to watchlist table');
    db.exec('ALTER TABLE watchlist ADD COLUMN imdb_id TEXT');
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

  // Add media_server_id to watch_history for multi-server support
  const watchHistoryColumns = db.prepare("PRAGMA table_info(watch_history)").all();
  const watchHistoryColumnNames = watchHistoryColumns.map(c => c.name);

  if (!watchHistoryColumnNames.includes('media_server_id')) {
    console.log('[Database] Adding media_server_id column to watch_history table');
    db.exec('ALTER TABLE watch_history ADD COLUMN media_server_id INTEGER REFERENCES media_servers(id)');
  }

  if (!watchHistoryColumnNames.includes('media_item_key')) {
    console.log('[Database] Adding media_item_key column to watch_history table');
    db.exec('ALTER TABLE watch_history ADD COLUMN media_item_key TEXT');
    // Migrate existing plex_rating_key to media_item_key
    db.exec('UPDATE watch_history SET media_item_key = plex_rating_key WHERE media_item_key IS NULL');
  }

  // Add media_server_id to lifecycle for multi-server support
  const lifecycleColumns = db.prepare("PRAGMA table_info(lifecycle)").all();
  const lifecycleColumnNames = lifecycleColumns.map(c => c.name);

  if (!lifecycleColumnNames.includes('media_server_id')) {
    console.log('[Database] Adding media_server_id column to lifecycle table');
    db.exec('ALTER TABLE lifecycle ADD COLUMN media_server_id INTEGER REFERENCES media_servers(id)');
  }

  if (!lifecycleColumnNames.includes('media_item_key')) {
    console.log('[Database] Adding media_item_key column to lifecycle table');
    db.exec('ALTER TABLE lifecycle ADD COLUMN media_item_key TEXT');
    // Migrate existing plex_rating_key to media_item_key
    db.exec('UPDATE lifecycle SET media_item_key = plex_rating_key WHERE media_item_key IS NULL');
  }

  // Add media_server_id to episode_stats for multi-server support
  const episodeStatsColumns = db.prepare("PRAGMA table_info(episode_stats)").all();
  const episodeStatsColumnNames = episodeStatsColumns.map(c => c.name);

  if (!episodeStatsColumnNames.includes('media_server_id')) {
    console.log('[Database] Adding media_server_id column to episode_stats table');
    db.exec('ALTER TABLE episode_stats ADD COLUMN media_server_id INTEGER REFERENCES media_servers(id)');
  }

  if (!episodeStatsColumnNames.includes('media_item_key')) {
    console.log('[Database] Adding media_item_key column to episode_stats table');
    db.exec('ALTER TABLE episode_stats ADD COLUMN media_item_key TEXT');
    // Migrate existing show_rating_key to media_item_key
    db.exec('UPDATE episode_stats SET media_item_key = show_rating_key WHERE media_item_key IS NULL');
  }

  // Add media_server_id to queue_items for multi-server support
  if (!queueColumnNames.includes('media_server_id')) {
    console.log('[Database] Adding media_server_id column to queue_items table');
    db.exec('ALTER TABLE queue_items ADD COLUMN media_server_id INTEGER REFERENCES media_servers(id)');
  }

  if (!queueColumnNames.includes('media_item_key')) {
    console.log('[Database] Adding media_item_key column to queue_items table');
    db.exec('ALTER TABLE queue_items ADD COLUMN media_item_key TEXT');
    // Migrate existing plex_rating_key to media_item_key
    db.exec('UPDATE queue_items SET media_item_key = plex_rating_key WHERE media_item_key IS NULL');
  }

  // Add media_server_id to exclusions for multi-server support
  if (!exclusionColumnNames.includes('media_server_id')) {
    console.log('[Database] Adding media_server_id column to exclusions table');
    db.exec('ALTER TABLE exclusions ADD COLUMN media_server_id INTEGER REFERENCES media_servers(id)');
  }

  if (!exclusionColumnNames.includes('media_item_key')) {
    console.log('[Database] Adding media_item_key column to exclusions table');
    db.exec('ALTER TABLE exclusions ADD COLUMN media_item_key TEXT');
    // Migrate existing plex_id to media_item_key
    db.exec('UPDATE exclusions SET media_item_key = plex_id WHERE media_item_key IS NULL');
  }

  // Add media_server_id to rules for multi-server support
  const rulesColumns = db.prepare("PRAGMA table_info(rules)").all();
  const rulesColumnNames = rulesColumns.map(c => c.name);

  if (!rulesColumnNames.includes('media_server_id')) {
    console.log('[Database] Adding media_server_id column to rules table');
    db.exec('ALTER TABLE rules ADD COLUMN media_server_id INTEGER REFERENCES media_servers(id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_rules_media_server ON rules(media_server_id)');
  }

  // Add media_server_id to requests for multi-server support
  const requestsColumns = db.prepare("PRAGMA table_info(requests)").all();
  const requestsColumnNames = requestsColumns.map(c => c.name);

  if (!requestsColumnNames.includes('media_server_id')) {
    console.log('[Database] Adding media_server_id column to requests table');
    db.exec('ALTER TABLE requests ADD COLUMN media_server_id INTEGER REFERENCES media_servers(id)');
  }

  // Add media_server_id to watchlist for multi-server support
  if (!watchlistColumnNames.includes('media_server_id')) {
    console.log('[Database] Adding media_server_id column to watchlist table');
    db.exec('ALTER TABLE watchlist ADD COLUMN media_server_id INTEGER REFERENCES media_servers(id)');
  }

  // Add media_server_id to repair_requests for multi-server support
  if (!repairColumnNames.includes('media_server_id')) {
    console.log('[Database] Adding media_server_id column to repair_requests table');
    db.exec('ALTER TABLE repair_requests ADD COLUMN media_server_id INTEGER REFERENCES media_servers(id)');
  }

  // Create composite indexes for multi-server uniqueness enforcement
  // These improve performance and help application-level enforcement
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_server_id ON users(plex_id, media_server_id);
    CREATE INDEX IF NOT EXISTS idx_requests_server ON requests(tmdb_id, media_type, media_server_id);
    CREATE INDEX IF NOT EXISTS idx_watchlist_server ON watchlist(user_id, tmdb_id, media_type, media_server_id);
    CREATE INDEX IF NOT EXISTS idx_lifecycle_server ON lifecycle(tmdb_id, media_type, media_server_id);
    CREATE INDEX IF NOT EXISTS idx_watch_history_server ON watch_history(media_server_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_episode_stats_server ON episode_stats(media_server_id, media_item_key);
  `);

  console.log('[Database] Multi-server indexes created successfully');

  // =====================================================
  // Migration: Create media_server entries for existing Plex installations
  // =====================================================
  const existingPlexServer = db.prepare("SELECT * FROM media_servers WHERE type = 'plex'").get();

  if (!existingPlexServer) {
    // Check if there's a Plex service in the legacy services table
    const plexService = db.prepare("SELECT * FROM services WHERE type = 'plex' AND is_active = 1").get();

    if (plexService) {
      console.log('[Database] Migrating legacy Plex service to media_servers table');

      // Create media_server entry for Plex
      const result = db.prepare(`
        INSERT INTO media_servers (type, name, url, api_key, is_primary, is_active, created_at)
        VALUES ('plex', 'Plex', ?, ?, 1, 1, CURRENT_TIMESTAMP)
      `).run(plexService.url, plexService.api_key);

      const plexServerId = result.lastInsertRowid;
      console.log(`[Database] Created media_server entry for Plex (ID: ${plexServerId})`);

      // Update all existing users without media_server_id to link to Plex server
      const updatedUsers = db.prepare(`
        UPDATE users
        SET media_server_type = 'plex', media_server_id = ?
        WHERE media_server_id IS NULL AND plex_id IS NOT NULL
      `).run(plexServerId);

      console.log(`[Database] Updated ${updatedUsers.changes} existing Plex users with media_server_id`);
    }
  }

  // =====================================================
  // Jellyfin Webhook Tracking Tables
  // =====================================================

  // Create jellyfin_watch_events table for tracking all playback events
  db.exec(`
    CREATE TABLE IF NOT EXISTS jellyfin_watch_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      user_name TEXT,
      series_id TEXT NOT NULL,
      series_name TEXT,
      season_number INTEGER,
      episode_number INTEGER,
      episode_id TEXT,
      episode_name TEXT,
      event_type TEXT NOT NULL, -- 'start', 'stop', 'complete', 'pause', 'unpause'
      position_ticks BIGINT,
      played_percentage REAL,
      watch_duration_seconds INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      session_id TEXT,
      device_name TEXT,
      media_server_id INTEGER REFERENCES media_servers(id)
    )
  `);

  // Create jellyfin_user_velocity table for calculated velocity data
  db.exec(`
    CREATE TABLE IF NOT EXISTS jellyfin_user_velocity (
      user_id TEXT NOT NULL,
      series_id TEXT NOT NULL,
      series_name TEXT,
      velocity REAL, -- Episodes per day
      current_season INTEGER,
      current_episode INTEGER,
      episodes_watched INTEGER,
      first_watch DATETIME,
      last_watch DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      media_server_id INTEGER REFERENCES media_servers(id),
      PRIMARY KEY (user_id, series_id, media_server_id)
    )
  `);

  // Create indexes for Jellyfin watch events
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_jellyfin_watch_velocity
      ON jellyfin_watch_events(user_id, series_id, timestamp);

    CREATE INDEX IF NOT EXISTS idx_jellyfin_watch_complete
      ON jellyfin_watch_events(user_id, series_id, event_type, timestamp)
      WHERE event_type = 'complete';

    CREATE INDEX IF NOT EXISTS idx_jellyfin_watch_series
      ON jellyfin_watch_events(series_id, event_type, timestamp);

    CREATE INDEX IF NOT EXISTS idx_jellyfin_velocity_lookup
      ON jellyfin_user_velocity(user_id, series_id);
  `);

  console.log('[Database] Jellyfin webhook tracking tables initialized');
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

const getUserByPlexId = (plexId, mediaServerId = null) => {
  // Support both legacy (no media_server_id) and new multi-server lookups
  if (mediaServerId) {
    return db.prepare('SELECT * FROM users WHERE plex_id = ? AND media_server_id = ?').get(plexId, mediaServerId);
  }
  // Legacy: try exact match first, then fall back to any user with this plex_id
  const withServerId = db.prepare('SELECT * FROM users WHERE plex_id = ? AND media_server_id IS NOT NULL').get(plexId);
  if (withServerId) return withServerId;
  // Backward compatibility: return user without media_server_id set
  return db.prepare('SELECT * FROM users WHERE plex_id = ?').get(plexId);
};

const createOrUpdateUser = (userData) => {
  // Get Plex media server ID if not provided
  let mediaServerId = userData.media_server_id;
  if (!mediaServerId) {
    const plexServer = db.prepare("SELECT id FROM media_servers WHERE type = 'plex' AND is_active = 1").get();
    mediaServerId = plexServer?.id || null;
  }

  const existing = getUserByPlexId(userData.plex_id, mediaServerId);

  if (existing) {
    db.prepare(`
      UPDATE users SET
        plex_token = ?,
        username = ?,
        email = ?,
        thumb = ?,
        is_owner = ?,
        media_server_type = ?,
        media_server_id = ?,
        last_login = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      userData.plex_token,
      userData.username,
      userData.email || existing.email,
      userData.thumb || existing.thumb,
      userData.is_owner ? 1 : existing.is_owner,
      'plex',
      mediaServerId,
      existing.id
    );
    return getUserById(existing.id);
  } else {
    const result = db.prepare(`
      INSERT INTO users (plex_id, plex_token, username, email, thumb, is_admin, is_owner, media_server_type, media_server_id, last_login)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      userData.plex_id,
      userData.plex_token,
      userData.username,
      userData.email || null,
      userData.thumb || null,
      userData.is_admin ? 1 : 0,
      userData.is_owner ? 1 : 0,
      'plex',
      mediaServerId
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

// Media server helper functions
const getMediaServers = () => {
  return db.prepare('SELECT * FROM media_servers WHERE is_active = 1 ORDER BY is_primary DESC').all();
};

const getPrimaryMediaServer = () => {
  return db.prepare('SELECT * FROM media_servers WHERE is_primary = 1 AND is_active = 1').get();
};

const getMediaServerById = (id) => {
  return db.prepare('SELECT * FROM media_servers WHERE id = ?').get(id);
};

const getMediaServerByType = (type) => {
  return db.prepare('SELECT * FROM media_servers WHERE type = ? AND is_active = 1').get(type);
};

const createMediaServer = (serverData) => {
  // If this is the first server or marked as primary, ensure it's the only primary
  if (serverData.is_primary) {
    db.prepare('UPDATE media_servers SET is_primary = 0').run();
  }

  const result = db.prepare(`
    INSERT INTO media_servers (type, name, url, api_key, admin_user_id, admin_token, is_primary, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    serverData.type,
    serverData.name,
    serverData.url,
    serverData.api_key || null,
    serverData.admin_user_id || null,
    serverData.admin_token || null,
    serverData.is_primary ? 1 : 0,
    JSON.stringify(serverData.settings || {})
  );

  return getMediaServerById(result.lastInsertRowid);
};

const updateMediaServer = (id, updates) => {
  const fields = [];
  const values = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.url !== undefined) {
    fields.push('url = ?');
    values.push(updates.url);
  }
  if (updates.api_key !== undefined) {
    fields.push('api_key = ?');
    values.push(updates.api_key);
  }
  if (updates.admin_user_id !== undefined) {
    fields.push('admin_user_id = ?');
    values.push(updates.admin_user_id);
  }
  if (updates.admin_token !== undefined) {
    fields.push('admin_token = ?');
    values.push(updates.admin_token);
  }
  if (updates.is_primary !== undefined) {
    if (updates.is_primary) {
      db.prepare('UPDATE media_servers SET is_primary = 0').run();
    }
    fields.push('is_primary = ?');
    values.push(updates.is_primary ? 1 : 0);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.is_active ? 1 : 0);
  }
  if (updates.settings !== undefined) {
    fields.push('settings = ?');
    values.push(JSON.stringify(updates.settings));
  }
  if (updates.last_connected !== undefined) {
    fields.push('last_connected = ?');
    values.push(updates.last_connected);
  }

  if (fields.length === 0) return getMediaServerById(id);

  values.push(id);
  db.prepare(`UPDATE media_servers SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return getMediaServerById(id);
};

const deleteMediaServer = (id) => {
  db.prepare('DELETE FROM media_servers WHERE id = ?').run(id);
};

// Generic user function that works with any media server type
const getUserByMediaServerId = (serverUserId, mediaServerIdOrType) => {
  // Support both media_server_id (number) and media_server_type (string) for flexibility
  if (typeof mediaServerIdOrType === 'number') {
    return db.prepare('SELECT * FROM users WHERE plex_id = ? AND media_server_id = ?').get(serverUserId, mediaServerIdOrType);
  } else {
    // Legacy: lookup by type
    const mediaServerType = mediaServerIdOrType || 'plex';
    return db.prepare('SELECT * FROM users WHERE plex_id = ? AND media_server_type = ?').get(serverUserId, mediaServerType);
  }
};

const createOrUpdateUserGeneric = (userData) => {
  const mediaServerType = userData.media_server_type || 'plex';

  // Determine media_server_id
  let mediaServerId = userData.media_server_id;
  if (!mediaServerId && mediaServerType) {
    const server = db.prepare("SELECT id FROM media_servers WHERE type = ? AND is_active = 1").get(mediaServerType);
    mediaServerId = server?.id || null;
  }

  // Look up existing user by media_server_id if available, otherwise by type
  const existing = mediaServerId
    ? getUserByMediaServerId(userData.server_user_id, mediaServerId)
    : getUserByMediaServerId(userData.server_user_id, mediaServerType);

  if (existing) {
    db.prepare(`
      UPDATE users SET
        plex_token = ?,
        username = ?,
        email = ?,
        thumb = ?,
        is_owner = ?,
        media_server_type = ?,
        media_server_id = ?,
        last_login = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      userData.server_token,
      userData.username,
      userData.email || existing.email,
      userData.thumb || existing.thumb,
      userData.is_owner ? 1 : existing.is_owner,
      mediaServerType,
      mediaServerId,
      existing.id
    );
    return getUserById(existing.id);
  } else {
    const result = db.prepare(`
      INSERT INTO users (plex_id, plex_token, username, email, thumb, is_admin, is_owner, media_server_type, media_server_id, last_login)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      userData.server_user_id,
      userData.server_token,
      userData.username,
      userData.email || null,
      userData.thumb || null,
      userData.is_admin ? 1 : 0,
      userData.is_owner ? 1 : 0,
      mediaServerType,
      mediaServerId
    );
    return getUserById(result.lastInsertRowid);
  }
};

// =====================================================
// Jellyfin Webhook Tracking Functions
// =====================================================

/**
 * Record a Jellyfin watch event from webhook
 */
const recordJellyfinWatchEvent = (eventData) => {
  return db.prepare(`
    INSERT INTO jellyfin_watch_events
    (user_id, user_name, series_id, series_name, season_number, episode_number,
     episode_id, episode_name, event_type, position_ticks, played_percentage,
     watch_duration_seconds, timestamp, session_id, device_name, media_server_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventData.user_id,
    eventData.user_name,
    eventData.series_id,
    eventData.series_name,
    eventData.season_number,
    eventData.episode_number,
    eventData.episode_id,
    eventData.episode_name,
    eventData.event_type,
    eventData.position_ticks || null,
    eventData.played_percentage || null,
    eventData.watch_duration_seconds || null,
    eventData.timestamp || new Date().toISOString(),
    eventData.session_id || null,
    eventData.device_name || null,
    eventData.media_server_id || null
  );
};

/**
 * Calculate velocity for a user/show based on completed watch events
 */
const calculateJellyfinVelocity = (userId, seriesId, mediaServerId = null) => {
  // Get configurable velocity window (default 30 days)
  const velocityWindowDays = parseInt(getSetting('jellyfin_velocity_window_days') || '30');

  // Get completed episodes in configured time window
  const query = mediaServerId
    ? `SELECT season_number, episode_number, timestamp
       FROM jellyfin_watch_events
       WHERE user_id = ? AND series_id = ? AND media_server_id = ?
         AND event_type = 'complete'
         AND timestamp > datetime('now', '-${velocityWindowDays} days')
       ORDER BY timestamp ASC`
    : `SELECT season_number, episode_number, timestamp
       FROM jellyfin_watch_events
       WHERE user_id = ? AND series_id = ?
         AND event_type = 'complete'
         AND timestamp > datetime('now', '-${velocityWindowDays} days')
       ORDER BY timestamp ASC`;

  const params = mediaServerId ? [userId, seriesId, mediaServerId] : [userId, seriesId];
  const completedEpisodes = db.prepare(query).all(...params);

  if (completedEpisodes.length < 2) {
    return null; // Not enough data
  }

  // Calculate time span and velocity
  const firstWatch = new Date(completedEpisodes[0].timestamp);
  const lastWatch = new Date(completedEpisodes[completedEpisodes.length - 1].timestamp);
  const daysDiff = (lastWatch - firstWatch) / (1000 * 60 * 60 * 24);

  let velocity;
  if (daysDiff === 0) {
    // Watched multiple episodes same day (binging)
    velocity = completedEpisodes.length;
  } else {
    velocity = completedEpisodes.length / daysDiff;
  }

  // Get series name from most recent event
  const seriesInfoQuery = mediaServerId
    ? `SELECT series_name FROM jellyfin_watch_events
       WHERE user_id = ? AND series_id = ? AND media_server_id = ?
       ORDER BY timestamp DESC LIMIT 1`
    : `SELECT series_name FROM jellyfin_watch_events
       WHERE user_id = ? AND series_id = ?
       ORDER BY timestamp DESC LIMIT 1`;

  const seriesInfoParams = mediaServerId ? [userId, seriesId, mediaServerId] : [userId, seriesId];
  const seriesInfo = db.prepare(seriesInfoQuery).get(...seriesInfoParams);

  // Get current position (latest completed episode)
  const latest = completedEpisodes[completedEpisodes.length - 1];

  // Store velocity
  db.prepare(`
    INSERT OR REPLACE INTO jellyfin_user_velocity
    (user_id, series_id, series_name, velocity, current_season, current_episode,
     episodes_watched, first_watch, last_watch, media_server_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    userId,
    seriesId,
    seriesInfo?.series_name || 'Unknown',
    velocity,
    latest.season_number,
    latest.episode_number,
    completedEpisodes.length,
    firstWatch.toISOString(),
    lastWatch.toISOString(),
    mediaServerId
  );

  return {
    velocity,
    episodesWatched: completedEpisodes.length,
    currentSeason: latest.season_number,
    currentEpisode: latest.episode_number,
    firstWatch,
    lastWatch
  };
};

/**
 * Get velocity data for a user/show
 */
const getJellyfinVelocity = (userId, seriesId, mediaServerId = null) => {
  const query = mediaServerId
    ? `SELECT * FROM jellyfin_user_velocity
       WHERE user_id = ? AND series_id = ? AND media_server_id = ?`
    : `SELECT * FROM jellyfin_user_velocity
       WHERE user_id = ? AND series_id = ?`;

  const params = mediaServerId ? [userId, seriesId, mediaServerId] : [userId, seriesId];
  return db.prepare(query).get(...params);
};

/**
 * Get all velocity data for a user (across all shows)
 */
const getJellyfinUserVelocities = (userId, mediaServerId = null) => {
  const query = mediaServerId
    ? `SELECT * FROM jellyfin_user_velocity
       WHERE user_id = ? AND media_server_id = ?
       ORDER BY last_watch DESC`
    : `SELECT * FROM jellyfin_user_velocity
       WHERE user_id = ?
       ORDER BY last_watch DESC`;

  const params = mediaServerId ? [userId, mediaServerId] : [userId];
  return db.prepare(query).all(...params);
};

/**
 * Get all shows with active viewers (recent watch activity)
 */
const getJellyfinActiveShows = (daysActive = 30, mediaServerId = null) => {
  const query = mediaServerId
    ? `SELECT DISTINCT series_id, series_name, MAX(timestamp) as last_activity
       FROM jellyfin_watch_events
       WHERE timestamp > datetime('now', '-' || ? || ' days')
         AND media_server_id = ?
       GROUP BY series_id, series_name
       ORDER BY last_activity DESC`
    : `SELECT DISTINCT series_id, series_name, MAX(timestamp) as last_activity
       FROM jellyfin_watch_events
       WHERE timestamp > datetime('now', '-' || ? || ' days')
       GROUP BY series_id, series_name
       ORDER BY last_activity DESC`;

  const params = mediaServerId ? [daysActive, mediaServerId] : [daysActive];
  return db.prepare(query).all(...params);
};

/**
 * Get watch history for a show (all events)
 */
const getJellyfinShowHistory = (seriesId, mediaServerId = null, limit = 100) => {
  const query = mediaServerId
    ? `SELECT * FROM jellyfin_watch_events
       WHERE series_id = ? AND media_server_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`
    : `SELECT * FROM jellyfin_watch_events
       WHERE series_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`;

  const params = mediaServerId ? [seriesId, mediaServerId, limit] : [seriesId, limit];
  return db.prepare(query).all(...params);
};

/**
 * Get most recent start event for calculating watch duration
 * Used to match stop events with their corresponding start events
 */
const getJellyfinRecentStartEvent = (userId, episodeId, sessionId = null, mediaServerId = null) => {
  // Look for start events within the last hour (to avoid matching very old sessions)
  let query = `SELECT * FROM jellyfin_watch_events
               WHERE user_id = ? AND episode_id = ? AND event_type = 'start'
                 AND timestamp > datetime('now', '-1 hour')`;

  const params = [userId, episodeId];

  if (sessionId) {
    query += ` AND session_id = ?`;
    params.push(sessionId);
  }

  if (mediaServerId) {
    query += ` AND media_server_id = ?`;
    params.push(mediaServerId);
  }

  query += ` ORDER BY timestamp DESC LIMIT 1`;

  return db.prepare(query).get(...params);
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
  // User functions
  getUserById,
  getUserByPlexId,
  createOrUpdateUser,
  getUserByMediaServerId,
  createOrUpdateUserGeneric,
  // Session functions
  createSession,
  getSessionByTokenHash,
  deleteSession,
  cleanExpiredSessions,
  // Media server functions
  getMediaServers,
  getPrimaryMediaServer,
  getMediaServerById,
  getMediaServerByType,
  createMediaServer,
  updateMediaServer,
  deleteMediaServer,
  // Jellyfin webhook tracking functions
  recordJellyfinWatchEvent,
  calculateJellyfinVelocity,
  getJellyfinVelocity,
  getJellyfinUserVelocities,
  getJellyfinActiveShows,
  getJellyfinShowHistory,
  getJellyfinRecentStartEvent
};
