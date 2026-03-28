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

const USED_QUALIFIERS = /(uk used|pre-?owned|fair|open box|used|mint|pristine|almost new|basically new|just like new|like new|new phone only|clean as new|good condition)/i;
const NEW_QUALIFIERS = /(brand new|new sealed|sealed|^new$)/i;

const normalizeStorage = (value = '') => {
  const raw = String(value || '').toUpperCase();
  const matches = [...raw.matchAll(/\b(\d{1,4})\s*(GB|TB)\b/g)];
  if (!matches.length) {
    const slashConfig = raw.match(/\b\d{1,3}\s*\/\s*(64|128|256|512|1024)\b/);
    if (slashConfig?.[1]) return `${slashConfig[1]}GB`;

    const bareStorage = raw.match(/\b(64|128|256|512|1024)\b/);
    if (bareStorage?.[1]) return `${bareStorage[1]}GB`;

    return 'UNKNOWN';
  }

  const normalized = matches
    .map((match) => ({ amount: Number(match[1]), unit: String(match[2] || '').toUpperCase() }))
    .filter(({ amount, unit }) => Number.isFinite(amount)
      && !((unit === 'GB' && amount > 2048) || (unit === 'TB' && amount > 8)));

  if (!normalized.length) return 'UNKNOWN';

  // Prefer the largest capacity token to avoid RAM being chosen over storage (e.g. 8GB RAM + 512GB SSD).
  const best = normalized.reduce((current, next) => {
    const currentGb = current.unit === 'TB' ? current.amount * 1024 : current.amount;
    const nextGb = next.unit === 'TB' ? next.amount * 1024 : next.amount;
    return nextGb > currentGb ? next : current;
  });

  return `${best.amount}${best.unit}`;
};

const normalizeCondition = (value = '') => {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return 'Unknown';

  if (/non\s*-?\s*active/.test(text)) return 'Brand New';

  // Important business rule: mint/pristine/like-new/new-phone-only are still Used.
  if (USED_QUALIFIERS.test(text)) return 'Grade A UK Used';

  // New is allowed only for explicit clean qualifiers.
  if (NEW_QUALIFIERS.test(text)) return 'Brand New';

  return 'Unknown';
};

const resolveConditionWithDefaultUsed = (raw = '', current = 'Unknown') => {
  const normalizedCurrent = String(current || 'Unknown').trim();
  if (normalizedCurrent === 'Brand New' || normalizedCurrent === 'Grade A UK Used') return normalizedCurrent;
  const rawDerived = normalizeCondition(raw);
  if (rawDerived === 'Brand New') return 'Brand New';
  return 'Grade A UK Used';
};

const normalizeSim = (value = '') => {
  const text = String(value || '').toLowerCase();
  if (/\blocked\b|wi-?fi\s*only|wifi\s*only/.test(text)) return 'Locked/Wi-Fi Only (ESIM)';
  const hasEsim = /esim|e-sim/.test(text);
  const hasPhysical = /physical|single/.test(text);
  const hasIdm = /\bidm\b/.test(text);

  if (hasIdm && hasPhysical && hasEsim) return 'Physical SIM + ESIM';
  if (hasIdm && hasPhysical) return 'Physical SIM';
  if (hasIdm && hasEsim) return 'eSIM';
  if (hasIdm) return 'Physical SIM';
  if ((hasEsim && hasPhysical) || /physical\s*\+\s*esim/.test(text)) return 'Physical SIM + ESIM';
  if (/dual/.test(text)) return 'Physical SIM';
  if (hasEsim) return 'eSIM';
  if (hasPhysical) return 'Physical SIM';
  if (/\bfu\b|factory\s*unlocked|unlocked/.test(text)) return 'Physical SIM';
  return 'Unknown';
};

const inferSimByBrandContext = ({
  rawProductString = '',
  parsedSim = 'Unknown',
  taxonomy = canonicalFallbackTaxonomy(),
  deviceType = '',
}) => {
  if (parsedSim && parsedSim !== 'Unknown') return parsedSim;

  const raw = String(rawProductString || '').toLowerCase();
  const brand = String(taxonomy?.Brand || '').toLowerCase();
  const series = String(taxonomy?.Series || '').toLowerCase();
  const resolvedDeviceType = String(deviceType || '').toLowerCase();
  const looksLikeIphone = brand === 'apple'
    && (series.includes('iphone') || resolvedDeviceType.includes('iphone') || /\biphone\b/.test(raw));

  if (looksLikeIphone) return 'Physical SIM';

  const looksLikeSamsung = brand === 'samsung' || /\bsamsung\b|\bgalaxy\b/.test(raw);
  if (looksLikeSamsung) {
    if (/\bdual\b/.test(raw)) return 'Dual SIM';
    return 'Single SIM';
  }

  return parsedSim || 'Unknown';
};

const normalizeProcessorSpec = (value = '') => {
  const text = String(value || '');
  const patterns = [
    /core\s*i[3579](?:\s*[- ]?\d{3,5}[a-z]{0,2})?(?:\s*\d{1,2}(?:st|nd|rd|th)?\s*gen)?/i,
    /ryzen\s*[3579](?:\s*\d{3,5}[a-z]{0,2})?/i,
    /apple\s*m[1-4](?:\s*(?:pro|max|ultra))?/i,
    /\bm[1-4](?:\s*(?:pro|max|ultra))?\b/i,
    /intel\s*(?:uhd|iris)\s*\d*/i,
    /snapdragon\s*[a-z0-9+]+/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].replace(/\s+/g, ' ').trim();
  }

  return 'Unknown';
};

const inferConditionFromRaw = (raw = '', current = 'Unknown') => {
  if (current !== 'Unknown') return current;
  const text = String(raw || '').toLowerCase();
  if (/\bbh\s*\d{2,3}\b|\b\d{2,3}\s*bh\b|battery\s*health/.test(text)) return 'Grade A UK Used';
  if (/face\s*id\s*(issue|fault|not)|swap|crack|line\s*on\s*screen|dot\s*on\s*screen|ghost\s*touch/.test(text)) return 'Grade A UK Used';
  if (/\buk\s*used\b|used|pre-?owned|tt\b/.test(text)) return 'Grade A UK Used';
  if (/brand\s*new|sealed|new\s*sealed/.test(text)) return 'Brand New';
  return current;
};

const resolveSimWithLowCostAI = async (rawProductString = '') => {
  const raw = String(rawProductString || '').trim();
  if (!raw) return 'Unknown';

  try {
    const textAI = await resolveTextAIConfig({ background: false });
    const response = await textAI.client.chat.completions.create({
      model: textAI.model,
      messages: [
        { role: 'system', content: 'Classify SIM as exactly one label: Physical SIM, eSIM, Physical SIM + ESIM, Locked/Wi-Fi Only (ESIM), Unknown. Return one label only.' },
        { role: 'user', content: raw.slice(0, 220) },
      ],
      temperature: 0,
      max_tokens: 10,
    });

    const label = String(response?.choices?.[0]?.message?.content || '').trim();
    return normalizeSimLabel(label) || 'Unknown';
  } catch (error) {
    console.warn('⚠️ Low-cost SIM AI classification skipped:', error.message);
    return 'Unknown';
  }
};

const resolveSpecification = ({ rawProductString, category, parsedSim }) => {
  const normalizedCategory = String(category || '').toLowerCase();

  if (['laptops', 'gaming'].includes(normalizedCategory)) {
    const processor = normalizeProcessorSpec(rawProductString);
    if (processor !== 'Unknown') return processor;
  }

  return parsedSim;
};

const normalizeVariationSpecLabel = (value = '') => {
  const normalized = normalizeSimLabel(value);
  if (normalized) return normalized;
  return String(value || 'Unknown').trim() || 'Unknown';
};

const buildVariationId = ({ series, storage, condition, sim }) => `${series}_${storage}_${condition}_${normalizeVariationSpecLabel(sim)}`
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

let simDictionaryCache = [];
let simDictionaryCacheAt = 0;
const SIM_DICTIONARY_CACHE_TTL_MS = 60000;
let productCatalogCache = [];
let productCatalogCacheAt = 0;
const PRODUCT_CATALOG_CACHE_TTL_MS = 60000;

const normalizeSimLabel = (value = '') => {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return null;
  if (text.includes('locked') || text.includes('wifi only') || text.includes('wi-fi only')) return 'Locked/Wi-Fi Only (ESIM)';
  if (text.includes('physical') && text.includes('esim')) return 'Physical SIM + ESIM';
  if (text.includes('dual')) return 'Physical SIM';
  if (text.includes('esim')) return 'eSIM';
  if (text.includes('physical')) return 'Physical SIM';
  return null;
};

const toFetchableDictionaryUrl = (rawUrl = '') => {
  const url = String(rawUrl || '').trim();
  if (!url) return '';

  const match = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (!match?.[1]) return url;

  const gidMatch = url.match(/[?&]gid=(\d+)/i);
  const gid = gidMatch?.[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
};

const parseCsvRows = (rawText = '') => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < rawText.length; i += 1) {
    const char = rawText[i];
    const next = rawText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  return rows;
};

const toComparableToken = (value = '') => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const parseDictionaryText = (rawText = '') => parseCsvRows(rawText)
  .map((parts) => {
    if (parts.length < 2) return null;
    const key = String(parts[0] || '').toLowerCase();
    const value = normalizeSimLabel(parts[1]);
    if (!key || !value || key === 'key') return null;
    return { key, value };
  })
  .filter(Boolean);

const loadSimDictionary = async () => {
  const now = Date.now();
  if ((now - simDictionaryCacheAt) < SIM_DICTIONARY_CACHE_TTL_MS) return simDictionaryCache;

  const entries = [];

  const jsonBlob = process.env.SIM_DICTIONARY_JSON || process.env.ESIM_DICTIONARY_JSON || '';
  if (jsonBlob) {
    try {
      const parsed = JSON.parse(jsonBlob);
      Object.entries(parsed || {}).forEach(([key, value]) => {
        const normalized = normalizeSimLabel(value);
        if (normalized && String(key || '').trim()) {
          entries.push({ key: String(key).toLowerCase().trim(), value: normalized });
        }
      });
    } catch (error) {
      console.warn('⚠️ SIM dictionary JSON parse skipped:', error.message);
    }
  }

  const sourceUrlRaw = process.env.SIM_DICTIONARY_URL || process.env.ESIM_DICTIONARY_URL || process.env.SIM_KEY_VALUE_URL || '';
  const sourceUrl = toFetchableDictionaryUrl(sourceUrlRaw);
  if (sourceUrl) {
    try {
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const text = await response.text();
        entries.push(...parseDictionaryText(text));
      }
    } catch (error) {
      console.warn('⚠️ SIM dictionary URL fetch skipped:', error.message);
    }
  }

  simDictionaryCache = entries.sort((a, b) => b.key.length - a.key.length);
  simDictionaryCacheAt = now;
  return simDictionaryCache;
};

const loadProductCatalogDictionary = async () => {
  const now = Date.now();
  if ((now - productCatalogCacheAt) < PRODUCT_CATALOG_CACHE_TTL_MS) return productCatalogCache;

  const sourceUrlRaw = process.env.PRODUCT_DICTIONARY_URL || process.env.SIM_DICTIONARY_URL || process.env.ESIM_DICTIONARY_URL || '';
  const sourceUrl = toFetchableDictionaryUrl(sourceUrlRaw);
  if (!sourceUrl) return productCatalogCache;

  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return productCatalogCache;

    const csvText = await response.text();
    const rows = parseCsvRows(csvText);
    if (rows.length < 2) return productCatalogCache;

    const headers = rows[0].map((header) => String(header || '').toLowerCase());
    const idx = {
      category: headers.findIndex((h) => h.includes('category')),
      brand: headers.findIndex((h) => h.includes('brand')),
      series: headers.findIndex((h) => h.includes('series')),
      deviceType: headers.findIndex((h) => h.includes('device type')),
      storage: headers.findIndex((h) => h.includes('storage')),
      spec: headers.findIndex((h) => h.includes('sim type') || h.includes('processor')),
      condition: headers.findIndex((h) => h.includes('condition')),
    };

    if (idx.category < 0 || idx.brand < 0 || idx.series < 0 || idx.deviceType < 0) {
      return productCatalogCache;
    }

    productCatalogCache = rows.slice(1).map((cells) => ({
      category: String(cells[idx.category] || '').trim(),
      brand: String(cells[idx.brand] || '').trim(),
      series: String(cells[idx.series] || '').trim(),
      deviceType: String(cells[idx.deviceType] || '').trim(),
      storage: idx.storage >= 0 ? normalizeStorage(cells[idx.storage] || '') : 'UNKNOWN',
      spec: idx.spec >= 0 ? normalizeSimLabel(cells[idx.spec] || '') : null,
      condition: idx.condition >= 0 ? normalizeCondition(cells[idx.condition] || '') : 'Unknown',
    })).filter((entry) => entry.category && entry.brand && entry.series && entry.deviceType);

    productCatalogCacheAt = now;
  } catch (error) {
    console.warn('⚠️ Product catalog dictionary fetch skipped:', error.message);
  }

  return productCatalogCache;
};

const resolveCatalogEntry = async (rawText = '', parsedStorage = 'UNKNOWN') => {
  const catalog = await loadProductCatalogDictionary();
  if (!catalog.length) return null;

  const haystack = toComparableToken(rawText);
  const normalizedStorage = normalizeStorage(parsedStorage);

  const candidates = catalog
    .map((entry) => {
      const deviceToken = toComparableToken(entry.deviceType);
      const seriesToken = toComparableToken(entry.series);
      const deviceHit = deviceToken && haystack.includes(deviceToken);
      const seriesHit = seriesToken && haystack.includes(seriesToken);
      const storageHit = normalizedStorage === 'UNKNOWN' || entry.storage === 'UNKNOWN' || entry.storage === normalizedStorage;
      const score = (deviceHit ? 3 : 0) + (seriesHit ? 2 : 0) + (storageHit ? 1 : 0);
      return { entry, score, tokenSize: Math.max(deviceToken.length, seriesToken.length) };
    })
    .filter((candidate) => candidate.score >= 3)
    .sort((a, b) => (b.score - a.score) || (b.tokenSize - a.tokenSize));

  return candidates[0]?.entry || null;
};

const resolveSimWithDictionary = async (rawText = '') => {
  const entries = await loadSimDictionary();
  if (!entries.length) return null;

  const haystack = String(rawText || '').toLowerCase();
  const match = entries.find((entry) => haystack.includes(entry.key));
  return match?.value || null;
};

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

const inferTaxonomyFromRaw = (rawText = '') => {
  const text = String(rawText || '').toLowerCase();
  const compact = text.replace(/[^a-z0-9]/g, '');

  if (/\bairpods?\b|\bairpod\b/.test(text)) {
    return { Category: 'Sounds', Brand: 'Apple', Series: 'AirPods Series' };
  }

  const iphoneMatch = text.match(/iphone\s*(\d{1,2})/i);
  if (iphoneMatch?.[1]) {
    const model = iphoneMatch[1];
    return { Category: 'Smartphones', Brand: 'Apple', Series: `iPhone ${model} Series` };
  }

  const iphoneCompactMatch = text.match(/\b(\d{2})\s*pro\s*max\b|\b(\d{2})\s*promax\b|\b(\d{2})\s*pro\b|\b(\d{2})pro\b|\b(\d{2})\s*pm\b/i);
  if (iphoneCompactMatch) {
    const model = iphoneCompactMatch[1] || iphoneCompactMatch[2] || iphoneCompactMatch[3] || iphoneCompactMatch[4] || iphoneCompactMatch[5];
    if (Number(model) >= 11 && Number(model) <= 17) {
      return { Category: 'Smartphones', Brand: 'Apple', Series: `iPhone ${model} Series` };
    }
  }

  if (/\biphone\s*air\b/.test(text)) {
    return { Category: 'Smartphones', Brand: 'Apple', Series: 'iPhone 17 Series' };
  }

  const iphoneNumericAny = text.match(/\b(1[1-7])\b/);
  const hasCompetingFamily = /\b(macbook|thinkpad|probook|ipad|watch|iwatch)\b/i.test(text);
  if (!hasCompetingFamily && iphoneNumericAny?.[1] && /\b(gb|tb|sim|esim|e-?sim|p\s*\+|pro|max|plus|air|unlocked)\b/i.test(text)) {
    return { Category: 'Smartphones', Brand: 'Apple', Series: `iPhone ${iphoneNumericAny[1]} Series` };
  }

  if (/xs\s*max|xsm\b|xsmax/.test(text)) {
    return { Category: 'Smartphones', Brand: 'Apple', Series: 'iPhone X Series' };
  }
  if (/\biphone\s*x\b|\biphonex\b/.test(text)) {
    return { Category: 'Smartphones', Brand: 'Apple', Series: 'iPhone X Series' };
  }

  if (/macbook/.test(text)) {
    return { Category: 'Laptops', Brand: 'Apple', Series: 'MacBook Series' };
  }

  if (/\b(iwatch|apple\s*watch|watch\s*ultra)\b/.test(text)) {
    return { Category: 'Smartwatches', Brand: 'Apple', Series: 'Apple Watch Series' };
  }

  if (/\bipad\b/.test(text)) {
    return { Category: 'Tablets', Brand: 'Apple', Series: 'iPad Series' };
  }

  if (/\bmagic\s*keyboard\b/.test(text)) {
    return { Category: 'Accessories', Brand: 'Apple', Series: 'Magic Keyboard' };
  }

  if (/thinkpad/.test(text)) {
    return { Category: 'Laptops', Brand: 'Lenovo', Series: 'ThinkPad Series' };
  }

  if (/probook/.test(text)) {
    return { Category: 'Laptops', Brand: 'HP', Series: 'ProBook Series' };
  }

  if (/tecno\s*spark/.test(text)) {
    return { Category: 'Smartphones', Brand: 'Tecno', Series: 'Spark Series' };
  }

  // Samsung shorthand lists often omit the brand:
  // e.g. "S21 ultra 256gb", "Note 20", "Flip5", "Fold 4".
  if (/\b(?:s\d{1,2}|note\s*\d{1,2}|flip\s*\d{1,2}|fold\s*\d{1,2})\b/i.test(text)
    || /^(s\d{1,2}(plus|ultra)?|note\d{1,2}(plus|ultra)?|flip\d{1,2}|fold\d{1,2})\b/i.test(compact)) {
    if (/\bfold\s*\d{1,2}\b/.test(text) || /\bfold\d{1,2}\b/.test(compact)) {
      return { Category: 'Smartphones', Brand: 'Samsung', Series: 'Fold Series' };
    }
    if (/\bflip\s*\d{1,2}\b/.test(text) || /\bflip\d{1,2}\b/.test(compact)) {
      return { Category: 'Smartphones', Brand: 'Samsung', Series: 'Flip Series' };
    }
    if (/\bnote\s*\d{1,2}\b/.test(text) || /\bnote\d{1,2}\b/.test(compact)) {
      return { Category: 'Smartphones', Brand: 'Samsung', Series: 'Note Series' };
    }
    return { Category: 'Smartphones', Brand: 'Samsung', Series: 'S Series' };
  }

  const samsungGalaxy = text.match(/(galaxy\s*[a-z0-9+]+)/i);
  if (samsungGalaxy?.[1]) {
    return { Category: 'Smartphones', Brand: 'Samsung', Series: samsungGalaxy[1].replace(/\s+/g, ' ').trim() };
  }

  if (/\bsamsung\b|\bgalaxy\b/.test(text)) {
    if (/\b(z\s*)?fold\s*\d{1,2}\b|\bfold\s*\d{1,2}\b/.test(text)) {
      return { Category: 'Smartphones', Brand: 'Samsung', Series: 'Fold Series' };
    }
    if (/\b(z\s*)?flip\s*\d{1,2}\b|\bflip\s*\d{1,2}\b/.test(text)) {
      return { Category: 'Smartphones', Brand: 'Samsung', Series: 'Flip Series' };
    }
    if (/\bs\s*\d{1,2}\b|\bultra\b/.test(text)) {
      return { Category: 'Smartphones', Brand: 'Samsung', Series: 'S Series' };
    }
    if (/\bnote\s*\d{1,2}\b/.test(text)) {
      return { Category: 'Smartphones', Brand: 'Samsung', Series: 'Note Series' };
    }
    if (/\ba\s*\d{1,2}\b/.test(text)) {
      return { Category: 'Smartphones', Brand: 'Samsung', Series: 'A Series' };
    }
    return { Category: 'Smartphones', Brand: 'Samsung', Series: 'Samsung Series' };
  }

  if (/\b(monitor|inch\s+full\s+hd|display)\b/.test(text)) {
    return { Category: 'Accessories', Brand: 'Others', Series: 'Monitor Series' };
  }
  if (/\bseries\s*se\b|\b(?:2nd|3rd|4th)\s*gen\b/.test(text) && /\b(40m|41m|45m|49m|gps|lte|cellular)\b/.test(text)) {
    return { Category: 'Smartwatches', Brand: 'Apple', Series: 'Apple Watch Series' };
  }
  if (/\b(lens|frame|transitions?|nano-?texture|glass|cerulean|shiny|matte)\b/.test(text)) {
    return { Category: 'Others', Brand: 'Others', Series: 'General Listing' };
  }
  const pipeParts = String(rawText || '').split('|').map((part) => part.trim()).filter(Boolean);
  const pipeLead = String(pipeParts[0] || '').trim();
  const pipePriceToken = pipeParts.length >= 3 ? pipeParts[pipeParts.length - 1] : '';
  const pipeLooksPriced = /\d[\d,\s.]*/.test(pipePriceToken);
  const looksLikeGenericLead = /[a-z]{3,}/i.test(pipeLead)
    && !/(updated price list|enquiries|orders|follow us|instagram|stores ltd|lagos|street)/i.test(pipeLead);
  if ((pipeParts.length >= 3 && pipeLooksPriced && looksLikeGenericLead) || (pipeParts.length >= 2 && looksLikeGenericLead)) {
    return { Category: 'Others', Brand: 'Others', Series: 'General Listing' };
  }
  if (/\b(printer|laserjet|neverstop)\b/.test(text)) {
    return { Category: 'Accessories', Brand: 'Others', Series: 'Printers Series' };
  }
  if (/\b(ups|bluegate)\b/.test(text)) {
    return { Category: 'Accessories', Brand: 'Others', Series: 'UPS Series' };
  }
  if (/\b(tv|television|qled|uhd|crystal\s+uhd)\b/.test(text)) {
    return { Category: 'Accessories', Brand: 'Others', Series: 'TV Series' };
  }
  if (/\b(hp|lenovo|dell|asus|acer|thinkpad|ideapad|yoga|spectre|pavilion|omnibook|xps|alienware|vostro|latitude|inspiron|zenbook|vivobook|aspire)\b/.test(text)) {
    return { Category: 'Laptops', Brand: 'Others', Series: 'Laptop Series' };
  }

  return canonicalFallbackTaxonomy();
};

const inferDeviceTypeFromRaw = (rawText = '', fallbackSeries = 'Unknown Device') => {
  const text = String(rawText || '').toLowerCase();
  const normalizeIphoneSuffix = (value = '') => {
    const token = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!token) return '';
    if (token === 'pm') return 'Pro Max';
    if (token === 'pro max') return 'Pro Max';
    if (token === 'promax') return 'Pro Max';
    if (token === 'pro') return 'Pro';
    if (token === 'max') return 'Max';
    if (token === 'plus') return 'Plus';
    if (token === 'air') return 'Air';
    return token;
  };

  const iphone = text.match(/iphone\s*(\d{1,2})(?:\s*(pro\s*max|pro|max|plus))?/i);
  if (iphone?.[1]) {
    const normalizedSuffix = normalizeIphoneSuffix(iphone?.[2]);
    const suffix = normalizedSuffix ? ` ${normalizedSuffix}` : '';
    return `iPhone ${iphone[1]}${suffix}`.trim();
  }

  const compactIphone = text.match(/\b(1[1-7])\s*(pro\s*max|promax|pro|max|plus|pm|air)\b/i);
  if (compactIphone?.[1]) {
    return `iPhone ${compactIphone[1]} ${normalizeIphoneSuffix(compactIphone[2])}`.trim();
  }

  if (/\biphone\s*air\b/i.test(text)) return 'iPhone 17 Air';

  const compactBaseIphone = text.match(/\b(1[1-7])\b/);
  const hasCompetingDeviceFamily = /\b(macbook|thinkpad|probook|ipad|watch|iwatch)\b/i.test(text);
  if (!hasCompetingDeviceFamily && compactBaseIphone?.[1] && /\b(gb|tb|sim|esim|e-?sim|p\s*\+|pro|max|plus|air|unlocked)\b/i.test(text)) {
    return `iPhone ${compactBaseIphone[1]}`;
  }

  if (/macbook\s*pro/i.test(text)) return 'MacBook Pro';
  if (/macbook\s*air/i.test(text)) return 'MacBook Air';
  if (/macbook/i.test(text)) return 'MacBook';
  const samsungFold = text.match(/\b(?:samsung|galaxy)?\s*(?:z\s*)?fold\s*(\d{1,2})\b/i);
  if (samsungFold?.[1]) return `Samsung Z Fold${samsungFold[1]}`;
  const samsungFlip = text.match(/\b(?:samsung|galaxy)?\s*(?:z\s*)?flip\s*(\d{1,2})\b/i);
  if (samsungFlip?.[1]) return `Samsung Z Flip${samsungFlip[1]}`;
  const samsungS = text.match(/\b(?:samsung|galaxy)\s*s\s*(\d{1,2})(?:\s*(ultra|plus))?(?=\d|\b)/i);
  if (samsungS?.[1]) {
    const tierToken = String(samsungS?.[2] || '').toLowerCase();
    const tier = tierToken === 'ultra' ? ' Ultra' : (tierToken === 'plus' ? ' Plus' : '');
    return `Samsung S${samsungS[1]}${tier}`;
  }
  const samsungCompactS = text.match(/\bs\s*(\d{1,2})(?:\s*(ultra|plus))?(?=\d|\b)/i);
  if (samsungCompactS?.[1] && !/\biphone\b/i.test(text)) {
    const tierToken = String(samsungCompactS?.[2] || '').toLowerCase();
    const tier = tierToken === 'ultra' ? ' Ultra' : (tierToken === 'plus' ? ' Plus' : '');
    return `Samsung S${samsungCompactS[1]}${tier}`;
  }
  const samsungNote = text.match(/\bnote\s*(\d{1,2})(?:\s*ultra|\s*plus)?\b/i);
  if (samsungNote?.[1]) {
    const tier = /\bultra\b/i.test(text) ? ' Ultra' : (/\bplus\b/i.test(text) ? ' Plus' : '');
    return `Samsung Note ${samsungNote[1]}${tier}`;
  }
  const appleWatch = text.match(/\b(iwatch|apple\s*watch|watch\s*ultra)\s*(ultra\s*\d+|series\s*\d+|se)?/i);
  if (appleWatch?.[2]) {
    const watchSuffix = appleWatch[2]
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^ultra/i, 'Ultra')
      .replace(/^series/i, 'Series')
      .replace(/^se$/i, 'SE');
    return `Apple Watch ${watchSuffix}`;
  }
  if (appleWatch?.[1]) return 'Apple Watch';
  const appleWatchSe = text.match(/\bseries\s*se\s*(\d{1,2})(?:st|nd|rd|th)?\s*gen\b/i);
  if (appleWatchSe?.[1]) return `Apple Watch SE ${appleWatchSe[1]}`;
  if (/\bipad\s*air\b/i.test(text)) return 'iPad Air';
  if (/\bipad\s*pro\b/i.test(text)) return 'iPad Pro';
  if (/\bipad\b/i.test(text)) return 'iPad';
  if (/\bmagic\s*keyboard\b/i.test(text)) return 'Magic Keyboard';
  if (/\bairpods?\b|\bairpod\b/i.test(text)) return 'AirPods';
  if (/thinkpad/i.test(text)) return 'Lenovo ThinkPad';
  if (/probook/i.test(text)) return 'HP ProBook';
  const wigMatch = text.match(/\bwig\s*([a-z0-9-]+)?/i);
  if (wigMatch) {
    const wigName = String(wigMatch[1] || '').replace(/[^a-z0-9-]/gi, '').trim();
    return wigName ? `Wig ${wigName.charAt(0).toUpperCase()}${wigName.slice(1).toLowerCase()}` : 'Wig';
  }
  const genericPipeParts = String(rawText || '').split('|').map((part) => part.trim()).filter(Boolean);
  if (genericPipeParts.length >= 3) {
    const lead = String(genericPipeParts[0] || '').trim();
    if (lead) return lead;
  }

  return fallbackSeries || 'Unknown Device';
};

const sanitizeTaxonomyCandidate = (entry = canonicalFallbackTaxonomy()) => {
  const invalidSeriesPattern = /(grade\s*a|brand\s*new|uk\s*used|unknown|physical\s*sim|esim|locked)/i;
  const safeSeries = invalidSeriesPattern.test(String(entry.Series || '')) ? 'Others' : String(entry.Series || 'Others');
  const safeBrand = invalidSeriesPattern.test(String(entry.Brand || '')) ? 'Others' : String(entry.Brand || 'Others');
  const safeCategory = String(entry.Category || 'Others').trim() || 'Others';
  return {
    Category: safeCategory,
    Brand: safeBrand,
    Series: safeSeries,
  };
};

const taxonomySpecificityScore = (entry = canonicalFallbackTaxonomy()) => ['Category', 'Brand', 'Series']
  .reduce((score, key) => (String(entry?.[key] || '').trim().toLowerCase() !== 'others' ? score + 1 : score), 0);

const isAllOthersTaxonomy = (entry = canonicalFallbackTaxonomy()) => taxonomySpecificityScore(entry) === 0;

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
    promotedToTrusted = nextTrusted && !currentAlias.isTrusted;

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

export const processWithShadowTesting = async ({ rawProductString, price, strictVendorMode = false }) => {
  const alias = normalizeAlias(rawProductString);
  const parsedStorage = normalizeStorage(rawProductString);
  const parsedCondition = normalizeCondition(rawProductString);
  const inferredConditionBase = inferConditionFromRaw(rawProductString, parsedCondition);
  const catalogEntry = await resolveCatalogEntry(rawProductString, parsedStorage);
  const parsedSim = catalogEntry?.spec || (await resolveSimWithDictionary(rawProductString)) || normalizeSim(rawProductString);

  const ignoredByPhrase = await shouldIgnoreRawString(rawProductString);
  if (ignoredByPhrase) {
    const fallbackDeviceType = inferDeviceTypeFromRaw(rawProductString, 'Unknown Device');
    return {
      rawProductString,
      price,
      taxonomy: canonicalFallbackTaxonomy(),
      deviceType: fallbackDeviceType,
      storage: parsedStorage,
      condition: inferredConditionBase,
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
    const fastLaneDeviceType = inferDeviceTypeFromRaw(rawProductString, fastLane.taxonomy?.Series || 'Unknown Device');
    return {
      rawProductString,
      price,
      taxonomy: fastLane.taxonomy,
      deviceType: fastLaneDeviceType,
      storage: parsedStorage,
      condition: inferredConditionBase,
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
  let fallbackTaxonomy = inferTaxonomyFromRaw(rawProductString);
  if (strictVendorMode
    && fallbackTaxonomy?.Category === 'Others'
    && fallbackTaxonomy?.Brand === 'Others'
    && fallbackTaxonomy?.Series === 'General Listing') {
    fallbackTaxonomy = canonicalFallbackTaxonomy();
  }
  const catalogTaxonomy = catalogEntry
    ? {
      Category: catalogEntry.category,
      Brand: catalogEntry.brand,
      Series: catalogEntry.series,
    }
    : null;

  const selectedTaxonomy = (() => {
    // Always execute and prioritize the Two-Layer judge first.
    // If AI is uncertain, prefer whichever fallback has higher specificity.
    if (!isAllOthersTaxonomy(aiTruth)) {
      const aiScore = taxonomySpecificityScore(aiTruth);
      const fallbackScore = taxonomySpecificityScore(fallbackTaxonomy);
      const catalogScore = taxonomySpecificityScore(catalogTaxonomy || canonicalFallbackTaxonomy());

      if (fallbackScore > aiScore) return fallbackTaxonomy;
      if (catalogScore > aiScore) return catalogTaxonomy;
      return aiTruth;
    }

    if (!isAllOthersTaxonomy(catalogTaxonomy || canonicalFallbackTaxonomy())) return catalogTaxonomy;
    return fallbackTaxonomy;
  })();
  const finalTaxonomy = sanitizeTaxonomyCandidate(selectedTaxonomy);

  if (isAllOthersTaxonomy(aiTruth)) {
    await incrementMetrics({ stage2OthersFallbacks: 1 });
  }

  const baseCondition = parsedCondition === 'Unknown' && catalogEntry?.condition && catalogEntry.condition !== 'Unknown'
    ? catalogEntry.condition
    : inferredConditionBase;
  const normalizedSeries = String(finalTaxonomy?.Series || '').toLowerCase();
  const isCustomIndustrySeries = normalizedSeries === 'general listing';
  const resolvedCondition = isCustomIndustrySeries
    ? baseCondition
    : resolveConditionWithDefaultUsed(rawProductString, baseCondition);
  const safeFallbackSeries = String(finalTaxonomy.Series || '').trim().toLowerCase() === 'others'
    ? 'Unknown Device'
    : finalTaxonomy.Series;
  const resolvedDeviceType = catalogEntry?.deviceType
    || inferDeviceTypeFromRaw(rawProductString, safeFallbackSeries || 'Unknown Device');
  let resolvedSpecification = resolveSpecification({
    rawProductString,
    category: finalTaxonomy.Category,
    parsedSim,
  });

  const normalizedCategory = String(finalTaxonomy.Category || '').toLowerCase();
  const shouldUseAiForSim = ['smartphones', 'smartwatches'].includes(normalizedCategory) && resolvedSpecification === 'Unknown';
  if (shouldUseAiForSim) {
    resolvedSpecification = await resolveSimWithLowCostAI(rawProductString);
  }
  resolvedSpecification = inferSimByBrandContext({
    rawProductString,
    parsedSim: resolvedSpecification,
    taxonomy: finalTaxonomy,
    deviceType: resolvedDeviceType,
  });

  const requiresStorage = ['smartphones', 'laptops', 'tablets', 'gaming'].includes(normalizedCategory);
  const hasUnknownVariantAttr = (requiresStorage && parsedStorage === 'UNKNOWN');

  if (hasUnknownVariantAttr || (finalTaxonomy.Category === 'Others' && finalTaxonomy.Brand === 'Others' && finalTaxonomy.Series === 'Others')) {
    return {
      rawProductString,
      price,
      taxonomy: finalTaxonomy,
      deviceType: resolvedDeviceType,
      storage: parsedStorage,
      condition: resolvedCondition,
      sim: resolvedSpecification,
      variationId: null,
      trustedFastLane: false,
      ignored: true,
      ignoreReason: hasUnknownVariantAttr ? 'unknown-variant-attribute' : 'taxonomy-others',
    };
  }

  const aiVariationId = buildVariationId({
    series: finalTaxonomy.Series,
    storage: parsedStorage,
    condition: resolvedCondition,
    sim: resolvedSpecification,
  });

  let shadowResult = { didMatch: false, promotedToTrusted: false };
  try {
    shadowResult = await updateAliasTracker({
      variationId: aiVariationId,
      alias,
      regexPrediction,
      aiTruth: finalTaxonomy,
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
    taxonomy: finalTaxonomy,
    deviceType: resolvedDeviceType,
    storage: parsedStorage,
    condition: resolvedCondition,
    sim: resolvedSpecification,
    variationId: aiVariationId,
    trustedFastLane: false,
    ignored: false,
  };
};

export const __testables = {
  normalizeStorage,
  normalizeCondition,
  normalizeSim,
  inferConditionFromRaw,
  resolveConditionWithDefaultUsed,
  inferTaxonomyFromRaw,
  inferDeviceTypeFromRaw,
  inferSimByBrandContext,
  buildVariationId,
  canonicalFallbackTaxonomy,
  taxonomySpecificityScore,
  isAllOthersTaxonomy,
  regexPredictTaxonomy,
  toAliasDocId,
};
