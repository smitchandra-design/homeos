import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { tuyaRouter } from './integrations/tuya.js';
import { atombergRouter } from './integrations/atomberg.js';
import { alexaRouter } from './integrations/alexa.js';
import { agentRouter } from './agent.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Temporary debug route
app.get('/debug-tuya', async (req, res) => {
  const homeId = process.env.TUYA_HOME_ID;
  res.json({ homeId, hasClientId: !!process.env.TUYA_CLIENT_ID, hasSecret: !!process.env.TUYA_CLIENT_SECRET });
});

app.get('/debug-homes', async (req, res) => {
  try {
    const crypto = await import('crypto');
    const CLIENT_ID = process.env.TUYA_CLIENT_ID;
    const CLIENT_SECRET = process.env.TUYA_CLIENT_SECRET;
    const BASE_URL = 'https://openapi.tuyain.com';
    
    // Get token
    const ts = Date.now().toString();
    const contentHash = crypto.default.createHash('sha256').update('').digest('hex');
    const stringToSign = ['GET', contentHash, '', '/v1.0/token?grant_type=1'].join('\n');
    const signStr = CLIENT_ID + ts + stringToSign;
    const sig = crypto.default.createHmac('sha256', CLIENT_SECRET).update(signStr).digest('hex').toUpperCase();
    
    const tokenRes = await fetch(`${BASE_URL}/v1.0/token?grant_type=1`, {
      headers: { 'client_id': CLIENT_ID, 'sign': sig, 'sign_method': 'HMAC-SHA256', 't': ts, 'lang': 'en' }
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.success) return res.json({ error: 'Token failed', detail: tokenData });
    
    const token = tokenData.result.access_token;
    const uid = tokenData.result.uid;

    // Get homes using uid
    const ts2 = Date.now().toString();
    const path = `/v1.0/users/${uid}/homes`;
    const sh2 = crypto.default.createHash('sha256').update('').digest('hex');
    const sts2 = ['GET', sh2, '', path].join('\n');
    const ss2 = CLIENT_ID + token + ts2 + sts2;
    const sig2 = crypto.default.createHmac('sha256', CLIENT_SECRET).update(ss2).digest('hex').toUpperCase();

    const homesRes = await fetch(`${BASE_URL}${path}`, {
      headers: { 'client_id': CLIENT_ID, 'access_token': token, 'sign': sig2, 'sign_method': 'HMAC-SHA256', 't': ts2, 'lang': 'en' }
    });
    const homesData = await homesRes.json();
    res.json({ uid, homes: homesData });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Device integrations
app.use('/api/tuya', tuyaRouter);
app.use('/api/atomberg', atombergRouter);
app.use('/api/alexa', alexaRouter);

// AI Agent
app.use('/api/agent', agentRouter);

// Unified devices endpoint — aggregates all platforms
app.get('/api/devices', async (req, res) => {
  try {
    const [tuyaRes, atombergRes, alexaRes] = await Promise.allSettled([
      fetch(`http://localhost:${process.env.PORT || 3001}/api/tuya/devices`).then(r => r.json()),
      fetch(`http://localhost:${process.env.PORT || 3001}/api/atomberg/devices`).then(r => r.json()),
      fetch(`http://localhost:${process.env.PORT || 3001}/api/alexa/devices`).then(r => r.json()),
    ]);

    const devices = [
      ...(tuyaRes.status === 'fulfilled' ? tuyaRes.value.devices || [] : []),
      ...(atombergRes.status === 'fulfilled' ? atombergRes.value.devices || [] : []),
      ...(alexaRes.status === 'fulfilled' ? alexaRes.value.devices || [] : []),
    ];

    res.json({ devices, total: devices.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unified control endpoint
app.post('/api/control', async (req, res) => {
  const { deviceId, platform, command, value } = req.body;
  try {
    let result;
    if (platform === 'tuya') {
      result = await fetch(`http://localhost:${process.env.PORT || 3001}/api/tuya/control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, command, value })
      }).then(r => r.json());
    } else if (platform === 'atomberg') {
      result = await fetch(`http://localhost:${process.env.PORT || 3001}/api/atomberg/control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, command, value })
      }).then(r => r.json());
    } else if (platform === 'alexa') {
      result = await fetch(`http://localhost:${process.env.PORT || 3001}/api/alexa/control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, command, value })
      }).then(r => r.json());
    } else {
      return res.status(400).json({ error: 'Unknown platform' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`HomeOS backend running on port ${PORT}`));
