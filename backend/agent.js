import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

export const agentRouter = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Tool definitions for Claude to call
const tools = [
  {
    name: 'get_all_devices',
    description: 'Fetch all smart home devices and their current status across all platforms (Tuya, Atomberg, Alexa)',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'control_device',
    description: 'Turn a device on/off, adjust brightness, fan speed, lock/unlock, or set volume',
    input_schema: {
      type: 'object',
      required: ['deviceId', 'platform', 'command'],
      properties: {
        deviceId: { type: 'string', description: 'The device ID' },
        platform: { type: 'string', enum: ['tuya', 'atomberg', 'alexa'], description: 'Which platform the device belongs to' },
        command: { type: 'string', enum: ['turn_on', 'turn_off', 'set_brightness', 'set_speed', 'lock', 'unlock', 'set_volume', 'set_mode'], description: 'Command to execute' },
        value: { type: 'number', description: 'Optional value: brightness 0-100, fan speed 1-5, volume 0-100' }
      }
    }
  },
  {
    name: 'run_scene',
    description: 'Run a predefined scene that controls multiple devices at once (e.g. Good Night, Movie Mode, Morning)',
    input_schema: {
      type: 'object',
      required: ['scene'],
      properties: {
        scene: { type: 'string', enum: ['good_night', 'good_morning', 'movie_mode', 'away_mode', 'sleep_mode', 'welcome_home'], description: 'Scene to activate' }
      }
    }
  },
  {
    name: 'create_rule',
    description: 'Create a new smart rule/automation',
    input_schema: {
      type: 'object',
      required: ['name', 'trigger', 'actions'],
      properties: {
        name: { type: 'string' },
        trigger: { type: 'string', description: 'e.g. "at 10:30 PM", "when motion detected", "at sunrise"' },
        actions: { type: 'array', items: { type: 'string' }, description: 'List of actions to perform' }
      }
    }
  },
  {
    name: 'play_music',
    description: 'Play music on Spotify by mood/playlist name (e.g. "chill", "focus", "morning energy"). Requires Spotify Premium.',
    input_schema: {
      type: 'object',
      required: ['mood'],
      properties: {
        mood: { type: 'string', description: 'Mood, genre, or playlist search term (e.g. "jazz dinner", "lofi study", "bollywood party")' }
      }
    }
  },
  {
    name: 'control_music',
    description: 'Pause, resume, skip, or adjust volume of currently playing Spotify music',
    input_schema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['pause', 'resume', 'next', 'previous', 'volume'], description: 'Music control action' },
        volume: { type: 'number', description: 'Volume 0-100, required when action is "volume"' }
      }
    }
  },
  {
    name: 'get_music_state',
    description: 'Check what is currently playing on Spotify and on which device',
    input_schema: { type: 'object', properties: {} }
  }
];

// Tool execution
async function executeTool(toolName, toolInput, baseUrl) {
  switch (toolName) {
    case 'get_all_devices': {
      const r = await fetch(`${baseUrl}/api/devices`);
      return await r.json();
    }
    case 'control_device': {
      const r = await fetch(`${baseUrl}/api/control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toolInput)
      });
      return await r.json();
    }
    case 'run_scene': {
      const r = await fetch(`${baseUrl}/api/tuya/scene`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: toolInput.scene })
      });
      return await r.json();
    }
    case 'create_rule': {
      return { success: true, message: `Rule "${toolInput.name}" created`, rule: toolInput };
    }
    case 'play_music': {
      const r = await fetch(`${baseUrl}/api/spotify/mood`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood: toolInput.mood })
      });
      return await r.json();
    }
    case 'control_music': {
      const action = toolInput.action;
      if (action === 'volume') {
        const r = await fetch(`${baseUrl}/api/spotify/volume`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: toolInput.volume })
        });
        return await r.json();
      }
      const pathMap = { pause: '/api/spotify/pause', resume: '/api/spotify/play', next: '/api/spotify/next', previous: '/api/spotify/previous' };
      const r = await fetch(`${baseUrl}${pathMap[action]}`, { method: 'POST' });
      return await r.json();
    }
    case 'get_music_state': {
      const r = await fetch(`${baseUrl}/api/spotify/state`);
      return await r.json();
    }
    default:
      return { error: 'Unknown tool' };
  }
}

// Agentic loop
agentRouter.post('/chat', async (req, res) => {
  const { message, history = [] } = req.body;
  const baseUrl = `http://localhost:${process.env.PORT || 3001}`;

  const messages = [
    ...history,
    { role: 'user', content: message }
  ];

  const systemPrompt = `You are HomeOS, an intelligent home automation agent for Smit's home in Mumbai.
You control devices across three platforms:
- Tuya/Smart Life: lights (living room, bedroom, kitchen, entrance), door locks (front & back), vacuum cleaner
- Atomberg: smart ceiling fans (bedroom, living room) with sleep/boost/auto modes and speed 1-5
- Amazon Alexa: smart speakers (living room, bedroom), plus any Alexa-compatible devices
- Spotify: Play music by mood, control playback, adjust volume — use for scenes like Movie Mode, Dinner, Morning

Your personality: efficient, warm, proactive. You speak like a smart assistant — confirm actions clearly.
Always call get_all_devices first if you're unsure of current device states.
For multi-device commands ("good night", "leaving home"), use run_scene.
When creating rules, confirm the trigger and actions back to the user before saving.
Keep responses short — 1-3 sentences max. Never use markdown bullets in responses.`;

  try {
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages
    });

    // Agentic loop — keep running until no more tool calls
    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(toolUse.name, toolUse.input, baseUrl);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages
      });
    }

    const textContent = response.content.find(b => b.type === 'text');
    res.json({
      reply: textContent?.text || 'Done.',
      updatedHistory: messages
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
