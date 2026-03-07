# Horleytech Scrapebot & B2B AI Engine 🚀
An Enterprise-grade data ingestion, AI normalization, and Vendor Management platform. This system scrapes messy vendor data, utilizes an autonomous OpenAI normalization engine, and securely stores sharded product maps in Firebase.

🌟 Core Architecture
Frontend: React + Vite + TailwindCSS + Redux (Deployed on Vercel)

Backend: Node.js + Express (Deployed on Ubuntu/Nginx via DigitalOcean)

Database: Google Firebase (Firestore) - Enterprise Blaze Plan

AI Engine: Configurable (OpenAI or Qwen for text tasks, OpenAI image generation by default)

## AI Provider Setup (OpenAI + Qwen)

You can now choose the text AI provider from the Admin Dashboard (`OpenAI` or `Qwen`).
The backend reads this from `horleyTech_Settings/aiControl.selectedProvider`.

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
