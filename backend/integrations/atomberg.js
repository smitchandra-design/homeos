import express from 'express';

export const atombergRouter = express.Router();

const BASE_URL = 'https://api.developer.atomberg-iot.com';
const API_KEY = process.env.ATOMBERG_API_KEY;
const REFRESH_TOKEN = process.env.ATOMBERG_REFRESH_TOKEN;

let accessToken = null;
let accessTokenExpiry = 0;

// Step 1: get access token using api_key + refresh_token
async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiry) return accessToken;

  const res = await fetch(`${BASE_URL}/v1/get_access_token`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${REFRESH_TOKEN}`,
      'x-api-key': API_KEY
    }
  });

  const data = await res.json();
  if (data.status === 'success' && data.message?.access_token) {
    accessToken = data.message.access_token;
    // Access tokens typically expire in 1 hour
    accessTokenExpiry = Date.now() + 55 * 60 * 1000;
    return accessToken;
  }
  throw new Error('Atomberg auth failed: ' + JSON.stringify(data));
}

async function atombergRequest(method, path, body = null) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// GET /api/atomberg/devices
atombergRouter.get('/devices', async (req, res) => {
  try {
    const data = await atombergRequest('GET', '/v1/get_device_list');
    const list = data.message?.device_list || data.message || [];
    const devices = list.map(d => ({
      id: d.device_id,
      name: d.name || d.device_name || 'Atomberg Fan',
      platform: 'atomberg',
      type: 'fan',
      online: d.is_online ?? true,
      on: d.state?.power === 1 || d.state?.power === 'ON' || false,
      speed: d.state?.speed || 0,
      mode: d.state?.sleep_mode ? 'sleep' : 'normal',
      raw: d.state
    }));
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug: see raw Atomberg API response
atombergRouter.get('/debug', async (req, res) => {
  try {
    const token = await getAccessToken();
    const data = await atombergRequest('GET', '/v1/get_device_list');
    res.json({ token_ok: true, raw: data });
  } catch (err) {
    res.status(500).json({ token_ok: false, error: err.message });
  }
});

// POST /api/atomberg/control
atombergRouter.post('/control', async (req, res) => {
  const { deviceId, command, value } = req.body;
  try {
    let params = { device_id: deviceId };
    switch (command) {
      case 'turn_on':   params.power = 1; break;
      case 'turn_off':  params.power = 0; break;
      case 'set_speed': params.speed = Math.min(5, Math.max(1, Math.round(value))); break;
      case 'set_mode':  params.sleep_mode = value === 'sleep' ? 1 : 0; break;
      case 'set_timer': params.timer = value; break;
      default: return res.status(400).json({ error: 'Unknown command' });
    }
    const data = await atombergRequest('POST', '/v1/control', params);
    res.json({ success: true, result: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
