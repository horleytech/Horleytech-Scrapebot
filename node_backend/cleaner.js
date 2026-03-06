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
const PRODUCT_ALIAS_INDEX_COLLECTION = 'horleyTech_ProductAliasIndex';
const SETTINGS_COLLECTION = 'horleyTech_Settings';
const SHADOW_METRICS_DOC = 'shadowTestingMetrics';

let openaiClient = null;
const getOpenAIClient = () => {
  if (openaiClient) return openaiClient;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for Stage 2 AI mapping.');
  }
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
};

const normalizeAlias = (value = '') => String(value || '').trim().toLowerCase();
const normalizeComparable = (value = '') => normalizeAlias(value).replace(/[^a-z0-9]/g, '');
const toAliasDocId = (alias) => encodeURIComponent(normalizeAlias(alias));

const normalizeStorage = (value = '') => {
  const raw = String(value || '').toUpperCase().replace(/\s+/g, '');
  const storageMatch = raw.match(/(\d+)(GB|TB)/i);
  if (!storageMatch) return 'UNKNOWN';
  return `${storageMatch[1]}${storageMatch[2].toUpperCase()}`;
};

const normalizeCondition = (value = '') => {
  const text = String(value || '').toLowerCase();
  if (/(uk used|pre-owned|fair|open box|used)/i.test(text)) return 'Grade A UK Used';
  if (/(brand new|sealed|new)/i.test(text)) return 'Brand New';
  return 'Unknown';
};

const normalizeSim = (value = '') => {
  const text = String(value || '').toLowerCase();
  if (/dual/.test(text)) return 'Dual SIM';
  if (/esim|e-sim/.test(text)) return 'eSIM';
  if (/physical|single/.test(text)) return 'Physical SIM';
  return 'Unknown';
};

const buildVariationId = ({ series, storage, condition, sim }) => `${series}_${storage}_${condition}_${sim}`
  .toLowerCase()
  .replace(/\s+/g, '-');


const isTransientFirestoreError = (error) => {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('deadline_exceeded') || msg.includes('unavailable') || msg.includes('resource_exhausted');
};

const withRetries = async (operation, { retries = 2, delayMs = 300 } = {}) => {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientFirestoreError(error) || attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      attempt += 1;
    }
  }
  return null;
};

const canonicalFallbackTaxonomy = () => ({ Category: 'Others', Brand: 'Others', Series: 'Others' });

const collectMasterTaxonomy = async () => {
  const firestore = getAdminFirestore();
  const categories = ['Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'];
  const rows = [];
  const uniqueTriples = new Set();

  for (const category of categories) {
    const docSnap = await withRetries(() => firestore.collection(SETTINGS_COLLECTION).doc(`mappings_${category}`).get(), { retries: 1, delayMs: 200 });
    if (!docSnap.exists) continue;

    const mappings = docSnap.data()?.mappings || {};

    Object.entries(mappings).forEach(([raw, mapped]) => {
      const candidate = {
        raw: String(raw || ''),
        Category: mapped?.category || 'Others',
        Brand: mapped?.brand || 'Others',
        Series: mapped?.series || 'Others',
      };

      const tripleKey = `${candidate.Category}::${candidate.Brand}::${candidate.Series}`;
      uniqueTriples.add(tripleKey);
      rows.push(candidate);
    });
  }

  const canonicalTaxonomy = Array.from(uniqueTriples).map((entry) => {
    const [Category, Brand, Series] = entry.split('::');
    return { Category, Brand, Series };
  });

  return { rows, canonicalTaxonomy };
};

const regexPredictTaxonomy = (rawProductString, masterRows = []) => {
  const normalizedRaw = normalizeComparable(rawProductString);

  const hit = masterRows.find((row) => {
    const target = normalizeComparable(row.raw);
    return target && normalizedRaw.includes(target);
  });

  if (!hit) return canonicalFallbackTaxonomy();

  return {
    Category: hit.Category || 'Others',
    Brand: hit.Brand || 'Others',
    Series: hit.Series || 'Others',
  };
};

const runTwoLayerJudge = async (rawProductString, canonicalTaxonomy = []) => {
  if (!canonicalTaxonomy.length) return canonicalFallbackTaxonomy();

  const systemPrompt = 'You are a strict taxonomy judge. Choose EXACTLY one item from provided taxonomy list. Return JSON object with keys: Category, Brand, Series, confidence (0-1), exactMatched (boolean). If not confident exact match, return Others/ Others/ Others with confidence <= 0.5 and exactMatched false.';

  const response = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ rawProductString, taxonomy: canonicalTaxonomy }) },
    ],
    temperature: 0,
  });

  const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');

  const confidence = Number(parsed?.confidence || 0);
  const exactMatched = Boolean(parsed?.exactMatched);
  const proposed = {
    Category: parsed?.Category,
    Brand: parsed?.Brand,
    Series: parsed?.Series,
  };

  const found = canonicalTaxonomy.find((item) => item.Category === proposed.Category && item.Brand === proposed.Brand && item.Series === proposed.Series);
  if (!found || !exactMatched || confidence < 0.8) return canonicalFallbackTaxonomy();

  return found;
};

const incrementMetrics = async (delta = {}) => {
  const firestore = getAdminFirestore();
  const metricsRef = firestore.collection(SETTINGS_COLLECTION).doc(SHADOW_METRICS_DOC);
  const payload = {
    updatedAt: new Date().toISOString(),
  };

  Object.entries(delta).forEach(([key, value]) => {
    if (!Number.isFinite(value) || value === 0) return;
    payload[key] = admin.firestore.FieldValue.increment(value);
  });

  try {
    await withRetries(() => metricsRef.set(payload, { merge: true }), { retries: 1, delayMs: 250 });
  } catch (error) {
    console.warn('⚠️ Metrics write skipped:', error.message);
  }
};

const updateAliasTracker = async ({ variationId, alias, regexPrediction, aiTruth }) => {
  const firestore = getAdminFirestore();
  const containerRef = firestore.collection(PRODUCT_CONTAINER_COLLECTION).doc(variationId);
  const aliasIndexRef = firestore.collection(PRODUCT_ALIAS_INDEX_COLLECTION).doc(toAliasDocId(alias));

  const didMatch = regexPrediction.Category === aiTruth.Category
    && regexPrediction.Brand === aiTruth.Brand
    && regexPrediction.Series === aiTruth.Series;

  let promotedToTrusted = false;

  await withRetries(() => firestore.runTransaction(async (transaction) => {
    const containerSnap = await transaction.get(containerRef);
    const existing = containerSnap.exists ? containerSnap.data() : {};
    const aliasTracker = existing.aliasTracker || {};
    const currentAlias = aliasTracker[alias] || { consecutiveMatches: 0, isTrusted: false };

    const nextCount = didMatch ? Number(currentAlias.consecutiveMatches || 0) + 1 : 0;
    const nextTrusted = didMatch ? nextCount >= 100 : false;
    promotedToTrusted = nextTrusted && !Boolean(currentAlias.isTrusted);

    const updatePayload = {
      [`aliasTracker.${alias}.consecutiveMatches`]: didMatch
        ? admin.firestore.FieldValue.increment(1)
        : 0,
      [`aliasTracker.${alias}.isTrusted`]: nextTrusted,
      [`aliasTracker.${alias}.lastCheckedAt`]: new Date().toISOString(),
    };

    if (!existing.officialTaxonomy || !existing.officialTaxonomy.Series) {
      updatePayload.officialTaxonomy = aiTruth;
    }

    transaction.set(containerRef, updatePayload, { merge: true });

    transaction.set(aliasIndexRef, {
      alias,
      variationId,
      isTrusted: nextTrusted,
      lastCheckedAt: new Date().toISOString(),
    }, { merge: true });
  }), { retries: 1, delayMs: 300 });

  return { didMatch, promotedToTrusted };
};

const tryTrustedFastLane = async (alias) => {
  const firestore = getAdminFirestore();
  const aliasIndexRef = firestore.collection(PRODUCT_ALIAS_INDEX_COLLECTION).doc(toAliasDocId(alias));
  let aliasSnap;
  try {
    aliasSnap = await withRetries(() => aliasIndexRef.get(), { retries: 1, delayMs: 200 });
  } catch (error) {
    console.warn('⚠️ Trusted fast-lane lookup skipped:', error.message);
    return null;
  }

  if (!aliasSnap.exists) return null;

  const aliasData = aliasSnap.data() || {};
  if (!aliasData.isTrusted || !aliasData.variationId) return null;

  let containerSnap;
  try {
    containerSnap = await withRetries(() => firestore.collection(PRODUCT_CONTAINER_COLLECTION).doc(String(aliasData.variationId)).get(), { retries: 1, delayMs: 200 });
  } catch (error) {
    console.warn('⚠️ Trusted container lookup skipped:', error.message);
    return null;
  }
  if (!containerSnap.exists) return null;

  const containerData = containerSnap.data() || {};
  const tracker = containerData.aliasTracker?.[alias];
  if (!tracker?.isTrusted) return null;

  return {
    variationId: String(aliasData.variationId),
    taxonomy: containerData.officialTaxonomy || canonicalFallbackTaxonomy(),
  };
};

export const processWithShadowTesting = async ({ rawProductString, price }) => {
  const alias = normalizeAlias(rawProductString);
  const parsedStorage = normalizeStorage(rawProductString);
  const parsedCondition = normalizeCondition(rawProductString);
  const parsedSim = normalizeSim(rawProductString);

  await incrementMetrics({ totalProcessed: 1 });

  const fastLane = await tryTrustedFastLane(alias);
  if (fastLane) {
    await incrementMetrics({ fastLaneHits: 1 });
    return {
      rawProductString,
      price,
      taxonomy: fastLane.taxonomy,
      storage: parsedStorage,
      condition: parsedCondition,
      sim: parsedSim,
      variationId: fastLane.variationId,
      trustedFastLane: true,
    };
  }

  let rows = [];
  let canonicalTaxonomy = [];
  try {
    const collected = await collectMasterTaxonomy();
    rows = collected.rows;
    canonicalTaxonomy = collected.canonicalTaxonomy;
  } catch (error) {
    console.warn('⚠️ Master taxonomy fetch failed, using fallback:', error.message);
  }

  const regexPrediction = regexPredictTaxonomy(alias, rows);
  const aiTruth = await runTwoLayerJudge(alias, canonicalTaxonomy);

  if (aiTruth.Category === 'Others' && aiTruth.Brand === 'Others' && aiTruth.Series === 'Others') {
    await incrementMetrics({ stage2OthersFallbacks: 1 });
  }

  const aiVariationId = buildVariationId({
    series: aiTruth.Series,
    storage: parsedStorage,
    condition: parsedCondition,
    sim: parsedSim,
  });

  let shadowResult = { didMatch: false, promotedToTrusted: false };
  try {
    shadowResult = await updateAliasTracker({
      variationId: aiVariationId,
      alias,
      regexPrediction,
      aiTruth,
    });
  } catch (error) {
    console.warn('⚠️ Alias tracker update skipped:', error.message);
  }

  await incrementMetrics({
    shadowMatches: shadowResult.didMatch ? 1 : 0,
    shadowMismatches: shadowResult.didMatch ? 0 : 1,
    promotedTrustedAliases: shadowResult.promotedToTrusted ? 1 : 0,
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

export const __testables = {
  normalizeStorage,
  normalizeCondition,
  normalizeSim,
  buildVariationId,
  canonicalFallbackTaxonomy,
  regexPredictTaxonomy,
  toAliasDocId,
};
