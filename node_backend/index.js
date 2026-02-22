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
  res.send(fs.readFileSync('/root/.pm2/logs/index-out.log', 'utf8').split('\n').slice(-50).join('\n'));
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

  // 4. BACKGROUND AI PROCESSING
  try {
    const systemPrompt = `
        You are an expert product data extractor reading WhatsApp messages.
        Extract all mobile phones, tablets, laptops, games, and gadgets.
        
        Format the output as a JSON array of objects with EXACTLY these keys:
        - "Category": MUST be one of: 'iPhone', 'Samsung', 'Laptops', 'Smartphones', 'Smartwatch', 'Sound/Audio', 'Games', 'Tablets', 'Tecno', 'Infinix', 'Xiaomi', 'Oppo', 'Vivo'. If it does NOT fit these exactly, use 'Others'.
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

    const rawJson = aiResponse.choices[0].message.content.trim();
    const cleanJson = rawJson.replace(/^```json/g, '').replace(/```$/g, '').trim();
    const extractedProducts = JSON.parse(cleanJson);

    if (extractedProducts.length > 0) {
      console.log(`✅ AI Extracted ${extractedProducts.length} items.`);
      
      // EXACT SERVER DATE STAMP FIX
      const exactServerDate = new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' });

      const enrichedProducts = extractedProducts.map(product => ({
        ...product,
        DatePosted: exactServerDate, // Overrides the AI!
        isGroupMessage: isMessageFromGroup || false,
        groupName: isMessageFromGroup ? groupName : 'Direct Message'
      }));

      const identifier = senderName;

      const vendorData = [{
        vendorId: identifier,
        lastUpdated: new Date().toISOString(),
        shareableLink: `/vendor/${encodeURIComponent(identifier.replace(/\s+/g, '-'))}`,
        products: enrichedProducts
      }];

      await saveVendorsToFirebase(vendorData, OFFLINE_COLLECTION);
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
