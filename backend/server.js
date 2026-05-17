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
