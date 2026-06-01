const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const STEAM_REALM = 'Steam Achievement Collections';
const DAY = 24 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }));
      if (url.pathname === '/auth/steam') return startSteamLogin(request, env);
      if (url.pathname === '/auth/steam/return') return finishSteamLogin(request, env);
      if (url.pathname === '/api/me') return withAuth(request, env, getMe);
      if (url.pathname === '/api/library') return withAuth(request, env, getLibrary);
      if (url.pathname === '/api/library/import' && request.method === 'POST') return withAuth(request, env, importLibraryOnce);
      if (url.pathname === '/api/library/refresh' && request.method === 'POST') return withAuth(request, env, refreshLibraryDelta);
      if (url.pathname === '/api/achievements/sync' && request.method === 'POST') return withAuth(request, env, syncAchievementBatch);
      if (url.pathname.startsWith('/api/achievements/') && request.method === 'GET') return withAuth(request, env, getGameAchievements);
      if (url.pathname === '/api/steam/search' && request.method === 'GET') return withAuth(request, env, searchSteamApps);
      if (url.pathname.match(/^\/api\/apps\/\d+\/schema$/) && request.method === 'GET') return withAuth(request, env, getAppAchievementSchema);
      if (url.pathname === '/api/collections' && request.method === 'GET') return withAuth(request, env, getMyCollections);
      if (url.pathname === '/api/collections' && request.method === 'POST') return withAuth(request, env, createCollection);
      if (url.pathname === '/api/collections/search' && request.method === 'GET') return withAuth(request, env, searchCollections);
      if (url.pathname.match(/^\/api\/collections\/\d+$/) && request.method === 'GET') return withAuth(request, env, getCollection);
      if (url.pathname.match(/^\/api\/collections\/\d+$/) && request.method === 'PUT') return withAuth(request, env, updateCollection);
      if (url.pathname.match(/^\/api\/collections\/\d+\/games$/) && request.method === 'POST') return withAuth(request, env, addCollectionGame);
      if (url.pathname.match(/^\/api\/collections\/\d+\/games\/\d+$/) && request.method === 'DELETE') return withAuth(request, env, removeCollectionGame);
      if (url.pathname.match(/^\/api\/collections\/\d+\/save$/) && request.method === 'POST') return withAuth(request, env, saveCollectionToProfile);
      if (url.pathname.match(/^\/api\/collections\/\d+\/save$/) && request.method === 'DELETE') return withAuth(request, env, unsaveCollectionFromProfile);
      if (url.pathname === '/api/settings' && request.method === 'PUT') return withAuth(request, env, saveSettings);
      return json(env, { error: 'Not found' }, 404);
    } catch (error) {
      return json(env, { error: error.message || 'Server error' }, 500);
    }
  }
};

function clientUrl(env) { return env.CLIENT_URL || 'http://localhost:5173'; }
function apiUrl(request) { const u = new URL(request.url); return `${u.protocol}//${u.host}`; }
function cors(env, response) {
  const h = new Headers(response.headers);
  h.set('Access-Control-Allow-Origin', clientUrl(env));
  h.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, { status: response.status, headers: h });
}
function json(env, data, status = 200) { return cors(env, Response.json(data, { status })); }

async function signToken(steamId, env) {
  const payload = btoa(JSON.stringify({ steamId, exp: Date.now() + 30 * DAY }));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}
async function verifyToken(token, env) {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) throw new Error('Bad token');
  const expected = await signRaw(payload, env);
  if (expected !== sig) throw new Error('Bad token signature');
  const data = JSON.parse(atob(payload));
  if (Date.now() > data.exp) throw new Error('Token expired');
  return data.steamId;
}
async function signRaw(payload, env) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function withAuth(request, env, handler) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return json(env, { error: 'Not authenticated' }, 401);
  const steamId = await verifyToken(token, env);
  const user = await env.DB.prepare('SELECT * FROM users WHERE steam_id = ?').bind(steamId).first();
  if (!user) return json(env, { error: 'User not found' }, 401);
  return handler(request, env, user);
}

function startSteamLogin(request, env) {
  const returnTo = `${apiUrl(request)}/auth/steam/return`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': apiUrl(request),
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
  });
  return Response.redirect(`${STEAM_OPENID}?${params.toString()}`, 302);
}

async function finishSteamLogin(request, env) {
  const url = new URL(request.url);
  const verify = new URLSearchParams(url.search);
  verify.set('openid.mode', 'check_authentication');
  const check = await fetch(STEAM_OPENID, { method: 'POST', body: verify });
  const text = await check.text();
  if (!text.includes('is_valid:true')) return Response.redirect(`${clientUrl(env)}?login=failed`, 302);
  const claimed = url.searchParams.get('openid.claimed_id') || '';
  const steamId = claimed.match(/steamcommunity\.com\/openid\/id\/(\d+)/)?.[1];
  if (!steamId) return Response.redirect(`${clientUrl(env)}?login=failed`, 302);

  const profile = await getPlayerProfile(steamId, env);
  await env.DB.prepare(`INSERT INTO users (steam_id, display_name, avatar_url, profile_url, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(steam_id) DO UPDATE SET display_name=excluded.display_name, avatar_url=excluded.avatar_url, profile_url=excluded.profile_url, updated_at=CURRENT_TIMESTAMP`)
    .bind(steamId, profile?.personaname || null, profile?.avatarfull || null, profile?.profileurl || null).run();
  const user = await env.DB.prepare('SELECT id FROM users WHERE steam_id = ?').bind(steamId).first();
  await env.DB.prepare('INSERT OR IGNORE INTO profile_settings (user_id) VALUES (?)').bind(user.id).run();
  const token = await signToken(steamId, env);
  return Response.redirect(`${clientUrl(env)}?token=${encodeURIComponent(token)}`, 302);
}

async function steamGet(path, params, env) {
  const url = new URL(`https://api.steampowered.com/${path}`);
  url.searchParams.set('key', env.STEAM_API_KEY);
  url.searchParams.set('format', 'json');
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const r = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error(`Steam API error ${r.status}`);
  return r.json();
}
function steamArt(appId) {
  return {
    capsule: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_184x69.jpg`,
    header: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    wide: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`
  };
}

async function getPlayerProfile(steamId, env) {
  const d = await steamGet('ISteamUser/GetPlayerSummaries/v0002/', { steamids: steamId }, env);
  return d.response?.players?.[0] || null;
}
async function getOwnedGames(steamId, env) {
  const d = await steamGet('IPlayerService/GetOwnedGames/v0001/', { steamid: steamId, include_appinfo: 1, include_played_free_games: 1 }, env);
  return d.response?.games || [];
}

async function getMe(request, env, user) {
  const settings = await env.DB.prepare('SELECT * FROM profile_settings WHERE user_id = ?').bind(user.id).first();
  return json(env, { user, settings });
}

async function getLibrary(request, env, user) {
  const games = await env.DB.prepare(`SELECT app_id AS appid, game_name AS name, playtime_minutes AS playtime_forever, img_icon_url, capsule_url, header_url, wide_capsule_url,
    achievement_total, achievement_unlocked, achievement_percent, achievement_last_synced_at, achievement_next_sync_after,
    has_community_visible_stats FROM user_games WHERE user_id = ? ORDER BY game_name`).bind(user.id).all();
  return json(env, { games: games.results.map(formatGame), importedAt: user.library_imported_at });
}
function formatGame(g) {
  const art = steamArt(g.appid || g.app_id);
  return { ...g, capsule_url: g.capsule_url || art.capsule, header_url: g.header_url || art.header, wide_capsule_url: g.wide_capsule_url || art.wide, achievements: { total: g.achievement_total ?? 0, unlocked: g.achievement_unlocked ?? 0, percent: g.achievement_percent } };
}

async function importLibraryOnce(request, env, user) {
  if (user.library_imported_at) return getLibrary(request, env, user);
  const owned = await getOwnedGames(user.steam_id, env);
  await upsertOwnedGames(env, user.id, owned, false);
  await env.DB.prepare("UPDATE users SET library_imported_at=CURRENT_TIMESTAMP, library_sync_status='complete' WHERE id=?").bind(user.id).run();
  return json(env, { imported: owned.length, mode: 'initial' });
}

async function refreshLibraryDelta(request, env, user) {
  const owned = await getOwnedGames(user.steam_id, env); // one cheap call needed to know what changed
  const existing = await env.DB.prepare('SELECT app_id FROM user_games WHERE user_id=?').bind(user.id).all();
  const have = new Set(existing.results.map(r => Number(r.app_id)));
  const newOnly = owned.filter(g => !have.has(Number(g.appid)));
  await upsertOwnedGames(env, user.id, newOnly, false);
  // Keep playtime fresh with one batch DB update; this does not call per-game Steam APIs.
  await upsertOwnedGames(env, user.id, owned, true);
  await env.DB.prepare("UPDATE users SET library_imported_at=CURRENT_TIMESTAMP, library_sync_status='complete' WHERE id=?").bind(user.id).run();
  return json(env, { checked: owned.length, added: newOnly.length, mode: 'delta' });
}

async function upsertOwnedGames(env, userId, games, playtimeOnly) {
  const statements = games.map(g => {
    const art = steamArt(g.appid);
    return env.DB.prepare(`INSERT INTO user_games (user_id, app_id, game_name, playtime_minutes, img_icon_url, capsule_url, header_url, wide_capsule_url, last_owned_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, app_id) DO UPDATE SET
      game_name=excluded.game_name,
      playtime_minutes=excluded.playtime_minutes,
      img_icon_url=excluded.img_icon_url,
      capsule_url=excluded.capsule_url,
      header_url=excluded.header_url,
      wide_capsule_url=excluded.wide_capsule_url,
      last_owned_seen_at=CURRENT_TIMESTAMP`)
    .bind(userId, g.appid, g.name || `App ${g.appid}`, g.playtime_forever || 0, g.img_icon_url || null, art.capsule, art.header, art.wide);
  });
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
}

async function syncAchievementBatch(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit || 8), 20);
  const force = body.force === true;
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(`SELECT * FROM user_games WHERE user_id=? ${force ? '' : "AND (achievement_next_sync_after IS NULL OR achievement_next_sync_after <= datetime('now'))"}
    ORDER BY CASE WHEN achievement_last_synced_at IS NULL THEN 0 ELSE 1 END, achievement_last_synced_at ASC LIMIT ?`).bind(user.id, limit).all();

  let processed = 0, synced = 0, skipped = 0, errors = 0;
  for (const game of rows.results) {
    processed++;
    try {
      const d = await steamGet('ISteamUserStats/GetPlayerAchievements/v0001/', { steamid: user.steam_id, appid: game.app_id }, env);
      const list = d.playerstats?.achievements || [];
      if (!list.length) {
        await markAchievementSummary(env, user.id, game.app_id, 0, 0, null, 30);
        skipped++;
        continue;
      }
      const total = list.length;
      const unlocked = list.filter(a => a.achieved === 1).length;
      const percent = Math.round((unlocked / total) * 100);
      await ensureAchievementSchema(env, game.app_id);
      const schemaRows = await env.DB.prepare('SELECT * FROM app_achievement_schema WHERE app_id=?').bind(game.app_id).all();
      const schema = new Map(schemaRows.results.map(row => [row.achievement_api_name, row]));
      await markAchievementSummary(env, user.id, game.app_id, total, unlocked, percent, percent === 100 ? 30 : 3);
      const statements = list.map(a => {
        const meta = schema.get(a.apiname) || {};
        return env.DB.prepare(`INSERT INTO user_achievements (user_id, app_id, achievement_api_name, display_name, description, icon_url, icon_gray_url, unlocked, unlock_time, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, app_id, achievement_api_name) DO UPDATE SET display_name=excluded.display_name, description=excluded.description, icon_url=excluded.icon_url, icon_gray_url=excluded.icon_gray_url, unlocked=excluded.unlocked, unlock_time=excluded.unlock_time, updated_at=CURRENT_TIMESTAMP`)
        .bind(user.id, game.app_id, a.apiname, meta.display_name || a.apiname, meta.description || null, meta.icon_url || null, meta.icon_gray_url || null, a.achieved ? 1 : 0, a.unlocktime || null);
      });
      for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
      synced++;
    } catch (e) {
      errors++;
      await env.DB.prepare(`UPDATE user_games SET achievement_sync_attempts=achievement_sync_attempts+1,
        achievement_next_sync_after=datetime('now', '+14 days'), achievement_last_synced_at=CURRENT_TIMESTAMP WHERE user_id=? AND app_id=?`)
        .bind(user.id, game.app_id).run();
    }
  }
  const remaining = await env.DB.prepare(`SELECT COUNT(*) AS count FROM user_games WHERE user_id=? AND (achievement_next_sync_after IS NULL OR achievement_next_sync_after <= datetime('now'))`).bind(user.id).first();
  return json(env, { processed, synced, skipped, errors, remainingReadyToSync: remaining.count, syncedAt: now });
}

async function markAchievementSummary(env, userId, appId, total, unlocked, percent, cooldownDays) {
  await env.DB.prepare(`UPDATE user_games SET has_community_visible_stats=?, achievement_total=?, achievement_unlocked=?, achievement_percent=?,
    achievement_last_synced_at=CURRENT_TIMESTAMP, achievement_next_sync_after=datetime('now', ?), achievement_sync_attempts=0 WHERE user_id=? AND app_id=?`)
    .bind(percent === null ? 0 : 1, total, unlocked, percent, `+${cooldownDays} days`, userId, appId).run();
}

async function getGameAchievements(request, env, user) {
  const appId = Number(new URL(request.url).pathname.split('/').pop());
  await ensureAchievementSchema(env, appId);
  const rows = await env.DB.prepare(`SELECT ua.achievement_api_name,
      COALESCE(ua.display_name, s.display_name, ua.achievement_api_name) AS display_name,
      COALESCE(ua.description, s.description) AS description,
      COALESCE(ua.icon_url, s.icon_url) AS icon_url,
      COALESCE(ua.icon_gray_url, s.icon_gray_url) AS icon_gray_url,
      ua.unlocked, ua.unlock_time, ua.updated_at
    FROM user_achievements ua
    LEFT JOIN app_achievement_schema s ON s.app_id=ua.app_id AND s.achievement_api_name=ua.achievement_api_name
    WHERE ua.user_id=? AND ua.app_id=?
    ORDER BY ua.unlocked DESC, display_name ASC`).bind(user.id, appId).all();
  return json(env, { appid: appId, achievements: rows.results });
}


async function searchSteamApps(request, env, user) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return json(env, { results: [] });
  // Steam Store search is public and lets users add games they do not own.
  const url = new URL('https://store.steampowered.com/api/storesearch/');
  url.searchParams.set('term', q);
  url.searchParams.set('l', 'english');
  url.searchParams.set('cc', 'US');
  const r = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error(`Steam Store search error ${r.status}`);
  const data = await r.json();
  const results = (data.items || []).filter(x => x.type === 'app' || !x.type).slice(0, 25).map(x => ({
    appid: Number(x.id), name: x.name, capsule: x.tiny_image || steamArt(x.id).capsule, header: steamArt(x.id).header, wide: steamArt(x.id).wide
  }));
  if (results.length) {
    const statements = results.map(app => env.DB.prepare(`INSERT INTO steam_apps (app_id, name, capsule_url, header_url, wide_capsule_url, last_seen_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(app_id) DO UPDATE SET name=excluded.name, capsule_url=excluded.capsule_url, header_url=excluded.header_url, wide_capsule_url=excluded.wide_capsule_url, last_seen_at=CURRENT_TIMESTAMP`)
      .bind(app.appid, app.name, app.capsule, app.header, app.wide));
    await env.DB.batch(statements);
  }
  return json(env, { results });
}

async function ensureAchievementSchema(env, appId) {
  const existing = await env.DB.prepare(`SELECT updated_at, (julianday('now') - julianday(updated_at)) AS age_days FROM app_achievement_schema WHERE app_id=? LIMIT 1`).bind(appId).first();
  if (existing && Number(existing.age_days) < 30) return true;
  try {
    const data = await steamGet('ISteamUserStats/GetSchemaForGame/v2/', { appid: appId }, env);
    const achievements = data.game?.availableGameStats?.achievements || [];
    if (achievements.length) {
      const statements = achievements.map(a => env.DB.prepare(`INSERT INTO app_achievement_schema (app_id, achievement_api_name, display_name, description, icon_url, icon_gray_url, hidden, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(app_id, achievement_api_name) DO UPDATE SET display_name=excluded.display_name, description=excluded.description, icon_url=excluded.icon_url, icon_gray_url=excluded.icon_gray_url, hidden=excluded.hidden, updated_at=CURRENT_TIMESTAMP`)
        .bind(appId, a.name, a.displayName || a.name, a.description || null, a.icon || null, a.icongray || null, a.hidden ? 1 : 0));
      for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    }
  } catch (e) { return false; }
  return true;
}

async function getAppAchievementSchema(request, env, user) {
  const appId = Number(new URL(request.url).pathname.split('/')[3]);
  const before = await env.DB.prepare(`SELECT COUNT(*) AS count FROM app_achievement_schema WHERE app_id=?`).bind(appId).first();
  const refreshed = await ensureAchievementSchema(env, appId);
  const rows = await env.DB.prepare('SELECT * FROM app_achievement_schema WHERE app_id=? ORDER BY display_name').bind(appId).all();
  return json(env, { appid: appId, achievements: rows.results, cached: before.count > 0 && refreshed });
}

async function getMyCollections(request, env, user) {
  const mine = await env.DB.prepare(`SELECT c.*, u.display_name AS owner_name,
    (SELECT COUNT(*) FROM collection_games cg WHERE cg.collection_id=c.id) AS game_count
    FROM collections c JOIN users u ON u.id=c.owner_user_id WHERE c.owner_user_id=? ORDER BY c.updated_at DESC`).bind(user.id).all();
  const saved = await env.DB.prepare(`SELECT c.*, u.display_name AS owner_name,
    (SELECT COUNT(*) FROM collection_games cg WHERE cg.collection_id=c.id) AS game_count
    FROM saved_collections s JOIN collections c ON c.id=s.collection_id JOIN users u ON u.id=c.owner_user_id
    WHERE s.user_id=? ORDER BY s.created_at DESC`).bind(user.id).all();
  return json(env, { mine: mine.results, saved: saved.results });
}

async function createCollection(request, env, user) {
  const body = await request.json();
  const name = (body.name || '').trim();
  if (!name) return json(env, { error: 'Collection name is required' }, 400);
  const result = await env.DB.prepare('INSERT INTO collections (owner_user_id, name, description, visibility) VALUES (?, ?, ?, ?)')
    .bind(user.id, name, body.description || null, body.visibility || 'public').run();
  const id = result.meta.last_row_id;
  await env.DB.prepare('INSERT OR IGNORE INTO saved_collections (user_id, collection_id, pinned) VALUES (?, ?, 1)').bind(user.id, id).run();
  return getCollection(new Request(`${clientUrl(env)}/api/collections/${id}`), env, user);
}

async function getCollection(request, env, user) {
  const id = Number(new URL(request.url).pathname.split('/')[3]);
  const collection = await env.DB.prepare(`SELECT c.*, u.display_name AS owner_name, u.avatar_url AS owner_avatar,
    EXISTS(SELECT 1 FROM saved_collections s WHERE s.user_id=? AND s.collection_id=c.id) AS saved_by_me
    FROM collections c JOIN users u ON u.id=c.owner_user_id WHERE c.id=?`).bind(user.id, id).first();
  if (!collection) return json(env, { error: 'Collection not found' }, 404);
  if (collection.visibility !== 'public' && collection.owner_user_id !== user.id) return json(env, { error: 'Private collection' }, 403);
  const games = await env.DB.prepare(`SELECT cg.*, COALESCE(cg.capsule_url, sa.capsule_url) AS capsule_url, COALESCE(cg.header_url, sa.header_url) AS header_url, COALESCE(cg.wide_capsule_url, sa.wide_capsule_url) AS wide_capsule_url, ug.achievement_total, ug.achievement_unlocked, ug.achievement_percent, ug.playtime_minutes,
    CASE WHEN ug.app_id IS NULL THEN 0 ELSE 1 END AS owned_by_me
    FROM collection_games cg LEFT JOIN steam_apps sa ON sa.app_id=cg.app_id LEFT JOIN user_games ug ON ug.user_id=? AND ug.app_id=cg.app_id
    WHERE cg.collection_id=? ORDER BY cg.sort_order ASC, cg.game_name ASC`).bind(user.id, id).all();
  return json(env, { collection, games: games.results });
}

async function updateCollection(request, env, user) {
  const id = Number(new URL(request.url).pathname.split('/')[3]);
  const current = await env.DB.prepare('SELECT * FROM collections WHERE id=?').bind(id).first();
  if (!current) return json(env, { error: 'Collection not found' }, 404);
  if (current.owner_user_id !== user.id) return json(env, { error: 'Only the owner can edit this collection' }, 403);
  const body = await request.json();
  await env.DB.prepare('UPDATE collections SET name=?, description=?, visibility=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(body.name || current.name, body.description ?? current.description, body.visibility || current.visibility, id).run();
  return getCollection(request, env, user);
}

async function addCollectionGame(request, env, user) {
  const parts = new URL(request.url).pathname.split('/');
  const collectionId = Number(parts[3]);
  const current = await env.DB.prepare('SELECT * FROM collections WHERE id=?').bind(collectionId).first();
  if (!current) return json(env, { error: 'Collection not found' }, 404);
  if (current.owner_user_id !== user.id) return json(env, { error: 'Only the owner can edit this collection' }, 403);
  const body = await request.json();
  const appId = Number(body.appid || body.app_id);
  const name = (body.name || body.game_name || `App ${appId}`).trim();
  if (!appId || !name) return json(env, { error: 'appid and name are required' }, 400);
  const art = { capsule: body.capsule || steamArt(appId).capsule, header: body.header || steamArt(appId).header, wide: body.wide || steamArt(appId).wide };
  await env.DB.prepare('INSERT INTO steam_apps (app_id, name, capsule_url, header_url, wide_capsule_url) VALUES (?, ?, ?, ?, ?) ON CONFLICT(app_id) DO UPDATE SET name=excluded.name, capsule_url=excluded.capsule_url, header_url=excluded.header_url, wide_capsule_url=excluded.wide_capsule_url').bind(appId, name, art.capsule, art.header, art.wide).run();
  const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order),0) AS sort_order FROM collection_games WHERE collection_id=?').bind(collectionId).first();
  await env.DB.prepare(`INSERT INTO collection_games (collection_id, app_id, game_name, capsule_url, header_url, wide_capsule_url, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(collection_id, app_id) DO UPDATE SET game_name=excluded.game_name, capsule_url=excluded.capsule_url, header_url=excluded.header_url, wide_capsule_url=excluded.wide_capsule_url`)
    .bind(collectionId, appId, name, art.capsule, art.header, art.wide, Number(max.sort_order) + 1).run();
  await env.DB.prepare('UPDATE collections SET updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(collectionId).run();
  return getCollection(new Request(`${clientUrl(env)}/api/collections/${collectionId}`), env, user);
}

async function removeCollectionGame(request, env, user) {
  const parts = new URL(request.url).pathname.split('/');
  const collectionId = Number(parts[3]);
  const appId = Number(parts[5]);
  const current = await env.DB.prepare('SELECT * FROM collections WHERE id=?').bind(collectionId).first();
  if (!current) return json(env, { error: 'Collection not found' }, 404);
  if (current.owner_user_id !== user.id) return json(env, { error: 'Only the owner can edit this collection' }, 403);
  await env.DB.prepare('DELETE FROM collection_games WHERE collection_id=? AND app_id=?').bind(collectionId, appId).run();
  await env.DB.prepare('UPDATE collections SET updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(collectionId).run();
  return json(env, { removed: true });
}

async function searchCollections(request, env, user) {
  const q = `%${(new URL(request.url).searchParams.get('q') || '').trim()}%`;
  const rows = await env.DB.prepare(`SELECT c.*, u.display_name AS owner_name,
    (SELECT COUNT(*) FROM collection_games cg WHERE cg.collection_id=c.id) AS game_count,
    EXISTS(SELECT 1 FROM saved_collections s WHERE s.user_id=? AND s.collection_id=c.id) AS saved_by_me
    FROM collections c JOIN users u ON u.id=c.owner_user_id
    WHERE c.visibility='public' AND (c.name LIKE ? OR c.description LIKE ?)
    ORDER BY game_count DESC, c.updated_at DESC LIMIT 50`).bind(user.id, q, q).all();
  return json(env, { results: rows.results });
}

async function saveCollectionToProfile(request, env, user) {
  const id = Number(new URL(request.url).pathname.split('/')[3]);
  const c = await env.DB.prepare('SELECT id, visibility FROM collections WHERE id=?').bind(id).first();
  if (!c || c.visibility !== 'public') return json(env, { error: 'Collection not found' }, 404);
  await env.DB.prepare('INSERT OR IGNORE INTO saved_collections (user_id, collection_id, pinned) VALUES (?, ?, 1)').bind(user.id, id).run();
  return json(env, { saved: true });
}

async function unsaveCollectionFromProfile(request, env, user) {
  const id = Number(new URL(request.url).pathname.split('/')[3]);
  await env.DB.prepare('DELETE FROM saved_collections WHERE user_id=? AND collection_id=?').bind(user.id, id).run();
  return json(env, { saved: false });
}

async function saveSettings(request, env, user) {
  const body = await request.json();
  await env.DB.prepare(`UPDATE profile_settings SET display_name=?, headline=?, layout_style=?, achievement_display_mode=?, card_density=?, accent_color=?, featured_game_ids=?, featured_collection_ids=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`)
    .bind(body.display_name || null, body.headline || null, body.layout_style || 'hero', body.achievement_display_mode || 'byGame', body.card_density || 'comfortable', body.accent_color || '#3b82f6', JSON.stringify(body.featured_game_ids || []), JSON.stringify(body.featured_collection_ids || []), user.id).run();
  return getMe(request, env, user);
}
