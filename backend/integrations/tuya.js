import express from 'express';
import crypto from 'crypto';

export const tuyaRouter = express.Router();

const BASE_URL = 'https://openapi.tuyain.com'; // Change to tuyaus.com if US account
const CLIENT_ID = process.env.TUYA_CLIENT_ID;
const CLIENT_SECRET = process.env.TUYA_CLIENT_SECRET;

let tokenCache = { token: null, expiresAt: 0 };

// Tuya signature generation
function sign(method, path, body, token, timestamp) {
  const contentHash = crypto.createHash('sha256').update(body || '').digest('hex');
  const stringToSign = [method, contentHash, '', path].join('\n');
  const signStr = CLIENT_ID + (token || '') + timestamp + stringToSign;
  return crypto.createHmac('sha256', CLIENT_SECRET).update(signStr).digest('hex').toUpperCase();
}

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const ts = Date.now().toString();
  const sig = sign('GET', '/v1.0/token?grant_type=1', '', '', ts);
  const res = await fetch(`${BASE_URL}/v1.0/token?grant_type=1`, {
    headers: {
      'client_id': CLIENT_ID,
      'sign': sig,
      'sign_method': 'HMAC-SHA256',
      't': ts,
      'lang': 'en'
    }
  });
  const data = await res.json();
  if (data.success) {
    tokenCache = { token: data.result.access_token, expiresAt: Date.now() + data.result.expire_time * 1000 };
    return tokenCache.token;
  }
  throw new Error('Tuya auth failed: ' + JSON.stringify(data));
}

async function tuyaRequest(method, path, body = null) {
  const token = await getToken();
  const ts = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const sig = sign(method, path, bodyStr, token, ts);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'client_id': CLIENT_ID,
      'access_token': token,
      'sign': sig,
      'sign_method': 'HMAC-SHA256',
      't': ts,
      'lang': 'en',
      'Content-Type': 'application/json'
    },
    body: bodyStr || undefined
  });
  return res.json();
}

// Map Tuya device categories to friendly types
function mapCategory(category) {
  const map = { dj: 'light', dc: 'light', dd: 'light', ms: 'lock', cl: 'curtain', sweeping_robot: 'vacuum', sd: 'vacuum' };
  return map[category] || 'device';
}

// GET /api/tuya/devices
tuyaRouter.get('/devices', async (req, res) => {
  try {
    // Fetch devices linked to your Tuya cloud project
    const homeId = process.env.TUYA_HOME_ID;
    const data = await tuyaRequest('GET', `/v2.0/cloud/thing/device?space_id=${homeId}`);
    const devices = (data.result?.list || []).map(d => ({
      id: d.id,
      name: d.name,
      platform: 'tuya',
      type: mapCategory(d.category),
      online: d.is_online,
      on: d.status?.find(s => s.code === 'switch_led' || s.code === 'switch')?.value ?? false,
      brightness: d.status?.find(s => s.code === 'bright_value_v2')?.value,
      raw: d.status
    }));
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tuya/control
tuyaRouter.post('/control', async (req, res) => {
  const { deviceId, command, value } = req.body;
  try {
    let commands = [];
    switch (command) {
      case 'turn_on':   commands = [{ code: 'switch_led', value: true }, { code: 'switch', value: true }]; break;
      case 'turn_off':  commands = [{ code: 'switch_led', value: false }, { code: 'switch', value: false }]; break;
      case 'set_brightness': commands = [{ code: 'bright_value_v2', value: Math.round(value * 10) }]; break; // Tuya uses 10-1000
      case 'lock':      commands = [{ code: 'open', value: false }]; break;
      case 'unlock':    commands = [{ code: 'open', value: true }]; break;
      default: return res.status(400).json({ error: 'Unknown command' });
    }
    const data = await tuyaRequest('POST', `/v1.0/devices/${deviceId}/commands`, { commands });
    res.json({ success: data.success, result: data.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tuya/scene — control multiple devices for scenes
tuyaRouter.post('/scene', async (req, res) => {
  const { scene } = req.body;
  try {
    // Scenes map to Tuya tap-to-run scene IDs configured in Smart Life app
    const sceneMap = {
      good_night:    process.env.TUYA_SCENE_GOODNIGHT,
      good_morning:  process.env.TUYA_SCENE_MORNING,
      movie_mode:    process.env.TUYA_SCENE_MOVIE,
      away_mode:     process.env.TUYA_SCENE_AWAY,
      welcome_home:  process.env.TUYA_SCENE_WELCOME,
    };
    const sceneId = sceneMap[scene];
    if (!sceneId) return res.status(404).json({ error: `Scene ${scene} not configured` });
    const homeId = process.env.TUYA_HOME_ID;
    const data = await tuyaRequest('POST', `/v2.0/homes/${homeId}/scenes/${sceneId}/actions/trigger`, {});
    res.json({ success: data.success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
