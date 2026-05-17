# HomeOS — Complete Setup Guide
### Your AI Smart Home Agent · Tuya + Atomberg + Alexa + Claude

---

## What you're setting up

| Component | Purpose | Where it runs |
|---|---|---|
| **Backend API** | Talks to all your device platforms | Render (free) |
| **Frontend PWA** | iPad app you'll use daily | Render (free static) |
| **AI Agent** | Claude understands your commands | Anthropic API |

Total cost: ~$0/month on free tier + Anthropic API (~₹0.50–2/day typical usage)

---

## Step 1 — Get your API credentials

### 1A · Tuya / Smart Life (Lights, Locks, Vacuum)

1. Go to **https://iot.tuya.com** and sign in with your Smart Life account
2. Click **Cloud → Development → Create Cloud Project**
   - Name: `HomeOS`
   - Industry: Smart Home
   - Development Method: Smart Home
   - Data Center: **India** (or wherever your devices are registered)
3. Note your **Client ID** and **Client Secret** from the project overview
4. Go to **Devices → Link Devices → Link Tuya App Account**
   - Scan the QR code with your Smart Life app
5. Go to **Home Management** to find your **Home ID**
6. Go to **Cloud → Automations → Tap-to-Run** in Smart Life app:
   - Create scenes: "Good Night", "Good Morning", "Movie Mode", "Away", "Welcome Home"
   - Each scene gets an ID you'll copy to your `.env`

### 1B · Atomberg (Smart Fans)

Atomberg has a Partner API — email **partners@atomberg.com** with:
- Subject: "Partner API Access Request"
- Your name, building address, device count
- Use case: personal home automation

They typically respond in 2–3 business days with your API key and secret.

**While waiting:** The app works in demo mode for fans — you can tap to simulate, and activate the real integration once you have keys.

### 1C · Amazon Alexa (Speakers)

1. Go to **https://developer.amazon.com** → sign in with your Amazon/Alexa account
2. Go to **Login with Amazon → Create a New Security Profile**
   - Name: `HomeOS`
   - Description: Personal home control app
3. Under the profile, click **Web Settings → Allowed Return URLs** and add:
   `https://homeos-backend.onrender.com/api/alexa/oauth/callback`
   *(You'll fill in the real Render URL after Step 3)*
4. Note your **Client ID** and **Client Secret**
5. After deploying (Step 3), visit:
   ```
   https://www.amazon.com/ap/oa?client_id=YOUR_CLIENT_ID&scope=alexa::smarthome&response_type=code&redirect_uri=YOUR_REDIRECT_URI
   ```
   → This starts OAuth → copies tokens automatically to your `.env`

### 1D · Anthropic API Key

1. Go to **https://console.anthropic.com**
2. Click **API Keys → Create Key**
3. Copy the key (starts with `sk-ant-...`)

---

## Step 2 — Deploy to Render

### 2A · Push code to GitHub

1. Create a new GitHub repo: `homeos`
2. Upload the entire `homeos/` folder
3. Commit and push

### 2B · Deploy on Render

1. Go to **https://render.com** → sign up free
2. Click **New → Blueprint** → connect your GitHub repo
3. Render reads `render.yaml` and creates two services automatically:
   - `homeos-backend` (Node API)
   - `homeos-frontend` (Static PWA)

### 2C · Add environment variables

In Render dashboard → `homeos-backend` → **Environment**:

```
ANTHROPIC_API_KEY         = sk-ant-...
TUYA_CLIENT_ID            = (from iot.tuya.com)
TUYA_CLIENT_SECRET        = (from iot.tuya.com)
TUYA_HOME_ID              = (from iot.tuya.com → Home Management)
TUYA_SCENE_GOODNIGHT      = (scene ID from Smart Life)
TUYA_SCENE_MORNING        = (scene ID from Smart Life)
TUYA_SCENE_MOVIE          = (scene ID from Smart Life)
TUYA_SCENE_AWAY           = (scene ID from Smart Life)
TUYA_SCENE_WELCOME        = (scene ID from Smart Life)
ATOMBERG_API_KEY          = (from Atomberg — add later)
ATOMBERG_API_SECRET       = (from Atomberg — add later)
ALEXA_CLIENT_ID           = (from Amazon Developer)
ALEXA_CLIENT_SECRET       = (from Amazon Developer)
ALEXA_REDIRECT_URI        = https://homeos-backend.onrender.com/api/alexa/oauth/callback
```

4. Click **Save** → Render redeploys automatically (~2 min)

### 2D · Complete Alexa OAuth

Once backend is live, visit the authorization URL (from Step 1C) in your browser.
After you approve, the callback page shows your tokens — copy them to Render env vars:
```
ALEXA_ACCESS_TOKEN   = (from callback page)
ALEXA_REFRESH_TOKEN  = (from callback page)
ALEXA_TOKEN_EXPIRY   = (from callback page)
```

---

## Step 3 — Connect the frontend to your backend

1. Open your deployed frontend: `https://homeos-frontend.onrender.com`
2. Open browser console and run:
   ```javascript
   localStorage.setItem('homeos_backend', 'https://homeos-backend.onrender.com')
   location.reload()
   ```
3. The status indicator turns 🟢 green and your real devices load

---

## Step 4 — Install on iPad as an app

1. Open **Safari** on your iPad (must be Safari — Chrome won't allow PWA install)
2. Go to: `https://homeos-frontend.onrender.com`
3. Tap the **Share button** (box with arrow) at the top
4. Tap **"Add to Home Screen"**
5. Name it `HomeOS` → tap **Add**
6. The app now appears on your home screen and opens fullscreen — no browser chrome

---

## Step 5 — Test your setup

Open the app and try these voice/text commands:

| Command | What happens |
|---|---|
| "Turn off living room light" | Sends Tuya command, light goes off |
| "Set bedroom fan to speed 2" | Sends Atomberg command |
| "Lock all doors" | Sends Tuya lock commands |
| "Good night mode" | Triggers Tuya scene — all devices configured |
| "What devices are on?" | Agent fetches live state and replies |
| "Create a rule: turn on kitchen light at 6:30 AM" | Agent saves a new automation |

---

## Smart Rules you can set up in Smart Life app

These run reliably even if your phone/backend is offline:

| Rule | Trigger | Action |
|---|---|---|
| Morning | 6:30 AM | Turn on kitchen light |
| Night | 11:00 PM | Lock all doors + turn off lights |
| Away | All family leaves geofence | Turn off all devices |
| Welcome | Any family member arrives | Entrance light + fan on |
| Motion | Entrance motion sensor | Entrance light on for 5 min |

---

## Troubleshooting

**Devices not showing:** Check Tuya credentials and that your Smart Life devices are linked in the cloud project (iot.tuya.com → Link App Account).

**Agent not responding:** Verify `ANTHROPIC_API_KEY` in Render env vars. Check Render logs.

**Alexa devices missing:** Complete the OAuth flow — without tokens, Alexa API returns 401.

**Atomberg fans offline:** Email partners@atomberg.com — the app runs in demo mode until keys arrive.

**Render sleeping:** Free Render services sleep after 15 min of inactivity. Add a free uptime monitor at **https://uptimerobot.com** to ping `/health` every 5 min.

---

## Your backend is live at:
```
https://homeos-backend.onrender.com/health      → Check status
https://homeos-backend.onrender.com/api/devices → All devices
https://homeos-backend.onrender.com/api/agent/chat → AI Agent
```
