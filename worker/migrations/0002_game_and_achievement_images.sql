-- Run this only if you already created your D1 database from an older version of this starter.
ALTER TABLE user_games ADD COLUMN capsule_url TEXT;
ALTER TABLE user_games ADD COLUMN header_url TEXT;
ALTER TABLE user_games ADD COLUMN wide_capsule_url TEXT;
ALTER TABLE user_achievements ADD COLUMN icon_gray_url TEXT;
ALTER TABLE steam_apps ADD COLUMN header_url TEXT;
ALTER TABLE steam_apps ADD COLUMN wide_capsule_url TEXT;
ALTER TABLE app_achievement_schema ADD COLUMN icon_gray_url TEXT;
ALTER TABLE collection_games ADD COLUMN capsule_url TEXT;
ALTER TABLE collection_games ADD COLUMN header_url TEXT;
ALTER TABLE collection_games ADD COLUMN wide_capsule_url TEXT;
