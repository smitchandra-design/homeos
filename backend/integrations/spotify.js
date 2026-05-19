import express from 'express';

export const spotifyRouter = express.Router();

const SPOTIFY_AUTH = 'https://accounts.spotify.com';
const SPOTIFY_API = 'https://api.spotify.com/v1';
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

// Required scopes for full playback + library control
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'streaming',
  'user-library-read'
].join(' ');

// In-memory token store (in production, save to DB)
let tokens = {
  access_token: process.env.SPOTIFY_ACCESS_TOKEN || null,
  refresh_token: process.env.SPOTIFY_REFRESH_TOKEN || null,
  expires_at: parseInt(process.env.SPOTIFY_TOKEN_EXPIRY || '0')
};

// ─── Auth Flow ────────────────────────────────────────────

// Step 1: redirect user to Spotify login
spotifyRouter.get('/login', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state: 'homeos_auth'
  });
  res.redirect(`${SPOTIFY_AUTH}/authorize?${params}`);
});

// Step 2: callback handler — exchange code for tokens
spotifyRouter.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send('Auth failed: ' + error);
  if (!code) return res.status(400).send('No code received');

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    });
    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const r = await fetch(`${SPOTIFY_AUTH}/api/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    const data = await r.json();
    if (!data.access_token) return res.status(400).json(data);

    tokens.access_token = data.access_token;
    tokens.refresh_token = data.refresh_token;
    tokens.expires_at = Date.now() + (data.expires_in * 1000);

    res.send(`
      <html><body style="font-family:system-ui;background:#0f0f10;color:#f0f0f2;padding:40px;">
      <h2 style="color:#1DB954">✓ Spotify Connected!</h2>
      <p>HomeOS can now control your Spotify playback.</p>
      <p style="margin-top:24px;font-size:13px;color:#888">Add these to your Render env vars to persist across restarts:</p>
      <pre style="background:#1a1a1e;padding:16px;border-radius:8px;font-size:11px;overflow-x:auto;">
SPOTIFY_ACCESS_TOKEN=${data.access_token}
SPOTIFY_REFRESH_TOKEN=${data.refresh_token}
SPOTIFY_TOKEN_EXPIRY=${tokens.expires_at}</pre>
      <p style="margin-top:24px;"><a href="javascript:window.close()" style="color:#1DB954">Close this window</a></p>
      </body></html>
    `);
  } catch (e) {
    res.status(500).send('Token exchange failed: ' + e.message);
  }
});

// Refresh expired access token
async function refreshAccessToken() {
  if (!tokens.refresh_token) throw new Error('No refresh token — please re-authenticate at /api/spotify/login');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token
  });
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${SPOTIFY_AUTH}/api/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await r.json();
  if (data.access_token) {
    tokens.access_token = data.access_token;
    tokens.expires_at = Date.now() + (data.expires_in * 1000);
    if (data.refresh_token) tokens.refresh_token = data.refresh_token;
    return tokens.access_token;
  }
  throw new Error('Refresh failed: ' + JSON.stringify(data));
}

async function getValidToken() {
  if (!tokens.access_token) throw new Error('Not authenticated — visit /api/spotify/login');
  if (Date.now() >= tokens.expires_at - 60000) await refreshAccessToken();
  return tokens.access_token;
}

async function spotifyRequest(method, path, body = null) {
  const token = await getValidToken();
  const r = await fetch(`${SPOTIFY_API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  // Spotify returns 204 for many control endpoints (success, no content)
  if (r.status === 204) return { success: true };
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: r.status }; }
}

// ─── Public API ───────────────────────────────────────────

// Current playback state
spotifyRouter.get('/state', async (req, res) => {
  try {
    const data = await spotifyRequest('GET', '/me/player');
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List available devices (phone, speaker, laptop)
spotifyRouter.get('/devices', async (req, res) => {
  try {
    const data = await spotifyRequest('GET', '/me/player/devices');
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Search for playlist/track/artist
spotifyRouter.get('/search', async (req, res) => {
  const { q, type = 'playlist', limit = 5 } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q parameter' });
  try {
    const data = await spotifyRequest('GET', `/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Play / pause / resume / next / prev
spotifyRouter.post('/play', async (req, res) => {
  const { uri, deviceId } = req.body;
  try {
    let path = '/me/player/play';
    if (deviceId) path += `?device_id=${deviceId}`;
    const body = uri ? { context_uri: uri } : undefined;
    const data = await spotifyRequest('PUT', path, body);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

spotifyRouter.post('/pause', async (req, res) => {
  try {
    const data = await spotifyRequest('PUT', '/me/player/pause');
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

spotifyRouter.post('/next', async (req, res) => {
  try {
    const data = await spotifyRequest('POST', '/me/player/next');
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

spotifyRouter.post('/previous', async (req, res) => {
  try {
    const data = await spotifyRequest('POST', '/me/player/previous');
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Volume 0-100
spotifyRouter.post('/volume', async (req, res) => {
  const { level } = req.body;
  try {
    const data = await spotifyRequest('PUT', `/me/player/volume?volume_percent=${Math.min(100, Math.max(0, level))}`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Convenience: play by mood (uses search to find a playlist)
spotifyRouter.post('/mood', async (req, res) => {
  const { mood, deviceId } = req.body;
  try {
    // Search for a playlist matching the mood
    const searchResult = await spotifyRequest('GET', `/search?q=${encodeURIComponent(mood)}&type=playlist&limit=1`);
    const playlist = searchResult.playlists?.items?.[0];
    if (!playlist) return res.status(404).json({ error: `No playlist found for mood "${mood}"` });

    // Play that playlist
    let path = '/me/player/play';
    if (deviceId) path += `?device_id=${deviceId}`;
    await spotifyRequest('PUT', path, { context_uri: playlist.uri });

    res.json({ success: true, playing: playlist.name, mood });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: connection status
spotifyRouter.get('/status', (req, res) => {
  res.json({
    authenticated: !!tokens.access_token,
    hasRefreshToken: !!tokens.refresh_token,
    expiresIn: tokens.expires_at ? Math.max(0, Math.floor((tokens.expires_at - Date.now()) / 1000)) : 0,
    clientIdSet: !!CLIENT_ID,
    redirectUri: REDIRECT_URI
  });
});
