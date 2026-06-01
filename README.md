# Steam Achievement Collections — Serverless Starter

A GitHub/Cloudflare-hostable Steam achievement tracker centered on achievement-hunting collections.

## Features

- Steam OpenID login through a Cloudflare Worker
- D1 database persistence for users, profile settings, library, achievements, public collections, saved collections, and app achievement schema cache
- One-time library import
- Manual delta library refresh that only adds missing games after one owned-games check
- Achievement syncing in small API-friendly batches
- Public user-created collections of Steam games
- Collections can include any Steam game, even games the creator does not own
- Steam-wide game search for collection building
- Shared cached achievement schema preview for collection games
- Browse/search public collections and add them to a user profile
- Customizable profile page that can show games, whole-library achievement progress, or saved achievement collections

## Recommended hosting

- Frontend: GitHub Pages or Cloudflare Pages
- Backend: Cloudflare Worker
- Database: Cloudflare D1

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a D1 database:

```bash
npx wrangler d1 create steam_achievements
```

3. Copy the returned `database_id` into `wrangler.toml`.

4. Create the database tables:

```bash
npm run db:init
```

5. Add Worker secrets:

```bash
npx wrangler secret put STEAM_API_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CLIENT_URL
```

`CLIENT_URL` should be your frontend URL, such as `https://yourname.github.io/steam-achievement-collections`.

6. Deploy the Worker:

```bash
npm run worker:deploy
```

7. Set frontend environment variable:

```bash
VITE_API_URL=https://your-worker.your-subdomain.workers.dev
```

8. Build and deploy the frontend:

```bash
npm run build
```

## Collection design

Collections are not limited to owned games. A creator can search Steam's public store catalog and add any app to a collection, such as every Final Fantasy game on Steam.

The collection tables are:

- `collections`: owner, name, description, visibility
- `collection_games`: games in a collection, including app id and display name
- `saved_collections`: collections a user added to their profile
- `steam_apps`: lightweight app cache from Steam search
- `app_achievement_schema`: shared cached achievement definitions for games

This means users can browse community-created collections and add those collections to their profile without duplicating every game row into their personal library.

## Sync design

### Library import

The first import calls Steam's owned-games endpoint once and saves the game list in D1. The main library page reads from D1 afterward.

### Manual library update

The settings page has **Manually update game library**. It calls the owned-games endpoint once, compares the result to the saved D1 library, adds only games missing from the website, and updates playtime for existing games. It does not fetch achievements for every game.

### Achievement sync

Achievement syncing is intentionally separate:

- The library page never fetches achievements directly from Steam.
- The user clicks **Sync next achievement batch**.
- The Worker syncs a small number of due games, default 8.
- Unsynced games are prioritized first.
- Completed games get a longer cooldown.
- Games with no public achievement data get a longer cooldown.
- Failed games get a backoff cooldown.

### Collection achievement previews

When previewing achievements for a game inside a collection, the app uses Steam's game schema endpoint and caches the result in `app_achievement_schema`. This is cheaper than fetching user-specific achievement progress and can be shared across all users.

## Important notes

- Steam login identifies the user by SteamID. You never store Steam passwords.
- Your Steam API key stays in Cloudflare Worker secrets, not in the browser.
- Some Steam profiles or games may not expose achievement data publicly.
- This starter uses simple signed bearer tokens. For production, consider shorter token lifetimes, refresh tokens, CSRF protections, stricter rate limiting, and stronger session management.

## Modern dark theme and accent color

This version includes a modern dark UI with glass-style panels, animated hover states, animated progress bars, profile cards, and a user-selectable site highlight color.

The accent color is stored in `profile_settings.accent_color` and is applied through the CSS variable `--accent`. Users can choose from preset swatches or use a custom color picker under **Settings**.

If you already created the D1 database from an older version, add the new column manually:

```sql
ALTER TABLE profile_settings ADD COLUMN accent_color TEXT DEFAULT '#3b82f6';
```

Then redeploy the Worker and frontend.

## Game and achievement imagery

This version stores and displays Steam artwork everywhere games appear:

- `wide_capsule_url` for large modern cards
- `header_url` as a fallback hero image
- `capsule_url` for compact rows/search results
- achievement `icon_url` and `icon_gray_url`
- achievement display name and description from Steam schema caching

Owned-library achievement syncing now merges the player's unlocked/locked state with cached Steam achievement schema data so the UI can show the achievement image, name, and description without repeatedly fetching schema data.

If you already deployed an older D1 database, run `worker/migrations/0002_game_and_achievement_images.sql` once before deploying this Worker. If you are creating a new database, just run `worker/schema.sql`.
