import admin from 'firebase-admin';
import OpenAI from 'openai';
import { getAdminFirestore } from './backup.js';

export function convertString(stringResponse) {
  if (stringResponse.slice(-1) !== ']') {
    const lastBraceIndex = stringResponse.lastIndexOf('}');
    return stringResponse.slice(0, lastBraceIndex + 1) + ']';
  }
  return stringResponse;
}

export const appleSeries = [
  'iPhone 17 Series',
  'iPhone 16 Series',
  'iPhone 15 Series',
  'iPhone 14 Series',
  'iPhone 13 Series',
  'iPhone 12 Series',
  'iPhone 11 Series',
  'iPhone X Series',
  'iPhone 8 Series',
  'iPhone 7 Series',
];

const PRODUCT_CONTAINER_COLLECTION = 'horleyTech_ProductContainers';
const SETTINGS_COLLECTION = 'horleyTech_Settings';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const normalizeKey = (value = '') => String(value || '').trim().toLowerCase();

const normalizeStorage = (value = '') => {
  const raw = String(value || '').toUpperCase().replace(/\s+/g, '');
  const storageMatch = raw.match(/(\d+)(GB|TB)/i);
  if (!storageMatch) return 'NA';
  return `${storageMatch[1]}${storageMatch[2].toUpperCase()}`;
};

const normalizeCondition = (value = '') => {
  const text = String(value || '').toLowerCase();
  if (/(uk used|pre-owned|fair|open box|used)/i.test(text)) return 'Used';
  if (/(brand new|sealed|new)/i.test(text)) return 'New';
  return 'Used';
};

const normalizeSim = (value = '') => {
  const text = String(value || '').toLowerCase();
  if (/dual/.test(text)) return 'Dual SIM';
  if (/esim|e-sim/.test(text)) return 'eSIM';
  if (/physical|single/.test(text)) return 'Physical SIM';
  return 'Physical SIM';
};

const buildVariationId = ({ series, storage, condition, sim }) => `${series}_${storage}_${condition}_${sim}`
  .toLowerCase()
  .replace(/\s+/g, '-');

const getMasterTaxonomyRows = async () => {
  const firestore = getAdminFirestore();
  const categories = ['Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'];
  const rows = [];

  for (const category of categories) {
    const docSnap = await firestore.collection(SETTINGS_COLLECTION).doc(`mappings_${category}`).get();
    if (!docSnap.exists) continue;
    const mappings = docSnap.data()?.mappings || {};

    Object.entries(mappings).forEach(([raw, mapped]) => {
      rows.push({
        raw: String(raw || ''),
        Category: mapped?.category || 'Others',
        Brand: mapped?.brand || 'Others',
        Series: mapped?.series || 'Others',
      });
    });
  }

  return rows;
};

const regexPredictTaxonomy = (rawProductString, masterRows = []) => {
  const normalizedRaw = normalizeKey(rawProductString).replace(/[^a-z0-9]/g, '');

  const hit = masterRows.find((row) => {
    const target = normalizeKey(row.raw).replace(/[^a-z0-9]/g, '');
    return target && normalizedRaw.includes(target);
  });

  if (!hit) {
    return { Category: 'Others', Brand: 'Others', Series: 'Others' };
  }

  return {
    Category: hit.Category || 'Others',
    Brand: hit.Brand || 'Others',
    Series: hit.Series || 'Others',
  };
};

const runTwoLayerJudge = async (rawProductString, dictionaryRows = []) => {
  const dictionary = dictionaryRows.slice(0, 1200).map((entry) => ({
    Category: entry.Category,
    Brand: entry.Brand,
    Series: entry.Series,
  }));

  const systemPrompt = 'You are a strict mapper. Map the raw product to one taxonomy entry from dictionary. If no confident exact match, return Others triple. Return strict JSON object with keys Category, Brand, Series only.';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ rawProductString, dictionary }) },
    ],
    temperature: 0,
  });

  const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');

  if (!parsed?.Category || !parsed?.Brand || !parsed?.Series) {
    return { Category: 'Others', Brand: 'Others', Series: 'Others' };
  }

  const found = dictionary.find((item) => item.Category === parsed.Category && item.Brand === parsed.Brand && item.Series === parsed.Series);
  if (!found) return { Category: 'Others', Brand: 'Others', Series: 'Others' };

  return found;
};

const updateAliasTracker = async ({ variationId, alias, regexPrediction, aiTruth }) => {
  const firestore = getAdminFirestore();
  const docRef = firestore.collection(PRODUCT_CONTAINER_COLLECTION).doc(variationId);

  await firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(docRef);
    const existing = snap.exists ? snap.data() : {};
    const aliasTracker = existing.aliasTracker || {};
    const currentAlias = aliasTracker[alias] || { consecutiveMatches: 0, isTrusted: false };

    const didMatch = regexPrediction.Category === aiTruth.Category
      && regexPrediction.Brand === aiTruth.Brand
      && regexPrediction.Series === aiTruth.Series;

    const nowTrusted = didMatch ? (Number(currentAlias.consecutiveMatches || 0) + 1) >= 100 : false;

    const basePayload = {
      officialTaxonomy: aiTruth,
      [`aliasTracker.${alias}.isTrusted`]: nowTrusted || Boolean(currentAlias.isTrusted),
    };

    if (didMatch) {
      transaction.set(docRef, {
        ...basePayload,
        [`aliasTracker.${alias}.consecutiveMatches`]: admin.firestore.FieldValue.increment(1),
      }, { merge: true });
      return;
    }

    transaction.set(docRef, {
      ...basePayload,
      [`aliasTracker.${alias}.consecutiveMatches`]: 0,
      [`aliasTracker.${alias}.isTrusted`]: false,
    }, { merge: true });
  });
};

export const processWithShadowTesting = async ({ rawProductString, price }) => {
  const firestore = getAdminFirestore();
  const alias = normalizeKey(rawProductString);
  const dictionaryRows = await getMasterTaxonomyRows();

  const regexPrediction = regexPredictTaxonomy(alias, dictionaryRows);
  const parsedStorage = normalizeStorage(rawProductString);
  const parsedCondition = normalizeCondition(rawProductString);
  const parsedSim = normalizeSim(rawProductString);

  const predictedVariationId = buildVariationId({
    series: regexPrediction.Series,
    storage: parsedStorage,
    condition: parsedCondition,
    sim: parsedSim,
  });

  const candidateContainerSnap = await firestore.collection(PRODUCT_CONTAINER_COLLECTION).doc(predictedVariationId).get();
  if (candidateContainerSnap.exists) {
    const container = candidateContainerSnap.data() || {};
    const trackedAlias = container.aliasTracker?.[alias];

    if (trackedAlias?.isTrusted === true) {
      return {
        rawProductString,
        price,
        taxonomy: container.officialTaxonomy || regexPrediction,
        storage: parsedStorage,
        condition: parsedCondition,
        sim: parsedSim,
        variationId: predictedVariationId,
        trustedFastLane: true,
      };
    }
  }

  const aiTruth = await runTwoLayerJudge(alias, dictionaryRows);

  const aiVariationId = buildVariationId({
    series: aiTruth.Series,
    storage: parsedStorage,
    condition: parsedCondition,
    sim: parsedSim,
  });

  await updateAliasTracker({
    variationId: aiVariationId,
    alias,
    regexPrediction,
    aiTruth,
  });

  return {
    rawProductString,
    price,
    taxonomy: aiTruth,
    storage: parsedStorage,
    condition: parsedCondition,
    sim: parsedSim,
    variationId: aiVariationId,
    trustedFastLane: false,
  };
};
