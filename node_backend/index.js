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

// Import our new Phase 1 functions
import { processChatFile } from './fileProcessor.js';
import { saveVendorsToFirebase } from './dataProcessor.js';

dotenv.config();

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

// ==========================================================
// 🚀 1. MANUAL UPLOAD ROUTE (Restored & Upgraded)
// ==========================================================
app.post('/process', upload.single('file'), async (req, res) => {
  if (!req.file) {
    console.error("No file uploaded.");
    return res.status(400).send('No file uploaded.');
  }

  const filePath = path.join(__dirname, req.file.path);
  console.log(`File path resolved as: ${filePath}`);

  // Respond to the frontend immediately so the loading spinner doesn't hang forever
  res.json({
    message: 'File Uploaded. AI processing started. Check dashboard shortly for updates.',
    status: true,
  });

  // Run the new AI Extractor in the background
  try {
    const vendorsData = await processChatFile(filePath);
    if (vendorsData && vendorsData.length > 0) {
        await saveVendorsToFirebase(vendorsData);
    }
    // Delete the file from the server after successful processing
    fs.unlink(filePath, (err) => {
      if (err) console.error('Error deleting file:', err);
      else console.log('🗑️ Deleted temporary upload file');
    });
  } catch (err) {
    console.error('❌ Error processing manual upload:', err);
  }
});

// ==========================================================
// 🚀 2. "AUTO LISTEN" WEBHOOK (Custom Header Auth)
// ==========================================================
app.post('/api/webhook/whatsapp', async (req, res) => {
    // 1. SECURE AUTHENTICATION: Look for 'x-api-key' in the custom headers
    // Express automatically converts header names to lowercase
    const incomingApiKey = req.headers['x-api-key'];

    if (incomingApiKey !== process.env.WEBHOOK_SECRET) {
        console.warn(`🚨 Unauthorized webhook attempt blocked. Invalid x-api-key.`);
        return res.status(401).json({ error: "Unauthorized. Invalid API Key." });
    }

    // 2. EXTRACT DATA: Catch the AutoResponder app's default payload
    const sender = req.body?.sender || req.body?.title;
    const message = req.body?.message || req.body?.senderMessage;

    if (!sender || !message) {
        return res.status(400).json({ error: "Missing sender or message." });
    }

    console.log(`📡 [AUTO LISTEN] Secure message received from ${sender}`);

    // Immediately send 200 OK so the Android app doesn't crash
    res.status(200).json({ status: "Secure message received, processing..." });

    try {
        const systemPrompt = `
        You are an expert product data extractor.
        Extract all mobile phones, tablets, laptops, games, and gadgets from this single WhatsApp message.
        
        Format the output as a JSON array of objects with EXACTLY these keys:
        - "Category": e.g., 'iPhone 14 Series'. If it does NOT fit a standard category, use 'Others'.
        - "Device Type": e.g., 'iPhone 14 Pro Max'.
        - "Condition": e.g., 'Brand New', 'UK Used'.
        - "SIM Type/Model/Processor": e.g., 'Physical SIM', 'ESIM'.
        - "Storage Capacity/Configuration": e.g., '256GB'.
        - "Regular price": The numeric price. CRITICAL: If no price is stated but it's in stock, use 'Available'.
        - "DatePosted": Use today's date: "${new Date().toISOString().split('T')[0]}".

        If no products are found in this message, return an empty array [].
        Only return the valid JSON array. Do not include markdown formatting.
        `;

        const aiResponse = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
            ],
            temperature: 0,
        });

        const rawJson = aiResponse.choices[0].message.content.trim();
        const cleanJson = rawJson.replace(/^```json/g, '').replace(/```$/g, '').trim();
        const extractedProducts = JSON.parse(cleanJson);

        if (extractedProducts.length > 0) {
            console.log(`✅ AI Extracted ${extractedProducts.length} items from ${sender}`);
            
            const vendorData = [{
                vendorId: sender,
                lastUpdated: new Date().toISOString(),
                shareableLink: `/vendor/${encodeURIComponent(sender.replace(/\s+/g, '-'))}`,
                products: extractedProducts
            }];

            await saveVendorsToFirebase(vendorData);
            console.log(`🗂️ Background save complete for ${sender}.`);
        } else {
            console.log(`🤷‍♂️ No products found in message from ${sender}.`);
        }

    } catch (error) {
        console.error(`❌ Webhook Processing Error for ${sender}:`, error);
    }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
