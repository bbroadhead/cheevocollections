PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steam_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  profile_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  library_imported_at TEXT,
  library_sync_status TEXT NOT NULL DEFAULT 'never',
  achievement_sync_status TEXT NOT NULL DEFAULT 'never',
  achievement_sync_started_at TEXT,
  achievement_sync_finished_at TEXT
);

CREATE TABLE IF NOT EXISTS user_games (
  user_id INTEGER NOT NULL,
  app_id INTEGER NOT NULL,
  game_name TEXT NOT NULL,
  playtime_minutes INTEGER NOT NULL DEFAULT 0,
  img_icon_url TEXT,
  capsule_url TEXT,
  header_url TEXT,
  wide_capsule_url TEXT,
  has_community_visible_stats INTEGER NOT NULL DEFAULT 0,
  achievement_total INTEGER,
  achievement_unlocked INTEGER,
  achievement_percent INTEGER,
  achievement_last_synced_at TEXT,
  achievement_next_sync_after TEXT,
  achievement_sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_owned_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, app_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_games_user_percent ON user_games(user_id, achievement_percent);
CREATE INDEX IF NOT EXISTS idx_user_games_next_sync ON user_games(user_id, achievement_next_sync_after);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL,
  app_id INTEGER NOT NULL,
  achievement_api_name TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  icon_url TEXT,
  icon_gray_url TEXT,
  unlocked INTEGER NOT NULL DEFAULT 0,
  unlock_time INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, app_id, achievement_api_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS steam_apps (
  app_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  capsule_url TEXT,
  header_url TEXT,
  wide_capsule_url TEXT,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_achievement_schema (
  app_id INTEGER NOT NULL,
  achievement_api_name TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  icon_url TEXT,
  icon_gray_url TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (app_id, achievement_api_name)
);

CREATE TABLE IF NOT EXISTS profile_settings (
  user_id INTEGER PRIMARY KEY,
  display_name TEXT,
  headline TEXT DEFAULT 'Achievement hunter, backlog tamer, and completionist-in-progress.',
  layout_style TEXT DEFAULT 'hero',
  achievement_display_mode TEXT DEFAULT 'byGame',
  card_density TEXT DEFAULT 'comfortable',
  accent_color TEXT DEFAULT '#3b82f6',
  featured_game_ids TEXT DEFAULT '[]',
  featured_collection_ids TEXT DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  source_collection_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collections_visibility_name ON collections(visibility, name);
CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections(owner_user_id);

CREATE TABLE IF NOT EXISTS collection_games (
  collection_id INTEGER NOT NULL,
  app_id INTEGER NOT NULL,
  game_name TEXT NOT NULL,
  capsule_url TEXT,
  header_url TEXT,
  wide_capsule_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (collection_id, app_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS saved_collections (
  user_id INTEGER NOT NULL,
  collection_id INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, collection_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  cursor_app_id INTEGER,
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- Existing D1 users: create a separate migration file with the ALTER TABLE lines in README.md.
