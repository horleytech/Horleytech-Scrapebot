import OpenAI from 'openai';
import fs from 'fs';
import { convertString } from './cleaner.js';
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const createBatches = (rawText, linesPerBatch = 50) => {
  const lines = rawText.split('\n');
  const batches = [];

  for (let i = 0; i < lines.length; i += linesPerBatch) {
    batches.push(lines.slice(i, i + linesPerBatch).join('\n'));
  }

  return batches;
};

const extractFromBatch = async (batchText, batchNumber, totalBatches) => {
  console.log(`🤖 Processing Batch ${batchNumber} of ${totalBatches}...`);

  const systemPrompt = `
  You are an enterprise-grade WhatsApp inventory extractor.
  Extract only valid products and classify each item using this strict taxonomy.

  MASTER CATEGORIES + STRICT SUBCATEGORIES:

  1) Smartphones
     - iPhones (iPhone 17 Series, iPhone 16 Series, iPhone 15 Series, iPhone 14 Series, iPhone 13 Series, iPhone 12 Series, iPhone 11 Series, iPhone X Series, iPhone 8 Series, iPhone 7 Series)
     - Samsung (Fold Series, Flip Series, S Series, Note Series, A Series)
     - Google Pixels (Pixel 10 Series, Pixel 9 Series, Pixel 8 Series, Pixel 7 Series, Pixel 6 Series)
     - Nokia

  2) Smartwatches
     - Apple Watch
     - Samsung Watch

  3) Laptops
     - Macbook Pro
     - Macbook Air
     - HP
     - Lenovo
     - Dell
     - ASUS

  4) Sounds
     - Speakers
     - Headphones
     - Earphones (Apple, Samsung, Sony)

  5) Accessories
     - Chargers
     - Powerbanks
     - Others

  6) Tablets
     - Apple iPads
     - Amazon Tabs
     - Samsung Tabs

  7) Gaming
     - Consoles
     - Gears
     - Games (Xbox, PlayStation 4, PlayStation 5)

  FALLBACK RULE (MANDATORY):
  - If a device matches a Master Category but NOT a strict SubCategory, assign the correct Master Category and dynamically set SubCategory (example: Category: "Gaming", SubCategory: "Nintendo").
  - If completely unknown, use Category: "Others" and SubCategory: "Others".

  Return a JSON array where each object has EXACTLY these keys:
  - "vendorId": Exact sender name/identifier (never date/time).
  - "Category": Master category from taxonomy or "Others".
  - "SubCategory": Strict subcategory when available, otherwise dynamic fallback.
  - "Device Type": Product/device name.
  - "Condition": Device condition.
  - "SIM Type/Model/Processor": SIM/model/chipset details.
  - "Storage Capacity/Configuration": storage/RAM configuration.
  - "Regular price": numeric price, or "Available" if in stock with no explicit price.

  Ignore system messages like "<Media omitted>" or encryption notices.
  Return only valid JSON (no markdown code fences).
  `;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: batchText }
      ],
      temperature: 0,
    });

    const rawJson = response.choices[0].message.content.trim();
    const cleanJson = rawJson.replace(/^```json/g, '').replace(/```$/g, '').trim();

    try {
      return JSON.parse(cleanJson);
    } catch (parseError) {
      console.warn(`⚠️ JSON was cut off in Batch ${batchNumber}. Activating cleaner.js rescue...`);
      const rescuedJson = convertString(cleanJson);
      return JSON.parse(rescuedJson);
    }
  } catch (error) {
    console.error(`❌ Error extracting from batch ${batchNumber}:`, error);
    return [];
  }
};

const groupProductsByVendor = (allExtractedProducts) => {
  const vendorMap = {};
  const exactServerDate = new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' });

  allExtractedProducts.forEach((product) => {
    const vendor = product.vendorId;

    if (!vendor || vendor === 'Unknown') return;

    if (!vendorMap[vendor]) {
      vendorMap[vendor] = {
        vendorId: vendor,
        lastUpdated: new Date().toISOString(),
        shareableLink: `/vendor/${encodeURIComponent(vendor.replace(/\s+/g, '-'))}`,
        products: []
      };
    }

    const { vendorId, ...cleanProduct } = product;

    vendorMap[vendor].products.push({
      ...cleanProduct,
      DatePosted: exactServerDate,
      isGroupMessage: false,
      groupName: 'TXT Upload'
    });
  });

  return Object.values(vendorMap);
};

export const processChatFile = async (filePath) => {
  const rawText = fs.readFileSync(filePath, 'utf-8');
  const batches = createBatches(rawText, 60);

  console.log(`📦 File split into ${batches.length} batches to protect API limits.`);

  let allProducts = [];

  for (let i = 0; i < batches.length; i++) {
    const batchProducts = await extractFromBatch(batches[i], i + 1, batches.length);
    allProducts = [...allProducts, ...batchProducts];
  }

  console.log(`✅ Total products extracted globally: ${allProducts.length}`);

  const finalVendorData = groupProductsByVendor(allProducts);

  console.log(`🗂️ Successfully grouped into ${finalVendorData.length} unique Vendors.`);
  return finalVendorData;
};
