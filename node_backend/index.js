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
import { initializeBackupJob, runBackup, getAdminFirestore } from './backup.js';

dotenv.config();

const PM2_LOG_PATH = '/root/.pm2/logs/index-out.log';
const OFFLINE_COLLECTION = 'horleyTech_OfflineInventories';
const BACKUP_COLLECTION = 'horleyTech_Backups';

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

initializeBackupJob();

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
    const backupDocuments = Array.isArray(payload.documents) ? payload.documents : [];

    const existingSnapshot = await firestore.collection(OFFLINE_COLLECTION).get();
    const operations = [];

    existingSnapshot.docs.forEach((docSnap) => {
      operations.push({
        type: 'delete',
        ref: firestore.collection(OFFLINE_COLLECTION).doc(docSnap.id),
      });
    });

    backupDocuments.forEach((vendorDoc) => {
      const { id, ...vendorData } = vendorDoc;
      if (!id) return;
      operations.push({
        type: 'set',
        ref: firestore.collection(OFFLINE_COLLECTION).doc(id),
        data: vendorData,
      });
    });

    await runBatchInChunks(operations);

    return res.json({
      success: true,
      restoredDocuments: backupDocuments.length,
      backupId,
    });
  } catch (error) {
    console.error('❌ Restore error:', error);
    return res.status(500).json({ success: false, error: error.message });
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
