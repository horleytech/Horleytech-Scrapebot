import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import morgan from 'morgan';
import compression from 'compression';
import cors from 'cors';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { processChatFile } from './fileProcessor.js';
import { Worker } from 'worker_threads';
import { processWithShadowTesting } from './cleaner.js';
import { saveVendorsToFirebase } from './dataProcessor.js';
import { initializeCronTasks, runRetroactiveSweep, resetGlobalMemoryCache } from './cronTasks.js';
import { resolveImageAIConfig, resolveTextAIConfig } from './aiConfig.js';
import {
  initializeSystemCollections,
  runBackup,
  getAdminFirestore,
  listBackupsFromDrive,
  downloadAndRestoreFromDrive,
  restoreInventoryFromBackupPayload,
  getBackupPayloadFromFirestore,
} from './backup.js';

dotenv.config();


const PM2_LOG_PATH = '/root/.pm2/logs/scrapebot-backend-out.log';
const OFFLINE_COLLECTION = 'horleyTech_OfflineInventories';
const _BACKUP_COLLECTION = 'horleyTech_Backups';
const MESSAGE_COLLECTION = 'horleyTech_PlatformMessages';
const AUDIT_COLLECTION = 'horleyTech_AuditLogs';
const SETTINGS_COLLECTION = 'horleyTech_Settings';

let messagesCache = [];
let messagesCacheUpdatedAt = 0;
const MESSAGES_CACHE_TTL_MS = 15000;
const MESSAGE_FETCH_TIMEOUT_MS = 8000;
const processedMessageCache = new Map();
const lineLevelExtractionCache = new Map();
const WEBHOOK_JSON_LIMIT = process.env.WEBHOOK_JSON_LIMIT || '10mb';
const WEBHOOK_FORM_LIMIT = process.env.WEBHOOK_FORM_LIMIT || '10mb';
const MAX_LINE_PARSE_CHARS = Number(process.env.MAX_LINE_PARSE_CHARS || 8000);
const MAX_AI_CHUNK_CHARS = Number(process.env.MAX_AI_CHUNK_CHARS || 16000);

const sanitizeForFirestore = (value) => JSON.parse(JSON.stringify(value, (_key, entry) => (
  entry === undefined ? null : entry
)));

const withTimeout = async (promiseFactory, timeoutMs, timeoutMessage) => Promise.race([
  promiseFactory(),
  new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

const app = express();
const allowedOrigins = new Set([
  'http://localhost:5173', // Local React Dev
  'http://localhost:3000', // Alternative Local Dev
  'https://scrapebot.horleytech.com', // Production Frontend
  'https://www.scrapebot.horleytech.com', // Production Frontend (www)
  ...String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

const allowedOriginRegex = /^https:\/\/(?:[a-z0-9-]+\.)*horleytech\.com$/i;

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  return allowedOriginRegex.test(origin);
};

const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (isAllowedOrigin(origin)) return callback(null, true);

    const msg = `The CORS policy for this site does not allow access from origin: ${origin}`;
    return callback(new Error(msg), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-user-role'],
  credentials: true,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Ensure CORS headers are present even when upstream middleware throws,
// so browser clients get actionable responses instead of opaque CORS failures.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    if (origin) res.header('Access-Control-Allow-Origin', origin);
    else res.header('Access-Control-Allow-Origin', '*');
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-user-role');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  return next();
});
app.use(compression());
app.use(express.json({ limit: WEBHOOK_JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: WEBHOOK_FORM_LIMIT }));
app.use(morgan('dev'));

const PORT = process.env.PORT || 8000;
const _CATS = "'Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'";

// Initialize infrastructure
initializeSystemCollections();
initializeCronTasks();


const resolveUserRole = (req) => {
  const headerRole = String(req.headers['x-user-role'] || '').toLowerCase();
  if (headerRole.includes('admin')) return 'Admin';
  if (headerRole.includes('vendor')) return 'Vendor';

  const senderRole = String(req.body?.sender || '').toLowerCase();
  if (senderRole === 'admin') return 'Admin';
  if (senderRole === 'vendor') return 'Vendor';

  if (req.path.includes('/admin')) return 'Admin';
  return 'Vendor';
};


const isAdminRequest = (req) => {
  const role = resolveUserRole(req);
  return role === 'Admin';
};

const AUDIT_TEXT_LIMIT = 2000;
const AUDIT_ARRAY_LIMIT = 40;

const sanitizeAuditPayload = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[truncated-depth]';

  if (typeof value === 'string') {
    return value.length > AUDIT_TEXT_LIMIT ? `${value.slice(0, AUDIT_TEXT_LIMIT)}...[truncated]` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const trimmed = value.slice(0, AUDIT_ARRAY_LIMIT).map((item) => sanitizeAuditPayload(item, depth + 1));
    if (value.length > AUDIT_ARRAY_LIMIT) {
      trimmed.push(`[truncated ${value.length - AUDIT_ARRAY_LIMIT} more items]`);
    }
    return trimmed;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 80);
    return entries.reduce((acc, [key, val]) => {
      acc[key] = sanitizeAuditPayload(val, depth + 1);
      return acc;
    }, {});
  }

  return String(value);
};

app.use(async (req, res, next) => {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'DELETE'].includes(method)) {
    return next();
  }

  const AUDIT_NOISY_PATH_PREFIXES = [
    '/api/webhook/whatsapp',
    '/process',
    '/api/messages/send',
    '/api/ai/fix-inventory',
  ];
  const AUDIT_TRACKED_PATH_PREFIXES = [
    '/api/admin/',
    '/api/inventory/bulk-edit',
    '/api/backup/restore',
    '/api/backup/drive-restore',
    '/api/backup/upload-restore',
  ];
  const requestPath = String(req.path || '');
  const isNoisyPath = AUDIT_NOISY_PATH_PREFIXES.some((prefix) => requestPath.startsWith(prefix));
  const isTrackedPath = AUDIT_TRACKED_PATH_PREFIXES.some((prefix) => requestPath.startsWith(prefix));
  if (isNoisyPath || !isTrackedPath) {
    return next();
  }

  const userRole = resolveUserRole(req);
  let oldData = null;
  let targetDocId = null;

  try {
    const firestore = getAdminFirestore();
    const candidateId = req.body?.vendorDocId || req.body?.vendorId;

    if (candidateId) {
      const snap = await firestore.collection(OFFLINE_COLLECTION).doc(String(candidateId)).get();
      if (snap.exists) {
        oldData = snap.data();
        targetDocId = snap.id;
      }
    }

    if (!oldData && req.body?.backupId && req.path.includes('/backup/restore')) {
      const currentSnapshot = await firestore.collection(OFFLINE_COLLECTION).get();
      oldData = currentSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      targetDocId = '__collection_snapshot__';
    }
  } catch (error) {
    console.error('Audit prefetch failed:', error.message);
  }

  req.auditContext = { oldData, targetDocId, userRole };

  res.on('finish', async () => {
    if (res.statusCode >= 500) return;

    try {
      const firestore = getAdminFirestore();
      await firestore.collection(AUDIT_COLLECTION).add({
        timestamp: new Date().toISOString(),
        path: req.path,
        method,
        userRole,
        targetDocId,
        oldData: sanitizeAuditPayload(oldData),
        newData: sanitizeAuditPayload(req.body || null),
      });
    } catch (error) {
      console.error('Audit write failed:', error.message);
    }
  });

  next();
});

const runBatchInChunks = async (operations, maxPerBatch = 400) => {
  const firestore = getAdminFirestore();

  for (let i = 0; i < operations.length; i += maxPerBatch) {
    const batch = firestore.batch();
    const chunk = operations.slice(i, i + maxPerBatch);

    chunk.forEach((operation) => {
      if (operation.type === 'delete') {
        batch.delete(operation.ref);
      }

      if (operation.type === 'set') {
        batch.set(operation.ref, operation.data, { merge: false });
      }
    });

    await batch.commit();
  }
};

const deleteCollectionDocuments = async (collectionName, filterFn = null, maxPerBatch = 350) => {
  const firestore = getAdminFirestore();
  const snapshot = await firestore.collection(collectionName).get();

  const docsToDelete = snapshot.docs.filter((docSnap) => {
    if (!filterFn) return true;
    return Boolean(filterFn(docSnap));
  });

  for (let i = 0; i < docsToDelete.length; i += maxPerBatch) {
    const batch = firestore.batch();
    docsToDelete.slice(i, i + maxPerBatch).forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }

  return docsToDelete.length;
};

app.get('/', (req, res) => {
  res.json({ message: 'Server Running' });
});

app.get('/api/logs', (req, res) => {
  try {
    if (!fs.existsSync(PM2_LOG_PATH)) return res.send('No logs yet.');
    const content = fs.readFileSync(PM2_LOG_PATH, 'utf-8');
    res.send(content.split('\n').slice(-50).join('\n'));
  } catch (e) {
    res.send('Logs loading...');
  }
});

// --- STAFF MANAGEMENT ROUTES ---
app.post('/api/admin/create-staff', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'username and password are required.' });
    }

    const pseudoEmail = `${String(username).toLowerCase().replace(/\s+/g, '')}@staff.horleytech.com`;
    const firestore = getAdminFirestore();

    const userRecord = await admin.auth().createUser({
      email: pseudoEmail,
      password: String(password),
      displayName: `Staff: ${String(username)}`,
    });

    await firestore.collection('horleyTech_Staff').doc(userRecord.uid).set({
      username: String(username),
      email: pseudoEmail,
      role: 'staff',
      uid: userRecord.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ success: true, uid: userRecord.uid });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/delete-staff/:uid', async (req, res) => {
  try {
    const { uid } = req.params;

    if (!uid) {
      return res.status(400).json({ success: false, error: 'uid is required.' });
    }

    const firestore = getAdminFirestore();
    await admin.auth().deleteUser(String(uid));
    await firestore.collection('horleyTech_Staff').doc(String(uid)).delete();

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin Audit History Endpoint
app.get('/api/admin/audit-logs', async (req, res) => {
  const limit = Number.parseInt(req.query.limit, 10) || 500;

  try {
    const firestore = getAdminFirestore();
    const snapshot = await firestore
      .collection(AUDIT_COLLECTION)
      .orderBy('timestamp', 'desc')
.limit(Math.min(limit, 2000))
      .get();

    return res.json({
      success: true,
      logs: snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin Undo Restore-Action Endpoint
app.post('/api/admin/restore-action', async (req, res) => {
  const { auditId } = req.body || {};

  if (!auditId) {
    return res.status(400).json({ success: false, error: 'auditId is required.' });
  }

  try {
    const firestore = getAdminFirestore();
    const auditDoc = await firestore.collection(AUDIT_COLLECTION).doc(String(auditId)).get();

    if (!auditDoc.exists) {
      return res.status(404).json({ success: false, error: 'Audit log not found.' });
    }

    const auditData = auditDoc.data();

    if (!auditData?.oldData) {
      return res.status(400).json({ success: false, error: 'This action has no restorable oldData.' });
    }

    if (Array.isArray(auditData.oldData) && auditData.targetDocId === '__collection_snapshot__') {
      const existingSnapshot = await firestore.collection(OFFLINE_COLLECTION).get();
      const operations = [];

      existingSnapshot.docs.forEach((docSnap) => {
        operations.push({ type: 'delete', ref: firestore.collection(OFFLINE_COLLECTION).doc(docSnap.id) });
      });

      auditData.oldData.forEach((vendorDoc) => {
        const { id, ...vendorData } = vendorDoc || {};
        if (!id) return;
        operations.push({
          type: 'set',
          ref: firestore.collection(OFFLINE_COLLECTION).doc(id),
          data: vendorData,
        });
      });

      await runBatchInChunks(operations);

      return res.json({ success: true, restored: auditData.oldData.length, mode: 'collection' });
    }

    const targetDocId = auditData.targetDocId || auditData.oldData.vendorId || auditData.oldData.docId;
    if (!targetDocId) {
      return res.status(400).json({ success: false, error: 'Could not resolve target vendor document.' });
    }

    await firestore.collection(OFFLINE_COLLECTION).doc(String(targetDocId)).set(auditData.oldData, { merge: false });

    return res.json({ success: true, restored: 1, vendorDocId: targetDocId });
  } catch (error) {
    console.error('❌ Restore action error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk Inventory Edit Endpoint
app.post('/api/inventory/bulk-edit', async (req, res) => {
  const { productIds, fields } = req.body || {};

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({ success: false, error: 'productIds array is required.' });
  }

  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return res.status(400).json({ success: false, error: 'fields object is required.' });
  }

  try {
    const firestore = getAdminFirestore();
    const updatesByVendor = new Map();

    productIds.forEach((rawId) => {
      const token = String(rawId);
      const separator = token.includes('::') ? '::' : token.includes('|') ? '|' : null;
      if (!separator) return;

      const [vendorDocId, indexText] = token.split(separator);
      const productIndex = Number.parseInt(indexText, 10);

      if (!vendorDocId || Number.isNaN(productIndex) || productIndex < 0) return;

      if (!updatesByVendor.has(vendorDocId)) {
        updatesByVendor.set(vendorDocId, new Set());
      }

      updatesByVendor.get(vendorDocId).add(productIndex);
    });

    if (!updatesByVendor.size) {
      return res.status(400).json({ success: false, error: 'No valid productIds were provided.' });
    }

    const batch = firestore.batch();
    let updatedProducts = 0;

    for (const [vendorDocId, indexSet] of updatesByVendor.entries()) {
      const vendorRef = firestore.collection(OFFLINE_COLLECTION).doc(vendorDocId);
      const vendorSnap = await vendorRef.get();

      if (!vendorSnap.exists) continue;

      const vendorData = vendorSnap.data();
      const products = Array.isArray(vendorData.products) ? [...vendorData.products] : [];

      indexSet.forEach((index) => {
        if (!products[index]) return;
        products[index] = { ...products[index], ...fields };
        updatedProducts += 1;
      });

      batch.update(vendorRef, {
        products,
        lastUpdated: new Date().toISOString(),
      });
    }

    await batch.commit();

    return res.json({ success: true, updatedProducts });
  } catch (error) {
    console.error('❌ Bulk edit error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Vendor Onboarding Link Generator
app.post('/api/admin/onboard-vendor', async (req, res) => {
  const { vendorName, adminNumber } = req.body || {};

  if (!vendorName || !adminNumber) {
    return res.status(400).json({ success: false, error: 'vendorName and adminNumber are required.' });
  }

  const cleanedNumber = String(adminNumber).replace(/[^0-9]/g, '');
  if (!cleanedNumber) {
    return res.status(400).json({ success: false, error: 'adminNumber must include digits.' });
  }

  const message = `Hello! I am ${String(vendorName).trim()}. Please onboard me to Horleytech. My product list format will be: [Device] | [Specs] | [Condition] | [Price]`;
  const url = encodeURI(`https://wa.me/${cleanedNumber}?text=${message}`);

  return res.json({ success: true, url, message });
});

app.post('/api/admin/tiny-link-controls/apply', async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required.',
      });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const nextTinyLinksEnabled = Boolean(payload.tinyLinksEnabled);
    const nextShowBothTinyAndNormalLinks = Boolean(payload.showBothTinyAndNormalLinks);
    const now = new Date().toISOString();
    const actionLabel = `${nextTinyLinksEnabled ? 'Enabled' : 'Disabled'} Tiny Links + ${nextShowBothTinyAndNormalLinks ? 'Enabled' : 'Disabled'} Both Tiny + Normal Links View (Bulk)`;

    const firestore = getAdminFirestore();
    const snapshot = await firestore.collection(OFFLINE_COLLECTION).get();
    const docs = snapshot.docs || [];

    const CHUNK_SIZE = 400;
    for (let index = 0; index < docs.length; index += CHUNK_SIZE) {
      const chunk = docs.slice(index, index + CHUNK_SIZE);
      const batch = firestore.batch();

      chunk.forEach((vendorDoc) => {
        const payload = vendorDoc.data() || {};
        const logs = payload.logs && typeof payload.logs === 'object' ? payload.logs : {};
        const adminLogs = Array.isArray(logs.admin) ? logs.admin : [];
        const nextAdminLogs = [{ action: actionLabel, date: now }, ...adminLogs].slice(0, 200);

        batch.set(vendorDoc.ref, {
          tinyLinksEnabled: nextTinyLinksEnabled,
          showBothTinyAndNormalLinks: nextShowBothTinyAndNormalLinks,
          logs: {
            ...logs,
            admin: nextAdminLogs,
          },
          lastUpdated: now,
        }, { merge: true });
      });

      await batch.commit();
    }

    await firestore.collection(SETTINGS_COLLECTION).doc('adminPreferences').set({
      globalTinyLinksEnabled: nextTinyLinksEnabled,
      globalShowBothTinyAndNormalLinks: nextShowBothTinyAndNormalLinks,
      tinyLinkControlsUpdatedAt: now,
    }, { merge: true });

    return res.status(200).json({
      success: true,
      message: 'Tiny controls applied successfully.',
      updatedVendors: docs.length,
      tinyLinksEnabled: nextTinyLinksEnabled,
      showBothTinyAndNormalLinks: nextShowBothTinyAndNormalLinks,
    });
  } catch (error) {
    console.error('❌ Tiny Link Control Crash:', error);
    return res.status(500).json({
      success: false,
      message: 'Backend failed to apply Tiny link controls',
      error: error?.message || 'Unknown server error',
    });
  }
});


// Tutorial Video Settings Endpoints
app.get('/api/settings/tutorial-video', async (_req, res) => {
  try {
    const firestore = getAdminFirestore();
    const docSnap = await firestore.collection(SETTINGS_COLLECTION).doc('tutorial_video').get();
    const data = docSnap.exists ? docSnap.data() : {};

    return res.json({
      success: true,
      youtubeUrl: data?.youtubeUrl || '',
    });
  } catch (error) {
    console.error('❌ Fetch tutorial video setting error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/settings/tutorial-video', async (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ success: false, error: 'Admin access required.' });
  }

  const youtubeUrl = String(req.body?.youtubeUrl || '').trim();

  if (!youtubeUrl) {
    return res.status(400).json({ success: false, error: 'youtubeUrl is required.' });
  }

  try {
    const firestore = getAdminFirestore();
    await firestore.collection(SETTINGS_COLLECTION).doc('tutorial_video').set(
      {
        youtubeUrl,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return res.json({ success: true, youtubeUrl });
  } catch (error) {
    console.error('❌ Update tutorial video setting error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Generic Global Settings Endpoints (Firebase-backed)
app.get('/api/admin/settings/:category', async (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ success: false, error: 'Admin access required.' });
  }

  const category = String(req.params?.category || '').trim();
  if (!category) {
    return res.status(400).json({ success: false, error: 'Settings category is required.' });
  }

  try {
    const firestore = getAdminFirestore();
    const docSnap = await firestore.collection(SETTINGS_COLLECTION).doc(category).get();
    return res.json({ success: true, data: docSnap.exists ? (docSnap.data() || {}) : {} });
  } catch (error) {
    console.error('❌ Fetch global settings error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/settings/:category', async (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ success: false, error: 'Admin access required.' });
  }

  const category = String(req.params?.category || '').trim();
  if (!category) {
    return res.status(400).json({ success: false, error: 'Settings category is required.' });
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};

  try {
    const firestore = getAdminFirestore();
    await firestore.collection(SETTINGS_COLLECTION).doc(category).set({
      ...payload,
      lastUpdated: new Date().toISOString(),
    }, { merge: true });

    return res.json({ success: true, message: `${category} settings saved.` });
  } catch (error) {
    console.error('❌ Save global settings error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin Manual Backup Endpoint
app.get('/api/backup/manual', async (req, res) => {
  try {
    const result = await runBackup();

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error || 'Manual backup failed.' });
    }

    return res.json({ success: true, backupId: result.backupId, totalDocuments: result.totalDocuments });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Drive Backup Listing Endpoint
app.get('/api/backup/drive-list', async (_req, res) => {
  try {
    const files = await listBackupsFromDrive();
    return res.json({ success: true, files });
  } catch (error) {
    console.error('❌ Drive list error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Drive Backup Restore Endpoint
app.post('/api/backup/drive-restore', async (req, res) => {
  const { fileId } = req.body || {};

  if (!fileId) {
    return res.status(400).json({ success: false, error: 'fileId is required.' });
  }

  try {
    const result = await downloadAndRestoreFromDrive(String(fileId));
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ Drive restore error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Manual JSON Upload Restore Endpoint
app.post('/api/backup/upload-restore', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Backup JSON file is required.' });
  }

  const filePath = path.join(__dirname, req.file.path);

  try {
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const payload = JSON.parse(rawContent);

    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.documents)) {
      return res.status(400).json({ success: false, error: 'Invalid backup schema. Expected { documents: [] }.' });
    }

    const hasInvalidDoc = payload.documents.some((docEntry) => !docEntry || typeof docEntry !== 'object' || !docEntry.id);
    if (hasInvalidDoc) {
      return res.status(400).json({ success: false, error: 'Invalid backup schema: each document must include an id.' });
    }

    const result = await restoreInventoryFromBackupPayload(payload);
    return res.json({ success: true, mode: 'upload', ...result });
  } catch (error) {
    console.error('❌ Upload restore error:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

// Manual Retroactive Sweeper Trigger
app.post('/api/admin/retroactive-sweep', async (_req, res) => {
  try {
    const dryRun = String(_req.query?.dryRun || _req.body?.dryRun || '').toLowerCase() === 'true';
    const result = await runRetroactiveSweep({ dryRun });
    return res.json(result);
  } catch (error) {
    console.error('❌ Retroactive sweep error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/force-build-cache', async (_req, res) => {
  try {
    const firestore = getAdminFirestore();
    await firestore.collection(SETTINGS_COLLECTION).doc('cacheControl').set({
      cacheAutomationEnabled: true,
      cacheAutomationPausedByNuke: false,
      lastForceStartedAt: new Date().toISOString(),
    }, { merge: true });

    const workerPath = path.join(__dirname, 'workers', 'cacheWorker.js');
    const worker = new Worker(workerPath, { type: 'module' });

    worker.on('message', (message) => {
      if (message?.success) {
        console.log(`✅ Background cache worker completed with ${message.total} products.`);
      } else {
        console.error('❌ Background cache worker failed:', message?.error || 'Unknown error');
      }
    });

    worker.on('error', (error) => {
      console.error('❌ Cache worker runtime error:', error.message);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`❌ Cache worker exited with code ${code}`);
      }
    });

    return res.status(202).json({
      success: true,
      message: 'Cache build started in background. You will be notified upon completion.',
    });
  } catch (error) {
    console.error('Cache worker spawn failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/nuke-server-memory', (_req, res) => {
  resetGlobalMemoryCache();
  return res.status(200).json({ message: 'Server memory wiped successfully' });
});


app.post('/api/admin/nuke-cache-system', async (_req, res) => {
  try {
    const firestore = getAdminFirestore();

    const deletedChunks = await deleteCollectionDocuments(SETTINGS_COLLECTION, (docSnap) => docSnap.id.startsWith('cache_chunk_'));

    await firestore.collection(SETTINGS_COLLECTION).doc('globalProductsCache').delete().catch(() => null);

    // Also nuke shadow product caches/indexes so old polluted containers are removed.
    const deletedProductContainers = await deleteCollectionDocuments('horleyTech_ProductContainers');
    const deletedAliasIndex = await deleteCollectionDocuments('horleyTech_ProductAliasIndex');

    await firestore.collection(SETTINGS_COLLECTION).doc('cacheControl').set({
      cacheAutomationEnabled: false,
      cacheAutomationPausedByNuke: true,
      nukedAt: new Date().toISOString(),
      deletedChunks,
      deletedProductContainers,
      deletedAliasIndex,
    }, { merge: true });

    resetGlobalMemoryCache();

    return res.status(200).json({
      success: true,
      message: 'Global/product caches nuked. Automation is OFF until force build is triggered.',
      deletedChunks,
      deletedProductContainers,
      deletedAliasIndex,
    });
  } catch (error) {
    console.error('❌ Cache nuke failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin Database Restore Endpoint
app.post('/api/backup/restore', async (req, res) => {
  const { backupId } = req.body || {};

  if (!backupId) {
    return res.status(400).json({ success: false, error: 'backupId is required.' });
  }

  try {
    const autoSaveResult = await runBackup();

    if (!autoSaveResult?.success) {
      throw new Error(autoSaveResult?.error || 'Auto-save backup failed before restore.');
    }

    const payload = await getBackupPayloadFromFirestore(String(backupId));
    const result = await restoreInventoryFromBackupPayload(payload);

    return res.json({
      success: true,
      restoredDocuments: result.restoredDocuments,
      backupId,
      autoSaveBackupId: autoSaveResult.backupId,
    });
  } catch (error) {
    console.error('❌ Restore error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin-Vendor Chat Messaging Endpoints (Version 3.1)
app.post('/api/messages/send', async (req, res) => {
  const { vendorId, sender, recipient, text } = req.body || {};

  if (!vendorId || !sender || !recipient || !text?.trim()) {
    return res.status(400).json({ success: false, error: 'vendorId, sender, recipient and text are required.' });
  }

  try {
    const firestore = getAdminFirestore();
    const payload = {
      vendorId: String(vendorId),
      sender: String(sender),
      recipient: String(recipient),
      text: String(text).trim(),
      timestamp: new Date().toISOString(),
      createdAt: Date.now(),
      readByAdmin: sender !== 'vendor',
    };

    const docRef = await firestore.collection(MESSAGE_COLLECTION).add(payload);
    const saved = { id: docRef.id, ...payload };
    messagesCache = [saved, ...messagesCache].slice(0, 200);
    messagesCacheUpdatedAt = Date.now();
    return res.json({ success: true, message: saved });
  } catch (error) {
    console.error('❌ Send message error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/messages', async (_req, res) => {
  const now = Date.now();
  const cacheFresh = messagesCache.length > 0 && (now - messagesCacheUpdatedAt) < MESSAGES_CACHE_TTL_MS;

  if (cacheFresh) {
    return res.json({ success: true, messages: messagesCache, source: 'cache' });
  }

  try {
    const firestore = getAdminFirestore();
    const snapshot = await withTimeout(
      () => firestore.collection(MESSAGE_COLLECTION).orderBy('createdAt', 'desc').limit(200).get(),
      MESSAGE_FETCH_TIMEOUT_MS,
      'Messages fetch timed out',
    );

    const messages = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    messagesCache = messages;
    messagesCacheUpdatedAt = Date.now();

    return res.json({ success: true, messages, source: 'firestore' });
  } catch (error) {
    console.error('❌ Fetch all messages error:', error.message);

    if (messagesCache.length > 0) {
      return res.status(200).json({
        success: true,
        messages: messagesCache,
        source: 'stale-cache',
        warning: 'Serving stale messages due to backend timeout.',
      });
    }

    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/messages/:vendorId', async (req, res) => {
  const { vendorId } = req.params;

  if (!vendorId) {
    return res.status(400).json({ success: false, error: 'vendorId is required.' });
  }

  try {
    const firestore = getAdminFirestore();
    const snapshot = await firestore.collection(MESSAGE_COLLECTION).where('vendorId', '==', vendorId).orderBy('createdAt', 'asc').get();
    const messages = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

    const unreadVendorMessages = snapshot.docs.filter((docSnap) => {
      const data = docSnap.data();
      return data.sender === 'vendor' && !data.readByAdmin;
    });

    if (unreadVendorMessages.length > 0) {
      const batch = firestore.batch();
      unreadVendorMessages.forEach((docSnap) => {
        batch.update(docSnap.ref, { readByAdmin: true });
      });
      await batch.commit();
    }

    return res.json({ success: true, messages });
  } catch (error) {
    console.error('❌ Fetch vendor messages error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// AI Auto-Setup/Fixer Endpoint (Version 3.3)
app.post('/api/ai/fix-inventory', async (req, res) => {
  const { actionType } = req.body || {};
  const products = Array.isArray(req.body?.products) ? req.body.products : null;

  if (!products) {
    return res.status(400).json({ success: false, error: 'products array is required.' });
  }

  const normalizedActionType = actionType === 'images' ? 'images' : 'fix';

  try {
    if (normalizedActionType === 'fix') {
      const systemPrompt = `You are a data cleaner. Standardize the following electronics inventory list. Fix typos in 'Device Type', ensure 'Storage Capacity/Configuration' is formatted like '128GB' or '8GB/256GB', and ensure 'SIM Type/Model/Processor' is clear. Return the exact JSON structure provided.`;

      const textAI = await resolveTextAIConfig({ background: true });
      const aiResponse = await textAI.client.chat.completions.create({
        model: textAI.model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify(products),
          },
        ],
        temperature: 0,
      });

      const rawContent = aiResponse.choices?.[0]?.message?.content || '[]';
      const cleanJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = sanitizeForFirestore(JSON.parse(cleanJson));

      if (!Array.isArray(parsed)) {
        return res.status(500).json({ success: false, error: 'AI response was not an array.' });
      }

      return res.json({ success: true, products: parsed });
    }

    const imageProcessedProducts = [];

    for (const product of products) {
      const nextProduct = { ...product };

      try {
        const imagePrompt = `A professional, realistic, studio-quality product photo of a ${product['Device Type'] || 'device'} ${product.Condition || ''} on a pure white background.`;

        const imageAI = await resolveImageAIConfig();
        const imageResponse = await imageAI.client.images.generate({
          model: imageAI.model,
          prompt: imagePrompt,
          size: '256x256',
          response_format: 'b64_json',
        });

        const responseB64 = imageResponse?.data?.[0]?.b64_json;
        if (responseB64) {
          nextProduct.productImageBase64 = `data:image/png;base64,${responseB64}`;
        }
      } catch (imageError) {
        console.error(`❌ AI image generation failed for ${product['Device Type'] || 'Unknown Device'}:`, imageError.message || imageError);
      }

      imageProcessedProducts.push(nextProduct);
    }

    return res.json({ success: true, products: imageProcessedProducts });
  } catch (error) {
    console.error('❌ AI fix inventory error:', error);
    return res.status(500).json({ success: false, error: error.message || 'AI processing failed.' });
  }
});

const normalizePriceToken = (token = '', options = {}) => {
  const rawToken = String(token || '').toLowerCase().trim();
  const raw = rawToken.replace(/[^0-9mk.,]/g, '').trim();
  if (!raw) return 0;

  const hasMillionSuffix = raw.endsWith('m');
  const hasThousandSuffix = raw.endsWith('k');
  const hasDecimal = raw.includes('.');
  const numericText = raw.replace(/[mk]/g, '').replace(/,/g, '');
  const numeric = Number(numericText);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;

  if (hasMillionSuffix) return Math.round(numeric * 1000000);
  if (hasThousandSuffix) return Math.round(numeric * 1000);
  if (hasDecimal && numeric < 10 && options?.assumeMillionsForSmallDecimal) {
    return Math.round(numeric * 1000000);
  }
  return Math.round(numeric);
};

const normalizeVendorProductsWithShadow = async (vendorsData = []) => {
  const normalizedVendors = [];

  for (const vendor of vendorsData) {
    const currentProducts = Array.isArray(vendor?.products) ? vendor.products : [];
    const nextProducts = [];

    for (const product of currentProducts) {
      const rawProductString = String(
        product?.rawProductString
        || product?.raw
        || product?.rawString
        || product?.['Device Type']
        || ''
      ).trim();

      if (!rawProductString) continue;
      const parsedPrice = normalizePriceToken(product?.['Regular price'] || product?.price || '');

      try {
        const shadow = await processWithShadowTesting({ rawProductString, price: parsedPrice });
        nextProducts.push({
          ...product,
          Category: shadow.taxonomy?.Category || product?.Category || 'Others',
          Brand: shadow.taxonomy?.Brand || product?.Brand || 'Others',
          Series: shadow.taxonomy?.Series || product?.Series || 'Others',
          'Device Type': shadow.deviceType || product?.['Device Type'] || shadow.taxonomy?.Series || rawProductString,
          Condition: shadow.condition || product?.Condition || 'Unknown',
          'SIM Type/Model/Processor': shadow.sim || product?.['SIM Type/Model/Processor'] || 'Unknown',
          'Storage Capacity/Configuration': shadow.storage || product?.['Storage Capacity/Configuration'] || 'UNKNOWN',
          'Regular price': shadow.price || product?.['Regular price'] || 'Available',
          variationId: shadow.variationId || product?.variationId || null,
          ignored: Boolean(shadow.ignored),
          ignoreReason: shadow.ignoreReason || '',
          trustedFastLane: Boolean(shadow.trustedFastLane),
          rawProductString,
        });
      } catch (error) {
        nextProducts.push(product);
      }
    }

    normalizedVendors.push({
      ...vendor,
      products: nextProducts,
    });
  }

  return normalizedVendors;
};

app.post('/process', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.', status: false });
  }

  const filePath = path.join(__dirname, req.file.path);

  res.json({
    message: 'File uploaded. AI processing started in the background.',
    status: true,
  });

  try {
    const selectedVendorName = String(req.body?.selectedVendorName || '').trim();
    const selectedVendorId = String(req.body?.selectedVendorId || '').trim();

    const vendorsData = await processChatFile(filePath, {
      forcedVendorName: selectedVendorName || undefined,
      forcedVendorId: selectedVendorId || undefined,
    });

    if (vendorsData?.length) {
      const normalizedVendors = await normalizeVendorProductsWithShadow(vendorsData);
      await saveVendorsToFirebase(normalizedVendors);
    }
  } catch (err) {
    console.error('❌ Error processing manual upload:', err);
  } finally {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

app.post('/api/webhook/whatsapp', async (req, res) => {
  const incomingApiKey = req.headers['x-api-key'];
  if (process.env.WEBHOOK_SECRET && incomingApiKey !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ data: [{ message: '' }] });
  }

  const { senderName, senderMessage, isMessageFromGroup, groupName } = req.body;

  if (!senderName || !senderMessage) {
    return res.status(200).json({ data: [{ message: '' }] });
  }

  res.status(200).json({ data: [{ message: '' }] });

  try {
    const normalizeVendorKey = (value = '') => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const resolveExtractionRoutingConfig = async () => {
      try {
        const firestore = getAdminFirestore();
        const docSnap = await firestore.collection(SETTINGS_COLLECTION).doc('extractionRouting').get();
        const data = docSnap.exists ? (docSnap.data() || {}) : {};
        const enabled = data?.enabled !== false;
        const rawList = Array.isArray(data?.strictVendors)
          ? data.strictVendors
          : String(data?.strictVendors || '').split(',');
        const strictVendors = rawList
          .map((item) => normalizeVendorKey(item))
          .filter(Boolean);
        return { enabled, strictVendors: new Set(strictVendors) };
      } catch (error) {
        console.warn('⚠️ Extraction routing config load skipped:', error.message);
        return { enabled: true, strictVendors: new Set() };
      }
    };

    const routingConfig = await resolveExtractionRoutingConfig();
    const strictVendorMode = routingConfig.enabled
      && routingConfig.strictVendors.has(normalizeVendorKey(senderName));

    const pipelineMetrics = {
      fragmentsMerged: 0,
      fragmentsSkippedWithoutBase: 0,
      linesSeen: 0,
      linesParsedDeterministic: 0,
      linesDroppedDeterministic: 0,
      dropReasons: {},
      strictVendorMode: strictVendorMode ? 1 : 0,
    };
    const incrementDropReason = (reason = 'unknown') => {
      const key = String(reason || 'unknown');
      pipelineMetrics.dropReasons[key] = Number(pipelineMetrics.dropReasons[key] || 0) + 1;
    };

    const isLikelyFragment = (raw = '') => {
      const text = String(raw || '').trim();
      if (!text) return true;
      if (text.length <= 3) return true;

      const lower = text.toLowerCase();
      const colorOnly = /^(black|white|gold|silver|purple|blue|green|red|pink|gray|grey|midnight)$/i.test(lower);
      const specOnly = /^(esim|physical\s*sim|locked|fu|idm|ibm|wifi|wi-?fi\s*only)$/i.test(lower);
      const memoryOnly = /^\d+\s*\/\s*\d+\s*(gb|tb)$/i.test(lower);
      const storageOnly = /^\d+\s*(gb|tb)$/i.test(lower);
      const styleOnly = /^([a-z\s-]+)?\(?\s*(clear|transition|transitions|lens|frame|cerulean|shiny|matte|black|blue|silver|gold|orange|pink)\s*[a-z\s-]*\)?$/i.test(lower);

      return colorOnly || specOnly || memoryOnly || storageOnly || styleOnly;
    };

    const mergeFragmentedProducts = (products = []) => {
      const merged = [];

      products.forEach((item) => {
        const raw = String(item?.rawProductString || '').trim();
        if (!raw) return;

        if (isLikelyFragment(raw)) {
          const previous = merged[merged.length - 1];
          if (previous) {
            previous.rawProductString = `${previous.rawProductString} | ${raw}`;
            pipelineMetrics.fragmentsMerged += 1;
          } else {
            pipelineMetrics.fragmentsSkippedWithoutBase += 1;
          }
          return;
        }

        merged.push({
          ...item,
          rawProductString: raw,
        });
      });

      return merged;
    };

    const stripWhatsAppEnvelope = (line = '') => String(line || '')
      .replace(/^\[\d{1,2}\/\d{1,2}(?:\/\d{2,4})?,\s*[\d:]+\s*(?:am|pm)?\]\s*[^:]+:\s*/i, '')
      .replace(/^\[\d{1,2}:\d{2}\s*(?:am|pm),\s*\d{1,2}\/\d{1,2}\/\d{2,4}\]\s*[^:]+:\s*/i, '')
      .trim();

    const normalizeLinesForDeterministicParse = (message = '') => {
      const normalizedMessage = String(message || '')
        // Handle pasted text that contains literal escaped newlines (e.g. "\\n")
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\n');

      const rows = normalizedMessage
        .split('\n')
        .map((line) => stripWhatsAppEnvelope(line))
        .map((line) => line.trim())
        .filter(Boolean);

      const conditionedRows = [];
      let sectionCondition = '';
      for (const row of rows) {
        const line = String(row || '').trim();
        if (!line) continue;

        const sectionMatch = line.match(/^\*?\s*(non\s*active(?:\s*without\s*warranty)?|active\s*stock|active|brand\s*new|uk\s*used)\s*\*?$/i);
        if (sectionMatch?.[1]) {
          const token = sectionMatch[1].toLowerCase();
          if (token.includes('brand new')) sectionCondition = 'Brand New';
          else if (token.includes('non')) sectionCondition = 'Non Active';
          else if (token.includes('active')) sectionCondition = 'Active';
          else if (token.includes('uk used')) sectionCondition = 'UK Used';
          continue;
        }

        if (/^\d+\s*[.)]?\s*$/.test(line)) continue;

        const hasConditionTag = /(brand\s*new|non\s*active|active|uk\s*used|like\s*new|good\s*condition|used)/i.test(line);
        const hasPriceHint = /(₦\s*)?\d[\d,.\s]*(m|k)?\b/i.test(line);
        const looksLikeProductEntry = /(iphone|ipad|macbook|airpod|watch|samsung|galaxy|fold|flip|pixel|note|tab|laptop|gb|tb|wig)/i.test(line);
        if (sectionCondition && !hasConditionTag && hasPriceHint && looksLikeProductEntry) {
          conditionedRows.push(`${line} | ${sectionCondition}`);
        } else {
          conditionedRows.push(line);
        }
      }

      const merged = [];
      for (const line of conditionedRows) {
        const priceOnly = /^(₦?\s*)?\d[\d,.\s]*(m|k)?$/i.test(line);
        if (priceOnly && merged.length > 0) {
          merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`;
        } else {
          merged.push(line);
        }
      }
      return merged;
    };

    const deterministicLineExtract = (line = '') => {
      const cleaned = String(line || '')
        .replace(/\*(₦?\s*[\d,]+(?:\.\d+)?\s*[mk]?)\*/gi, '$1')
        .replace(/^[-*•]+\s*/, '')
        .replace(/^\d+\s*[🅰🅱🅾a-z]*[\s.)-]*/iu, '')
        .replace(/@\s*n/gi, ' ₦')
        .replace(/\bn(?=\d)/gi, '₦')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) return null;
      if (isLikelyFragment(cleaned)) return null;

      const compactLine = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
      const startsWithSamsungShorthand = /^(s\d{1,2}(plus|ultra)?|note\d{1,2}(plus|ultra)?|flip\d{1,2}|fold\d{1,2})\b/.test(compactLine);
      const workingLine = startsWithSamsungShorthand && !/\bsamsung\b|\bgalaxy\b|\biphone\b/i.test(cleaned)
        ? `Samsung ${cleaned}`
        : cleaned;
      const hasProductSignal = /(iphone|ipad|macbook|airpod|watch|pixel|samsung|galaxy|fold|flip|ultra|pro|max|hp|lenovo|dell|asus|acer|thinkpad|ideapad|yoga|omnibook|pavilion|xps|alienware|printer|monitor|ups|tv|television|ssd|ram|gb|tb|wifi|cell|sim|core\s*i[3579])/i.test(workingLine)
        || /\bwig\b|\bfrontal\b|\bclosure\b|\bdensity\b|\bbody\s*wave\b|\bbone\s*straight\b|\bkinky\b/i.test(workingLine)
        || startsWithSamsungShorthand;

      const isNonProductLine = /(updated price list|enquiries|orders|please reconfirm|subject to change|confirm availability|follow us|instagram|street|lagos|stores ltd|call to confirm|monitor series|series\s*\*?$)/i.test(workingLine);
      if (isNonProductLine && !/\d[\d,.\s]*(m|k)?$/i.test(workingLine)) return null;

      const pipeParts = workingLine.split('||').map((part) => part.trim()).filter(Boolean);
      if (pipeParts.length >= 2) {
        const rawProduct = pipeParts.slice(0, -1).join(' | ');
        const priceToken = pipeParts[pipeParts.length - 1];
        const parsedPrice = normalizePriceToken(priceToken, { assumeMillionsForSmallDecimal: true });
        if (hasProductSignal && rawProduct && (parsedPrice >= 10000 || /available|active|act/i.test(priceToken))) {
          return {
            rawProductString: rawProduct,
            price: parsedPrice >= 10000 ? parsedPrice : 'Available',
          };
        }
      }

      // Best-format support: Product | Specs | Condition | Price
      // Also captures similar single-pipe vendor formats.
      const singlePipeParts = workingLine.split('|').map((part) => part.trim()).filter(Boolean);
      if (singlePipeParts.length >= 3) {
        const rawProduct = singlePipeParts.slice(0, -1).join(' | ');
        const priceToken = singlePipeParts[singlePipeParts.length - 1];
        const parsedPrice = normalizePriceToken(priceToken, { assumeMillionsForSmallDecimal: true });
        const leadSegment = String(singlePipeParts[0] || '').trim();
        const looksLikeStructuredGenericListing = /[a-z]{3,}/i.test(leadSegment)
          && !/(updated price list|enquiries|orders|follow us|instagram|stores ltd|lagos)/i.test(leadSegment);
        const allowGenericStructured = !strictVendorMode;
        if ((hasProductSignal || (allowGenericStructured && looksLikeStructuredGenericListing)) && rawProduct && parsedPrice >= 10000) {
          return {
            rawProductString: rawProduct,
            price: parsedPrice,
          };
        }
      }
      if (!hasProductSignal) return null;

      const availableMatch = workingLine.match(/^(.*?)(?:-|:)?\s*(available|act|active)\s*$/i);
      if (availableMatch?.[1]) {
        return { rawProductString: availableMatch[1].trim(), price: 'Available' };
      }

      const pricedMatch = workingLine.match(/^(.*?)(?:-|:|=|@)?\s*(₦?\s*[\d,]+(?:\.\d+)?\s*[mk]?)\s*$/i);
      if (pricedMatch?.[1] && pricedMatch?.[2]) {
        const rawPriceToken = String(pricedMatch[2] || '').trim();
        const hasPriceHint = /[₦mk]|,/.test(rawPriceToken);
        const numericToken = Number(rawPriceToken.replace(/[^0-9.]/g, ''));
        if (!hasPriceHint && (!Number.isFinite(numericToken) || numericToken < 10000)) return null;

        const normalizedPrice = normalizePriceToken(rawPriceToken, { assumeMillionsForSmallDecimal: true });
        return {
          rawProductString: pricedMatch[1].trim(),
          price: normalizedPrice || 'Available',
        };
      }

      const looksLikeNoPriceEntry = strictVendorMode && hasProductSignal
        && /\b(iphone|ipad|macbook|airpod|watch|samsung|galaxy|fold|flip|pixel|note|tab|s\d{1,2}|pro|max|plus|ultra|air|gb|tb)\b/i.test(workingLine);
      if (looksLikeNoPriceEntry) {
        return {
          rawProductString: workingLine.trim(),
          price: 'Available',
        };
      }

      return null;
    };

    const parsePriceFromRaw = (raw = '') => {
      const text = String(raw || '');
      const candidates = [];
      const moneyLikeMatches = text.match(/(?:₦\s*)?\d[\d,]{2,}(?:\.\d+)?\s*[mk]?/gi) || [];
      moneyLikeMatches.forEach((match) => {
        const value = normalizePriceToken(match, { assumeMillionsForSmallDecimal: true });
        if (value >= 10000) candidates.push(value);
      });

      const groupedMatches = text.match(/\d{1,3}(?:[,\s]\d{3}){1,3}/g) || [];
      groupedMatches.forEach((match) => {
        const numeric = Number(match.replace(/[^0-9]/g, ''));
        if (numeric >= 10000) candidates.push(numeric);
      });

      const plainMatches = text.match(/\b\d{4,7}\b/g) || [];
      plainMatches.forEach((match) => {
        const numeric = Number(match);
        if (numeric >= 10000) candidates.push(numeric);
      });

      return candidates.length ? Math.max(...candidates) : 0;
    };

    const computeConfidence = ({ shadowResult, normalizedPrice, rawProductString }) => {
      if (shadowResult?.ignored) {
        return { score: 10, level: 'low' };
      }

      let score = 0;
      const taxonomy = shadowResult?.taxonomy || {};
      const category = String(taxonomy?.Category || '').toLowerCase();
      const series = String(taxonomy?.Series || '').toLowerCase();
      const deviceType = String(shadowResult?.deviceType || '').toLowerCase();
      const condition = String(shadowResult?.condition || '').toLowerCase();
      const spec = String(shadowResult?.sim || '').toLowerCase();
      const storage = String(shadowResult?.storage || '').toUpperCase();

      if (category && category !== 'others') score += 30;
      if (series && series !== 'others') score += 15;
      if (deviceType && !['others', 'unknown device'].includes(deviceType)) score += 15;
      if (storage && storage !== 'UNKNOWN') score += 10;
      if (spec && spec !== 'unknown') score += 10;
      if (condition && condition !== 'unknown') score += 10;
      if (normalizedPrice >= 10000 || /₦|naira|k\b/i.test(String(rawProductString || ''))) score += 10;

      const bounded = Math.min(100, Math.max(0, score));
      const level = bounded >= 75 ? 'high' : bounded >= 45 ? 'medium' : 'low';
      return { score: bounded, level };
    };

    const stageOnePrompt = `
        You are Stage 1 Extractor.
        Extract products from messy WhatsApp broadcasts.
        Return JSON array only with EXACT keys:
        - rawProductString
        - price
        Do NOT categorize, do NOT infer taxonomy names, do NOT add extra keys.
        If no products are found, return [] only.
      `;

    let extractedProducts = [];

    // --- CROSS-LEARNED TOKEN FIX 1: THE CACHE ---
    // Fingerprint both the start and end so long messages with similar headers don't collide.
    const normalizedIncoming = String(senderMessage || '').trim();
    const toLineCacheKey = (value = '') => {
      const text = String(value || '');
      if (!text) return '';
      if (text.length <= 180) return text;
      return crypto.createHash('sha1').update(text).digest('hex');
    };
    const msgHash = `${normalizedIncoming.slice(0, 500)}::${normalizedIncoming.slice(-500)}::len-${normalizedIncoming.length}`;

    if (processedMessageCache.has(msgHash)) {
      console.log('⚡ Using cached extraction for repeat broadcast. Saving tokens!');
      extractedProducts = processedMessageCache.get(msgHash);
    } else {
      const rawLines = normalizeLinesForDeterministicParse(senderMessage)
        .map((line) => line.trim())
        .filter((line) => line.length > 3);
      pipelineMetrics.linesSeen += rawLines.length;

      let knownProducts = [];
      let unknownLines = [];

      rawLines.forEach((line) => {
        const lineHash = toLineCacheKey(line);
        if (lineLevelExtractionCache.has(lineHash)) {
          const cachedProducts = lineLevelExtractionCache.get(lineHash);
          if (Array.isArray(cachedProducts) && cachedProducts.length) {
            knownProducts = knownProducts.concat(cachedProducts);
          }
        } else {
          unknownLines.push(line);
        }
      });

      console.log(`📊 Broadcast Analysis: ${knownProducts.length} known products, ${unknownLines.length} unknown lines.`);
      extractedProducts = [...knownProducts];

      const extractFromText = async (textForAI, maxTokens = 300) => {
        let localRetries = 3;
        while (localRetries > 0) {
          try {
            const webhookAI = await resolveTextAIConfig({ background: false });
            const aiResponse = await webhookAI.client.chat.completions.create({
              model: webhookAI.model,
              messages: [
                { role: 'system', content: stageOnePrompt },
                { role: 'user', content: textForAI },
              ],
              temperature: 0,
              max_tokens: maxTokens,
            });
            const rawContent = String(aiResponse?.choices?.[0]?.message?.content || '');
            const cleanJson = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = sanitizeForFirestore(JSON.parse(cleanJson));
            return Array.isArray(parsed) ? parsed : [];
          } catch (err) {
            localRetries -= 1;
            if (localRetries > 0) {
              console.log(`⚠️ OpenAI Webhook Hiccup. Retrying... (${localRetries} left)`);
              await new Promise((resolve) => setTimeout(resolve, 2000));
            } else {
              throw new Error(`OpenAI failed after 3 retries: ${err.message}`);
            }
          }
        }
        return [];
      };

      if (unknownLines.length > 0) {
        const unresolvedLines = [];

        // Pass 1: deterministic extraction per line (works best for structured pricelist broadcasts).
        for (const unknownLine of unknownLines) {
          const lineText = unknownLine.substring(0, MAX_LINE_PARSE_CHARS);
          const lineHash = toLineCacheKey(lineText);
          const deterministicProduct = deterministicLineExtract(lineText);

          if (deterministicProduct) {
            const lineProducts = [deterministicProduct];
            extractedProducts = extractedProducts.concat(lineProducts);
            pipelineMetrics.linesParsedDeterministic += 1;
            if (lineLevelExtractionCache.size > 500) lineLevelExtractionCache.clear();
            lineLevelExtractionCache.set(lineHash, lineProducts);
            continue;
          }

          pipelineMetrics.linesDroppedDeterministic += 1;
          const dropReason = !/\d/.test(lineText)
            ? 'no-price'
            : (!/(iphone|ipad|macbook|airpod|watch|samsung|galaxy|fold|flip|pixel|note|tab|laptop|gb|tb|wig|service|repair|plumber)/i.test(lineText)
              ? 'no-signal'
              : 'unresolved');
          incrementDropReason(dropReason);
          unresolvedLines.push(lineText);
        }

        // Pass 2: AI only for truly unresolved lines.
        if (unresolvedLines.length > 0) {
          if (unresolvedLines.length <= 25) {
            for (const unresolvedLine of unresolvedLines) {
              const lineHash = toLineCacheKey(unresolvedLine);
              const lineProducts = await extractFromText(unresolvedLine, 160);
              extractedProducts = extractedProducts.concat(lineProducts);
              if (lineLevelExtractionCache.size > 500) lineLevelExtractionCache.clear();
              lineLevelExtractionCache.set(lineHash, lineProducts);
            }
          } else {
            const CHUNK_SIZE = 20;
            for (let index = 0; index < unresolvedLines.length; index += CHUNK_SIZE) {
              const chunkLines = unresolvedLines.slice(index, index + CHUNK_SIZE);
              const textForAI = chunkLines.join('\n').substring(0, MAX_AI_CHUNK_CHARS);
              const chunkProducts = await extractFromText(textForAI, 300);
              extractedProducts = extractedProducts.concat(chunkProducts);
            }
          }
        }
      }

      // Save full-message cache (cap to prevent memory leaks)
      if (processedMessageCache.size > 50) processedMessageCache.clear();
      processedMessageCache.set(msgHash, extractedProducts);
    }

    const stitchedProducts = mergeFragmentedProducts(extractedProducts);

    const shadowProcessed = [];
    for (const item of stitchedProducts) {
      const rawProductString = String(item?.rawProductString || '').trim();
      if (!rawProductString) continue;
      const parsedPrice = normalizePriceToken(item?.price || '', { assumeMillionsForSmallDecimal: true });
      const rawPrice = parsePriceFromRaw(rawProductString);
      const normalizedPrice = (parsedPrice > 0 && parsedPrice < 10000 && rawPrice >= 10000)
        ? rawPrice
        : (parsedPrice || rawPrice || 0);

      try {
        const shadowResult = await processWithShadowTesting({ rawProductString, price: normalizedPrice, strictVendorMode });
        const confidence = computeConfidence({ shadowResult, normalizedPrice, rawProductString });
        shadowProcessed.push({
          ...shadowResult,
          confidenceScore: confidence.score,
          confidenceLevel: confidence.level,
        });
      } catch (error) {
        console.warn('⚠️ Shadow processing failed for one item. Falling back to Others:', error.message);
        shadowProcessed.push({
          rawProductString,
          price: normalizedPrice,
          taxonomy: { Category: 'Others', Brand: 'Others', Series: 'Others' },
          deviceType: 'Unknown Device',
          storage: 'UNKNOWN',
          condition: 'Unknown',
          sim: 'Unknown',
          variationId: null,
          trustedFastLane: false,
          ignored: true,
          ignoreReason: 'shadow-failure',
          confidenceScore: 5,
          confidenceLevel: 'low',
        });
      }
    }

    const filteredShadowProcessed = strictVendorMode
      ? shadowProcessed.filter((item) => !(item?.ignored))
      : shadowProcessed;

    if (strictVendorMode) {
      const strictDrops = shadowProcessed.length - filteredShadowProcessed.length;
      if (strictDrops > 0) {
        console.log(`🧹 Strict mode filtered ${strictDrops} ignored/invalid items for ${senderName}.`);
      }
    }

    if (filteredShadowProcessed.length > 0) {
      console.log(`✅ Stage 1 extracted ${filteredShadowProcessed.length} items.`);
      const exactServerDate = new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' });

      const enrichedProducts = sanitizeForFirestore(filteredShadowProcessed.map((product) => ({
        Category: product.taxonomy?.Category || 'Others',
        Brand: product.taxonomy?.Brand || 'Others',
        Series: product.taxonomy?.Series || 'Others',
        'Device Type': product.deviceType || product.taxonomy?.Series || product.rawProductString,
        Condition: product.condition,
        'SIM Type/Model/Processor': product.sim,
        'Storage Capacity/Configuration': product.storage,
        'Regular price': product.price || 'Available',
        rawProductString: product.rawProductString,
        variationId: product.variationId,
        trustedFastLane: product.trustedFastLane,
        ignored: Boolean(product.ignored),
        ignoreReason: product.ignoreReason || '',
        confidenceScore: Number(product.confidenceScore || 0),
        confidenceLevel: product.confidenceLevel || 'low',
        DatePosted: exactServerDate,
        isGroupMessage: isMessageFromGroup || false,
        groupName: isMessageFromGroup ? groupName : 'Direct Message'
      })));

      const masterDocId = senderName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      const vendorData = [{
        vendorId: masterDocId,
        vendorName: senderName,
        lastUpdated: new Date().toISOString(),
        shareableLink: `/vendor/${masterDocId}`,
        products: enrichedProducts
      }];

      await saveVendorsToFirebase(vendorData);

      const excludedDrops = shadowProcessed.filter((item) => item?.ignoreReason === 'excluded-phrase').length;
      const taxonomyFallbacks = shadowProcessed.filter((item) => item?.ignoreReason === 'taxonomy-others').length;
      const lowConfidence = shadowProcessed.filter((item) => String(item?.confidenceLevel || '') === 'low').length;
      const strictFiltered = strictVendorMode
        ? Math.max(0, shadowProcessed.length - filteredShadowProcessed.length)
        : 0;
      try {
        const firestore = getAdminFirestore();
        const metrics = pipelineMetrics || { fragmentsMerged: 0, fragmentsSkippedWithoutBase: 0 };
        await firestore.collection(SETTINGS_COLLECTION).doc('pipelineMetrics').set({
          lastUpdated: new Date().toISOString(),
          fragmentsMerged: admin.firestore.FieldValue.increment(Number(metrics.fragmentsMerged || 0)),
          fragmentsSkippedWithoutBase: admin.firestore.FieldValue.increment(Number(metrics.fragmentsSkippedWithoutBase || 0)),
          linesSeen: admin.firestore.FieldValue.increment(Number(metrics.linesSeen || 0)),
          linesParsedDeterministic: admin.firestore.FieldValue.increment(Number(metrics.linesParsedDeterministic || 0)),
          linesDroppedDeterministic: admin.firestore.FieldValue.increment(Number(metrics.linesDroppedDeterministic || 0)),
          strictVendorModeRuns: admin.firestore.FieldValue.increment(Number(metrics.strictVendorMode || 0)),
          excludedPhraseDrops: admin.firestore.FieldValue.increment(excludedDrops),
          taxonomyFallbackDrops: admin.firestore.FieldValue.increment(taxonomyFallbacks),
          lowConfidenceRows: admin.firestore.FieldValue.increment(lowConfidence),
          strictFilteredRows: admin.firestore.FieldValue.increment(strictFiltered),
        }, { merge: true });
        if (metrics.dropReasons && Object.keys(metrics.dropReasons).length) {
          await firestore.collection(SETTINGS_COLLECTION).doc('pipelineMetrics').set({
            dropReasons: Object.entries(metrics.dropReasons).reduce((acc, [reason, count]) => {
              acc[reason] = admin.firestore.FieldValue.increment(Number(count || 0));
              return acc;
            }, {}),
          }, { merge: true });
        }
      } catch (metricError) {
        console.warn('⚠️ Pipeline metrics write skipped:', metricError.message);
      }
    } else if (strictVendorMode && shadowProcessed.length > 0) {
      console.log(`🛑 Strict mode blocked save for ${senderName}; all ${shadowProcessed.length} items were ignored.`);
    } else {
      console.log('🤷‍♂️ No products found in message.');
    }
  } catch (error) {
    console.error('❌ Webhook Processing Error:', error);
  }
});


const _normalizeMappingKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const _fetchUnknownVendorsList = async () => {
  const firestore = getAdminFirestore();
  const snapshot = await firestore.collection(OFFLINE_COLLECTION).get();
  const unknownCandidates = new Set();

  snapshot.docs.forEach((docSnap) => {
    const vendorData = docSnap.data() || {};
    const products = Array.isArray(vendorData.products) ? vendorData.products : [];

    products.forEach((product) => {
      const condition = String(product?.Condition || product?.condition || '').trim();
      const deviceType = String(product?.['Device Type'] || product?.deviceType || '').trim();
      const isUnknownCondition = condition.toLowerCase() === 'unknown';
      const isUnknownDevice = !deviceType || deviceType.toLowerCase() === 'unknown device';
      if (!isUnknownCondition && !isUnknownDevice) return;

      const rawString = [
        product?.raw,
        product?.rawString,
        product?.['Device Type'],
        product?.deviceType,
        product?.['SIM Type/Model/Processor'],
        product?.Condition,
      ].filter(Boolean).join(' ').trim();

      if (!rawString) return;
      unknownCandidates.add(rawString);
    });
  });

  return Array.from(unknownCandidates).map((raw) => ({ raw }));
};

const _runOpenAIExtraction = async (rows = [], signal) => {
  const systemPrompt = `You are a strict Two-Layer AI Judge. Given an array of objects with a "raw" string, extract details. You MUST return a JSON object with a single root key called "data" containing an array of objects. Each object must strictly have: - "raw": The exact original string - "category", "brand", "series": Standard classifications - "deviceType": The standard clean device name - "condition": STRICTLY evaluate to "Brand New", "Grade A UK Used", or "Unknown" - "sim": STRICTLY evaluate to "Physical SIM", "ESIM", "Physical SIM + ESIM", "Locked/Wi-Fi Only (ESIM)", or "Unknown" - "isOthers": true if unknown/obscure, else false;`;

  const backgroundAI = await resolveTextAIConfig({ background: true });
  const aiResponse = await backgroundAI.client.chat.completions.create({
    model: backgroundAI.model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(rows) },
    ],
    temperature: 0,
  }, { signal });

  const parsed = sanitizeForFirestore(JSON.parse(aiResponse.choices?.[0]?.message?.content || '{}'));
  return Array.isArray(parsed.data) ? parsed.data : [];
};

app.post('/api/admin/trigger-background-sync', async (_req, res) => {
  res.status(200).json({ message: 'Background sync started' });

  const CAT_LIST = ['Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'];
  const CHUNK_SIZE = 20;
  const CHUNK_TIMEOUT_MS = 45000;
  let db;

  const withTimeout = async (promiseFactory, timeoutMs, timeoutMessage) => Promise.race([
    promiseFactory(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
  ]);

  const safeSetSyncStatus = async (payload) => {
    if (!db) return;
    try {
      await db.collection('horleyTech_Settings').doc('syncStatus').set(payload, { merge: true });
    } catch (error) {
      console.warn('⚠️ syncStatus write skipped:', error.message);
    }
  };

  try {
    db = getAdminFirestore();
    console.log('🔄 Background Sync: Initializing...');

    const accumulatedMappings = {};
    for (const cat of CAT_LIST) {
      try {
        const catDoc = await withTimeout(
          () => db.collection(SETTINGS_COLLECTION).doc(`mappings_${cat}`).get(),
          20000,
          `Timeout loading mappings_${cat}`,
        );

        if (catDoc.exists) {
          const data = catDoc.data();
          if (data?.mappings) Object.assign(accumulatedMappings, data.mappings);
        }
      } catch (error) {
        console.warn(`⚠️ Could not load mappings_${cat}:`, error.message);
      }
    }

    const vendorsSnap = await withTimeout(
      () => db.collection('horleyTech_OfflineInventories').get(),
      30000,
      'Timeout loading offline inventories',
    );

    const unknownsSet = new Set();
    vendorsSnap.docs.forEach((docSnap) => {
      const products = docSnap.data().products || [];
      products.forEach((product) => {
        const raw = String(product.raw || product.rawString || product['Device Type'] || '').trim();
        if (!raw) return;
        const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
        const mapping = accumulatedMappings[key];
        if (!mapping || mapping.condition === 'Unknown' || mapping.deviceType === 'Unknown Device') {
          unknownsSet.add(raw);
        }
      });
    });

    const candidates = Array.from(unknownsSet).map((raw) => ({ raw }));
    console.log(`🔄 Background Sync: Found ${candidates.length} candidates for AI evaluation.`);

    if (!candidates.length) {
      await safeSetSyncStatus({ isSyncing: false, progress: 'No new items', justFinished: true });
      return;
    }

    let chunkMappings = {};
    let failedChunks = 0;

    for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
      const isCheckpoint = ((i / CHUNK_SIZE) % 5 === 0) || (i + CHUNK_SIZE >= candidates.length);
      const chunk = candidates.slice(i, i + CHUNK_SIZE);

      if (isCheckpoint) {
        try {
          const statusCheck = await withTimeout(
            () => db.collection('horleyTech_Settings').doc('syncStatus').get(),
            10000,
            'Timeout reading syncStatus',
          );

          if (statusCheck.exists && statusCheck.data().cancelRequested === true) {
            console.log('🛑 Background sync stopped by Admin.');
            await safeSetSyncStatus({ isSyncing: false, progress: 'Stopped by Admin', cancelRequested: false, justFinished: true });
            return;
          }
        } catch (error) {
          console.warn('⚠️ syncStatus checkpoint read skipped:', error.message);
        }

        const progressText = `Backend AI Judging ${Math.min(i + CHUNK_SIZE, candidates.length)} / ${candidates.length} (failed chunks: ${failedChunks})`;
        console.log(progressText);
        await safeSetSyncStatus({ isSyncing: true, progress: progressText, heartbeatAt: new Date().toISOString() });
      }

      try {
        const completion = await withTimeout(
          async () => {
            const aiConfig = await resolveTextAIConfig({ background: true });
            return aiConfig.client.chat.completions.create({
              model: aiConfig.model,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: "You are an expert mobile device product detail extractor. You must output JSON with a 'data' array containing objects with properties: raw, brand, series, category, deviceType, condition, specification, isOthers. 'condition' strictly Brand New, Grade A UK Used, or Unknown. 'specification' MUST dynamically extract either the SIM Type (e.g. Physical SIM, ESIM), OR the Processor/Chip (e.g. M1, M2 Pro, Core i7), OR the Watch Size/Connectivity (e.g. 45mm, GPS, Cellular), depending on what the device is. Default to 'Unknown' if none found." },
                { role: 'user', content: `Extract data for these products: ${JSON.stringify(chunk)}. Always return valid JSON with a 'data' array.` },
              ],
              temperature: 0.1,
            });
          },
          CHUNK_TIMEOUT_MS,
          `OpenAI chunk timeout at index ${i}`,
        );

        const parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
        const data = Array.isArray(parsed.data) ? parsed.data : [];

        data.forEach((item) => {
          const raw = String(item?.raw || '').trim();
          if (!raw) return;

          const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
          chunkMappings[key] = {
            standardName: item.deviceType || 'Unknown Device',
            condition: item.condition || 'Unknown',
            specification: item.specification || item.sim || 'Unknown',
            isOthers: Boolean(item.isOthers),
            category: item.category || 'Others',
            brand: item.brand || 'Others',
            series: item.series || 'Others',
            deviceType: item.deviceType || 'Unknown Device',
          };
        });
      } catch (error) {
        failedChunks += 1;
        console.error(`❌ Backend Chunk ${i} failed:`, error.message);
      }

      if (isCheckpoint && Object.keys(chunkMappings).length > 0) {
        const shardUpdates = {};
        for (const [key, mapping] of Object.entries(chunkMappings)) {
          const safeCat = CAT_LIST.includes(mapping.category) ? mapping.category : 'Others';
          if (!shardUpdates[safeCat]) shardUpdates[safeCat] = {};
          shardUpdates[safeCat][key] = mapping;
        }

        for (const [catName, mapData] of Object.entries(shardUpdates)) {
          await withTimeout(
            () => db.collection(SETTINGS_COLLECTION).doc(`mappings_${catName}`).set({ mappings: mapData, lastUpdated: new Date().toISOString() }, { merge: true }),
            20000,
            `Timeout saving mappings_${catName}`,
          );
        }

        console.log(`✅ Database Checkpoint - Sharded & Saved ${Object.keys(chunkMappings).length} mapped items.`);
        chunkMappings = {};
      }
    }

    if (Object.keys(chunkMappings).length > 0) {
      const shardUpdates = {};
      for (const [key, mapping] of Object.entries(chunkMappings)) {
        const safeCat = CAT_LIST.includes(mapping.category) ? mapping.category : 'Others';
        if (!shardUpdates[safeCat]) shardUpdates[safeCat] = {};
        shardUpdates[safeCat][key] = mapping;
      }

      for (const [catName, mapData] of Object.entries(shardUpdates)) {
        await withTimeout(
          () => db.collection(SETTINGS_COLLECTION).doc(`mappings_${catName}`).set({ mappings: mapData, lastUpdated: new Date().toISOString() }, { merge: true }),
          20000,
          `Timeout final saving mappings_${catName}`,
        );
      }

      console.log(`✅ Final Complete Save - Sharded & Saved ${Object.keys(chunkMappings).length} mapped items.`);
    }

    console.log('🎉 Background Sync: Complete!');
    await safeSetSyncStatus({ isSyncing: false, progress: failedChunks ? `Sync Complete (with ${failedChunks} failed chunks)` : 'Sync Complete', justFinished: true });
  } catch (error) {
    console.error('❌ Fatal Background Sync Error:', error);
    await safeSetSyncStatus({ isSyncing: false, progress: 'Error during sync', justFinished: true });
  }
});


// --- UNIFIED DATABASE WIPE ENDPOINT (START AFRESH) ---
app.delete('/api/admin/nuke-everything', async (_req, res) => {
  try {
    const preservedSystemSettingDocIds = new Set(['adminPreferences', 'aiControl']);
    const preservedCollections = {
      ar_settings: 'collection preserved',
      horleyTech_PricingSessions: 'collection preserved',
      horleyTech_Settings: [...preservedSystemSettingDocIds],
    };
    const deletedStats = {
      ar_analytics: await deleteCollectionDocuments('ar_analytics'),
      ar_customers: await deleteCollectionDocuments('ar_customers'),
      ar_raw_requests: await deleteCollectionDocuments('ar_raw_requests'),
      ar_settings: 0,
      horleyTech_AuditLogs: await deleteCollectionDocuments('horleyTech_AuditLogs'),
      horleyTech_Backups: await deleteCollectionDocuments('horleyTech_Backups'),
      horleyTech_OfflineInventories: await deleteCollectionDocuments('horleyTech_OfflineInventories'),
      horleyTech_PlatformMessages: await deleteCollectionDocuments('horleyTech_PlatformMessages'),
      horleyTech_PricingSessions: 0,
      horleyTech_ProductAliasIndex: await deleteCollectionDocuments('horleyTech_ProductAliasIndex'),
      horleyTech_ProductContainers: await deleteCollectionDocuments('horleyTech_ProductContainers'),
      horleyTech_Settings: await deleteCollectionDocuments(
        'horleyTech_Settings',
        (docSnap) => !preservedSystemSettingDocIds.has(docSnap.id),
      ),
    };

    // Reset Scrapebot memory cache + webhook extraction cache
    resetGlobalMemoryCache();
    processedMessageCache.clear();
    lineLevelExtractionCache.clear();

    return res.status(200).json({
      success: true,
      message: 'All Scrapebot and Auto Responder data wiped (pricing sessions + system settings preserved). Fresh start ready.',
      stats: deletedStats,
      preserved: preservedCollections,
    });
  } catch (error) {
    console.error('❌ Total Nuke failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server is running and listening on port ${PORT}`);
});
