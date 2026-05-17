import express from 'express';

export const atombergRouter = express.Router();

const BASE_URL = 'https://api.developer.atomberg-iot.com';
const API_KEY = process.env.ATOMBERG_API_KEY;
const REFRESH_TOKEN = process.env.ATOMBERG_REFRESH_TOKEN;

let accessToken = null;
let accessTokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiry) return accessToken;

  const res = await fetch(`${BASE_URL}/v1/get_access_token`, {
    method: 'GET',
    headers: {
      'X-API-Key': API_KEY,
      'Authorization': `Bearer ${REFRESH_TOKEN}`
    }
  });

  const data = await res.json();
  if (data.status === 'Success' && data.message?.access_token) {
    accessToken = data.message.access_token;
    accessTokenExpiry = Date.now() + 55 * 60 * 1000; // 55 min
    return accessToken;
  }
  throw new Error('Atomberg auth failed: ' + JSON.stringify(data));
}

async function atombergRequest(method, path, body = null) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'X-API-Key': API_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// GET /api/atomberg/debug
atombergRouter.get('/debug', async (req, res) => {
  try {
    const token = await getAccessToken();
    const devices = await atombergRequest('GET', '/v1/get_list_of_devices');
    const states = await atombergRequest('GET', '/v1/get_device_state?device_id=all');
    res.json({ token_ok: true, devices, states });
  } catch (err) {
    res.status(500).json({ token_ok: false, error: err.message });
  }
});

// GET /api/atomberg/devices
atombergRouter.get('/devices', async (req, res) => {
  try {
    const devicesData = await atombergRequest('GET', '/v1/get_list_of_devices');
    const statesData = await atombergRequest('GET', '/v1/get_device_state?device_id=all');

    if (devicesData.status !== 'Success') {
      return res.status(500).json({ error: 'Failed to fetch devices', detail: devicesData });
    }

    const deviceList = devicesData.message?.devices_list || [];
    const stateList = statesData.message?.device_state || [];

    const devices = deviceList.map(d => {
      const state = stateList.find(s => s.device_id === d.device_id) || {};
      return {
        id: d.device_id,
        name: d.name || d.device_name || 'Atomberg Fan',
        platform: 'atomberg',
        type: 'fan',
        online: state.is_online ?? false,
        on: state.power === 1 || state.power === true,
        speed: state.last_recorded_speed || state.speed || 0,
        mode: state.sleep_mode ? 'sleep' : 'normal',
        raw: state
      };
    });

    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/atomberg/control
atombergRouter.post('/control', async (req, res) => {
  const { deviceId, command, value } = req.body;
  try {
    let cmd = {};
    switch (command) {
      case 'turn_on':   cmd = { power: 1 }; break;
      case 'turn_off':  cmd = { power: 0 }; break;
      case 'set_speed': cmd = { speed: Math.min(5, Math.max(1, Math.round(value))) }; break;
      case 'set_mode':  cmd = { sleep_mode: value === 'sleep' ? 1 : 0 }; break;
      case 'set_timer': cmd = { timer: value }; break;
      default: return res.status(400).json({ error: 'Unknown command' });
    }
    const data = await atombergRequest('POST', '/v1/send_command', {
      device_id: deviceId,
      command: cmd
    });
    res.json({ success: data.status === 'Success', result: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
