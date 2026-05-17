import express from 'express';
import crypto from 'crypto';

export const tuyaRouter = express.Router();

const BASE_URL = 'https://openapi.tuyain.com';
const CLIENT_ID = process.env.TUYA_CLIENT_ID;
const CLIENT_SECRET = process.env.TUYA_CLIENT_SECRET;

let tokenCache = { token: null, expiresAt: 0 };

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

function mapCategory(category) {
  const map = { dj: 'light', dc: 'light', dd: 'light', dbl: 'light', tgkg: 'light', tdq: 'light', ms: 'lock', cl: 'curtain', sweeping_robot: 'vacuum', sd: 'vacuum', fs: 'fan', fskg: 'fan' };
  return map[category] || 'device';
}

// Debug endpoint — shows raw Tuya API responses to help diagnose
tuyaRouter.get('/debug', async (req, res) => {
  const homeId = process.env.TUYA_HOME_ID;
  const results = {};
  try {
    // Try all known device list endpoints
    results.token_ok = true;

    // Method 1: Home devices (most common)
    try {
      results.method1_home = await tuyaRequest('GET', `/v1.0/homes/${homeId}/devices`);
    } catch(e) { results.method1_home = { error: e.message }; }

    // Method 2: Cloud thing device with space_id
    try {
      results.method2_cloud = await tuyaRequest('GET', `/v2.0/cloud/thing/device?space_id=${homeId}`);
    } catch(e) { results.method2_cloud = { error: e.message }; }

    // Method 3: User devices
    try {
      results.method3_user = await tuyaRequest('GET', `/v1.0/users/${homeId}/devices`);
    } catch(e) { results.method3_user = { error: e.message }; }

    // Method 4: Asset devices
    try {
      results.method4_asset = await tuyaRequest('GET', `/v1.0/assets/${homeId}/devices`);
    } catch(e) { results.method4_asset = { error: e.message }; }

    res.json(results);
  } catch (err) {
    res.status(500).json({ token_ok: false, error: err.message });
  }
});

// GET /api/tuya/devices
tuyaRouter.get('/devices', async (req, res) => {
  try {
    const homeId = process.env.TUYA_HOME_ID;
    let devices = [];

    // Try Method 1: /v1.0/homes/{homeId}/devices — works for most Smart Life accounts
    const data1 = await tuyaRequest('GET', `/v1.0/homes/${homeId}/devices`);
    if (data1.success && data1.result?.length > 0) {
      devices = data1.result.map(d => ({
        id: d.id,
        name: d.name,
        platform: 'tuya',
        type: mapCategory(d.category),
        online: d.online,
        on: d.status?.find(s => s.code === 'switch_led' || s.code === 'switch')?.value ?? false,
        brightness: d.status?.find(s => s.code === 'bright_value_v2')?.value,
        raw: d.status
      }));
      return res.json({ devices, source: 'homes_api' });
    }

    // Fallback Method 2: /v2.0/cloud/thing/device
    const data2 = await tuyaRequest('GET', `/v2.0/cloud/thing/device?space_id=${homeId}`);
    if (data2.success && data2.result?.list?.length > 0) {
      devices = data2.result.list.map(d => ({
        id: d.id,
        name: d.name,
        platform: 'tuya',
        type: mapCategory(d.category),
        online: d.is_online,
        on: d.status?.find(s => s.code === 'switch_led' || s.code === 'switch')?.value ?? false,
        brightness: d.status?.find(s => s.code === 'bright_value_v2')?.value,
        raw: d.status
      }));
      return res.json({ devices, source: 'cloud_api' });
    }

    // Return empty with debug info so we know which API responded what
    res.json({ devices: [], debug: { data1, data2 } });
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
      case 'set_brightness': commands = [{ code: 'bright_value_v2', value: Math.round(value * 10) }]; break;
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

// POST /api/tuya/scene
tuyaRouter.post('/scene', async (req, res) => {
  const { scene } = req.body;
  try {
    const sceneMap = {
      good_night:   process.env.TUYA_SCENE_GOODNIGHT,
      good_morning: process.env.TUYA_SCENE_MORNING,
      movie_mode:   process.env.TUYA_SCENE_MOVIE,
      away_mode:    process.env.TUYA_SCENE_AWAY,
      welcome_home: process.env.TUYA_SCENE_WELCOME,
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
