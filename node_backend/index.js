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

dotenv.config();

const OFFLINE_COLLECTION = 'horleyTech_OfflineInventories';
const PM2_LOG_PATH = '/root/.pm2/logs/index-out.log';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ dest: './uploads' });
const app = express();

app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const PORT = process.env.PORT || 8000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get('/', (req, res) => {
  res.json({ message: 'Server Running' });
});

app.get('/api/logs', (req, res) => {
  try {
    if (!fs.existsSync(PM2_LOG_PATH)) {
      return res.status(404).json({ message: 'PM2 log file does not exist yet.', logs: '' });
    }

    const fileContent = fs.readFileSync(PM2_LOG_PATH, 'utf-8');
    const last50Lines = fileContent.split('\n').slice(-50).join('\n');
    return res.json({ logs: last50Lines });
  } catch (error) {
    console.error('Error reading PM2 logs:', error);
    return res.status(500).json({ message: 'Failed to read PM2 logs.', logs: '' });
  }
});

app.post('/process', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  const filePath = path.join(__dirname, req.file.path);

  res.json({
    message: 'File uploaded. AI processing started in the background.',
    status: true,
  });

  try {
    const vendorsData = await processChatFile(filePath);
    if (vendorsData?.length) {
      await saveVendorsToFirebase(vendorsData, OFFLINE_COLLECTION);
    }
  } catch (err) {
    console.error('❌ Error processing manual upload:', err);
  } finally {
    fs.unlink(filePath, (err) => {
      if (err) console.error('Error deleting file:', err);
    });
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
      You are an expert product data extractor.
      Extract all mobile phones, tablets, laptops, games, and gadgets from this single WhatsApp message.
      Return a JSON array with keys: Category, Device Type, Condition, SIM Type/Model/Processor,
      Storage Capacity/Configuration, Regular price, DatePosted.
      If no products exist, return [].
    `;

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: senderMessage },
      ],
      temperature: 0,
    });

    const rawJson = aiResponse.choices[0].message.content.trim();
    const cleanJson = rawJson.replace(/^```json/g, '').replace(/```$/g, '').trim();
    const extractedProducts = JSON.parse(cleanJson);

    if (extractedProducts.length > 0) {
      const enrichedProducts = extractedProducts.map((product) => ({
        ...product,
        isGroupMessage: isMessageFromGroup || false,
        groupName: isMessageFromGroup ? groupName : 'Direct Message',
      }));

      await saveVendorsToFirebase(
        [
          {
            vendorId: senderName,
            lastUpdated: new Date().toISOString(),
            shareableLink: `/vendor/${encodeURIComponent(senderName)}`,
            products: enrichedProducts,
          },
        ],
        OFFLINE_COLLECTION
      );
    }
  } catch (error) {
    console.error('❌ Webhook Processing Error:', error);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
