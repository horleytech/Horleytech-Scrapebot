import OpenAI from 'openai';
import { getAdminFirestore } from './backup.js';

const AI_CONTROL_DOC_PATH = ['horleyTech_Settings', 'aiControl'];
const PROVIDERS = new Set(['openai', 'qwen']);
const CACHE_TTL_MS = 15000;

let cachedControl = null;
let cachedControlAt = 0;

const normalizeProvider = (provider) => {
  const normalized = String(provider || '').trim().toLowerCase();
  return PROVIDERS.has(normalized) ? normalized : 'openai';
};

const getDefaultProvider = () => normalizeProvider(process.env.AI_PROVIDER_DEFAULT || 'openai');

const getOpenAIKey = ({ background = false } = {}) => (
  background
    ? (process.env.OPENAI_API_KEY_SYNC || process.env.OPENAI_API_KEY || process.env.AI_OPENAI_API_KEY || '')
    : (process.env.OPENAI_API_KEY || process.env.AI_OPENAI_API_KEY || '')
);

const getQwenKey = ({ background = false } = {}) => (
  background
    ? (process.env.QWEN_API_KEY_SYNC || process.env.QWEN_API_KEY || '')
    : (process.env.QWEN_API_KEY || '')
);

const getQwenBaseURL = () => process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

const getTextModel = (provider) => {
  if (provider === 'qwen') return process.env.AI_TEXT_MODEL_QWEN || 'qwen-plus';
  return process.env.AI_TEXT_MODEL_OPENAI || 'gpt-4o-mini';
};

const getImageModel = (provider) => {
  if (provider === 'qwen') return process.env.AI_IMAGE_MODEL_QWEN || 'qwen-image';
  return process.env.AI_IMAGE_MODEL_OPENAI || 'dall-e-2';
};

const buildOpenAIClient = ({ provider, background = false }) => {
  if (provider === 'qwen') {
    const apiKey = getQwenKey({ background });
    if (!apiKey) throw new Error('QWEN_API_KEY is required when AI provider is qwen.');
    return new OpenAI({ apiKey, baseURL: getQwenBaseURL() });
  }

  const apiKey = getOpenAIKey({ background });
  if (!apiKey) throw new Error('OPENAI_API_KEY is required when AI provider is openai.');
  return new OpenAI({ apiKey });
};

const loadAIControl = async () => {
  const now = Date.now();
  if (cachedControl && (now - cachedControlAt) < CACHE_TTL_MS) return cachedControl;

  try {
    const firestore = getAdminFirestore();
    const docSnap = await firestore.collection(AI_CONTROL_DOC_PATH[0]).doc(AI_CONTROL_DOC_PATH[1]).get();
    cachedControl = docSnap.exists ? (docSnap.data() || {}) : {};
    cachedControlAt = now;
    return cachedControl;
  } catch (error) {
    console.warn('⚠️ Could not read aiControl config, using env default:', error.message);
    return cachedControl || {};
  }
};

export const resolveTextAIConfig = async ({ background = false } = {}) => {
  const control = await loadAIControl();
  const provider = normalizeProvider(control.selectedProvider || getDefaultProvider());
  return {
    provider,
    model: String(control.textModel || getTextModel(provider)),
    client: buildOpenAIClient({ provider, background }),
  };
};

export const resolveImageAIConfig = async () => {
  const control = await loadAIControl();
  const imageProvider = normalizeProvider(control.imageProvider || getDefaultProvider());

  return {
    provider: imageProvider,
    model: String(control.imageModel || getImageModel(imageProvider)),
    client: buildOpenAIClient({ provider: imageProvider, background: true }),
  };
};

export const getAIProviders = () => ['openai', 'qwen'];
