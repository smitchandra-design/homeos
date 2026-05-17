import express from 'express';

export const alexaRouter = express.Router();

// Alexa Smart Home uses Login with Amazon (LWA) OAuth
// Users must authorize via LWA — tokens stored after OAuth flow
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const ALEXA_API_URL = 'https://api.amazonalexa.com/v3/endpoints';

// In production, store tokens per user in a DB (e.g. Postgres on Render)
// For MVP, use env vars after completing OAuth once
let alexaAccessToken = process.env.ALEXA_ACCESS_TOKEN;
let alexaRefreshToken = process.env.ALEXA_REFRESH_TOKEN;
let alexaTokenExpiry = parseInt(process.env.ALEXA_TOKEN_EXPIRY || '0');

async function refreshAlexaToken() {
  if (alexaAccessToken && Date.now() < alexaTokenExpiry) return alexaAccessToken;
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: alexaRefreshToken,
    client_id: process.env.ALEXA_CLIENT_ID,
    client_secret: process.env.ALEXA_CLIENT_SECRET
  });
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json();
  if (data.access_token) {
    alexaAccessToken = data.access_token;
    alexaTokenExpiry = Date.now() + data.expires_in * 1000;
    return alexaAccessToken;
  }
  throw new Error('Alexa token refresh failed: ' + JSON.stringify(data));
}

// GET /api/alexa/devices
alexaRouter.get('/devices', async (req, res) => {
  try {
    const token = await refreshAlexaToken();
    const response = await fetch(ALEXA_API_URL, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    const data = await response.json();
    const endpoints = data.endpoints || [];

    const devices = endpoints
      .filter(e => {
        const cats = e.displayCategories || [];
        return cats.some(c => ['SPEAKER', 'SMARTPLUG', 'LIGHT', 'OTHER'].includes(c));
      })
      .map(e => ({
        id: e.endpointId,
        name: e.friendlyName,
        platform: 'alexa',
        type: e.displayCategories?.[0]?.toLowerCase() || 'device',
        online: true, // Alexa endpoint list doesn't include real-time state; use separate state fetch
        description: e.description,
        manufacturer: e.manufacturerName,
        capabilities: e.capabilities?.map(c => c.interface) || []
      }));

    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alexa/control — sends directives to Alexa Smart Home
alexaRouter.post('/control', async (req, res) => {
  const { deviceId, command, value } = req.body;
  try {
    const token = await refreshAlexaToken();

    // Build directive based on command
    let namespace, name, payload = {};
    switch (command) {
      case 'turn_on':
        namespace = 'Alexa.PowerController'; name = 'TurnOn'; break;
      case 'turn_off':
        namespace = 'Alexa.PowerController'; name = 'TurnOff'; break;
      case 'set_volume':
        namespace = 'Alexa.Speaker'; name = 'SetVolume';
        payload = { volume: Math.min(100, Math.max(0, value)) }; break;
      case 'set_brightness':
        namespace = 'Alexa.BrightnessController'; name = 'SetBrightness';
        payload = { brightness: Math.min(100, Math.max(0, value)) }; break;
      default:
        return res.status(400).json({ error: 'Unsupported command for Alexa' });
    }

    const directive = {
      directive: {
        header: {
          namespace, name,
          messageId: crypto.randomUUID(),
          payloadVersion: '3'
        },
        endpoint: { endpointId: deviceId, scope: { type: 'BearerToken', token } },
        payload
      }
    };

    // Alexa Smart Home directives go via the Alexa Event Gateway
    const response = await fetch('https://api.amazonalexa.com/v3/events', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(directive)
    });

    if (response.status === 202) {
      res.json({ success: true, message: 'Directive sent to Alexa' });
    } else {
      const err = await response.text();
      res.status(response.status).json({ error: err });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// OAuth callback — Alexa sends auth code here after user authorizes
alexaRouter.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');
  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.ALEXA_REDIRECT_URI,
      client_id: process.env.ALEXA_CLIENT_ID,
      client_secret: process.env.ALEXA_CLIENT_SECRET
    });
    const tokenRes = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const tokens = await tokenRes.json();
    // In production: save tokens to DB. For now, display for manual copy to .env
    res.send(`
      <h2>Alexa Authorization Successful!</h2>
      <p>Copy these to your Render environment variables:</p>
      <pre>ALEXA_ACCESS_TOKEN=${tokens.access_token}
ALEXA_REFRESH_TOKEN=${tokens.refresh_token}
ALEXA_TOKEN_EXPIRY=${Date.now() + tokens.expires_in * 1000}</pre>
      <p>Then restart your Render service.</p>
    `);
  } catch (err) {
    res.status(500).send('OAuth failed: ' + err.message);
  }
});
