import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runBackup, getAdminFirestore } from './backup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OFFLINE_COLLECTION = 'horleyTech_OfflineInventories';
const SETTINGS_COLLECTION = 'horleyTech_Settings';

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

  console.log('⏰ Autonomous cron tasks initialized.');
};
