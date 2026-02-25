import fs from 'fs';
import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import morgan from 'morgan';
import compression from 'compression';
import cors from 'cors';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { processChatFile } from './fileProcessor.js';
import { saveVendorsToFirebase } from './dataProcessor.js';
import {
  initializeBackupJob,
  initializeSystemCollections,
  runBackup,
  getAdminFirestore,
  listBackupsFromDrive,
  downloadAndRestoreFromDrive,
  restoreInventoryFromBackupPayload,
} from './backup.js';

dotenv.config();

const PM2_LOG_PATH = '/root/.pm2/logs/index-out.log';
const OFFLINE_COLLECTION = 'horleyTech_OfflineInventories';
const BACKUP_COLLECTION = 'horleyTech_Backups';
const MESSAGE_COLLECTION = 'horleyTech_PlatformMessages';
const AUDIT_COLLECTION = 'horleyTech_AuditLogs';

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
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const PORT = process.env.PORT || 8000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CATS = "'Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'";

// Initialize infrastructure
initializeBackupJob();
initializeSystemCollections();


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
        oldData,
        newData: req.body || null,
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

// Admin Audit History Endpoint
app.get('/api/admin/audit-logs', async (req, res) => {
  const limit = Number.parseInt(req.query.limit, 10) || 200;

  try {
    const firestore = getAdminFirestore();
    const snapshot = await firestore
      .collection(AUDIT_COLLECTION)
      .orderBy('timestamp', 'desc')
      .limit(Math.min(limit, 500))
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
  const { vendorName, phoneNumber } = req.body || {};

  if (!vendorName || !phoneNumber) {
    return res.status(400).json({ success: false, error: 'vendorName and phoneNumber are required.' });
  }

  const cleanedNumber = String(phoneNumber).replace(/[^0-9]/g, '');
  if (!cleanedNumber) {
    return res.status(400).json({ success: false, error: 'phoneNumber must include digits.' });
  }

  const message = `Hello! I am ${String(vendorName).trim()}. Please onboard me. My product format will be: [Device] | [Specs] | [Condition] | [Price]`;
  const url = `https://wa.me/${cleanedNumber}?text=${encodeURIComponent(message)}`;

  return res.json({ success: true, url, message });
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

// Admin Database Restore Endpoint
app.post('/api/backup/restore', async (req, res) => {
  const { backupId } = req.body || {};

  if (!backupId) {
    return res.status(400).json({ success: false, error: 'backupId is required.' });
  }

  try {
    const firestore = getAdminFirestore();

    const backupDoc = await firestore.collection(BACKUP_COLLECTION).doc(backupId).get();
    if (!backupDoc.exists) {
      return res.status(404).json({ success: false, error: 'Backup version not found.' });
    }

    const payload = backupDoc.data();
    const result = await restoreInventoryFromBackupPayload(payload);

    return res.json({
      success: true,
      restoredDocuments: result.restoredDocuments,
      backupId,
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
    const vendorsData = await processChatFile(filePath);
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});