# HorleyTech Scrapebot — Enterprise E‑Commerce PIM Ecosystem

A modern, AI-first Product Information Management (PIM) and vendor intelligence platform built for scale, resilience, and operational clarity. Designed for engineering teams, operators, and stakeholders who need high-confidence catalog normalization and pricing intelligence across noisy real-world vendor data.

---

## ✨ System Architecture

The platform is built around a **centralized AI knowledge core** and a **Firebase-backed persistence layer** that keeps product intelligence durable and continuously improving.

### High-Level Flow

1. **Vendor data ingestion** (messy strings, mixed formatting, shorthand naming).
2. **AI Gatekeeper normalization** (strict JSON extraction from unstructured device strings).
3. **Global Brain persistence** in Firebase (`customMappings`).
4. **Aggressive chunked save strategy** during AI processing (every 20 rows).
5. **Global products cache rebuild** for downstream analytics, search, and pricing.
6. **Nightly Ghost Admin sweep** to auto-learn and enrich unseen vendor strings.

### Core Data Backbone

- **Firebase Firestore** as source of truth.
- **`horleyTech_Settings/customMappings`** as the canonical, ever-growing global dictionary.
- **Chronological product + vendor history** powering dynamic pricing and business intelligence.

---

## 🚀 Core Features

### 1) 🧠 100% Pure AI Dictionary (No Local Guessing)

We fully removed local regex/heuristic guessing from the canonical mapping path.

- No brittle local rule chains.
- No fragmented vendor-specific hacks.
- One centralized intelligence layer: **Global Brain = `customMappings`**.

This yields consistent normalization behavior across admin workflows, automation scripts, and nightly sync jobs.

### 2) ⚖️ Two-Layer AI Judge (OpenAI `gpt-4o-mini`)

Messy vendor inputs like:

- `Brand NewESIM 17PM`
- `Uk used iphn 13pm dual`
- `iphone16prm bn esim`

are parsed into strict structured JSON (example):

- **Condition:** `Brand New`
- **SIM:** `ESIM`
- **Device Type:** `iPhone 17 Pro Max`

This strict extraction standard enables deterministic downstream logic for filtering, analytics, and pricing.

### 3) 💾 Aggressive Save Architecture (Crash-Safe Progress)

The AI processing loop runs in **chunks of 20 items** and saves each successful chunk immediately.

- Progress is persisted continuously.
- Browser freeze/crash/network blip does not wipe completed work.
- Operational risk is minimized during long normalization runs.

### 4) 👻 Ghost Admin Nightly Sweeper

A Node.js cron worker (`cronTasks.js`) runs every day at **2:00 AM** to:

- find newly observed vendor strings,
- send unseen candidates to the AI Judge,
- merge validated outputs into the Global Brain silently.

Result: the system self-improves overnight without manual admin babysitting.

### 5) 📈 Smart Pricing Engine

The pricing engine aligns uploaded company pricing CSVs with the latest chronological vendor duplicate data to compute dynamic margins.

- Vendor recency is respected.
- Margin strategy remains data-driven.
- Pricing decisions stay synchronized with market behavior.

### 6) ☢️ Nuke & Rebuild Protocol

For controlled recovery and reset operations, the platform includes a safeguarded destructive flow requiring explicit typed confirmation:

- operator must type **`NUKE`** before dictionary wipe,
- rebuild pipeline then reconstructs clean global mappings safely.

This prevents accidental destructive actions while preserving emergency reset capability.

---

## 🔐 How the AI Gatekeeper Works

The AI Gatekeeper is the normalization firewall between raw vendor noise and production-grade product records.

### Pipeline

1. Collect unclean/unknown strings from inventory.
2. Batch into fixed-size payloads (20 rows per request).
3. Send to extraction endpoint backed by OpenAI `gpt-4o-mini`.
4. Validate strict response shape.
5. Merge valid mappings into `customMappings`.
6. Re-map inventory using updated dictionary.
7. Persist clean global cache for platform-wide usage.

### Reliability Controls

- Chunked persistence after each AI response.
- Timeout/abort guards in fetch loops.
- Non-blocking failure handling (bad chunk doesn’t kill full pipeline).
- Merge-safe writes to Firestore.

---

## ⏰ Cron Automation (Ghost Admin)

Automation is handled by `cronTasks.js` with a daily 2:00 AM schedule.

### Responsibilities

- scan for fresh vendor strings not yet mastered,
- submit to AI Judge for normalization,
- merge back into global dictionary,
- keep daytime admin dashboards cleaner and faster.

### Why It Matters

- Reduces manual intervention.
- Increases dictionary coverage daily.
- Keeps AI enrichment continuous and compounding.

---

## 🛠️ Setup / Run Instructions

> The exact commands can vary by environment, but this is the recommended baseline.

### 1) Prerequisites

- Node.js 18+
- npm or yarn
- Firebase project credentials
- OpenAI API key

### 2) Install Dependencies

```bash
npm install
```

### 3) Configure Environment

Create/update your `.env` with required keys (example names):

```bash
VITE_BASE_URL=http://localhost:3000
VITE_MASTER_DICTIONARY_CSV=<master_dictionary_csv_url>
FIREBASE_API_KEY=<firebase_key>
FIREBASE_PROJECT_ID=<firebase_project>
OPENAI_API_KEY=<openai_key>
```

### 4) Run Frontend

```bash
npm run dev
```

### 5) Run Backend / API Services

```bash
npm run start
```

### 6) Run Cron Worker

If cron is isolated in your deployment model, run it as a separate process:

```bash
node cronTasks.js
```

---

## 🧩 Operational Notes for Teams

- Treat `customMappings` as the canonical intelligence asset.
- Prefer additive merge writes over destructive overwrites during active sync.
- Keep AI extraction schema strict and versioned.
- Monitor nightly cron logs for coverage growth and anomalies.

---

## 📣 Stakeholder Snapshot

This ecosystem is engineered for **enterprise reliability** and **AI-native catalog operations**:

- Consistent normalization from chaotic inputs.
- Durable progress under real-world browser/network instability.
- Autonomous overnight learning loop.
- Pricing intelligence grounded in live vendor chronology.

A polished, compounding data engine—built for scale. 🍏
