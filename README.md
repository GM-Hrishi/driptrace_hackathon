# DripTrace

IV fluid flow-rate and empty-bottle monitoring dashboard.

Built for KERNEL PRIME'26, S.A. Engineering College (Oct 8-9, 2026).

## Stack

- React 19 + Vite
- Tailwind CSS v4
- Firebase (Realtime Database + Firestore)
- motion, @number-flow/react, recharts

## Setup

```bash
npm install
cp .env.example .env.local   # fill in your Firebase config
npm run dev
```

## Screens

| Route | Theme | What it is |
|---|---|---|
| `/` | dark | Ward overview: every bed, critical first, with the topbar banner showing the single highest active alert |
| `/bed/:id` | dark | One infusion: hero bottle, KPI row, flow trend vs prescribed, alarm panel with acknowledge |
| `/admin` | light | System status, simulated beds, alarm thresholds, HX711 calibration |
| `/admin?tab=design` | light | Design View: every token, severity state and alarm animation, live |

## Alarms

Derived in `src/lib/severity.js`, against each bed's own prescribed rate:

- **Critical** (red, 2 Hz): bottle empty, flow stopped
- **Caution** (amber, 0.6 Hz): flow more than 30% off the prescribed rate
  (e.g. "Flow rate 3.2x prescribed — check infusion settings"), volume under 10%
- **Offline** (steel cyan, static): a unit that has not published for 15 s. Never shown as a clinical alarm.

Both thresholds are adjustable in Admin.

## Simulation

Simulation mode drives every bed assigned to a simulated unit, so the ward
can be demonstrated, and scaled, without hardware. It is on by default in
`npm run dev` and off in production builds; toggle it in Admin. Each simulated
bed can be switched into any state (3.2x fast flow, occlusion, empty,
offline) from Admin or its bed page.

Bed registrations and settings are stored in the browser's localStorage.
The Firebase rules deny all client writes by design, so nothing typed into
the dashboard is written to the database.
