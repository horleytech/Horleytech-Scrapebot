import admin from 'firebase-admin';
import { getAdminFirestore } from './backup.js';
import { resolveTextAIConfig } from './aiConfig.js';

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

const normalizeAlias = (value = '') => String(value || '').trim().toLowerCase();
const normalizeComparable = (value = '') => normalizeAlias(value).replace(/[^a-z0-9]/g, '');
const toAliasDocId = (alias) => encodeURIComponent(normalizeAlias(alias));

const USED_QUALIFIERS = /(uk used|pre-?owned|fair|open box|used|mint|pristine|almost new|basically new|just like new|like new|new phone only|clean as new)/i;
const NEW_QUALIFIERS = /(brand new|new sealed|sealed|^new$)/i;

const normalizeStorage = (value = '') => {
  const raw = String(value || '').toUpperCase().replace(/\s+/g, '');
  const storageMatch = raw.match(/(\d+)(GB|TB)/i);
  if (!storageMatch) return 'UNKNOWN';

  const amount = Number(storageMatch[1]);
  const unit = storageMatch[2].toUpperCase();

  // Guard against malformed joins like 13128GB which create noisy container IDs.
  if ((unit === 'GB' && amount > 2048) || (unit === 'TB' && amount > 8)) return 'UNKNOWN';

  return `${amount}${unit}`;
};

const normalizeCondition = (value = '') => {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return 'Unknown';

  // Important business rule: mint/pristine/like-new/new-phone-only are still Used.
  if (USED_QUALIFIERS.test(text)) return 'Grade A UK Used';

  // New is allowed only for explicit clean qualifiers.
  if (NEW_QUALIFIERS.test(text)) return 'Brand New';

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

let excludedPhraseCache = [];
let excludedPhraseCacheAt = 0;
const EXCLUDED_PHRASE_CACHE_TTL_MS = 60000;

const getExcludedPhrases = async () => {
  const now = Date.now();
  if ((now - excludedPhraseCacheAt) < EXCLUDED_PHRASE_CACHE_TTL_MS) return excludedPhraseCache;

  try {
    const firestore = getAdminFirestore();
    const prefSnap = await withRetries(() => firestore.collection(SETTINGS_COLLECTION).doc('adminPreferences').get(), { retries: 1, delayMs: 200 });
    const raw = String(prefSnap.data()?.excludedPhrases || '');
    excludedPhraseCache = raw.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
    excludedPhraseCacheAt = now;
  } catch (error) {
    console.warn('⚠️ Excluded phrase read skipped:', error.message);
  }

  return excludedPhraseCache;
};

const shouldIgnoreRawString = async (rawText = '') => {
  const text = String(rawText || '').toLowerCase();
  if (!text) return true;
  const phrases = await getExcludedPhrases();
  return phrases.some((phrase) => text.includes(phrase));
};

const isTaxonomyEntryValid = (entry = {}) => {
  const category = String(entry.Category || '').trim();
  const brand = String(entry.Brand || '').trim();
  const series = String(entry.Series || '').trim();
  const brandLower = brand.toLowerCase();

  if (!category || !brand || !series) return false;
  if (brandLower === 'mint' || brandLower === 'pristine' || brandLower === 'like new') return false;
  return true;
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

      if (!isTaxonomyEntryValid(candidate)) return;
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

  const aiConfig = await resolveTextAIConfig({ background: false });
  const response = await aiConfig.client.chat.completions.create({
    model: aiConfig.model,
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

  const ignoredByPhrase = await shouldIgnoreRawString(rawProductString);
  if (ignoredByPhrase) {
    return {
      rawProductString,
      price,
      taxonomy: canonicalFallbackTaxonomy(),
      storage: parsedStorage,
      condition: parsedCondition,
      sim: parsedSim,
      variationId: null,
      trustedFastLane: false,
      ignored: true,
      ignoreReason: 'excluded-phrase',
    };
  }

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
      ignored: false,
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

  const hasUnknownVariantAttr = parsedStorage === 'UNKNOWN' || parsedCondition === 'Unknown' || parsedSim === 'Unknown';
  if (hasUnknownVariantAttr || (aiTruth.Category === 'Others' && aiTruth.Brand === 'Others' && aiTruth.Series === 'Others')) {
    return {
      rawProductString,
      price,
      taxonomy: aiTruth,
      storage: parsedStorage,
      condition: parsedCondition,
      sim: parsedSim,
      variationId: null,
      trustedFastLane: false,
      ignored: true,
      ignoreReason: hasUnknownVariantAttr ? 'unknown-variant-attribute' : 'taxonomy-others',
    };
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
    ignored: false,
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
