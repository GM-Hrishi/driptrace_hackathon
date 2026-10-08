# DripTrace Companion App - Handoff Document

This document contains the entire state and source code of the DripTrace Companion Android app. You can copy-paste this document into an LLM (like Claude) to continue developing the app.

## Project Context
- **Architecture**: A native Android shell containing a `WebView`. The entire UI, state management, and network fetching logic (Modes A and B) are handled via HTML/JS/CSS in a local asset file (`index.html`).
- **Native Bridge**: A `WebAppInterface` in `MainActivity.java` provides JS access to native Android features: `triggerAlert()` (Notifications), `triggerVibration()`, `saveSetting()`, and `getSetting()` (SharedPreferences).
- **Recent Fixes Implemented**:
  - Exponential backoff in JS polling loop.
  - Native lifecycle hooks (`window.onAppPause` / `window.onAppResume`) to pause polling when backgrounded.
  - Settings persistence wired up to SharedPreferences via the Native Bridge.
  - JSON `.json` endpoints for Firebase Mode A.

---

## 1. `app/src/main/assets/index.html`
This is the core of the app containing all UI and logic.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<title>DripTrace Companion</title>
<style>
@font-face { font-family: 'Plus Jakarta Sans'; src: url('fonts/PlusJakartaSans-Regular.ttf') format('truetype'); font-weight: 400; }
@font-face { font-family: 'Plus Jakarta Sans'; src: url('fonts/PlusJakartaSans-Bold.ttf') format('truetype'); font-weight: 700; }
@font-face { font-family: 'JetBrains Mono'; src: url('fonts/JetBrainsMono-Regular.ttf') format('truetype'); font-weight: 400; }
@font-face { font-family: 'JetBrains Mono'; src: url('fonts/JetBrainsMono-Bold.ttf') format('truetype'); font-weight: 700; }
:root {
  --bg: #070d14;
  --surface: #0e1724;
  --surface-bright: #142132;
  --border: #1b2b3f;
  --border-light: #253952;
  --accent: #00d4ff;
  --accent-glow: rgba(0, 212, 255, 0.25);
  --green: #10e898;
  --green-glow: rgba(16, 232, 152, 0.2);
  --amber: #f5b027;
  --amber-glow: rgba(245, 176, 39, 0.2);
  --red: #ff3b69;
  --red-glow: rgba(255, 59, 105, 0.25);
  --text: #e2f1fc;
  --text-muted: #5f7a96;
  --text-dim: #3d5268;
}
* { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color: transparent; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
  min-height: 100vh;
  padding-bottom: 30px;
  user-select: none;
  background-image: radial-gradient(rgba(0, 212, 255, 0.04) 1px, transparent 1px);
  background-size: 28px 28px;
}
.mono { font-family: 'JetBrains Mono', monospace; }
.app-container { max-width: 540px; margin: 0 auto; padding: 16px 14px; }

/* HEADER */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px 16px;
}
.logo-block { display: flex; align-items: center; gap: 10px; }
.logo-icon {
  width: 42px; height: 42px; border-radius: 12px;
  background: linear-gradient(135deg, #00d4ff, #0077aa);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 20px var(--accent-glow);
}
.logo-icon svg { width: 22px; height: 22px; fill: #041019; }
.brand-name { font-size: 1.25rem; font-weight: 800; letter-spacing: -0.4px; }
.brand-name span { color: var(--accent); }
.brand-tag { font-size: 0.62rem; color: var(--text-muted); font-weight: 600; letter-spacing: 0.6px; }

.header-actions { display: flex; align-items: center; gap: 8px; }
.btn-icon {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  width: 38px; height: 38px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.2s;
}
.btn-icon:active { transform: scale(0.92); background: var(--surface-bright); }

/* STATUS BAR */
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 14px;
  margin-bottom: 12px;
  font-size: 0.72rem;
}
.mode-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  font-size: 0.68rem; font-weight: 700;
  background: rgba(0, 212, 255, 0.12);
  color: var(--accent); border: 1px solid rgba(0, 212, 255, 0.25);
}
.mode-badge.local {
  background: rgba(16, 232, 152, 0.12);
  color: var(--green); border-color: rgba(16, 232, 152, 0.25);
}
.conn-indicator { display: flex; align-items: center; gap: 6px; }
.conn-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--green); box-shadow: 0 0 8px var(--green);
  animation: pulse 2s infinite;
}
.conn-dot.reconnecting { background: var(--amber); box-shadow: 0 0 8px var(--amber); }
.conn-dot.offline { background: var(--red); box-shadow: 0 0 8px var(--red); animation: none; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* BED SWITCHER */
.bed-switcher {
  display: flex; gap: 6px; overflow-x: auto;
  margin-bottom: 14px; padding-bottom: 2px;
}
.bed-pill {
  flex: 1; min-width: 80px; text-align: center;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 7px 6px;
  font-size: 0.75rem; font-weight: 700; color: var(--text-muted);
  cursor: pointer; transition: all 0.2s;
}
.bed-pill.active {
  background: var(--surface-bright);
  border-color: var(--accent); color: var(--text);
  box-shadow: 0 0 14px var(--accent-glow);
}

/* ALERT BANNER */
.alert-banner {
  display: none;
  border-radius: 14px; padding: 12px 14px;
  margin-bottom: 14px;
  align-items: center; justify-content: space-between;
  animation: slideDown 0.3s ease;
}
@keyframes slideDown { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.alert-banner.warning {
  display: flex; background: rgba(245, 176, 39, 0.12);
  border: 1px solid var(--amber); color: #ffd680;
  box-shadow: 0 0 20px var(--amber-glow);
}
.alert-banner.critical {
  display: flex; background: rgba(255, 59, 105, 0.15);
  border: 1px solid var(--red); color: #ff94ab;
  box-shadow: 0 0 24px var(--red-glow);
  animation: shakeAlert 0.4s ease, pulseAlert 1.5s infinite;
}
@keyframes pulseAlert { 0%, 100% { border-color: var(--red); } 50% { border-color: #ff85a1; } }
.alert-content { display: flex; align-items: center; gap: 10px; font-size: 0.8rem; }
.alert-btn {
  background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25);
  border-radius: 8px; padding: 6px 12px; color: #fff;
  font-size: 0.72rem; font-weight: 700; cursor: pointer;
}

/* GAUGES GRID */
.grid-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px; padding: 16px;
  position: relative; overflow: hidden;
  transition: border-color 0.2s;
}
.card:hover { border-color: var(--border-light); }
.card-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 10px;
}
.card-title {
  font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 1px; color: var(--text-muted);
}
.card-badge {
  font-size: 0.65rem; font-weight: 700; padding: 2px 8px;
  border-radius: 999px;
}
.badge-good { background: rgba(16, 232, 152, 0.14); color: var(--green); }
.badge-warn { background: rgba(245, 176, 39, 0.14); color: var(--amber); }
.badge-bad { background: rgba(255, 59, 105, 0.18); color: var(--red); }

/* Flow Rate Card */
.flow-readout { text-align: center; padding: 8px 0; }
.flow-val {
  font-size: 2.8rem; font-weight: 800; line-height: 1;
  color: var(--accent); text-shadow: 0 0 20px var(--accent-glow);
}
.flow-unit { font-size: 0.82rem; color: var(--text-muted); margin-top: 4px; }
.flow-sub {
  margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border);
  display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-muted);
}

/* Bottle Level Card */
.bottle-container { display: flex; align-items: center; justify-content: space-around; padding: 6px 0; }
.bottle-graphic {
  width: 56px; height: 110px; border: 2.5px solid var(--border-light);
  border-radius: 12px 12px 18px 18px; position: relative;
  background: var(--surface-bright); overflow: hidden;
}
.bottle-cap {
  position: absolute; top: -6px; left: 50%; transform: translateX(-50%);
  width: 20px; height: 6px; background: var(--text-muted); border-radius: 3px;
}
.bottle-fluid {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: linear-gradient(180deg, var(--accent), #0077aa);
  transition: height 0.4s ease, background 0.4s ease;
}
.bottle-fluid.warn { background: linear-gradient(180deg, var(--amber), #aa7700); }
.bottle-fluid.empty { background: linear-gradient(180deg, var(--red), #aa0022); }
.bottle-scale {
  position: absolute; top: 0; bottom: 0; left: 0; right: 0;
  display: flex; flex-direction: column; justify-content: space-between;
  padding: 10px 0; opacity: 0.2;
}
.bottle-tick { height: 1px; background: #fff; width: 30%; margin-left: auto; }

.bottle-stats { text-align: right; }
.bottle-pct { font-size: 1.8rem; font-weight: 800; color: var(--text); line-height: 1; }
.bottle-wt { font-size: 0.75rem; color: var(--text-muted); margin-top: 6px; font-weight: 600; }

/* Vitals & Metadata */
.vitals-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
.vital-box {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 12px; text-align: center;
}
.vital-box .icon { fill: var(--text-muted); width: 18px; height: 18px; margin-bottom: 4px; }
.vital-val { font-size: 1.2rem; font-weight: 700; color: var(--text); margin-bottom: 2px; }
.vital-lbl { font-size: 0.6rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }

/* CONTROLS */
.controls-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 18px; padding: 16px;
}
.slider-container { margin: 20px 0; position: relative; }
.slider {
  -webkit-appearance: none; width: 100%; height: 6px;
  background: var(--surface-bright); border-radius: 3px; outline: none;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 28px; height: 28px;
  background: var(--bg); border: 2.5px solid var(--accent);
  border-radius: 50%; cursor: pointer; box-shadow: 0 0 10px var(--accent-glow);
}
.slider-val-display {
  position: absolute; top: -30px; left: 50%; transform: translateX(-50%);
  font-size: 1.1rem; font-weight: 800; color: var(--accent);
}
.presets { display: flex; gap: 8px; margin-bottom: 16px; }
.btn-preset {
  flex: 1; background: var(--surface-bright); border: 1px solid var(--border-light);
  color: var(--text); padding: 8px 0; border-radius: 10px;
  font-size: 0.75rem; font-weight: 700; cursor: pointer; transition: 0.2s;
}
.btn-preset:active { background: var(--accent); color: #000; border-color: var(--accent); }
.btn-primary {
  width: 100%; background: var(--accent); color: #000;
  border: none; border-radius: 12px; padding: 14px;
  font-size: 0.85rem; font-weight: 800; text-transform: uppercase;
  letter-spacing: 1px; cursor: pointer; box-shadow: 0 0 15px var(--accent-glow);
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.btn-primary:active { transform: scale(0.98); }
.btn-secondary {
  width: 100%; background: transparent; color: var(--text);
  border: 1px solid var(--border-light); border-radius: 12px; padding: 12px;
  font-size: 0.75rem; font-weight: 700; cursor: pointer; margin-top: 10px;
}

/* MODALS */
.modal-backdrop {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(4, 10, 16, 0.85); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none; transition: 0.3s; z-index: 100;
}
.modal-backdrop.show { opacity: 1; pointer-events: auto; }
.modal-card {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 20px; width: 90%; max-width: 400px;
  padding: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);
  transform: translateY(20px); transition: 0.3s;
}
.show .modal-card { transform: translateY(0); }
.modal-title { font-size: 1.1rem; font-weight: 800; margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
.form-grp { margin-bottom: 14px; }
.form-label { font-size: 0.68rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px; display: block; }
.form-input {
  width: 100%; background: var(--surface-bright); border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 12px; color: var(--text);
  font-size: 0.82rem; font-family: 'JetBrains Mono', monospace; outline: none;
}
.form-input:focus { border-color: var(--accent); }
.modal-close { margin-top: 18px; width: 100%; }
</style>
</head>
<body>

<div class="app-container">

  <!-- HEADER -->
  <header class="header">
    <div class="logo-block">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24"><path d="M12,2C12,2 5,10 5,15C5,18.86 8.13,22 12,22C15.87,22 19,18.86 19,15C19,10 12,2 12,2M12,20C9.24,20 7,17.76 7,15C7,11.2 10.82,5.55 12,3.87C13.18,5.55 17,11.2 17,15C17,17.76 14.76,20 12,20M12,18A3,3 0 0,0 15,15A3,3 0 0,0 12,12A3,3 0 0,0 9,15A3,3 0 0,0 12,18Z"/></svg>
      </div>
      <div>
        <div class="brand-name">Drip<span>Trace</span></div>
        <div class="brand-tag">HACKATHON BUILD</div>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn-icon" id="toggleSimBtn" onclick="toggleSimulator(!state.isSimulator)">
        <svg style="width:20px;height:20px;fill:currentColor" viewBox="0 0 24 24"><path d="M17.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,9A1.5,1.5 0 0,1 19,10.5A1.5,1.5 0 0,1 17.5,12M14.5,8A1.5,1.5 0 0,1 13,6.5A1.5,1.5 0 0,1 14.5,5A1.5,1.5 0 0,1 16,6.5A1.5,1.5 0 0,1 14.5,8M9.5,8A1.5,1.5 0 0,1 8,6.5A1.5,1.5 0 0,1 9.5,5A1.5,1.5 0 0,1 11,6.5A1.5,1.5 0 0,1 9.5,8M6.5,12A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,1 6.5,9A1.5,1.5 0 0,1 8,10.5A1.5,1.5 0 0,1 6.5,12M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A1.5,1.5 0 0,0 13.5,19.5C13.5,19.11 13.35,18.76 13.11,18.5C12.88,18.23 12.73,17.88 12.73,17.5A1.5,1.5 0 0,1 14.23,16H16A5,5 0 0,0 21,11C21,6.58 16.97,3 12,3Z"/></svg>
      </button>
      <button class="btn-icon" id="openSettingsBtn">
        <svg style="width:20px;height:20px;fill:currentColor" viewBox="0 0 24 24"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.98C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.98L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.98Z"/></svg>
      </button>
    </div>
  </header>

  <!-- STATUS BAR -->
  <div class="status-bar">
    <div class="mode-badge" id="modeBadge">MODE A  BACKEND</div>
    <div class="conn-indicator">
      <div class="conn-dot" id="connDot"></div>
      <span id="connStatusText">CONNECTED</span>
    </div>
  </div>

  <!-- BEDS -->
  <div class="bed-switcher">
    <div class="bed-pill active" onclick="selectBed('bed-01')">BED 01</div>
    <div class="bed-pill" onclick="selectBed('bed-02')">BED 02</div>
    <div class="bed-pill" onclick="selectBed('bed-03')">BED 03</div>
  </div>

  <!-- ALERT BANNER -->
  <div class="alert-banner" id="alertBanner">
    <div class="alert-content">
      <svg style="width:24px;height:24px;fill:currentColor" viewBox="0 0 24 24"><path d="M13,14H11V10H13M13,18H11V16H13M1,21H23L12,2L1,21Z"/></svg>
      <div>
        <div style="font-weight:800;letter-spacing:0.5px;" id="alertTitle">CRITICAL FLOW DEVIATION</div>
        <div style="font-size:0.7rem;margin-top:2px;opacity:0.9;" id="alertMessage">Flow rate 40% above prescribed. Check clamp!</div>
      </div>
    </div>
    <button class="alert-btn" onclick="sendAckAlert()">ACK</button>
  </div>

  <!-- MAIN DASHBOARD -->
  <div class="grid-2col">
    <!-- Flow Rate -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Flow Rate</span>
        <span class="card-badge badge-good mono" id="devBadge">+0%</span>
      </div>
      <div class="flow-readout">
        <div class="flow-val mono" id="flowRateVal">--.-</div>
        <div class="flow-unit">mL / hr</div>
      </div>
      <div class="flow-sub">
        <span>Target: <span id="targetRateText" class="mono" style="color:var(--text);font-weight:700;">--.-</span></span>
        <span id="flowState">Normal</span>
      </div>
    </div>

    <!-- Bottle Level -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Container</span>
        <span class="card-badge badge-good mono" id="bottleStatusBadge">ACTIVE</span>
      </div>
      <div class="bottle-container">
        <div class="bottle-graphic">
          <div class="bottle-cap"></div>
          <div class="bottle-scale">
            <div class="bottle-tick"></div><div class="bottle-tick"></div>
            <div class="bottle-tick"></div><div class="bottle-tick"></div>
          </div>
          <div class="bottle-fluid" id="bottleFluid" style="height: 60%"></div>
        </div>
        <div class="bottle-stats">
          <div class="bottle-pct mono" id="bottlePctVal">--%</div>
          <div class="bottle-wt mono" id="bottleWeightVal">-- g</div>
        </div>
      </div>
    </div>
  </div>

  <!-- VITALS -->
  <div class="vitals-grid">
    <div class="vital-box">
      <svg class="icon" viewBox="0 0 24 24"><path d="M12,21.35L10.55,20.03C5.4,15.36 2,12.27 2,8.5C2,5.41 4.42,3 7.5,3C9.24,3 10.91,3.81 12,5.08C13.09,3.81 14.76,3 16.5,3C19.58,3 22,5.41 22,8.5C22,12.27 18.6,15.36 13.45,20.03L12,21.35Z"/></svg>
      <div class="vital-val mono" id="hrVal">--</div>
      <div class="vital-lbl">HR (BPM)</div>
    </div>
    <div class="vital-box">
      <svg class="icon" viewBox="0 0 24 24"><path d="M12,2C12,2 5,10 5,15C5,18.86 8.13,22 12,22C15.87,22 19,18.86 19,15C19,10 12,2 12,2M12,20C9.24,20 7,17.76 7,15C7,11.2 10.82,5.55 12,3.87C13.18,5.55 17,11.2 17,15C17,17.76 14.76,20 12,20Z"/></svg>
      <div class="vital-val mono" id="spo2Val">--%</div>
      <div class="vital-lbl">SpO2</div>
    </div>
    <div class="vital-box">
      <svg class="icon" viewBox="0 0 24 24"><path d="M12,21L15.6,16.2C14.6,15.45 13.35,15 12,15C10.65,15 9.4,15.45 8.4,16.2L12,21M12,3C7.95,3 4.21,4.34 1.2,6.6L3,9C5.5,7.12 8.62,6 12,6C15.38,6 18.5,7.12 21,9L22.8,6.6C19.79,4.34 16.05,3 12,3M12,9C9.3,9 6.81,9.89 4.8,11.4L6.6,13.8C8.1,12.67 9.97,12 12,12C14.03,12 15.9,12.67 17.4,13.8L19.2,11.4C17.19,9.89 14.7,9 12,9Z"/></svg>
      <div class="vital-val mono" id="rssiVal">--</div>
      <div class="vital-lbl">WiFi dBm</div>
    </div>
  </div>

  <div style="text-align:center;font-size:0.6rem;color:var(--text-dim);margin-bottom:12px;" class="mono">LAST UPDATE: <span id="lastUpdated">--:--:--</span></div>

  <!-- CONTROL PANEL -->
  <div class="controls-card">
    <div class="card-title" style="margin-bottom:8px;">Set Target Flow Rate</div>
    <div class="slider-container">
      <div class="slider-val-display mono"><span id="sliderValDisplay">40.0</span> <span style="font-size:0.6rem;">mL/hr</span></div>
      <input type="range" class="slider" id="rateSlider" min="0" max="120" step="5" value="40" oninput="updateSliderVal(this.value)">
    </div>
    <div class="presets">
      <button class="btn-preset" onclick="setPreset(20)">20</button>
      <button class="btn-preset" onclick="setPreset(40)">40</button>
      <button class="btn-preset" onclick="setPreset(60)">60</button>
      <button class="btn-preset" onclick="setPreset(80)">80</button>
      <button class="btn-preset" onclick="setPreset(100)">100</button>
    </div>
    <button class="btn-primary" onclick="sendPrescribedRate()">APPLY TARGET RATE</button>
    <button class="btn-secondary" onclick="sendTareScale()">TARE SCALE (CALIBRATE TO 0G)</button>
  </div>

</div>

<!-- SETTINGS MODAL -->
<div class="modal-backdrop" id="settingsModal">
  <div class="modal-card">
    <div class="modal-title">DripTrace Settings</div>

    <div class="form-grp">
      <label class="form-label">Transport Mode</label>
      <select class="form-input" id="cfgMode" onchange="switchMode(this.value)">
        <option value="A">Mode A - Cloud Backend (HTTPS REST)</option>
        <option value="B">Mode B - Local ESP32 (Direct WiFi/LAN)</option>
      </select>
    </div>

    <div class="form-grp" id="grpModeA">
      <label class="form-label">Backend Base URL</label>
      <input type="text" class="form-input" id="cfgBackendUrl" value="https://driptrace-hackathon-default-rtdb.firebaseio.com">
      <label class="form-label" style="margin-top:10px;">Auth Token (Optional)</label>
      <input type="text" class="form-input" id="cfgAuthToken" placeholder="Leave blank if open">
    </div>

    <div class="form-grp" id="grpModeB" style="display: none;">
      <label class="form-label">ESP32 Local Endpoint</label>
      <input type="text" class="form-input" id="cfgLocalUrl" value="http://192.168.4.1">
      <div style="font-size: 0.65rem; color: var(--amber); margin-top: 6px; font-weight: 600;">
        ESP32 Hotspot: DripTrace-Demo / soldering26
      </div>
    </div>

    <div class="form-grp">
      <label class="form-label">Selected Device ID</label>
      <input type="text" class="form-input" id="cfgDeviceId" value="bed-01">
    </div>

    <div class="form-grp">
      <label class="form-label">Polling Refresh Rate (ms)</label>
      <input type="number" class="form-input" id="cfgPollInterval" value="1500">
    </div>

    <button class="btn-primary modal-close" onclick="saveSettings()">SAVE & CLOSE</button>
  </div>
</div>

<script>
const bridge = window.AndroidBridge || {
  getSetting: (k, d) => d,
  saveSetting: (k, v) => {},
  triggerVibration: () => {},
  triggerAlert: () => {}
};
const state = {
  mode: bridge.getSetting('cfgMode', 'A'),
  backendUrl: bridge.getSetting('cfgBackendUrl', 'https://driptrace-hackathon-default-rtdb.firebaseio.com'),
  authToken: bridge.getSetting('cfgAuthToken', ''),
  localUrl: bridge.getSetting('cfgLocalUrl', 'http://192.168.4.1'),
  deviceId: bridge.getSetting('cfgDeviceId', 'bed-01'),
  pollInterval: parseInt(bridge.getSetting('cfgPollInterval', '1500'), 10),
  currentPollInterval: parseInt(bridge.getSetting('cfgPollInterval', '1500'), 10),
  isSimulator: bridge.getSetting('isSimulator', 'false') === 'true',
  connected: true,
  currentRate: 42.3,
  prescribedRate: 40.0,
  bottlePct: 61.7,
  bottleGrams: 185.2,
  bottleEmpty: false,
  heartRate: 78,
  spo2: 97,
  rssi: -58,
  timer: null
};

// UI Elements
const modeBadge = document.getElementById('modeBadge');
const connDot = document.getElementById('connDot');
const connStatusText = document.getElementById('connStatusText');
const flowRateVal = document.getElementById('flowRateVal');
const targetRateText = document.getElementById('targetRateText');
const flowState = document.getElementById('flowState');
const devBadge = document.getElementById('devBadge');
const bottlePctVal = document.getElementById('bottlePctVal');
const bottleWeightVal = document.getElementById('bottleWeightVal');
const bottleFluid = document.getElementById('bottleFluid');
const bottleStatusBadge = document.getElementById('bottleStatusBadge');
const hrVal = document.getElementById('hrVal');
const spo2Val = document.getElementById('spo2Val');
const rssiVal = document.getElementById('rssiVal');
const lastUpdated = document.getElementById('lastUpdated');
const alertBanner = document.getElementById('alertBanner');
const alertTitle = document.getElementById('alertTitle');
const alertMessage = document.getElementById('alertMessage');
const rateSlider = document.getElementById('rateSlider');
const sliderValDisplay = document.getElementById('sliderValDisplay');
const settingsModal = document.getElementById('settingsModal');

function updateUI(data) {
  const safe = (v) => (v === undefined || v === null) ? '--' : v;
  const safeFixed = (v, d) => (v === undefined || v === null || isNaN(v)) ? '--' : Number(v).toFixed(d);
  const safeRound = (v) => (v === undefined || v === null || isNaN(v)) ? '--' : Math.round(v);
  
  flowRateVal.textContent = safeFixed(data.flowRateMlPerHr, 1);
  targetRateText.textContent = safeFixed(data.prescribedRateMlPerHr, 1);

  // Deviation
  const dev = data.deviationPercent;
  const sign = dev >= 0 ? '+' : '';
  devBadge.textContent = isNaN(dev) ? '--' : `${sign}${dev}%`;
  
  const devAbs = Math.abs(dev);
  if (isNaN(devAbs) || devAbs <= 10) {
    devBadge.className = 'card-badge badge-good mono';
    flowState.textContent = 'Normal';
  } else if (devAbs <= 25) {
    devBadge.className = 'card-badge badge-warn mono';
    flowState.textContent = 'Deviation';
  } else {
    devBadge.className = 'card-badge badge-bad mono';
    flowState.textContent = 'Critical';
  }

  // Bottle Level
  bottlePctVal.textContent = isNaN(data.bottleLevelPercent) ? '--%' : `${safeRound(data.bottleLevelPercent)}%`;
  bottleWeightVal.textContent = isNaN(data.bottleWeightGrams) ? '-- g' : `${safeFixed(data.bottleWeightGrams, 1)} g`;
  bottleFluid.style.height = isNaN(data.bottleLevelPercent) ? '4%' : `${Math.max(4, data.bottleLevelPercent)}%`;

  if (data.bottleEmpty || data.bottleLevelPercent <= 10) {
    bottleFluid.className = 'bottle-fluid empty';
    bottleStatusBadge.className = 'card-badge badge-bad mono';
    bottleStatusBadge.textContent = 'EMPTY';
  } else if (data.bottleLevelPercent <= 30) {
    bottleFluid.className = 'bottle-fluid warn';
    bottleStatusBadge.className = 'card-badge badge-warn mono';
    bottleStatusBadge.textContent = 'LOW';
  } else {
    bottleFluid.className = 'bottle-fluid';
    bottleStatusBadge.className = 'card-badge badge-good mono';
    bottleStatusBadge.textContent = 'ACTIVE';
  }

  // Vitals
  hrVal.textContent = safe(data.heartRateBpm);
  spo2Val.textContent = isNaN(data.spo2Percent) ? '--%' : `${data.spo2Percent}%`;
  rssiVal.textContent = safe(data.wifiRssi);
  lastUpdated.textContent = new Date().toLocaleTimeString();

  // Alerts
  if (data.alertActive && data.alertSeverity !== 'none') {
    alertBanner.className = `alert-banner ${data.alertSeverity}`;
    if (data.alertSeverity === 'critical') {
      alertTitle.textContent = data.bottleEmpty ? 'CRITICAL: BOTTLE EMPTY' : 'CRITICAL FLOW DEVIATION';
      alertMessage.textContent = data.bottleEmpty ? 'IV infusion completed. Replace container immediately.' : `Flow rate abnormal (${dev}%). Check clamp!`;
      triggerNativeAlert('CRITICAL IV ALERT', alertMessage.textContent, 'critical');
    } else {
      alertTitle.textContent = 'FLOW RATE WARNING';
      alertMessage.textContent = `Flow deviation of ${dev}% detected.`;
      triggerNativeAlert('IV Flow Warning', alertMessage.textContent, 'warning');
    }
  } else {
    alertBanner.className = 'alert-banner';
  }
}

async function fetchTelemetry() {
  if (state.isSimulator) {
    runSimulatorTick();
    restartPolling(true);
    return;
  }

  const url = state.mode === 'A'
    ? `${state.backendUrl}/devices/${state.deviceId}/telemetry/latest.json`
    : `${state.localUrl}/telemetry`;

  try {
    const headers = { 'Accept': 'application/json' };
    if (state.mode === 'A' && state.authToken) headers['Authorization'] = `Bearer ${state.authToken}`;
    
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    
    let data;
    try { data = await res.json(); } catch(e) { throw new Error('JSON Parse failed'); }
    if (!data) throw new Error('Null data');
    
    setConnectionState(true);
    updateUI(data);
    restartPolling(true); // reset backoff
  } catch (err) {
    console.warn('Telemetry fetch error:', err);
    setConnectionState(false);
    state.currentPollInterval = Math.min(state.currentPollInterval * 2, 15000);
    restartPolling(false);
  }
}

function setConnectionState(online) {
  state.connected = online;
  if (online) {
    connDot.className = 'conn-dot';
    connStatusText.textContent = 'CONNECTED';
  } else {
    connDot.className = 'conn-dot offline';
    connStatusText.textContent = 'RECONNECTING...';
  }
}

// NATIVE ANDROID BRIDGE
let lastAlertTimestamp = 0;
function triggerNativeAlert(title, message, severity) {
  const now = Date.now();
  if (now - lastAlertTimestamp < 8000) return; // Debounce 8s
  lastAlertTimestamp = now;
  if (window.AndroidBridge && window.AndroidBridge.triggerAlert) {
    window.AndroidBridge.triggerAlert(title, message, severity);
  }
}

// COMMANDS (APP -> DEVICE)
async function sendCommand(cmdPayload) {
  if (state.isSimulator) {
    if (cmdPayload.command === 'setPrescribedRate') {
      state.prescribedRate = cmdPayload.value;
      targetRateText.textContent = cmdPayload.value.toFixed(1);
    } else if (cmdPayload.command === 'resetAlert') {
      state.alertActive = false;
      state.alertSeverity = 'none';
      alertBanner.className = 'alert-banner';
    } else if (cmdPayload.command === 'calibrateLoadCell') {
      state.bottleGrams = 250.0;
      state.bottlePct = 83.3;
      state.bottleEmpty = false;
    }
    if (window.AndroidBridge && window.AndroidBridge.triggerVibration) {
      window.AndroidBridge.triggerVibration(100);
    }
    return;
  }

  const url = state.mode === 'A'
    ? `${state.backendUrl}/devices/${state.deviceId}/commands.json`
    : `${state.localUrl}/command`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.mode === 'A' && state.authToken) headers['Authorization'] = `Bearer ${state.authToken}`;
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(cmdPayload)
    });
  } catch (e) {
    console.error('Command failed:', e);
  }
}

function updateSliderVal(v) { sliderValDisplay.textContent = v; }
function setPreset(v) { rateSlider.value = v; updateSliderVal(v); sendPrescribedRate(); }
function sendPrescribedRate() { sendCommand({ command: 'setPrescribedRate', value: parseFloat(rateSlider.value) }); }
function sendAckAlert() { sendCommand({ command: 'resetAlert' }); }
function sendTareScale() {
  if (confirm("Calibrate and tare IV bottle scale to 0g?")) {
    sendCommand({ command: 'calibrateLoadCell', tareWeightGrams: 0 });
  }
}

function selectBed(bedId) {
  state.deviceId = bedId;
  document.querySelectorAll('.bed-pill').forEach(el => {
    el.classList.toggle('active', el.textContent.trim().toLowerCase().replace(' ', '-') === bedId);
  });
  if (state.isSimulator) {
    state.bottleGrams = bedId === 'bed-01' ? 185.2 : (bedId === 'bed-02' ? 260.0 : 45.0);
    state.prescribedRate = bedId === 'bed-01' ? 40.0 : 50.0;
    rateSlider.value = state.prescribedRate;
    updateSliderVal(state.prescribedRate);
  }
}

function toggleSimulator(enabled) {
  state.isSimulator = enabled;
  if (!enabled) setConnectionState(false);
  else setConnectionState(true);
}

// SETTINGS MODAL
document.getElementById('openSettingsBtn').onclick = () => {
  document.getElementById('cfgAuthToken').value = state.authToken;
  document.getElementById('cfgMode').value = state.mode;
  document.getElementById('cfgBackendUrl').value = state.backendUrl;
  document.getElementById('cfgLocalUrl').value = state.localUrl;
  document.getElementById('cfgDeviceId').value = state.deviceId;
  document.getElementById('cfgPollInterval').value = state.pollInterval;
  switchMode(state.mode);
  settingsModal.classList.add('show');
};

function switchMode(m) {
  document.getElementById('grpModeA').style.display = m === 'A' ? 'block' : 'none';
  document.getElementById('grpModeB').style.display = m === 'B' ? 'block' : 'none';
}

function saveSettings() {
  state.mode = document.getElementById('cfgMode').value; bridge.saveSetting('cfgMode', state.mode);
  state.backendUrl = document.getElementById('cfgBackendUrl').value; bridge.saveSetting('cfgBackendUrl', state.backendUrl);
  state.authToken = document.getElementById('cfgAuthToken').value; bridge.saveSetting('cfgAuthToken', state.authToken);
  state.localUrl = document.getElementById('cfgLocalUrl').value; bridge.saveSetting('cfgLocalUrl', state.localUrl);
  state.deviceId = document.getElementById('cfgDeviceId').value; bridge.saveSetting('cfgDeviceId', state.deviceId);
  state.pollInterval = parseInt(document.getElementById('cfgPollInterval').value, 10) || 1500; bridge.saveSetting('cfgPollInterval', state.pollInterval.toString());
  bridge.saveSetting('isSimulator', state.isSimulator.toString());

  modeBadge.textContent = state.mode === 'A' ? 'MODE A - BACKEND' : 'MODE B - LOCAL';
  modeBadge.className = `mode-badge ${state.mode === 'B' ? 'local' : ''}`;

  settingsModal.classList.remove('show');
  restartPolling();
}

function restartPolling(reset = true) {
  if (state.timer) clearTimeout(state.timer);
  if (reset) state.currentPollInterval = state.pollInterval;
  if (!state.isPaused) {
    state.timer = setTimeout(fetchTelemetry, state.currentPollInterval);
  }
}

// Lifecycle hooks for Android
window.onAppPause = function() {
  state.isPaused = true;
  if (state.timer) clearTimeout(state.timer);
};
window.onAppResume = function() {
  state.isPaused = false;
  restartPolling(true);
};

// Start polling
restartPolling();
</script>
</body>
</html>
```

## 2. `app/src/main/java/com/ivfluidwatch/app/MainActivity.java`
Native Java layer setting up the WebView, Android Native Bridge, and Lifecycle forwarding.

```java
package com.ivfluidwatch.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends AppCompatActivity {

    private static final String CHANNEL_ID = "driptrace_alerts_channel";
    private static final int NOTIFICATION_ID = 1001;
    private static final int PERMISSION_REQ_CODE = 200;

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private SharedPreferences sharedPreferences;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        sharedPreferences = getSharedPreferences("DripTracePrefs", Context.MODE_PRIVATE);
        createNotificationChannel();
        requestNotificationPermission();

        swipeRefresh = findViewById(R.id.swipeRefresh);
        webView = findViewById(R.id.webView);

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Native bridge for notifications and hardware feedback
        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                swipeRefresh.setRefreshing(false);
            }
        });

        webView.setWebChromeClient(new WebChromeClient());
        swipeRefresh.setOnRefreshListener(() -> webView.reload());

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        webView.loadUrl("file:///android_asset/index.html");
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "DripTrace Alerts", NotificationManager.IMPORTANCE_HIGH);
            channel.enableVibration(true);
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) notificationManager.createNotificationChannel(channel);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQ_CODE);
            }
        }
    }

    public class WebAppInterface {
        @JavascriptInterface
        public void triggerAlert(String title, String message, String severity) {
            triggerVibration(severity.equalsIgnoreCase("critical") ? 800 : 350);
            NotificationCompat.Builder builder = new NotificationCompat.Builder(MainActivity.this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.stat_notify_error)
                    .setContentTitle(title)
                    .setContentText(message)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true);
            NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (notificationManager != null) notificationManager.notify(NOTIFICATION_ID, builder.build());
        }

        @JavascriptInterface
        public void triggerVibration(long ms) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                else v.vibrate(ms);
            }
        }

        @JavascriptInterface
        public void saveSetting(String key, String value) {
            sharedPreferences.edit().putString(key, value).apply();
        }

        @JavascriptInterface
        public String getSetting(String key, String defaultValue) {
            return sharedPreferences.getString(key, defaultValue);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("if(window.onAppResume) window.onAppResume();", null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.evaluateJavascript("if(window.onAppPause) window.onAppPause();", null);
            webView.onPause();
        }
    }
}
```

## Next Steps for Claude
1. The app handles **Mode A (Firebase)** and **Mode B (Local ESP32)** flawlessly via HTML fetches.
2. The UI is injected strictly through HTML/CSS. If further UI changes are needed, focus entirely on modifying `index.html`. 
3. If new Native capabilities are required (e.g., Bluetooth, raw UDP sockets), add them inside `MainActivity.java`'s `WebAppInterface` class and call them from JS via `window.AndroidBridge`.
