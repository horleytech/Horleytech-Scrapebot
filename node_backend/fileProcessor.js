import OpenAI from 'openai';
import fs from 'fs';
import { convertString } from './cleaner.js';
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 1. THE BATCH CHUNKER
 * Splits the raw WhatsApp text into safe, token-friendly batches of lines.
 */
const createBatches = (rawText, linesPerBatch = 50) => {
  const lines = rawText.split('\n');
  const batches = [];
  
  for (let i = 0; i < lines.length; i += linesPerBatch) {
    batches.push(lines.slice(i, i + linesPerBatch).join('\n'));
  }
  
  return batches;
};

/**
 * 2. THE AI EXTRACTOR (PER BATCH)
 * The AI now reads the chunk, identifies the Sender, Date, and extracts the products.
 */
const extractFromBatch = async (batchText, batchNumber, totalBatches) => {
  console.log(`🤖 Processing Batch ${batchNumber} of ${totalBatches}...`);

  const systemPrompt = `
  You are an expert data extractor reading raw WhatsApp chat exports.
  Identify who sent each message and extract all mobile phones, tablets, laptops, games, and gadgets.
  
  Format the output as a JSON array of objects with EXACTLY these keys:
  - "vendorId": The exact Name or Phone Number of the person who sent the message. (Critical: Do not use the date/time, just the sender's identifier).
  - "DatePosted": The date the message was sent, extracted from the chat log.
  - "Category": e.g., 'iPhone 14 Series'. If it does NOT fit a standard phone/laptop category, use 'Others'.
  - "Device Type": e.g., 'iPhone 14 Pro Max', 'Xbox Series S'.
  - "Condition": e.g., 'Brand New', 'UK Used'.
  - "SIM Type/Model/Processor": e.g., 'Physical SIM', 'ESIM', 'M1 Chip', 'No Pad'.
  - "Storage Capacity/Configuration": e.g., '256GB', '512GB/16GB RAM'.
  - "Regular price": The numeric price. CRITICAL RULE: If no price is stated but the item is in stock, output 'Available'.

  Ignore system messages like "<Media omitted>" or "Messages are end-to-end encrypted".
  Only return the valid JSON array. Do not include markdown formatting like \`\`\`json.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: batchText }
      ],
      temperature: 0, 
    });

    const rawJson = response.choices[0].message.content.trim();
    const cleanJson = rawJson.replace(/^```json/g, '').replace(/```$/g, '').trim();
    
    // First, try to parse it normally
    try {
        return JSON.parse(cleanJson);
    } catch (parseError) {
        console.warn(`⚠️ JSON was cut off in Batch ${batchNumber}. Activating cleaner.js rescue...`);
        // If it fails, use the cleaner to rescue the data!
        const rescuedJson = convertString(cleanJson);
        return JSON.parse(rescuedJson);
    }

  } catch (error) {
    console.error(`❌ Error extracting from batch ${batchNumber}:`, error);
    return []; 
  }

/**
 * 3. THE POST-PROCESSOR & GROUPER
 * Takes the flat list of products from all AI batches and groups them by Vendor for Firebase.
 */
const groupProductsByVendor = (allExtractedProducts) => {
  const vendorMap = {};

  allExtractedProducts.forEach(product => {
    const vendor = product.vendorId;
    
    // Skip if AI failed to find a vendor
    if (!vendor || vendor === "Unknown") return; 

    if (!vendorMap[vendor]) {
      vendorMap[vendor] = {
        vendorId: vendor,
        lastUpdated: new Date().toISOString(),
        shareableLink: `/vendor/${encodeURIComponent(vendor.replace(/\s+/g, '-'))}`,
        products: []
      };
    }

    // Remove vendorId from the product object itself
    const { vendorId, ...cleanProduct } = product;
    
    // NEW: Inject the Group fields so manual uploads perfectly match the Webhook format!
    vendorMap[vendor].products.push({
      ...cleanProduct,
      isGroupMessage: false,
      groupName: 'Manual .txt Upload' // This will now show nicely on the dashboard
    });
  });

  return Object.values(vendorMap);
};

/**
 * 4. THE MASTER RUNNER
 * Coordinates chunking, AI extraction, and grouping.
 */
export const processChatFile = async (filePath) => {
    const rawText = fs.readFileSync(filePath, 'utf-8');
    
    // 1. Chunk the file
    const batches = createBatches(rawText, 60); // 60 lines per batch is very safe for tokens
    console.log(`📦 File split into ${batches.length} batches to protect API limits.`);

    let allProducts = [];

    // 2. Process each chunk sequentially (or you could use Promise.all to do it concurrently)
    for (let i = 0; i < batches.length; i++) {
        const batchProducts = await extractFromBatch(batches[i], i + 1, batches.length);
        allProducts = [...allProducts, ...batchProducts];
    }
    
    console.log(`✅ Total products extracted globally: ${allProducts.length}`);

    // 3. Group by vendor
    const finalVendorData = groupProductsByVendor(allProducts);
    
    console.log(`🗂️ Successfully grouped into ${finalVendorData.length} unique Vendors.`);
    return finalVendorData;
};
