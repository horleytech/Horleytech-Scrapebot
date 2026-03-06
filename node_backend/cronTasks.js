import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import OpenAI from 'openai';
import { runBackup, getAdminFirestore } from './backup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OFFLINE_COLLECTION = 'horleyTech_OfflineInventories';
const SETTINGS_COLLECTION = 'horleyTech_Settings';
const AI_BATCH_SIZE = 20;
let inMemoryGlobalProducts = [];

const normalizeCacheCondition = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return 'Unknown';
  if (normalized === 'new' || normalized === 'brand new') return 'Brand New';
  if (normalized === 'used' || normalized.includes('grade a') || normalized.includes('uk used')) return 'Grade A UK Used';
  return String(value || 'Unknown');
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const normalizeMappingKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const toFlatMappingList = (customMappings) => {
  if (Array.isArray(customMappings)) return customMappings;

  if (customMappings && typeof customMappings === 'object') {
    return Object.entries(customMappings).map(([raw, mapped]) => {
      if (mapped && typeof mapped === 'object') {
        return { raw, ...mapped };
      }
      return { raw, deviceType: String(mapped || '').trim() };
    });
  }

  return [];
};

export const getLatestCustomMappings = async () => {
  const firestore = getAdminFirestore();
  const customMappingsDoc = await firestore.collection(SETTINGS_COLLECTION).doc('customMappings').get();
  if (!customMappingsDoc.exists) return [];

  const data = customMappingsDoc.data() || {};
  return toFlatMappingList(data?.mappings || data?.dictionary || data?.customMappings || data);
};

const buildMappingIndex = (customMappings = []) => {
  const index = new Map();

  customMappings.forEach((entry) => {
    const raw = entry?.raw || entry?.source || entry?.rawString || '';
    const key = normalizeMappingKey(raw);
    if (!key || key === '__unmappable__') return;

    index.set(key, {
      category: entry.category || 'Others',
      brand: entry.brand || 'Others',
      series: entry.series || 'Others',
      deviceType: entry.deviceType || entry.standardName || '',
    });
  });

  return index;
};

export const runRetroactiveSweep = async () => {
  const firestore = getAdminFirestore();
  const customMappings = await getLatestCustomMappings();
  const mappingIndex = buildMappingIndex(customMappings);

  if (!mappingIndex.size) {
    return { success: true, inspectedProducts: 0, correctedProducts: 0, note: 'No mappings available.' };
  }

  const snapshot = await firestore.collection(OFFLINE_COLLECTION).get();
  const batch = firestore.batch();

  let inspectedProducts = 0;
  let correctedProducts = 0;

  snapshot.docs.forEach((docSnap) => {
    const vendorData = docSnap.data() || {};
    const products = Array.isArray(vendorData.products) ? [...vendorData.products] : [];
    let vendorTouched = false;

    const updatedProducts = products.map((product) => {
      inspectedProducts += 1;

      const currentCategory = String(product?.Category || '').trim();
      const currentDeviceType = String(product?.['Device Type'] || '').trim();
      const needsRepair = ['others'].includes(currentCategory.toLowerCase())
        || ['unknown device', ''].includes(currentDeviceType.toLowerCase());

      if (!needsRepair) return product;

      const rawString = String(product?.raw || product?.rawString || product?.['Device Type'] || '').trim();
      const mapping = mappingIndex.get(normalizeMappingKey(rawString));
      if (!mapping?.deviceType) return product;

      vendorTouched = true;
      correctedProducts += 1;

      return {
        ...product,
        Category: mapping.category || product.Category || 'Others',
        Brand: mapping.brand || product.Brand || 'Others',
        Series: mapping.series || product.Series || 'Others',
        'Device Type': mapping.deviceType,
      };
    });

    if (vendorTouched) {
      batch.update(docSnap.ref, {
        products: updatedProducts,
        lastUpdated: new Date().toISOString(),
      });
    }
  });

  await batch.commit();

  return {
    success: true,
    inspectedProducts,
    correctedProducts,
  };
};

export const exportMappingsToJsonl = async () => {
  const mappings = await getLatestCustomMappings();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const lines = mappings
    .filter((entry) => entry?.raw && (entry?.deviceType || entry?.category || entry?.brand))
    .map((entry) => JSON.stringify({
      raw: String(entry.raw).trim(),
      category: entry.category || 'Others',
      brand: entry.brand || 'Others',
      series: entry.series || 'Others',
      deviceType: entry.deviceType || entry.standardName || 'Unknown Device',
    }));

  const fileName = `custom-mappings-finetune-${timestamp}.jsonl`;
  const exportDir = path.join(__dirname, 'backups');
  const filePath = path.join(exportDir, fileName);

  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');

  const firestore = getAdminFirestore();
  await firestore.collection(SETTINGS_COLLECTION).doc('customMappingsFineTuneExports').set({
    lastExportAt: new Date().toISOString(),
    lastExportFileName: fileName,
    totalLines: lines.length,
  }, { merge: true });

  return {
    success: true,
    fileName,
    filePath,
    totalLines: lines.length,
  };
};

const chunkArray = (arr = [], size = AI_BATCH_SIZE) => {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

const runTwoLayerJudge = async (rows = []) => {
  const systemPrompt = 'You are a strict Two-Layer AI Judge. Given an array of objects with a "raw" string, extract details. You MUST return a JSON object with a single root key called "data" containing an array of objects. Each object must strictly have: "raw", "category", "brand", "series", "deviceType", "condition", "sim", and "isOthers". "condition" must be one of "Brand New", "Grade A UK Used", or "Unknown". "sim" must be one of "Physical SIM", "ESIM", "Physical SIM + ESIM", or "Unknown".';

  const aiResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(rows) },
    ],
    temperature: 0,
  });

  const parsed = JSON.parse(aiResponse.choices?.[0]?.message?.content || '{}');
  return Array.isArray(parsed.data) ? parsed.data : [];
};

export const runNightlyUnknownSweeper = async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️ OPENAI_API_KEY missing. Nightly unknown sweeper skipped.');
    return { success: false, judged: 0, skipped: true };
  }

  const firestore = getAdminFirestore();
  if (!admin.apps.length) {
    console.warn('⚠️ Firebase admin app unavailable. Nightly unknown sweeper skipped.');
    return { success: false, judged: 0, skipped: true };
  }

  const CAT_LIST = ['Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'];

  const vendorSnapshot = await firestore.collection(OFFLINE_COLLECTION).get();
  const unknownCandidates = new Set();

  vendorSnapshot.docs.forEach((docSnap) => {
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

  const candidateRows = Array.from(unknownCandidates).map((raw) => ({ raw }));
  if (!candidateRows.length) {
    return { success: true, judged: 0, updatedMappings: 0 };
  }

  const chunks = chunkArray(candidateRows, AI_BATCH_SIZE);
  const newAiMappings = {};

  for (const chunk of chunks) {
    try {
      const judgedRows = await runTwoLayerJudge(chunk);
      judgedRows.forEach((item) => {
        const raw = String(item?.raw || '').trim();
        if (!raw) return;
        const key = normalizeMappingKey(raw);
        if (!key) return;
        newAiMappings[key] = {
          standardName: item.deviceType || 'Unknown Device',
          condition: item.condition || 'Unknown',
          sim: item.sim || 'Unknown',
          isOthers: Boolean(item.isOthers),
          category: item.category || 'Others',
          brand: item.brand || 'Others',
          series: item.series || 'Others',
          deviceType: item.deviceType || 'Unknown Device',
        };
      });
    } catch (error) {
      console.error('❌ Nightly sweeper AI chunk failed:', error.message);
    }
  }

  // Categorical Sharding Checkpoint Save
  const shardUpdates = {};
  for (const [key, mapping] of Object.entries(newAiMappings)) {
    const safeCat = CAT_LIST.includes(mapping.category) ? mapping.category : 'Others';
    if (!shardUpdates[safeCat]) shardUpdates[safeCat] = {};
    shardUpdates[safeCat][key] = mapping;
  }
  for (const [catName, mapData] of Object.entries(shardUpdates)) {
    await firestore.collection('horleyTech_Settings').doc(`mappings_${catName}`).set({
      mappings: mapData,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      sweeperLastRunAt: new Date().toISOString(),
      sweeperCandidateCount: candidateRows.length,
    }, { merge: true });
  }

  return {
    success: true,
    judged: candidateRows.length,
    updatedMappings: Object.keys(newAiMappings).length,
  };
};

export const forceBuildGlobalCache = async () => {
  const firestore = admin.firestore();
  const vendorsSnap = await firestore.collection('horleyTech_OfflineInventories').get();

  const groupedByVariation = {};

  vendorsSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const vendorName = data.vendorName || docSnap.id;
    const vendorLink = data.shareableLink || '';

    (data.products || []).forEach((product) => {
      const priceValue = Number(String(product?.['Regular price'] || '').replace(/[^0-9.]/g, ''));
      if (!priceValue || priceValue <= 0) return;

      if (product?.ignored === true || String(product?.ignoreReason || '').trim()) return;

      const variationId = String(product?.variationId || '').trim().toLowerCase();
      if (!variationId) return;

      if (!groupedByVariation[variationId]) groupedByVariation[variationId] = [];

      groupedByVariation[variationId].push({
        id: `${docSnap.id}_${Math.random().toString(36).slice(2, 11)}`,
        variationId,
        vendorName,
        vendorLink,
        price: String(product?.['Regular price'] || ''),
        priceValue,
        date: data.lastUpdated || new Date().toISOString(),
        category: product?.Category || 'Others',
        brandSubCategory: product?.Brand || 'Others',
        series: product?.Series || 'Others',
        condition: normalizeCacheCondition(product?.Condition || 'Unknown'),
        simType: product?.['SIM Type/Model/Processor'] || 'Physical SIM',
        storage: product?.['Storage Capacity/Configuration'] || 'NA',
        raw: product?.rawProductString || '',
      });
    });
  });

  const allProducts = Object.values(groupedByVariation).flatMap((items) => items
    .sort((a, b) => a.priceValue - b.priceValue)
    .slice(0, 10));

  if (!allProducts.length) {
    throw new Error('Global cache build aborted: no products were found in offline inventories.');
  }

  inMemoryGlobalProducts = [...allProducts];

  const chunkSize = 500;
  const totalChunks = Math.ceil(allProducts.length / chunkSize);

  const previousCacheMeta = await firestore.collection(SETTINGS_COLLECTION).doc('globalProductsCache').get();
  const previousChunkTotal = Number(previousCacheMeta.data()?.totalChunks || 0);

  for (let i = 0; i < previousChunkTotal; i += 1) {
    await firestore.doc(`${SETTINGS_COLLECTION}/cache_chunk_${i}`).delete();
  }

  for (let i = 0; i < totalChunks; i += 1) {
    const chunk = allProducts.slice(i * chunkSize, (i + 1) * chunkSize);
    await firestore.doc(`${SETTINGS_COLLECTION}/cache_chunk_${i}`).set({ products: chunk });
  }

  await firestore.doc(`${SETTINGS_COLLECTION}/globalProductsCache`).set({
    lastUpdated: new Date().toISOString(),
    totalChunks,
    totalProducts: allProducts.length,
    totalVariations: Object.keys(groupedByVariation).length,
  });

  return allProducts.length;
};

export const resetGlobalMemoryCache = () => {
  inMemoryGlobalProducts = [];
  return inMemoryGlobalProducts.length;
};

export const runScheduledCacheBuildIfEnabled = async () => {
  const firestore = getAdminFirestore();
  const controlSnap = await firestore.collection(SETTINGS_COLLECTION).doc('cacheControl').get();
  const cacheAutomationEnabled = controlSnap.exists ? Boolean(controlSnap.data()?.cacheAutomationEnabled) : false;

  if (!cacheAutomationEnabled) {
    return { success: true, skipped: true, reason: 'Cache automation disabled' };
  }

  const total = await forceBuildGlobalCache();
  await firestore.collection(SETTINGS_COLLECTION).doc('cacheControl').set({
    lastAutomatedBuildAt: new Date().toISOString(),
    lastAutomatedBuildTotal: total,
  }, { merge: true });

  return { success: true, skipped: false, total };
};

export const initializeCronTasks = () => {
  cron.schedule('0 0 * * 0', async () => {
    console.log('🗂️ Running weekly automated backup...');
    await runBackup();
  }, { timezone: 'Africa/Lagos' });

  cron.schedule('0 23 * * 6', async () => {
    console.log('🧹 Running scheduled retroactive system correction...');
    await runRetroactiveSweep();
  }, { timezone: 'Africa/Lagos' });

  cron.schedule('0 0 1 * *', async () => {
    console.log('📦 Running monthly mapping JSONL export...');
    await exportMappingsToJsonl();
  }, { timezone: 'Africa/Lagos' });

  cron.schedule('0 2 * * *', async () => {
    console.log('👻 Running nightly unknown mapping sweeper...');
    try {
      const result = await runNightlyUnknownSweeper();
      console.log('✅ Nightly unknown mapping sweeper finished:', result);
    } catch (error) {
      console.error('❌ Nightly unknown mapping sweeper failed:', error.message);
    }
  }, { timezone: 'Africa/Lagos' });

  cron.schedule('0 */6 * * *', async () => {
    console.log('🧱 Running scheduled global cache build check...');
    try {
      const result = await runScheduledCacheBuildIfEnabled();
      if (result.skipped) {
        console.log('⏭️ Scheduled cache build skipped:', result.reason);
      } else {
        console.log('✅ Scheduled cache build completed:', result.total);
      }
    } catch (error) {
      console.error('❌ Scheduled cache build failed:', error.message);
    }
  }, { timezone: 'Africa/Lagos' });

  console.log('⏰ Autonomous cron tasks initialized.');
};
