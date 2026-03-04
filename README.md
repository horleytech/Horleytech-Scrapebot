# Horleytech Scrapebot & AI Engine 🚀
An Enterprise-grade data ingestion, AI normalization, and Vendor Management platform built for Horleytech. This system scrapes messy vendor WhatsApp/CSV data, utilizes an autonomous OpenAI normalization engine, and securely stores sharded product maps in Firebase.

🌟 Core Architecture
Frontend: React + Vite + TailwindCSS (Deployed on Vercel)

Backend: Node.js + Express (Deployed on Ubuntu/Nginx via DigitalOcean)

Database: Google Firebase (Firestore) - Enterprise Blaze Plan

AI Engine: OpenAI gpt-4o-mini

🧠 The Master Sync Engine
The legacy system relied on heavy frontend processing and bloated Firebase documents. We have upgraded to a Categorically Sharded Global Brain.

How it works:
Data Ingestion: WhatsApp webhooks and CSV uploads feed raw strings into the Offline Inventory.

Background AI Judge: The /api/admin/trigger-background-sync endpoint safely sweeps the database for unknown messy strings.

Smart Categorical Sharding: To bypass Firebase's 1MB document limit, the AI groups mappings dynamically. Instead of a monolithic dictionary, data is saved into 8 distinct categorical shards (e.g., mappings_Smartphones, mappings_Laptops, mappings_Smartwatches).

Specification Matching: The AI dynamically matches Specifications based on the device context (e.g., "M2 Pro" for Laptops, "45mm" for Watches, "ESIM" for Phones).

🛡️ Enterprise Security & Limits
CORS Bouncer: Strict Nginx Reverse Proxy with an explicit OPTIONS preflight VIP pass.

Index Exemptions: The mappings field in horleyTech_Settings is strictly exempted from Firebase Indexing, unlocking infinite dictionary expansion without freezing the backend.

Quota Protections: The Node.js engine writes data in intelligent batches to minimize Firebase Read/Write operations.

💻 Server Commands (Cheatsheet)
Restart Backend Engine: pm2 restart all

View Live Terminal Logs: pm2 log 0

Restart Nginx Bouncer: sudo systemctl restart nginx

Pull Latest Code: git pull origin main --rebase
