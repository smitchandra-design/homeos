import express from 'express';

export const atombergRouter = express.Router();

// Atomberg Partner API base URL
const BASE_URL = 'https://partner.atomberg.com/api/v1';
const API_KEY = process.env.ATOMBERG_API_KEY;
const API_SECRET = process.env.ATOMBERG_API_SECRET;

let atombergToken = null;
let tokenExpiry = 0;

async function getAtombergToken() {
  if (atombergToken && Date.now() < tokenExpiry) return atombergToken;
  const res = await fetch(`${BASE_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: API_KEY, apiSecret: API_SECRET })
  });
  const data = await res.json();
  if (data.token) {
    atombergToken = data.token;
    tokenExpiry = Date.now() + (data.expiresIn || 3600) * 1000;
    return atombergToken;
  }
  throw new Error('Atomberg auth failed: ' + JSON.stringify(data));
}

async function atombergRequest(method, path, body = null) {
  const token = await getAtombergToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// GET /api/atomberg/devices
atombergRouter.get('/devices', async (req, res) => {
  try {
    const data = await atombergRequest('GET', '/devices');
    const devices = (data.devices || []).map(d => ({
      id: d.deviceId,
      name: d.name,
      platform: 'atomberg',
      type: 'fan',
      online: d.isOnline,
      on: d.state?.power === 'ON',
      speed: d.state?.speed || 0,        // 1–5
      mode: d.state?.mode || 'normal',   // normal / sleep / boost / auto
      timer: d.state?.timer || 0,
      raw: d.state
    }));
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/atomberg/control
atombergRouter.post('/control', async (req, res) => {
  const { deviceId, command, value } = req.body;
  try {
    let payload = {};
    switch (command) {
      case 'turn_on':   payload = { power: 'ON' }; break;
      case 'turn_off':  payload = { power: 'OFF' }; break;
      case 'set_speed': payload = { speed: Math.min(5, Math.max(1, Math.round(value))) }; break;
      case 'set_mode':  payload = { mode: value }; break; // sleep | boost | auto | normal
      case 'set_timer': payload = { timer: value }; break; // minutes
      default: return res.status(400).json({ error: 'Unknown command for Atomberg fan' });
    }
    const data = await atombergRequest('POST', `/devices/${deviceId}/control`, payload);
    res.json({ success: true, result: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
