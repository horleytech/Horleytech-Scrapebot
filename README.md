# Horleytech Scrapebot & B2B AI Engine 🚀
An Enterprise-grade data ingestion, AI normalization, and Vendor Management platform. This system scrapes messy vendor data, utilizes an autonomous OpenAI normalization engine, and securely stores sharded product maps in Firebase.

🌟 Core Architecture
Frontend: React + Vite + TailwindCSS + Redux (Deployed on Vercel)

Backend: Node.js + Express (Deployed on Ubuntu/Nginx via DigitalOcean)

Database: Google Firebase (Firestore) - Enterprise Blaze Plan

AI Engine: Configurable (OpenAI or Qwen for text tasks, OpenAI image generation by default)

## AI Provider Setup (OpenAI + Qwen)

You can now choose the text AI provider and image AI provider from the Admin Dashboard (`OpenAI` or `Qwen`).
The backend reads these from `horleyTech_Settings/aiControl.selectedProvider` and `horleyTech_Settings/aiControl.imageProvider`.

### .env variables (backend)

Add these on your DigitalOcean backend server in `node_backend/.env`:

```env
# Default provider if dashboard setting is missing
AI_PROVIDER_DEFAULT=openai

# OpenAI keys (used for text when provider=openai, and for images)
OPENAI_API_KEY=your_openai_key
OPENAI_API_KEY_SYNC=your_optional_background_openai_key
AI_TEXT_MODEL_OPENAI=gpt-4o-mini
AI_IMAGE_MODEL_OPENAI=dall-e-2

# Qwen keys (used for text when provider=qwen)
QWEN_API_KEY=your_qwen_key
QWEN_API_KEY_SYNC=your_optional_background_qwen_key
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
AI_TEXT_MODEL_QWEN=qwen-plus
AI_IMAGE_MODEL_QWEN=qwen-image

# Optional: CSV used for global product/container arrangement.
# Nightly unknown sweeper will use this first for CSV-target seeding.
GLOBAL_PRODUCTS_CSV_URL=https://docs.google.com/spreadsheets/d/<sheet-id>/export?format=csv&gid=0

# Webhook/parser robustness (recommended for large WhatsApp inventory payloads)
WEBHOOK_JSON_LIMIT=10mb
WEBHOOK_FORM_LIMIT=10mb
MAX_LINE_PARSE_CHARS=8000
MAX_AI_CHUNK_CHARS=16000
```

### What to install on DigitalOcean

No extra package is required beyond project dependencies (`npm install` / `pnpm install`).
Qwen is called through OpenAI-compatible HTTP API using the existing `openai` SDK.

After updating `.env`, restart backend:

```bash
pm2 restart all
pm2 log 0
```

🧠 The Master Sync Engine
Categorical Sharding: To bypass Firebase's 1MB document limit, the AI groups mappings dynamically into 8 distinct categorical shards (e.g., mappings_Smartphones, mappings_Laptops).

Specification Matching: The AI dynamically matches Specifications based on the device context.

🔐 Role-Based Access Control (RBAC) & Tracking
Dual Authentication: The system utilizes official Firebase Auth for both Admins and Staff.

Pseudo-Email Strategy: Staff members log in using simplified Usernames, which the backend securely maps to tracking emails ([username]@staff.horleytech.com).

Audit Logging: Every action taken by a Staff member is permanently tracked in the Firebase Audit Logs.

💰 Advanced Price Engine & Distribution
Bulk Selection: Admins can multi-select products from the master inventory.

Targeted Margins: Price calculation rules can be applied to isolated, selected batches.

Vendor Routing: Selected product blocks can be dynamically assigned to specific vendor storefronts.

💻 Server Commands
Restart Backend Engine: pm2 restart all

View Live Terminal Logs: pm2 log 0

Restart Nginx Bouncer: sudo systemctl restart nginx

Pull Latest Code: git pull origin main --rebase

## Strict Vendor Routing (Laptop/Phone Flow)

The WhatsApp webhook supports vendor-specific strict parsing for laptop/phone broadcasts.

- Admin UI location: **Admin Dashboard → AI TXT Analyzer → Strict Routing Vendors (Laptop/Phone)**.
- Backend settings document: `horleyTech_Settings/extractionRouting`.
- Fields:
  - `enabled` (boolean): turns strict routing on/off globally.
  - `strictVendors` (string[]): vendor names that should use strict laptop/phone parsing.

### Message path (end-to-end)

1. WhatsApp messages hit the backend webhook (`/api/webhook/whatsapp`).
2. Webhook loads `extractionRouting` from settings and checks sender/vendor name against `strictVendors`.
3. If matched and enabled, backend sets `strictVendorMode=true` and runs stricter line parsing + fallback behavior.
4. Parsed products continue through normalization and taxonomy scoring before storage.

This means messages still go straight to the backend, while the admin page only controls the backend behavior via settings.

### General Listing format (non-strict vendors)

Preferred formats:
- `Product | Specs | Condition | Price`
- `Product | Specs | Condition | Storage | Price`

Also supported:
- `Product | Condition | Specs | Price`
- `Product | Condition | Specs | Storage | Price`
