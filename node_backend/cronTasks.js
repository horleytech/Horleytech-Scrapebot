import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import { runBackup, getAdminFirestore } from './backup.js';
import { resolveTextAIConfig } from './aiConfig.js';
import { processWithShadowTesting } from './cleaner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OFFLINE_COLLECTION = 'horleyTech_OfflineInventories';
const SETTINGS_COLLECTION = 'horleyTech_Settings';
const AI_BATCH_SIZE = 20;
const NIGHTLY_MAX_CANDIDATES = 300;
const NIGHTLY_MAX_AI_CHUNKS = 20;
const NIGHTLY_AI_THROTTLE_MS = 750;
let inMemoryGlobalProducts = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TAXONOMY_CATEGORIES = ['Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'];
const normalizeVendorKey = (value = '') => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const normalizeCacheCondition = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return 'Unknown';
  if (normalized === 'new' || normalized === 'brand new') return 'Brand New';
  if (normalized === 'used' || normalized.includes('grade a') || normalized.includes('uk used')) return 'Grade A UK Used';
  return String(value || 'Unknown');
};

const normalizeMappingKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeFuzzyDeviceKey = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/pro\s*max/g, 'promax')
  .replace(/ultra\s*2/g, 'ultra2')
  .replace(/series\s*se/g, 'se')
  .replace(/[^a-z0-9]/g, '');
const tokenizeCsvLine = (line = '') => {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
};

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

const loadShardedMappingSeeds = async (firestore) => {
  const rows = [];
  for (const category of TAXONOMY_CATEGORIES) {
    const docSnap = await firestore.collection(SETTINGS_COLLECTION).doc(`mappings_${category}`).get();
    if (!docSnap.exists) continue;
    const mappings = docSnap.data()?.mappings || {};
    Object.entries(mappings).forEach(([raw, mapped]) => {
      const rawKey = normalizeFuzzyDeviceKey(raw);
      const deviceType = mapped?.deviceType || mapped?.standardName || '';
      const deviceKey = normalizeFuzzyDeviceKey(deviceType);
      if (!rawKey && !deviceKey) return;
      rows.push({
        rawKey,
        deviceKey,
        category: mapped?.category || category || 'Others',
        brand: mapped?.brand || 'Others',
        series: mapped?.series || 'Others',
        deviceType: deviceType || mapped?.series || 'Unknown Device',
      });
    });
  }
  return rows;
};

const resolveSeedMatchFromShards = (rawString = '', seeds = []) => {
  const rawKey = normalizeFuzzyDeviceKey(rawString);
  if (!rawKey || rawKey.length < 3) return null;

  let best = null;
  let bestScore = 0;
  seeds.forEach((seed) => {
    const candidateRaw = String(seed.rawKey || '');
    const candidateDevice = String(seed.deviceKey || '');
    const rawContains = candidateRaw && (rawKey.includes(candidateRaw) || candidateRaw.includes(rawKey));
    const deviceContains = candidateDevice && (rawKey.includes(candidateDevice) || candidateDevice.includes(rawKey));
    if (!rawContains && !deviceContains) return;

    const overlap = Math.max(candidateRaw.length, candidateDevice.length, 1);
    const scoreBase = Math.min(rawKey.length, overlap);
    const score = (rawContains ? scoreBase : 0) + (deviceContains ? scoreBase + 3 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = seed;
    }
  });

  if (!best || bestScore < 4) return null;
  return {
    standardName: best.deviceType || 'Unknown Device',
    condition: 'Unknown',
    sim: 'Unknown',
    isOthers: false,
    category: best.category || 'Others',
    brand: best.brand || 'Others',
    series: best.series || 'Others',
    deviceType: best.deviceType || 'Unknown Device',
    confidenceSource: 'catalog-seed',
  };
};

const inferCategoryFromName = (deviceType = '') => {
  const text = String(deviceType || '').toLowerCase();
  if (!text) return 'Others';
  if (/(iphone|samsung|pixel|tecno|infinix|redmi|xiaomi|phone)/.test(text)) return 'Smartphones';
  if (/(macbook|thinkpad|ideapad|laptop|notebook|elitebook|xps|pavilion|omen)/.test(text)) return 'Laptops';
  if (/(watch|smartwatch|ultra2|se2)/.test(text)) return 'Smartwatches';
  if (/(ipad|tablet|tab)/.test(text)) return 'Tablets';
  if (/(airpod|speaker|earbud|headphone)/.test(text)) return 'Sounds';
  return 'Others';
};

const inferBrandFromName = (deviceType = '') => {
  const text = String(deviceType || '').toLowerCase();
  if (!text) return 'Others';
  if (text.includes('iphone') || text.includes('ipad') || text.includes('macbook') || text.includes('airpod') || text.includes('watch')) return 'Apple';
  if (text.includes('samsung') || /\bs\d{1,2}\b/.test(text)) return 'Samsung';
  if (text.includes('pixel')) return 'Google';
  if (text.includes('tecno')) return 'Tecno';
  if (text.includes('infinix')) return 'Infinix';
  if (text.includes('xiaomi') || text.includes('redmi')) return 'Xiaomi';
  return 'Others';
};

const loadStrictRoutingVendors = async (firestore) => {
  try {
    const docSnap = await firestore.collection(SETTINGS_COLLECTION).doc('extractionRouting').get();
    const data = docSnap.exists ? (docSnap.data() || {}) : {};
    const enabled = data?.enabled !== false;
    const rawList = Array.isArray(data?.strictVendors) ? data.strictVendors : String(data?.strictVendors || '').split(',');
    const strictVendors = new Set(rawList.map((item) => normalizeVendorKey(item)).filter(Boolean));
    return { enabled, strictVendors };
  } catch (error) {
    console.warn('⚠️ Nightly strict routing config load failed:', error.message);
    return { enabled: true, strictVendors: new Set() };
  }
};

const loadCsvDeviceTargets = async (firestore) => {
  const envCsvUrl = String(
    process.env.GLOBAL_PRODUCTS_CSV_URL
    || process.env.COMPANY_PRICING_CSV_URL
    || process.env.COMPANY_CSV_URL
    || process.env.PRODUCT_DICTIONARY_URL
    || ''
  ).trim();
  try {
    let csvUrl = envCsvUrl;
    if (!csvUrl) {
      const sessionsSnap = await firestore.collection('horleyTech_PricingSessions').orderBy('createdAt', 'desc').limit(5).get();
      const sessionDoc = sessionsSnap.docs.find((docSnap) => String(docSnap.data()?.companyCsvUrl || '').trim());
      csvUrl = String(sessionDoc?.data()?.companyCsvUrl || '').trim();
    }
    if (!csvUrl) return [];
    const response = await fetch(csvUrl, { headers: { Accept: 'text/csv,text/plain,*/*' } });
    if (!response.ok) return [];
    const csvText = await response.text();
    const lines = String(csvText || '').split(/\r?\n/).filter((line) => String(line || '').trim());
    if (!lines.length) return [];
    const headers = tokenizeCsvLine(lines[0]).map((cell) => String(cell || '').toLowerCase());
    const targetIndex = headers.findIndex((header) => ['device type', 'device', 'product', 'model'].includes(header.trim()));
    const fallbackIndex = targetIndex >= 0 ? targetIndex : 0;
    return lines.slice(1)
      .map((line) => tokenizeCsvLine(line)[fallbackIndex] || '')
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .slice(0, 5000);
  } catch (error) {
    console.warn('⚠️ Nightly CSV target load skipped:', error.message);
    return [];
  }
};

const resolveSeedMatchFromCsvTargets = (rawString = '', csvTargets = []) => {
  const rawKey = normalizeFuzzyDeviceKey(rawString);
  if (!rawKey || !csvTargets.length) return null;

  let bestTarget = '';
  let bestScore = 0;
  csvTargets.forEach((target) => {
    const targetKey = normalizeFuzzyDeviceKey(target);
    if (!targetKey || targetKey.length < 3) return;
    const contains = rawKey.includes(targetKey) || targetKey.includes(rawKey);
    if (!contains) return;
    const score = Math.min(rawKey.length, targetKey.length);
    if (score > bestScore) {
      bestScore = score;
      bestTarget = target;
    }
  });

  if (!bestTarget || bestScore < 4) return null;
  const deviceType = String(bestTarget || '').trim();
  const category = inferCategoryFromName(deviceType);
  const brand = inferBrandFromName(deviceType);
  return {
    standardName: deviceType || 'Unknown Device',
    condition: 'Unknown',
    sim: 'Unknown',
    isOthers: false,
    category,
    brand,
    series: deviceType || 'Others',
    deviceType: deviceType || 'Unknown Device',
    confidenceSource: 'csv-seed',
  };
};

export const runRetroactiveSweep = async ({ dryRun = false } = {}) => {
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
  let aiRepairsAttempted = 0;
  const RETRO_MAX_AI_REPAIRS = 200;
  const proposedByVendor = {};

  for (const docSnap of snapshot.docs) {
    const vendorData = docSnap.data() || {};
    const products = Array.isArray(vendorData.products) ? [...vendorData.products] : [];
    let vendorTouched = false;

    const updatedProducts = [];
    for (const product of products) {
      inspectedProducts += 1;

      const currentCategory = String(product?.Category || '').trim();
      const currentDeviceType = String(product?.['Device Type'] || '').trim();
      const needsRepair = ['others'].includes(currentCategory.toLowerCase())
        || ['unknown device', ''].includes(currentDeviceType.toLowerCase());

      const rawString = String(
        product?.rawProductString
        || product?.raw
        || product?.rawString
        || product?.['Device Type']
        || ''
      ).trim();

      let nextProduct = { ...product };
      const mapping = mappingIndex.get(normalizeMappingKey(rawString));
      if (needsRepair && mapping?.deviceType) {
        nextProduct = {
          ...nextProduct,
          Category: mapping.category || nextProduct.Category || 'Others',
          Brand: mapping.brand || nextProduct.Brand || 'Others',
          Series: mapping.series || nextProduct.Series || 'Others',
          'Device Type': mapping.deviceType,
        };
        vendorTouched = true;
        correctedProducts += 1;
      }

      const hasUnknownIgnoreReason = ['unknown-variant-attribute', 'taxonomy-others'].includes(String(nextProduct?.ignoreReason || '').trim());
      const shouldTryAiRepair = (needsRepair || hasUnknownIgnoreReason) && rawString && aiRepairsAttempted < RETRO_MAX_AI_REPAIRS;

      if (shouldTryAiRepair) {
        try {
          const priceValue = Number(String(nextProduct?.['Regular price'] || '').replace(/[^0-9.]/g, '')) || 0;
          const repaired = await processWithShadowTesting({ rawProductString: rawString, price: priceValue });
          aiRepairsAttempted += 1;

          const repairedIsKnown = !(repaired?.ignored)
            && String(repaired?.taxonomy?.Category || '').toLowerCase() !== 'others'
            && String(repaired?.taxonomy?.Series || '').toLowerCase() !== 'others';

          if (repairedIsKnown) {
            nextProduct = {
              ...nextProduct,
              Category: repaired.taxonomy?.Category || nextProduct.Category || 'Others',
              Brand: repaired.taxonomy?.Brand || nextProduct.Brand || 'Others',
              Series: repaired.taxonomy?.Series || nextProduct.Series || 'Others',
              'Device Type': repaired.deviceType || repaired.taxonomy?.Series || nextProduct['Device Type'] || 'Unknown Device',
              Condition: repaired.condition || nextProduct.Condition || 'Unknown',
              'SIM Type/Model/Processor': repaired.sim || nextProduct['SIM Type/Model/Processor'] || 'Unknown',
              'Storage Capacity/Configuration': repaired.storage || nextProduct['Storage Capacity/Configuration'] || 'UNKNOWN',
              variationId: repaired.variationId || nextProduct.variationId || null,
              ignored: false,
              ignoreReason: '',
            };
            vendorTouched = true;
            correctedProducts += 1;
            proposedByVendor[docSnap.id] = (proposedByVendor[docSnap.id] || 0) + 1;
          }
        } catch (error) {
          console.warn('⚠️ Retro sweep AI repair skipped for one product:', error.message);
        }
      }

      updatedProducts.push(nextProduct);
    }

    if (vendorTouched) {
      if (!dryRun) {
        batch.update(docSnap.ref, {
          products: updatedProducts,
          lastUpdated: new Date().toISOString(),
        });
      }
    }
  }

  if (!dryRun) {
    await batch.commit();
  }

  return {
    success: true,
    inspectedProducts,
    correctedProducts,
    aiRepairsAttempted,
    dryRun: Boolean(dryRun),
    proposedByVendor,
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
  const systemPrompt = 'You are a strict Two-Layer AI Judge. Given an array of objects with a "raw" string, extract details. You MUST return a JSON object with a single root key called "data" containing an array of objects. Each object must strictly have: "raw", "category", "brand", "series", "deviceType", "condition", "sim", and "isOthers". "condition" must be one of "Brand New", "Grade A UK Used", or "Unknown". "sim" must be one of "Physical SIM", "ESIM", "Physical SIM + ESIM", "Locked/Wi-Fi Only (ESIM)", or "Unknown".';

  const textAI = await resolveTextAIConfig({ background: true });
  const aiResponse = await textAI.client.chat.completions.create({
    model: textAI.model,
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
  if (!process.env.OPENAI_API_KEY && !process.env.QWEN_API_KEY) {
    console.warn('⚠️ No AI key configured (OPENAI_API_KEY or QWEN_API_KEY). Nightly unknown sweeper skipped.');
    return { success: false, judged: 0, skipped: true };
  }

  const firestore = getAdminFirestore();
  if (!admin.apps.length) {
    console.warn('⚠️ Firebase admin app unavailable. Nightly unknown sweeper skipped.');
    return { success: false, judged: 0, skipped: true };
  }

  const CAT_LIST = TAXONOMY_CATEGORIES;
  const shardSeeds = await loadShardedMappingSeeds(firestore);
  const csvTargets = await loadCsvDeviceTargets(firestore);
  const strictRouting = await loadStrictRoutingVendors(firestore);

  const vendorSnapshot = await firestore.collection(OFFLINE_COLLECTION).get();
  const unknownCandidates = new Set();

  vendorSnapshot.docs.forEach((docSnap) => {
    const vendorData = docSnap.data() || {};
    const vendorName = String(vendorData?.vendorName || docSnap.id || '').trim();
    const vendorKey = normalizeVendorKey(vendorName);
    const shouldIncludeVendor = strictRouting.enabled && strictRouting.strictVendors.size > 0
      ? strictRouting.strictVendors.has(vendorKey)
      : true;
    if (!shouldIncludeVendor) return;
    const products = Array.isArray(vendorData.products) ? vendorData.products : [];
    products.forEach((product) => {
      const series = String(product?.Series || '').trim().toLowerCase();
      if (series === 'general listing') return;
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

  const candidateRows = Array.from(unknownCandidates)
    .slice(0, NIGHTLY_MAX_CANDIDATES)
    .map((raw) => ({ raw }));
  if (!candidateRows.length) {
    return { success: true, judged: 0, updatedMappings: 0 };
  }

  const chunks = chunkArray(candidateRows, AI_BATCH_SIZE).slice(0, NIGHTLY_MAX_AI_CHUNKS);
  const newAiMappings = {};
  let seededFromCatalog = 0;
  let seededFromCsv = 0;
  let failedChunks = 0;

  candidateRows.forEach(({ raw }) => {
    const key = normalizeMappingKey(raw);
    if (!key) return;
    const seeded = resolveSeedMatchFromShards(raw, shardSeeds);
    if (seeded) {
      newAiMappings[key] = seeded;
      seededFromCatalog += 1;
      return;
    }
    const csvSeeded = resolveSeedMatchFromCsvTargets(raw, csvTargets);
    if (!csvSeeded) return;
    newAiMappings[key] = csvSeeded;
    seededFromCsv += 1;
  });

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    try {
      const rowsNeedingAi = chunk.filter(({ raw }) => !newAiMappings[normalizeMappingKey(raw)]);
      if (!rowsNeedingAi.length) continue;
      const judgedRows = await runTwoLayerJudge(rowsNeedingAi);
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
      failedChunks += 1;
      console.error('❌ Nightly sweeper AI chunk failed:', error.message);
    }
    if (index < chunks.length - 1) await wait(NIGHTLY_AI_THROTTLE_MS);
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
    seededFromCatalog,
    seededFromCsv,
    totalChunks: chunks.length,
    failedChunks,
  };
};

export const midnightDatabaseCleanup = async () => {
  const firestore = getAdminFirestore();
  const now = new Date();
  const cutoff = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString();
  const maxDeletesPerRun = 500;

  try {
    const snapshot = await firestore
      .collection('horleyTech_AuditLogs')
      .where('timestamp', '<', cutoff)
      .limit(maxDeletesPerRun)
      .get();

    if (snapshot.empty) {
      return { success: true, deleted: 0, cutoff };
    }

    const batch = firestore.batch();
    snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();

    return { success: true, deleted: snapshot.size, cutoff };
  } catch (error) {
    console.error('❌ Midnight cleanup failed:', error.message);
    return { success: false, deleted: 0, cutoff, error: error.message };
  }
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
    try {
      await runBackup();
    } catch (error) {
      console.error('❌ Weekly backup failed:', error.message);
    }
  }, { timezone: 'Africa/Lagos' });

  cron.schedule('0 23 * * 6', async () => {
    console.log('🧹 Running scheduled retroactive system correction...');
    try {
      await runRetroactiveSweep();
    } catch (error) {
      console.error('❌ Retroactive sweep failed:', error.message);
    }
  }, { timezone: 'Africa/Lagos' });

  cron.schedule('0 0 1 * *', async () => {
    console.log('📦 Running monthly mapping JSONL export...');
    try {
      await exportMappingsToJsonl();
    } catch (error) {
      console.error('❌ Monthly mapping export failed:', error.message);
    }
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

  cron.schedule('30 2 * * *', async () => {
    console.log('🧽 Running nightly audit-log cleanup...');
    const result = await midnightDatabaseCleanup();
    if (result.success) {
      console.log('✅ Nightly cleanup result:', result);
    } else {
      console.error('❌ Nightly cleanup result:', result);
    }
  }, { timezone: 'Africa/Lagos' });

  console.log('⏰ Autonomous cron tasks initialized.');
};
