import express from 'express';
import fs from 'fs';
import path from 'path';

export const rulesRouter = express.Router();

// File-based storage (survives restarts on Render persistent disk; in-memory on free tier)
const RULES_FILE = process.env.RULES_FILE || '/tmp/homeos-rules.json';

function loadRules() {
  try {
    if (fs.existsSync(RULES_FILE)) {
      return JSON.parse(fs.readFileSync(RULES_FILE, 'utf-8'));
    }
  } catch(e) { console.warn('Failed to load rules:', e.message); }
  return [];
}

function saveRules(rules) {
  try {
    fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
  } catch(e) { console.warn('Failed to save rules:', e.message); }
}

let rules = loadRules();
let nextId = rules.length ? Math.max(...rules.map(r => r.id)) + 1 : 1;

// ─── Public API ─────────────────────────────────────

// List all rules
rulesRouter.get('/', (req, res) => {
  res.json({ rules });
});

// Create rule
rulesRouter.post('/', (req, res) => {
  const { name, trigger, when, action, enabled = true } = req.body;
  if (!name || !trigger || !action) {
    return res.status(400).json({ error: 'name, trigger, action are required' });
  }
  const rule = {
    id: nextId++,
    name, trigger, when, action,
    enabled,
    created: Date.now(),
    lastRun: null
  };
  rules.push(rule);
  saveRules(rules);
  res.json({ success: true, rule });
});

// Update rule (toggle enabled, etc.)
rulesRouter.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const rule = rules.find(r => r.id === id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  Object.assign(rule, req.body, { id });
  saveRules(rules);
  res.json({ success: true, rule });
});

// Delete rule
rulesRouter.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const before = rules.length;
  rules = rules.filter(r => r.id !== id);
  if (rules.length === before) return res.status(404).json({ error: 'Rule not found' });
  saveRules(rules);
  res.json({ success: true });
});

// Manually trigger a rule
rulesRouter.post('/:id/run', async (req, res) => {
  const id = parseInt(req.params.id);
  const rule = rules.find(r => r.id === id);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  await executeRule(rule, req.app);
  res.json({ success: true, ranAt: rule.lastRun });
});

// ─── Rule Execution ─────────────────────────────────

async function executeRule(rule, app) {
  const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
  rule.lastRun = Date.now();
  saveRules(rules);

  // Send action to agent for interpretation + execution
  try {
    await fetch(`${baseUrl}/api/agent/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: rule.action, history: [] })
    });
    console.log(`✓ Rule "${rule.name}" executed: ${rule.action}`);
  } catch(e) {
    console.error(`✗ Rule "${rule.name}" failed:`, e.message);
  }
}

// ─── Scheduler ──────────────────────────────────────
// Runs every minute, checks for time-based rules that should fire

function startScheduler(app) {
  setInterval(async () => {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (rule.trigger !== 'time') continue;

      // Parse "when" — accept "06:30", "6:30 AM", "10:30 PM"
      const ruleTime = parseTime(rule.when);
      if (!ruleTime) continue;

      if (ruleTime === currentTime) {
        // Avoid double-execution within same minute
        if (rule.lastRun && Date.now() - rule.lastRun < 60000) continue;
        await executeRule(rule, app);
      }
    }
  }, 30000); // Check every 30 seconds
  console.log('⏰ Rules scheduler started');
}

function parseTime(str) {
  if (!str) return null;
  str = str.trim().toUpperCase();

  // Match formats: "06:30", "6:30 AM", "10:30PM"
  const m = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!m) return null;

  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  const ampm = m[3];

  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;

  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}

// Start the scheduler when this module loads
setTimeout(() => startScheduler(), 5000);
