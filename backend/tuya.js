import express from 'express';
import crypto from 'crypto';

export const tuyaRouter = express.Router();

const BASE_URL = 'https://openapi.tuyain.com';
const CLIENT_ID = process.env.TUYA_CLIENT_ID;
const CLIENT_SECRET = process.env.TUYA_CLIENT_SECRET;

let tokenCache = { token: null, uid: null, expiresAt: 0 };

function sign(method, path, body, token, timestamp) {
  const contentHash = crypto.createHash('sha256').update(body || '').digest('hex');
  const stringToSign = [method, contentHash, '', path].join('\n');
  const signStr = CLIENT_ID + (token || '') + timestamp + stringToSign;
  return crypto.createHmac('sha256', CLIENT_SECRET).update(signStr).digest('hex').toUpperCase();
}

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache;
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
    tokenCache = {
      token: data.result.access_token,
      uid: data.result.uid,
      expiresAt: Date.now() + data.result.expire_time * 1000
    };
    return tokenCache;
  }
  throw new Error('Tuya auth failed: ' + JSON.stringify(data));
}

async function tuyaRequest(method, path, body = null) {
  const { token } = await getToken();
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
  const map = {
    dj: 'light', dc: 'light', dd: 'light', dbl: 'light',
    tgkg: 'light', tdq: 'light', gyd: 'light', xdd: 'light',
    ms: 'lock', bxx: 'lock', jtmspro: 'lock',
    cl: 'curtain', fs: 'fan', fskg: 'fan',
    sweeping_robot: 'vacuum', sd: 'vacuum',
    sp: 'speaker', wk: 'thermostat'
  };
  return map[category] || 'device';
}

function normalizeDevices(list, source) {
  return list.map(d => ({
    id: d.id || d.device_id,
    name: d.name || d.device_name || 'Device',
    platform: 'tuya',
    type: mapCategory(d.category),
    online: d.online ?? d.is_online ?? false,
    on: d.status?.find(s => ['switch_led','switch','switch_1'].includes(s.code))?.value ?? false,
    brightness: d.status?.find(s => ['bright_value_v2','bright_value'].includes(s.code))?.value,
    source,
    raw: d.status || []
  }));
}

// GET /api/tuya/devices — tries every known endpoint
tuyaRouter.get('/devices', async (req, res) => {
  try {
    const { token, uid } = await getToken();

    // Try endpoints in order, return first one that works
    const endpoints = [
      `/v1.0/iot-01/associated-users/devices`,
      `/v2.0/cloud/thing/device?page_size=50`,
      `/v1.0/users/${uid}/devices`,
      `/v1.0/devices`,
    ];

    for (const path of endpoints) {
      try {
        const data = await tuyaRequest('GET', path);
        if (data.success) {
          // Handle all possible response structures across Tuya endpoints
          const result = data.result;
          const list = Array.isArray(result) ? result
            : Array.isArray(result?.devices) ? result.devices
            : Array.isArray(result?.list) ? result.list
            : [];
          if (list.length > 0) {
            return res.json({ devices: normalizeDevices(list, path), source: path });
          }
        }
      } catch(e) {
        continue;
      }
    }

    res.json({ devices: [], message: 'No devices found across all endpoints' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tuya/debug — shows result from every endpoint
tuyaRouter.get('/debug', async (req, res) => {
  try {
    const { token, uid } = await getToken();
    const results = { token_ok: true, uid };

    const endpoints = [
      `/v1.0/iot-01/associated-users/devices`,
      `/v2.0/cloud/thing/device?page_size=50`,
      `/v1.0/users/${uid}/devices`,
      `/v1.0/devices`,
    ];

    for (const path of endpoints) {
      try {
        results[path] = await tuyaRequest('GET', path);
      } catch(e) {
        results[path] = { error: e.message };
      }
    }

    res.json(results);
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
      case 'turn_on':        commands = [{ code: 'switch_led', value: true }, { code: 'switch', value: true }, { code: 'switch_1', value: true }]; break;
      case 'turn_off':       commands = [{ code: 'switch_led', value: false }, { code: 'switch', value: false }, { code: 'switch_1', value: false }]; break;
      case 'set_brightness': commands = [{ code: 'bright_value_v2', value: Math.round(value * 10) }]; break;
      case 'lock':           commands = [{ code: 'open', value: false }]; break;
      case 'unlock':         commands = [{ code: 'open', value: true }]; break;
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
