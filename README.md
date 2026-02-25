# 🚀 Horleytech Scrapebot

![Platform](https://img.shields.io/badge/Platform-Full--Stack-blue)
![Frontend](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61DAFB)
![Backend](https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-339933)
![Database](https://img.shields.io/badge/Database-Firebase%20Firestore-FFCA28)
![AI](https://img.shields.io/badge/AI-GPT--4o--mini%20%2B%20DALL--E%202-purple)
![Deploy](https://img.shields.io/badge/Deploy-Vercel%20%2B%20PM2%20%2B%20Nginx-black)

**Horleytech Scrapebot** is an AI-powered full-stack platform that automates how electronics inventory is captured, structured, analyzed, and recovered.

It ingests unstructured WhatsApp vendor messages through secure webhooks, converts them into structured product records using OpenAI, and powers a production-ready admin dashboard for inventory operations, analytics, chat workflows, and one-click disaster recovery.

---

## 📌 Table of Contents

- [System Architecture](#-system-architecture)
- [Core Features](#-core-features)
- [AI Workflow (WhatsApp → Inventory)](#-ai-workflow-whatsapp--inventory)
- [Environment Variables (.env)](#-environment-variables-env)
- [Local Development](#-local-development)
- [Deployment & Hosting](#-deployment--hosting)
- [Disaster Recovery (Google Workspace)](#-disaster-recovery-google-workspace)
- [Security Notes](#-security-notes)
- [Operational Notes](#-operational-notes)

---

## 🧱 System Architecture

### Frontend (Vercel)
- **Framework:** React + Vite
- **Styling:** Tailwind CSS
- **Data Visualization:** Recharts
- **Primary Responsibility:** Admin dashboard, vendor operations UI, backup restore controls, analytics, and messaging workflows

### Backend (Ubuntu + PM2 + Nginx)
- **Runtime:** Node.js
- **Framework:** Express
- **Process Manager:** PM2
- **Edge/Web Layer:** Nginx reverse proxy with SSL termination
- **Primary Responsibility:** Webhook ingestion, AI parsing, database write orchestration, audit logging, backup/restore API

### Database
- **Service:** Firebase Firestore
- **Access Mode:** Firebase Admin SDK (server-side God-Mode)
- **Credential Source:** local `node_backend/firebase-credentials.json` file

### AI Integrations
- **Text Structuring:** OpenAI **GPT-4o-mini** for parsing raw WhatsApp inventory text into structured JSON
- **Image Generation:** OpenAI **DALL·E 2** for professional product image generation

---

## 🌟 Core Features

### 1) 🤖 AI Auto-Scraper (WhatsApp Webhook)
- Receives inbound WhatsApp payloads through `/api/webhook/whatsapp`
- Validates webhook requests via `x-api-key` + `WEBHOOK_SECRET`
- Uses GPT-4o-mini to extract key product fields:
  - Device Type
  - Condition
  - Price
  - Storage/Configuration
- Automatically enriches and writes structured inventory data into Firestore

### 2) 📊 Advanced Admin Dashboard
- Bulk inventory editing for high-volume operations
- Dynamic visual analytics (e.g., price variance and action heatmaps)
- Unified inbox workflow for vendor communication and operational messaging

### 3) 🧾 Audit Trail + Undo System
- Every write action is tracked in `horleyTech_AuditLogs`
- Admins can inspect historical changes
- “Undo” / restore-action endpoint lets admins instantly roll back specific updates or full collection snapshots

### 4) ☁️ Disaster Recovery (Automated)
- Scheduled backup job runs every **Sunday at 2:00 AM (Africa/Lagos)**
- Firestore inventory snapshot is exported as JSON
- Backup is uploaded to a Google Workspace Shared Drive
- Backup metadata is persisted in `horleyTech_Backups`

### 5) ♻️ One-Click Restore
- Admin UI can list available Drive backups
- Restore endpoint pulls a selected backup, validates payload, wipes current inventory collection, and rehydrates records in batches

### 6) 🧠 Smart Vendor Onboarding
- Generates vendor-specific `wa.me` onboarding links
- Includes pre-filled formatting instructions for cleaner AI ingestion
- Supports embedded YouTube tutorial guidance for rapid vendor enablement

---

## 🔄 AI Workflow (WhatsApp → Inventory)

1. Vendor sends inventory text via WhatsApp.
2. WhatsApp webhook posts payload to backend endpoint.
3. Backend validates request with secret header.
4. GPT-4o-mini normalizes raw text into strict JSON schema.
5. Backend enriches entries with metadata (timestamp/group context).
6. Structured product records are saved into Firestore vendor documents.
7. Dashboard updates become immediately available for admins.

---

## 🔐 Environment Variables (.env)

Create a `.env` file (typically in the project root for runtime) and define the following keys:

```env
# Server
PORT=8000

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Webhook Security
WEBHOOK_SECRET=your_internal_webhook_secret

# Google Workspace / Drive Backup
GOOGLE_DRIVE_FOLDER_ID=your_shared_drive_folder_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Firebase (frontend/client config if externalized)
FIREBASE_API_KEY=your_firebase_web_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_web_app_id
```

### Firebase Admin Credential Requirement (Backend)
The backend expects a local service account file:

```bash
node_backend/firebase-credentials.json
```

This file is required for privileged Firestore admin operations (backup, restore, audit-aware writes). Never commit this file to version control.

---

## 🛠️ Local Development

### Prerequisites
- Node.js 18+
- npm or pnpm
- Firebase project + service account JSON
- OpenAI API key

### Install

```bash
npm install
```

### Run Frontend (Vite)

```bash
npm run dev
```

### Run Backend (Express)

```bash
npm run start:be
```

### Build Frontend

```bash
npm run build
```

---

## 🚢 Deployment & Hosting

### Frontend
- Hosted on **Vercel**
- Built with Vite and deployed as static SPA assets

### Backend
- Hosted on **Ubuntu Server**
- Managed by **PM2** for uptime and process supervision
- Exposed via **Nginx reverse proxy** with SSL enabled

Typical production flow:
1. Deploy backend code to Ubuntu host
2. Place `firebase-credentials.json` in `node_backend/`
3. Set `.env` secrets on server
4. Start/reload backend via PM2
5. Route HTTPS traffic through Nginx to Node process

---

## 🧯 Disaster Recovery (Google Workspace)

The platform includes built-in disaster recovery with automated and operator-triggered restore paths.

### Automated Weekly Backup
- Triggered by `node-cron`
- Schedule: `0 2 * * 0` (Sunday, 2:00 AM, Africa/Lagos)
- Exports Firestore collection snapshot to JSON
- Uploads backup file to configured Google Shared Drive folder
- Records backup metadata in Firestore for traceability

### One-Click Restore
- Admin users can fetch recent backups from Google Drive
- Selecting a backup triggers:
  - Download of backup payload
  - Validation of required fields
  - Atomic-ish collection replacement (batched delete + batched reinsert)
- Enables rapid rollback after data corruption, accidental edits, or operational incidents

---

## 🔒 Security Notes

- Use `WEBHOOK_SECRET` to protect ingestion endpoints.
- Keep `firebase-credentials.json` out of Git (`.gitignore` required).
- Scope Google Drive service account permissions to minimum required access.
- Store all secrets in environment variables (never hardcode credentials).
- Limit admin routes behind role-based checks and secured network paths.

---

## 📘 Operational Notes

- PM2 logs can be exposed through backend log endpoints for quick diagnostics.
- Audit metadata and backup metadata collections are initialized automatically at startup.
- If Google Drive variables are missing, backup still runs locally but skips remote upload.

---

## 👨‍💻 Maintainers

Built for production-grade electronics inventory automation with AI-first workflows, admin governance, and recovery resilience.

If you’re extending this platform, prioritize:
- strict data schemas,
- robust auditability,
- and safe rollback mechanisms.
