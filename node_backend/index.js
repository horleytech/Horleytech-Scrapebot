import fs from 'fs';
import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import morgan from 'morgan';
import compression from 'compression';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import OpenAI from 'openai';
import admin from 'firebase-admin';
import { processChatFile } from './fileProcessor.js';
import { saveVendorsToFirebase } from './dataProcessor.js';
import { initializeCronTasks, runRetroactiveSweep } from './cronTasks.js';
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

const require = createRequire(import.meta.url);

const PM2_LOG_PATH = '/root/.pm2/logs/scrapebot-backend-out.log';
const OFFLINE_COLLECTION = 'horleyTech_OfflineInventories';
const BACKUP_COLLECTION = 'horleyTech_Backups';
const MESSAGE_COLLECTION = 'horleyTech_PlatformMessages';
const AUDIT_COLLECTION = 'horleyTech_AuditLogs';
const SETTINGS_COLLECTION = 'horleyTech_Settings';

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
const allowedOrigins = [
  'http://localhost:5173', // Local React Dev
  'http://localhost:3000', // Alternative Local Dev
  'https://scrapebot.horleytech.com', // Production Frontend
  'https://www.scrapebot.horleytech.com', // Production Frontend (www)
];
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-user-role'],
  credentials: true,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
}));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const PORT = process.env.PORT || 8000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CATS = "'Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'";

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
    const result = await runRetroactiveSweep();
    return res.json(result);
  } catch (error) {
    console.error('❌ Retroactive sweep error:', error);
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
    return res.json({ success: true, message: { id: docRef.id, ...payload } });
  } catch (error) {
    console.error('❌ Send message error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/messages', async (_req, res) => {
  try {
    const firestore = getAdminFirestore();
    const snapshot = await firestore.collection(MESSAGE_COLLECTION).orderBy('createdAt', 'desc').limit(200).get();
    const messages = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    return res.json({ success: true, messages });
  } catch (error) {
    console.error('❌ Fetch all messages error:', error);
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

      const aiResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
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
      const parsed = JSON.parse(cleanJson);

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

        const imageResponse = await openai.images.generate({
          model: 'dall-e-2',
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
      await saveVendorsToFirebase(vendorsData);
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
    const systemPrompt = `
        You are an expert product data extractor reading WhatsApp messages.
        Extract all relevant products.

        Format output as a JSON array with EXACT keys:
        - "Category": MUST be one of: ${CATS}. If unknown use 'Others'.
        - "SubCategory": strict sub-category when possible; otherwise dynamic fallback.
        - "Device Type"
        - "Condition"
        - "SIM Type/Model/Processor"
        - "Storage Capacity/Configuration"
        - "Regular price": numeric or 'Available' if no stated price.

        If no products are found, return []. Only return valid JSON.
        `;

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: senderMessage }
      ],
      temperature: 0,
    });

    const cleanJson = aiResponse.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
    const extractedProducts = JSON.parse(cleanJson);

    if (extractedProducts.length > 0) {
      console.log(`✅ AI Extracted ${extractedProducts.length} items.`);
      const exactServerDate = new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' });

      const enrichedProducts = extractedProducts.map((product) => ({
        ...product,
        DatePosted: exactServerDate,
        isGroupMessage: isMessageFromGroup || false,
        groupName: isMessageFromGroup ? groupName : 'Direct Message'
      }));

      const masterDocId = senderName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      const vendorData = [{
        vendorId: masterDocId,
        vendorName: senderName,
        lastUpdated: new Date().toISOString(),
        shareableLink: `/vendor/${masterDocId}`,
        products: enrichedProducts
      }];

      await saveVendorsToFirebase(vendorData);
    } else {
      console.log('🤷‍♂️ No products found in message.');
    }
  } catch (error) {
    console.error('❌ Webhook Processing Error:', error);
  }
});


const normalizeMappingKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const { getFirestore } = require('firebase-admin/firestore');

const fetchUnknownVendorsList = async () => {
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

const runOpenAIExtraction = async (rows = [], signal) => {
  const systemPrompt = `You are a strict Two-Layer AI Judge. Given an array of objects with a "raw" string, extract details. You MUST return a JSON object with a single root key called "data" containing an array of objects. Each object must strictly have: - "raw": The exact original string - "category", "brand", "series": Standard classifications - "deviceType": The standard clean device name - "condition": STRICTLY evaluate to "Brand New", "Grade A UK Used", or "Unknown" - "sim": STRICTLY evaluate to "Physical SIM", "ESIM", "Physical SIM + ESIM", or "Unknown" - "isOthers": true if unknown/obscure, else false;`;

  const aiResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(rows) },
    ],
    temperature: 0,
  }, { signal });

  const parsed = JSON.parse(aiResponse.choices?.[0]?.message?.content || '{}');
  return Array.isArray(parsed.data) ? parsed.data : [];
};

app.post('/api/admin/trigger-background-sync', async (req, res) => {
  res.status(200).json({ message: 'Background sync started' });
const db = getFirestore();
try {
console.log('🔄 Background Sync: Initializing...');

// 2. Fetch all existing Categorical Mappings
const CAT_LIST = ['Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'];
const accumulatedMappings = {};

for (const cat of CAT_LIST) {
  const catDoc = await db.collection(SETTINGS_COLLECTION).doc(`mappings_${cat}`).get();
  if (catDoc.exists) {
    const data = catDoc.data();
    if (data && data.mappings) {
      Object.assign(accumulatedMappings, data.mappings);
    }
  }
}
const mappings = accumulatedMappings;
const vendorsSnap = await db.collection('horleyTech_OfflineInventories').get();
const unknownsSet = new Set();
vendorsSnap.docs.forEach(docSnap => {
  const products = docSnap.data().products || [];
  products.forEach(p => {
    const raw = String(p.raw || p.rawString || p['Device Type'] || '').trim();
    if (!raw) return;
    const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!mappings[key] || mappings[key].condition === 'Unknown' || mappings[key].deviceType === 'Unknown Device') {
       unknownsSet.add(raw);
    }
  });
});
const candidates = Array.from(unknownsSet).map(str => ({ raw: str }));
console.log(`🔄 Background Sync: Found ${candidates.length} candidates for AI evaluation.`);
if (candidates.length === 0) {
  await db.collection('horleyTech_Settings').doc('syncStatus').set({ isSyncing: false, progress: 'No new items', justFinished: true }, { merge: true });
  return;
}
// OPTIMIZATION: Accumulate mappings to reduce database writes by 80%
let chunkMappings = {};
for (let i = 0; i < candidates.length; i += 20) {
  const isFifthChunk = ((i / 20) % 5 === 0);
  const isLastChunk = (i + 20 >= candidates.length);
  // 🛑 EMERGENCY STOP CHECK & UI UPDATE (Only every 5 chunks to save Firebase Read/Write costs)
  if (isFifthChunk || isLastChunk) {
    const statusCheck = await db.collection('horleyTech_Settings').doc('syncStatus').get();
    if (statusCheck.exists && statusCheck.data().cancelRequested === true) {
      console.log("🛑 Background sync stopped by Admin.");
      await db.collection('horleyTech_Settings').doc('syncStatus').set({ isSyncing: false, progress: 'Stopped by Admin', cancelRequested: false, justFinished: true }, { merge: true });
      return;
    }

    const progressText = `Backend AI Judging ${Math.min(i + 20, candidates.length)} / ${candidates.length}`;
    console.log(progressText);
    await db.collection('horleyTech_Settings').doc('syncStatus').set({ isSyncing: true, progress: progressText }, { merge: true });
  }
  const chunk = candidates.slice(i, i + 20);

  try {
    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
            { role: "system", content: "You are an expert mobile device product detail extractor. You must output JSON with a 'data' array containing objects with properties: raw, brand, series, category, deviceType, condition, specification, isOthers. 'condition' strictly Brand New, Grade A UK Used, or Unknown. 'specification' MUST dynamically extract either the SIM Type (e.g. Physical SIM, ESIM), OR the Processor/Chip (e.g. M1, M2 Pro, Core i7), OR the Watch Size/Connectivity (e.g. 45mm, GPS, Cellular), depending on what the device is. Default to 'Unknown' if none found." },
            { role: "user", content: `Extract data for these products: ${JSON.stringify(chunk)}. Always return valid JSON with a 'data' array.` }
        ],
        temperature: 0.1,
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    const data = Array.isArray(parsed.data) ? parsed.data : [];
    if (data.length > 0) {
      data.forEach(item => {
        const raw = String(item?.raw || '').trim();
        if (!raw) return;
        const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
        chunkMappings[key] = {
          standardName: item.deviceType || 'Unknown Device',
          condition: item.condition || 'Unknown',
          specification: item.specification || item.sim || 'Unknown', // Universal Spec field
          isOthers: Boolean(item.isOthers),
          category: item.category || 'Others',
          brand: item.brand || 'Others',
          series: item.series || 'Others',
          deviceType: item.deviceType || 'Unknown Device'
        };
      });
    }
  } catch (err) {
    console.error(`❌ Backend Chunk ${i} failed:`, err.message);
  }
  // OPTIMIZED AGGRESSIVE SAVE: Only write to Firebase every 100 items (or on the last chunk)
  if ((isFifthChunk || isLastChunk) && Object.keys(chunkMappings).length > 0) {
    // 📦 Categorical Sharding Checkpoint Save
    const shardUpdates = {};
    for (const [key, mapping] of Object.entries(chunkMappings)) {
      const safeCat = CAT_LIST.includes(mapping.category) ? mapping.category : 'Others';
      if (!shardUpdates[safeCat]) shardUpdates[safeCat] = {};
      shardUpdates[safeCat][key] = mapping;
    }

    for (const [catName, mapData] of Object.entries(shardUpdates)) {
      await db.collection(SETTINGS_COLLECTION).doc(`mappings_${catName}`).set({
        mappings: mapData,
        lastUpdated: new Date().toISOString(),
      }, { merge: true });
    }
    console.log(`✅ Database Checkpoint - Sharded & Saved ${Object.keys(chunkMappings).length} mapped items.`);
    // Reset accumulators after save
    chunkMappings = {};
  }
}

// 5. Final Complete Save
if (Object.keys(chunkMappings).length > 0) {
  const shardUpdates = {};
  for (const [key, mapping] of Object.entries(chunkMappings)) {
    const safeCat = CAT_LIST.includes(mapping.category) ? mapping.category : 'Others';
    if (!shardUpdates[safeCat]) shardUpdates[safeCat] = {};
    shardUpdates[safeCat][key] = mapping;
  }

  for (const [catName, mapData] of Object.entries(shardUpdates)) {
    await db.collection(SETTINGS_COLLECTION).doc(`mappings_${catName}`).set({
      mappings: mapData,
      lastUpdated: new Date().toISOString(),
    }, { merge: true });
  }
  console.log(`✅ Final Complete Save - Sharded & Saved ${Object.keys(chunkMappings).length} mapped items.`);
}

console.log('🎉 Background Sync: Complete!');
await db.collection('horleyTech_Settings').doc('syncStatus').set({ isSyncing: false, progress: 'Sync Complete', justFinished: true }, { merge: true });
} catch (error) {
console.error('❌ Fatal Background Sync Error:', error);
await db.collection('horleyTech_Settings').doc('syncStatus').set({ isSyncing: false, progress: 'Error during sync' }, { merge: true });
}
});
app.listen(PORT, () => {
  console.log(`✅ Server is running and listening on port ${PORT}`);
});
