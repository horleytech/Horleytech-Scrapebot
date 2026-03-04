# Horleytech Scrapebot & B2B AI Engine 🚀
An Enterprise-grade data ingestion, AI normalization, and Vendor Management platform. This system scrapes messy vendor data, utilizes an autonomous OpenAI normalization engine, and securely stores sharded product maps in Firebase.

🌟 Core Architecture
Frontend: React + Vite + TailwindCSS + Redux (Deployed on Vercel)

Backend: Node.js + Express (Deployed on Ubuntu/Nginx via DigitalOcean)

Database: Google Firebase (Firestore) - Enterprise Blaze Plan

AI Engine: OpenAI gpt-4o-mini

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
