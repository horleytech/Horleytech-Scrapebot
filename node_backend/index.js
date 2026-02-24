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
import { initializeBackupJob } from './backup.js';

dotenv.config();

const PM2_LOG_PATH = '/root/.pm2/logs/index-out.log';

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
const CATS = "'iPhone', 'Samsung', 'Laptops', 'Smartphones', 'Smartwatch', 'Sound/Audio', 'Games', 'Tablets', 'Tecno', 'Infinix', 'Xiaomi', 'Oppo', 'Vivo', 'Accessories', 'Others'";

initializeBackupJob();

app.get('/', (req, res) => {
  res.json({ message: 'Server Running' });
});

app.get('/api/logs', (req, res) => {
  try {
    if (!fs.existsSync(PM2_LOG_PATH)) return res.send('No logs yet.');
    const content = fs.readFileSync(PM2_LOG_PATH, 'utf-8');
    res.send(content.split('\n').slice(-50).join('\n'));
  } catch (e) {
    res.send("Logs loading...");
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
        Extract all mobile phones, tablets, laptops, games, and gadgets.
        
        Format the output as a JSON array of objects with EXACTLY these keys:
        - "Category": MUST be one of: ${CATS}. If it does NOT fit these exactly, use 'Others'.
        - "Device Type": e.g., 'iPhone 15 Pro Max', 'PS5'.
        - "Condition": e.g., 'Brand New', 'UK Used'.
        - "SIM Type/Model/Processor": e.g., 'Physical SIM', 'ESIM', 'M1 Chip'.
        - "Storage Capacity/Configuration": e.g., '256GB'.
        - "Regular price": The numeric price. CRITICAL: If no price is stated but it's in stock, use 'Available'.

        If no products are found, return []. Only return valid JSON. Do not use markdown blocks.
        `;

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
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

      const enrichedProducts = extractedProducts.map(product => ({
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
      console.log(`🤷‍♂️ No products found in message.`);
    }

  } catch (error) {
    console.error(`❌ Webhook Processing Error:`, error);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
