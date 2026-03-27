import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { collection, getDocs, doc, writeBatch, query, orderBy, updateDoc, setDoc, getDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { IoMdChatboxes } from 'react-icons/io';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, Legend,
} from 'recharts';
import AdminDashboardLayout from '../../components/layouts/DashboardLayout';
import { db } from '../../services/firebase/index.js';
import { BASE_URL } from '../../services/constants/apiConstants.js';
const COLLECTIONS = {
  offline: 'horleyTech_OfflineInventories',
  backups: 'horleyTech_Backups',
};
const CHART_COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#7c3aed', '#ef4444', '#14b8a6', '#f97316'];
const _FALLBACK_MASTER_DICTIONARY_CSV = 'https://example.com/master-dictionary.csv';
const FALLBACK_COMPANY_PRICING_CSV = 'https://example.com/company-pricing.csv';
const toCsv = (rows) => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const csvRows = rows.map((row) =>
    headers.map((header) => `"${String(row[header] ?? '').replaceAll('"', '""')}"`).join(',')
  );
  return `${headers.join(',')}\n${csvRows.join('\n')}`;
};
const downloadCsv = (filename, rows) => {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const normalizeDisplayCondition = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return 'Unknown';
  if (normalized.includes('non active') || normalized.includes('non-active')) return 'Brand New';
  if (normalized === 'new' || normalized === 'brand new') return 'Brand New';
  if (normalized === 'used' || normalized.includes('grade a') || normalized.includes('uk used')) return 'Grade A UK Used';
  return value;
};

const normalizeDisplaySpec = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return 'Unknown';
  if (normalized.includes('esim') || normalized.includes('e-sim')) return 'ESIM';
  if (normalized.includes('unlocked')) return 'ESIM';
  if (normalized === 'esim') return 'ESIM';
  if (normalized === 'physical sim') return 'Physical SIM';
  if (normalized === 'dual sim') return 'Dual SIM';
  return value;
};

const normalizeDisplayStorage = (value = '') => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.toLowerCase() === 'unknown') return 'Unknown';
  return normalized.toUpperCase();
};

const formatExportPrice = (vendors = []) => {
  const validPrices = vendors
    .map((vendor) => Number(vendor?.priceValue || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!validPrices.length) return '';
  return `N${validPrices[0].toLocaleString('en-NG')}.0`;
};

const toSheetLikeRows = (groupedTree = {}) => {
  const rows = [];

  Object.entries(groupedTree).forEach(([category, brands]) => {
    rows.push({ Section: `#${String(category || 'others').toLowerCase()}`, Model: '', Condition: '', Spec: '', Storage: '', Price: '' });

    Object.entries(brands).forEach(([_brand, seriesMap]) => {
      Object.entries(seriesMap).forEach(([series, devices]) => {
        rows.push({ Section: series, Model: '', Condition: '', Spec: '', Storage: '', Price: '' });

        Object.entries(devices)
          .sort(([a], [b]) => a.localeCompare(b))
          .forEach(([deviceType, variations]) => {
            const sortedVariations = Object.values(variations).sort((a, b) => {
              const conditionCompare = normalizeDisplayCondition(a.condition).localeCompare(normalizeDisplayCondition(b.condition));
              if (conditionCompare !== 0) return conditionCompare;
              const specCompare = normalizeDisplaySpec(a.specification).localeCompare(normalizeDisplaySpec(b.specification));
              if (specCompare !== 0) return specCompare;
              return normalizeDisplayStorage(a.storage).localeCompare(normalizeDisplayStorage(b.storage), undefined, { numeric: true, sensitivity: 'base' });
            });

            sortedVariations.forEach((variation) => {
              rows.push({
                Section: '',
                Model: deviceType,
                Condition: normalizeDisplayCondition(variation.condition),
                Spec: normalizeDisplaySpec(variation.specification),
                Storage: normalizeDisplayStorage(variation.storage),
                Price: formatExportPrice(variation.vendors),
              });
            });

            rows.push({ Section: '', Model: '', Condition: '', Spec: '', Storage: '', Price: '' });
          });
      });
    });

    rows.push({ Section: '', Model: '', Condition: '', Spec: '', Storage: '', Price: '' });
  });

  return rows;
};
const parseNairaValue = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const original = String(value || '');
  if (/available|negotiable/i.test(original)) return 0;
  const groupedNumber = original.match(/(\d{1,3}(?:,\d{3})+)/);
  if (groupedNumber) {
    const parsedGrouped = Number(groupedNumber[1].replace(/,/g, ''));
    if (Number.isFinite(parsedGrouped)) return parsedGrouped;
  }
  const raw = original.toLowerCase().replace(/[₦n\s,]/g, '').trim();
  if (!raw) return 0;
  const millionAndThousand = raw.match(/(\d+(?:\.\d+)?)m(\d+(?:\.\d+)?)k/);
  if (millionAndThousand) {
    const millions = Number(millionAndThousand[1]) || 0;
    const thousands = Number(millionAndThousand[2]) || 0;
    return Math.round((millions * 1000000) + (thousands * 1000));
  }
  const shorthandMatch = raw.match(/(\d+(?:\.\d+)?)([mk])/);
  if (shorthandMatch) {
    const amount = Number(shorthandMatch[1]) || 0;
    const multiplier = shorthandMatch[2] === 'm' ? 1000000 : 1000;
    return Math.round(amount * multiplier);
  }
  const safeNumberPart = raw.match(/\d+(?:\.\d+)?/);
  if (!safeNumberPart) return 0;
  const numeric = Number(safeNumberPart[0]);
  return Number.isFinite(numeric) ? numeric : 0;
};
const formatNaira = (amount) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);
const formatCompactNaira = (amount) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', notation: 'compact', maximumFractionDigits: 1 }).format(amount);
const normalizeLogs = (logs) => ({
  admin: Array.isArray(logs?.admin) ? logs.admin : [],
  vendor: Array.isArray(logs?.vendor) ? logs.vendor : [],
  customer: Array.isArray(logs?.customer) ? logs.customer : [],
});
const formatTimelineDate = (isoDate) => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today - target) / (1000 * 60 * 60 * 24));
  const timeText = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 0) return `Today at ${timeText}`;
  if (diffDays === 1) return `Yesterday at ${timeText}`;
  return date.toLocaleString();
};
const parseDateValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const isWithinDateRange = (value, startDate, endDate) => {
  const parsedDate = parseDateValue(value);
  if (!parsedDate) return !startDate && !endDate;
  if (startDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    if (parsedDate < start) return false;
  }
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    if (parsedDate > end) return false;
  }
  return true;
};
const buildGlobalRowsFromOfflineInventories = (vendorDocs = []) => {
  const rows = [];
  vendorDocs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const vendorName = data.vendorName || data.vendorId || docSnap.id;
    const vendorLink = data.shareableLink || '';
    const products = Array.isArray(data.products) ? data.products : [];

    products.forEach((product, index) => {
      const price = String(product?.['Regular price'] || '').trim();
      const priceValue = Number(price.replace(/[^0-9.]/g, ''));
      if (!priceValue || Number.isNaN(priceValue)) return;

      rows.push({
        id: `${docSnap.id}_${index}`,
        vendorName,
        vendorLink,
        price,
        priceValue,
        date: product?.DatePosted || data.lastUpdated || new Date().toISOString(),
        category: product?.Category || 'Others',
        brandSubCategory: product?.Brand || 'Others',
        series: product?.Series || inferSeries(product?.['Device Type'] || ''),
        deviceType: product?.['Device Type'] || 'Unknown Device',
        condition: normalizeDisplayCondition(product?.Condition || 'Unknown'),
        simType: normalizeDisplaySpec(product?.['SIM Type/Model/Processor'] || 'Unknown'),
        storage: normalizeDisplayStorage(product?.['Storage Capacity/Configuration'] || 'Unknown'),
        raw: `${product?.['Device Type'] || ''} ${product?.Condition || ''} ${product?.['SIM Type/Model/Processor'] || ''}`.trim(),
      });
    });
  });
  return rows;
};
const normalizeDictionaryKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeGoogleSheetCsvUrl = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  if (!raw.includes('docs.google.com/spreadsheets')) return raw;
  try {
    const parsed = new URL(raw);
    const sheetId = extractGoogleSheetId(raw);
    if (!sheetId) return raw;
    const gid = parsed.searchParams.get('gid') || (parsed.hash || '').replace('#gid=', '') || '0';
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  } catch {
    const sheetId = extractGoogleSheetId(raw);
    if (!sheetId) return raw.replace('/edit', '/export').replace(/\?.*$/, '?format=csv');
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
  }
};
const extractGoogleSheetId = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || '';
};
const normalizeCsvText = (rawText = '') => String(rawText || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
const _parseApiJsonSafe = async (response) => {
  const bodyText = await response.text();
  const trimmed = bodyText.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
      throw new Error('Received HTML instead of JSON. Check BASE_URL or backend route for /api/admin/extract-detailed-schema.');
    }
    throw new Error(`Invalid JSON response from server: ${trimmed.slice(0, 180)}`);
  }
};
const parseCompanyCsvText = (csvText = '') => {
  const safeText = normalizeCsvText(csvText);
  const lines = safeText.split(/\n/).map((line) => line.trimEnd()).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((header) => String(header || '').replace(/^\uFEFF/, '').trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index] || '';
      return acc;
    }, {});
  }).filter((row) => Object.values(row).some((value) => String(value || '').trim()));
};
const parseCsvLine = (line = '') => {
  const parsed = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      parsed.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  parsed.push(current.trim());
  return parsed;
};
const _parseMasterDictionaryCsv = (csvText = '') => {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { dictionary: {}, officialTargets: [] };
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const normalizedHeaders = headers.map((header) => normalizeDictionaryKey(header));
  const findHeaderIndex = (aliases = []) => normalizedHeaders.findIndex((header) => aliases.includes(header));
  const rawNameIndex = findHeaderIndex([
    'rawname',
    'rawdevicename',
    'rawmodel',
    'rawproduct',
    'devicetype',
    'device',
    'product',
    'model',
    'simtypemodelprocessor',
  ]);
  const standardNameIndex = findHeaderIndex(['standardname', 'normalizedname', 'canonicalname', 'mappedname']);
  const deviceTypeIndex = findHeaderIndex(['devicetype', 'device', 'model', 'productname']);
  if (rawNameIndex === -1 || (standardNameIndex === -1 && deviceTypeIndex === -1)) {
    throw new Error(`CSV must include a recognizable raw-name column (e.g. "Raw Name" or "Device Type") plus either "Standard Name" or "Device Type". Found headers: ${headers.join(', ') || '(none)'}`);
  }
  const dictionary = {};
  const officialTargetsSet = new Set();
  lines.slice(1).forEach((line) => {
    const values = parseCsvLine(line);
    const rawName = values[rawNameIndex];
    const deviceType = values[deviceTypeIndex] || values[standardNameIndex] || '';
    const standardName = values[standardNameIndex] || deviceType;
    const rawKey = normalizeDictionaryKey(rawName);
    if (deviceType?.trim()) officialTargetsSet.add(deviceType.trim());
    if (!rawKey || !standardName) return;
    dictionary[rawKey] = standardName.trim();
  });
  return { dictionary, officialTargets: Array.from(officialTargetsSet) };
};
const getCsvValueByAliases = (row = {}, aliases = []) => {
  const normalizedAliases = aliases.map((alias) => normalizeDictionaryKey(alias));
  const entry = Object.entries(row).find(([key]) => normalizedAliases.includes(normalizeDictionaryKey(key)));
  return entry ? entry[1] : '';
};

const extractLaptopSpecs = (raw) => {
  const normalized = String(raw || '').toLowerCase();
  const ramMatch = normalized.match(/\b(\d{1,3})\s*gb\s*(ram)?\b/);
  const storageMatch = normalized.match(/\b(\d{1,2}(?:\.\d+)?)\s*(tb|gb|ssd)\b/);
  const ram = ramMatch ? `${ramMatch[1]}GB` : 'Unknown';

  if (!storageMatch) return { ram, storage: 'Unknown' };
  const storageUnit = storageMatch[2] === 'ssd' ? 'GB' : storageMatch[2].toUpperCase();
  return {
    ram,
    storage: `${storageMatch[1]}${storageUnit}`,
  };
};

const smartMapDevice = (rawString, _officialTargets = [], customMappings = {}) => {
  const original = String(rawString || '').trim();
  if (!original) {
    return {
      standardName: 'Unknown Device',
      condition: 'Unknown',
      specification: 'Unknown',
      isOthers: true,
      aiRequired: true,
    };
  }

  const mappingKey = normalizeDictionaryKey(original);
  const mappingEntry = customMappings?.[mappingKey];
  if (mappingEntry) {
    if (typeof mappingEntry === 'object') {
      return {
        standardName: mappingEntry.deviceType || mappingEntry.standardName || 'Unknown Device',
        condition: mappingEntry.condition || 'Unknown',
        specification: mappingEntry.specification || mappingEntry.sim || 'Unknown',
        isOthers: Boolean(mappingEntry.isOthers),
        aiRequired: false,
        laptopSpecs: extractLaptopSpecs(original),
      };
    }

    return {
      standardName: String(mappingEntry || '').trim() || 'Unknown Device',
      condition: 'Unknown',
      specification: 'Unknown',
      isOthers: false,
      aiRequired: false,
      laptopSpecs: extractLaptopSpecs(original),
    };
  }

  return {
    standardName: 'Unknown Device',
    condition: 'Unknown',
    specification: 'Unknown',
    isOthers: true,
    aiRequired: true,
    laptopSpecs: extractLaptopSpecs(original),
  };
};
const _getConditionRank = (condition) => {
  const normalized = String(condition || '').trim();
  if (normalized === 'Brand New') return 0;
  if (normalized === 'Grade A UK Used') return 1;
  return 2;
};
const _extractDeviceVersion = (deviceType) => {
  const matches = String(deviceType || '').match(/\d+(?:\.\d+)?/g);
  if (!matches?.length) return -1;
  return Math.max(...matches.map((entry) => Number(entry) || 0));
};
const _getDeviceTierWeight = (deviceType) => {
  const normalized = String(deviceType || '').toLowerCase();
  if (normalized.includes('pro max')) return 3;
  if (normalized.includes('pro')) return 2;
  if (normalized.includes('plus')) return 1;
  return 0;
};
const _getSimRank = (specification) => {
  const normalized = String(specification || '').toLowerCase();
  if (normalized.includes('dual sim') || normalized.includes('physical sim+esim') || (normalized.includes('physical sim') && normalized.includes('esim'))) return 0;
  if (normalized.includes('physical sim')) return 1;
  if (normalized.includes('esim')) return 2;
  if (normalized.includes('locked') || normalized.includes('wi-fi only') || normalized.includes('wifi only')) return 3;
  return 4;
};
const _getStorageRank = (storage) => {
  const normalized = String(storage || '').toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(tb|gb)/);
  if (!match) return -1;
  const value = Number(match[1]) || 0;
  const unit = match[2];
  return unit === 'tb' ? value * 1024 : value;
};
const _inferBrandSubCategory = (deviceType) => {
  const normalized = String(deviceType || '').toLowerCase();
  if (normalized.includes('iphone')) return '#iphones';
  if (normalized.includes('samsung') || normalized.match(/^s\d{1,2}/)) return '#samsungphones';
  if (normalized.includes('pixel')) return '#googlepixel';
  if (normalized.includes('ipad')) return '#ipads';
  if (normalized.includes('macbook')) return '#macbooks';
  return '#others';
};
const inferSeries = (deviceType) => {
  const normalized = String(deviceType || '').toLowerCase();
  if (normalized.includes('iphone')) {
    const match = normalized.match(/iphone\s*(\d+)/);
    if (match) return `iPhone ${match[1]} Series`;
  }
  if (normalized.includes('samsung') || normalized.match(/^s\d{1,2}/)) {
    const match = normalized.match(/s(\d{1,2})/);
    if (match) return `Samsung S${match[1]} Series`;
  }
  return 'Others';
};

const normalizeDisplayDeviceType = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown Device';

  const lower = raw.toLowerCase().replace(/\s+/g, ' ');
  const iphoneMatch = lower.match(/iphone\s*(\d+)\s*(pro\s*max|pro|max|plus)?/i);
  if (iphoneMatch) {
    const suffix = String(iphoneMatch[2] || '').replace(/\s+/g, ' ').trim();
    const normalizedSuffix = suffix
      ? suffix.split(' ').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
      : '';
    return `iPhone ${iphoneMatch[1]}${normalizedSuffix ? ` ${normalizedSuffix}` : ''}`;
  }

  const samsungMatch = lower.match(/(?:samsung\s*)?s\s*(\d{1,2})(\s*ultra|\s*plus|\s*fe)?/i);
  if (samsungMatch && !lower.includes('series')) {
    const suffix = String(samsungMatch[2] || '').trim().toUpperCase();
    return `Samsung S${samsungMatch[1]}${suffix ? ` ${suffix}` : ''}`;
  }

  return raw.replace(/\s+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
};

const inferCategoryFromDevice = (deviceType = '', fallbackCategory = 'Others') => {
  const normalized = String(deviceType || '').toLowerCase();
  if (normalized.includes('iphone') || normalized.includes('samsung') || normalized.includes('pixel') || normalized.includes('smartphone')) return 'Smartphones';
  if (normalized.includes('watch')) return 'Smartwatches';
  if (normalized.includes('macbook') || normalized.includes('laptop')) return 'Laptops';
  if (normalized.includes('ipad') || normalized.includes('tablet')) return 'Tablets';
  return fallbackCategory || 'Others';
};

const inferBrandFromDevice = (deviceType = '', fallbackBrand = 'Others') => {
  const normalized = String(deviceType || '').toLowerCase();
  if (normalized.includes('iphone')) return 'Apple';
  if (normalized.includes('samsung') || normalized.match(/^s\d{1,2}/)) return 'Samsung';
  if (normalized.includes('pixel')) return 'Google';
  if (normalized.includes('macbook') || normalized.includes('ipad')) return 'Apple';
  return fallbackBrand || 'Others';
};
const AdminDashboard = () => {
  const currentMonthRange = useMemo(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    return { firstDay, lastDay };
  }, []);
  const location = useLocation();
  const isAdmin = true;
  const [activeTab, setActiveTab] = useState('offline');
  const [searchQuery, setSearchQuery] = useState('');
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [currentProductPage, setCurrentProductPage] = useState(1);
  const [productCategoryFilter, setProductCategoryFilter] = useState('All');
  const [productConditionFilter, setProductConditionFilter] = useState('All');
  const [selectedVendorFilter, setSelectedVendorFilter] = useState('All');
  const [productSortMode, setProductSortMode] = useState('highest_price');
  const [dataViewMode, setDataViewMode] = useState('all');
  const [excludedPhrases, setExcludedPhrases] = useState('');
  const [masterDictionary, setMasterDictionary] = useState({});
  const [officialTargets, setOfficialTargets] = useState([]);
  const _queueRef = useRef([]);
  const [bulkMetaDataValue, setBulkMetaDataValue] = useState('Electronics');
  const [globalProductsCacheRows, setGlobalProductsCacheRows] = useState([]);
  const [, setAllProductRows] = useState([]);
  const [, setFilteredProductRows] = useState([]);
  const [syncJobState, setSyncJobState] = useState({ isSyncing: false, progress: '' });
  const [selectedAIProvider, setSelectedAIProvider] = useState('openai');
  const [selectedImageAIProvider, setSelectedImageAIProvider] = useState('openai');
  const [companyCsvUrl, setCompanyCsvUrl] = useState(FALLBACK_COMPANY_PRICING_CSV);
  const [loadingCompanyCsv, setLoadingCompanyCsv] = useState(false);
  const [companyCsvRows, setCompanyCsvRows] = useState([]);
  const [savedPricingSessions, setSavedPricingSessions] = useState([]);
  const [pricingVendor, setPricingVendor] = useState('All');
  const [pricingVendorExtraOne, setPricingVendorExtraOne] = useState('');
  const [pricingVendorExtraTwo, setPricingVendorExtraTwo] = useState('');
  const [priceReferenceMode, setPriceReferenceMode] = useState('selected_primary');
  const [marginType, setMarginType] = useState('amount');
  const [marginValue, setMarginValue] = useState('0');
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [expandedPricingGroups, setExpandedPricingGroups] = useState([]);
  const [pricingOverrides, setPricingOverrides] = useState({});
  const [customMarginModalOpen, setCustomMarginModalOpen] = useState(false);
  const [customMarginType, setCustomMarginType] = useState('amount');
  const [customMarginValue, setCustomMarginValue] = useState('0');
  const [saveSessionModalOpen, setSaveSessionModalOpen] = useState(false);
  const [sessionNameInput, setSessionNameInput] = useState('');
  const [assignVendorModalOpen, setAssignVendorModalOpen] = useState(false);
  const [assignVendorValue, setAssignVendorValue] = useState('');
  const [startDate, setStartDate] = useState(currentMonthRange.firstDay);
  const [endDate, setEndDate] = useState(currentMonthRange.lastDay);
  const [expandedProductGroups, setExpandedProductGroups] = useState([]);
  const itemsPerPage = 50;
  
  const [offlineVendors, setOfflineVendors] = useState([]);
  const [backups, setBackups] = useState([]);
  const [, setLoadingSearch] = useState(false);
  const [, setLoadingBackups] = useState(false);
  const [selectedVendorIds, setSelectedVendorIds] = useState([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [manualBackupLoading, setManualBackupLoading] = useState(false);
  const [restoringBackupId, setRestoringBackupId] = useState(null);
  
  // Advanced Tools Toggle State
  const [togglingAdvancedVendorId, setTogglingAdvancedVendorId] = useState(null);
  // Messaging State
  const [allMessages, setAllMessages] = useState([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatVendor, setChatVendor] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  // Audit, Bulk Edit, Onboarding
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [restoringAuditId, setRestoringAuditId] = useState(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditLoading, setBulkEditLoading] = useState(false);
  const [bulkCondition, setBulkCondition] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkPrice, setBulkPrice] = useState('');
  const [tutorialVideoUrl, setTutorialVideoUrl] = useState('');
  const [savingTutorialVideo, setSavingTutorialVideo] = useState(false);
  const [onboardVendorName, setOnboardVendorName] = useState('');
  const [botNumber, setBotNumber] = useState('');
  const [driveBackups, setDriveBackups] = useState([]);
  const [loadingDriveBackups, setLoadingDriveBackups] = useState(false);
  const [restoringDriveId, setRestoringDriveId] = useState(null);
  const [uploadRestoreLoading, setUploadRestoreLoading] = useState(false);
  const [nukeEverythingConfirmText, setNukeEverythingConfirmText] = useState('');
  const [nukingEverything, setNukingEverything] = useState(false);
  const [bulkTinbrSaving, setBulkTinbrSaving] = useState(false);
  const [bulkTinbrUseTinyChecked, setBulkTinbrUseTinyChecked] = useState(true);
  const [bulkTinbrShowBothChecked, setBulkTinbrShowBothChecked] = useState(true);
  const priceReferenceModeLabelMap = {
    selected_primary: 'Primary Vendor only',
    selected_highest: 'Selected Vendors • Highest',
    selected_lowest: 'Selected Vendors • Lowest',
    selected_average: 'Selected Vendors • Average',
    global_highest: 'Global Inventory • Highest',
    global_lowest: 'Global Inventory • Lowest',
    global_average: 'Global Inventory • Average',
  };
  const selectedCompareVendors = useMemo(() => {
    const normalized = [pricingVendor, pricingVendorExtraOne, pricingVendorExtraTwo]
      .map((name) => String(name || '').trim())
      .filter((name) => name && name !== 'All');
    return Array.from(new Set(normalized)).slice(0, 3);
  }, [pricingVendor, pricingVendorExtraOne, pricingVendorExtraTwo]);
  const fetchInventory = async () => {
    setLoadingSearch(true);
    try {
      const querySnapshot = await getDocs(collection(db, COLLECTIONS.offline));
      const vendors = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        vendors.push({
          docId: docSnap.id,
          vendorId: data.vendorId || docSnap.id,
          vendorName: data.vendorName || data.vendorId || docSnap.id,
          totalProducts: data.products ? data.products.length : 0,
          inventoryValue: Array.isArray(data.products)
            ? data.products.reduce((sum, p) => sum + parseNairaValue(p['Regular price']), 0)
            : 0,
          lastUpdated: data.lastUpdated,
          shareableLink: data.shareableLink || `/vendor/${docSnap.id}`,
          status: data.status || 'active',
          viewCount: data.viewCount || 0,
          whatsappClicks: data.whatsappClicks || 0,
          vendorPassword: data.vendorPassword || '',
          storeWhatsappNumber: data.storeWhatsappNumber || '',
          advancedEnabled: Boolean(data.advancedEnabled),
          tinbrLinksEnabled: (data.tinyLinksEnabled ?? data.tinbrLinksEnabled) !== false,
          showBothTinbrAndNormalLinks: (data.showBothTinyAndNormalLinks ?? data.showBothTinbrAndNormalLinks) !== false,
          products: data.products || [],
          logs: normalizeLogs(data.logs),
          metaData: data.metaData || 'Electronics',
        });
      });
      setOfflineVendors(vendors);
      setSelectedVendorIds([]);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      setLoadingSearch(false);
    }
  };
  const fetchBackups = async () => {
    setLoadingBackups(true);
    try {
      const backupQuery = query(collection(db, COLLECTIONS.backups), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(backupQuery);
      setBackups(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    } catch (error) {
      console.error('Error fetching backups:', error);
    } finally {
      setLoadingBackups(false);
    }
  };
  const fetchAllMessages = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/messages`, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load messages');
      setAllMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (error) {
      console.error('Unable to fetch global messages:', error);
    }
  };
  const fetchAuditLogs = async () => {
    setLoadingAuditLogs(true);
    try {
      const response = await fetch(`${BASE_URL}/api/admin/audit-logs?limit=1000`, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load audit logs');
      setAuditLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (error) {
      console.error('Unable to fetch audit logs:', error);
    } finally {
      setLoadingAuditLogs(false);
    }
  };
  const fetchTutorialVideo = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/settings/tutorial-video`, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load tutorial video setting');
      setTutorialVideoUrl(data.youtubeUrl || '');
    } catch (error) {
      console.error('Unable to fetch tutorial video setting:', error);
    }
  };
  const saveTutorialVideo = async () => {
    const trimmedUrl = tutorialVideoUrl.trim();
    if (!trimmedUrl) {
      alert('Please enter a valid YouTube link.');
      return;
    }
    if (!window.confirm('Are you sure you want to proceed? This will change the live user experience/data.')) return;
    setSavingTutorialVideo(true);
    try {
      const response = await fetch(`${BASE_URL}/api/settings/tutorial-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'x-user-role': 'admin' },
        body: JSON.stringify({ youtubeUrl: trimmedUrl }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not save tutorial video');
      setTutorialVideoUrl(data.youtubeUrl || trimmedUrl);
      alert('✅ Tutorial video updated successfully.');
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setSavingTutorialVideo(false);
    }
  };
  const generateOnboardingLink = async () => {
    if (!onboardVendorName.trim() || !botNumber.trim()) {
      alert('Please enter vendor name and bot number.');
      return;
    }
    try {
      const response = await fetch(`${BASE_URL}/api/admin/onboard-vendor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          vendorName: onboardVendorName.trim(),
          adminNumber: botNumber.trim(), 
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error);
      const tinyUrlRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(data.url)}`);
      const shortUrl = await tinyUrlRes.text();
      await navigator.clipboard.writeText(shortUrl);
      alert(`✅ Shortened link copied to clipboard:\n\n${shortUrl}`);
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  };
  const fetchDriveBackups = async () => {
    setLoadingDriveBackups(true);
    try {
      const response = await fetch(`${BASE_URL}/api/backup/drive-list`, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load drive backups');
      setDriveBackups(Array.isArray(data.files) ? data.files : []);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setLoadingDriveBackups(false);
    }
  };
  const restoreDriveBackup = async (fileId) => {
    setRestoringDriveId(fileId);
    try {
      const response = await fetch(`${BASE_URL}/api/backup/drive-restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ fileId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Drive restore failed');
      alert(`✅ Restored ${data.restoredDocuments || 0} documents from Drive backup.`);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setRestoringDriveId(null);
    }
  };
  const uploadAndRestoreLocalBackup = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setUploadRestoreLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/api/backup/upload-restore`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Upload restore failed');
      alert(`✅ Restored ${data.restoredDocuments || 0} documents from local backup.`);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      event.target.value = '';
      setUploadRestoreLoading(false);
    }
  };

  const fetchCustomMappings = async () => {
    try {
      // 2. Fetch Sharded AI Mappings
      const CAT_LIST = ['Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'];
      let globalMappings = {};

      const mappingPromises = CAT_LIST.map((cat) => getDoc(doc(db, 'horleyTech_Settings', `mappings_${cat}`)));
      const mappingDocs = await Promise.all(mappingPromises);

      mappingDocs.forEach((docSnap) => {
        if (docSnap.exists() && docSnap.data().mappings) {
          globalMappings = { ...globalMappings, ...docSnap.data().mappings };
        }
      });
      setMasterDictionary(globalMappings);
    } catch (error) {
      console.error('Failed to load Firebase custom mappings:', error);
    }
  };

  const fetchAIProviderSetting = async () => {
    try {
      const aiControlSnap = await getDoc(doc(db, 'horleyTech_Settings', 'aiControl'));
      const savedProvider = String(aiControlSnap.data()?.selectedProvider || 'openai').toLowerCase();
      const savedImageProvider = String(aiControlSnap.data()?.imageProvider || savedProvider || 'openai').toLowerCase();
      setSelectedAIProvider(savedProvider === 'qwen' ? 'qwen' : 'openai');
      setSelectedImageAIProvider(savedImageProvider === 'qwen' ? 'qwen' : 'openai');
    } catch (error) {
      console.error('Failed to load AI provider setting:', error);
    }
  };

  const saveAIProviderSetting = async (provider) => {
    const safeProvider = provider === 'qwen' ? 'qwen' : 'openai';
    setSelectedAIProvider(safeProvider);
    try {
      await setDoc(doc(db, 'horleyTech_Settings', 'aiControl'), {
        selectedProvider: safeProvider,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      await fetchAIProviderSetting();
      alert(`✅ AI provider set to ${safeProvider.toUpperCase()}.`);
    } catch (error) {
      alert(`❌ Failed to save AI provider: ${error.message}`);
    }
  };

  const saveImageAIProviderSetting = async (provider) => {
    const safeProvider = provider === 'qwen' ? 'qwen' : 'openai';
    setSelectedImageAIProvider(safeProvider);
    try {
      await setDoc(doc(db, 'horleyTech_Settings', 'aiControl'), {
        imageProvider: safeProvider,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      await fetchAIProviderSetting();
      alert(`✅ Image AI provider set to ${safeProvider.toUpperCase()}.`);
    } catch (error) {
      alert(`❌ Failed to save Image AI provider: ${error.message}`);
    }
  };

  useEffect(() => {
    if (location.pathname === '/dashboard' || location.pathname === '/dashboard/') {
      fetchInventory();
      fetchBackups();
      fetchAIProviderSetting();
    }
  }, [location.pathname]);
  useEffect(() => {
    fetchAllMessages();
    fetchAuditLogs();
    fetchTutorialVideo();
    const timer = setInterval(fetchAllMessages, 12000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (activeTab === 'maintenance') {
      fetchDriveBackups();
    }
  }, [activeTab]);
  useEffect(() => {
    fetchCustomMappings();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'horleyTech_Settings', 'syncStatus'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSyncJobState({
          isSyncing: Boolean(data.isSyncing),
          progress: data.progress || '',
        });

        if (data.isSyncing === true) {
          // Keep dictionary count from appearing frozen at 0 during long sync runs.
          fetchCustomMappings();
        }

        if (data.isSyncing === false && data.justFinished === true) {
          fetchCustomMappings();
          setDoc(doc(db, 'horleyTech_Settings', 'syncStatus'), { justFinished: false }, { merge: true });
        }
      }
    });
    return () => unsubscribe();
  }, []);
  useEffect(() => {
    const preferencesRef = doc(db, 'horleyTech_Settings', 'adminPreferences');
    const unsubscribe = onSnapshot(preferencesRef, (preferencesSnap) => {
      if (!preferencesSnap.exists()) {
        setExcludedPhrases('');
        setBulkTinbrUseTinyChecked(true);
        setBulkTinbrShowBothChecked(true);
        return;
      }
      const preferencesData = preferencesSnap.data() || {};
      setExcludedPhrases(String(preferencesData.excludedPhrases || ''));
      const globalTinyEnabled = preferencesData.globalTinyLinksEnabled ?? preferencesData.globalTinbrLinksEnabled;
      if (typeof globalTinyEnabled === 'boolean') {
        setBulkTinbrUseTinyChecked(globalTinyEnabled);
      }
      const globalShowBothTiny = preferencesData.globalShowBothTinyAndNormalLinks ?? preferencesData.globalShowBothTinbrAndNormalLinks;
      if (typeof globalShowBothTiny === 'boolean') {
        setBulkTinbrShowBothChecked(globalShowBothTiny);
      }
    }, (error) => {
      console.error('Failed to load admin preferences:', error);
    });

    return () => unsubscribe();
  }, []);
  useEffect(() => {
    const fetchPricingSessions = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'horleyTech_PricingSessions'));
        const sessions = snapshot.docs.map((docSnap) => docSnap.data()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setSavedPricingSessions(sessions);
      } catch (error) {
        console.error('Could not fetch pricing sessions:', error);
      }
    };
    fetchPricingSessions();
  }, []);

  useEffect(() => {
    const loadGlobalCache = async () => {
      try {
        const loadFromOfflineInventories = async () => {
          const vendorSnapshot = await getDocs(collection(db, COLLECTIONS.offline));
          const fallbackRows = buildGlobalRowsFromOfflineInventories(vendorSnapshot.docs);
          setGlobalProductsCacheRows(fallbackRows);
          setAllProductRows(fallbackRows);
          if (!fallbackRows.length) {
            setFilteredProductRows([]);
            setAllProductRows([]);
          }
          setOfficialTargets(Array.from(new Set(fallbackRows.map((row) => row.deviceType).filter(Boolean))));
        };

        const cacheControlRef = doc(db, 'horleyTech_Settings', 'cacheControl');
        const cacheControlSnap = await getDoc(cacheControlRef);
        const cacheAutomationPausedByNuke = Boolean(cacheControlSnap.data()?.cacheAutomationPausedByNuke);

        const cacheRef = doc(db, 'horleyTech_Settings', 'globalProductsCache');
        const snapshot = await getDoc(cacheRef);
        if (!snapshot.exists()) {
          if (cacheAutomationPausedByNuke) {
            setGlobalProductsCacheRows([]);
            setFilteredProductRows([]);
            setAllProductRows([]);
            setOfficialTargets([]);
            return;
          }

          await loadFromOfflineInventories();
          return;
        }
        const metadata = snapshot.data() || {};
        const totalChunks = Number(metadata.totalChunks || 0);
        if (totalChunks > 0) {
          const chunkDocs = await Promise.all(
            Array.from({ length: totalChunks }, (_, index) => getDoc(doc(db, 'horleyTech_Settings', `cache_chunk_${index}`)))
          );
          const flattenedRows = chunkDocs.flatMap((chunkSnap) => (Array.isArray(chunkSnap.data()?.products) ? chunkSnap.data().products : []));
          if (flattenedRows.length) {
            setGlobalProductsCacheRows(flattenedRows);
            setAllProductRows(flattenedRows);
          } else {
            await loadFromOfflineInventories();
          }
          if (Array.isArray(metadata.officialTargets)) setOfficialTargets(metadata.officialTargets);
          return;
        }
        const rows = metadata.products;
        if (Array.isArray(rows) && rows.length) {
          setGlobalProductsCacheRows(rows);
          setAllProductRows(rows);
        } else {
          await loadFromOfflineInventories();
        }
      } catch (error) {
        console.error('Failed to load global products cache:', error);
        setGlobalProductsCacheRows([]);
        setFilteredProductRows([]);
        setAllProductRows([]);
      }
    };
    const timeoutId = setTimeout(() => {
      loadGlobalCache();
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, []);

  const saveExcludedPhrasesFilter = async () => {
    try {
      await setDoc(doc(db, 'horleyTech_Settings', 'adminPreferences'), {
        excludedPhrases: String(excludedPhrases || ''),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      const preferencesSnap = await getDoc(doc(db, 'horleyTech_Settings', 'adminPreferences'));
      const freshExcluded = String(preferencesSnap.data()?.excludedPhrases || '');
      setExcludedPhrases(freshExcluded);
      alert('✅ Excluded phrases filter saved.');
    } catch (error) {
      alert(`❌ Failed to save filter: ${error.message}`);
    }
  };

  const exportGlobalProductsCSV = () => {
    const rows = toSheetLikeRows(groupedGlobalProducts);
    downloadCsv('Global_Products_Export.csv', rows);
  };

  const runMasterAutoSync = async () => {
    if (syncJobState.isSyncing) return;
    try {
      await setDoc(doc(db, 'horleyTech_Settings', 'syncStatus'), {
        isSyncing: true,
        progress: 'Initializing Backend Engine...',
        cancelRequested: false,
        startedAt: new Date().toISOString(),
      }, { merge: true });

      await fetch(`${BASE_URL}/api/admin/trigger-background-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
      });
    } catch (err) {
      alert(`Failed to trigger background sync: ${err.message}`);
      await setDoc(doc(db, 'horleyTech_Settings', 'syncStatus'), { isSyncing: false, progress: 'Failed to start' }, { merge: true });
    }
  };

  const stopMasterSync = async () => {
    const confirmText = window.prompt('⚠️ Type "STOP" to halt the background sync:');
    if (confirmText !== 'STOP') return;
    try {
      // Instantly unlock the UI on the frontend, and tell the backend to die if it's running
      await setDoc(doc(db, 'horleyTech_Settings', 'syncStatus'), {
        isSyncing: false, // Force Unlock
        cancelRequested: true,
        progress: 'Stopped by Admin',
        justFinished: true,
      }, { merge: true });
      alert('Forcefully stopped and unlocked.');
    } catch (err) {
      alert(`Failed to send stop signal: ${err.message}`);
    }
  };

  const filteredOffline = useMemo(
    () => offlineVendors.filter((v) => !searchQuery || v.vendorName?.toLowerCase().includes(searchQuery.toLowerCase())),
    [offlineVendors, searchQuery]
  );
  const normalizedProductRows = useMemo(() => {
    const excludedTokens = excludedPhrases
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
    return globalProductsCacheRows
      .filter((row) => {
        if (selectedVendorFilter !== 'All' && row.vendorName !== selectedVendorFilter) return false;
        if (!isWithinDateRange(row.date, startDate, endDate)) return false;
        const haystack = [
          row.category,
          row.brandSubCategory,
          row.series,
          row.deviceType,
          row.condition,
          row.simType,
          row.storage,
          row.raw,
        ].join(' ').toLowerCase();
        const isExcluded = excludedTokens.some((phrase) => haystack.includes(phrase));
        const cleanStatus = isExcluded ? 'excluded' : (row.cleanStatus || 'clean');
        if (dataViewMode !== 'all' && cleanStatus !== dataViewMode) return false;
        return true;
      })
      .map((row, index) => {
        const mappingCandidates = [
          normalizeDictionaryKey(row.raw),
          normalizeDictionaryKey(row.deviceType),
        ].filter(Boolean);
        const mappingEntry = mappingCandidates
          .map((key) => masterDictionary?.[key])
          .find(Boolean);

        const mappedDeviceType = typeof mappingEntry === 'object'
          ? (mappingEntry.deviceType || mappingEntry.standardName || row.deviceType)
          : row.deviceType;
        const canonicalDeviceType = normalizeDisplayDeviceType(mappedDeviceType || row.deviceType || 'Unknown Device');

        const mappedCategory = typeof mappingEntry === 'object' ? (mappingEntry.category || row.category) : row.category;
        const canonicalCategory = mappedCategory && mappedCategory !== 'Others'
          ? mappedCategory
          : inferCategoryFromDevice(canonicalDeviceType, mappedCategory || 'Others');

        const mappedBrand = typeof mappingEntry === 'object' ? (mappingEntry.brand || row.brandSubCategory) : row.brandSubCategory;
        const canonicalBrand = mappedBrand && mappedBrand !== 'Others'
          ? mappedBrand
          : inferBrandFromDevice(canonicalDeviceType, mappedBrand || 'Others');

        const mappedSeries = typeof mappingEntry === 'object' ? (mappingEntry.series || row.series) : row.series;
        const canonicalSeries = mappedSeries && mappedSeries !== 'Others'
          ? mappedSeries
          : inferSeries(canonicalDeviceType);

        const storage = normalizeDisplayStorage(row.storage || row['Storage Capacity/Configuration'] || 'Unknown');
        const condition = normalizeDisplayCondition(row.condition || row.Condition || 'Unknown');
        const specSource = row.specification || row.simType || row['SIM Type/Model/Processor'] || 'Unknown';
        const specification = normalizeDisplaySpec(specSource);
        const haystack = [
          canonicalCategory,
          canonicalBrand,
          canonicalSeries,
          canonicalDeviceType,
          condition,
          specification,
          storage,
          row.raw,
        ].join(' ').toLowerCase();
        const isExcluded = excludedTokens.some((phrase) => haystack.includes(phrase));
        const cleanStatus = isExcluded ? 'excluded' : (row.cleanStatus || 'clean');
        return {
          ...row,
          id: row.id || `cache-${index}`,
          category: canonicalCategory,
          brandSubCategory: canonicalBrand,
          series: canonicalSeries,
          deviceType: canonicalDeviceType,
          condition,
          simType: specification,
          specification,
          storage,
          cleanStatus,
        };
      });
  }, [globalProductsCacheRows, startDate, endDate, selectedVendorFilter, dataViewMode, excludedPhrases, masterDictionary]);
  const filteredProductRows = useMemo(() => {
    const queryText = productSearchQuery.trim().toLowerCase();
    return normalizedProductRows.filter((row) => {
      const matchesQuery = !queryText || [
        row.category,
        row.brandSubCategory,
        row.series,
        row.deviceType,
        row.condition,
        row.simType,
        row.storage,
        row.vendorName,
      ].some((field) => String(field || '').toLowerCase().includes(queryText));
      const matchesCategory = productCategoryFilter === 'All' || row.category === productCategoryFilter;
      const matchesCondition = productConditionFilter === 'All' || row.condition === productConditionFilter;
      return matchesQuery && matchesCategory && matchesCondition;
    });
  }, [normalizedProductRows, productSearchQuery, productCategoryFilter, productConditionFilter]);
  const groupedGlobalProducts = useMemo(() => {
    const tree = {};
    filteredProductRows.forEach((row) => {
      tree[row.category] ??= {};
      tree[row.category][row.brandSubCategory] ??= {};
      tree[row.category][row.brandSubCategory][row.series] ??= {};
      tree[row.category][row.brandSubCategory][row.series][row.deviceType] ??= {};
      // Use raw.specification if mapped, otherwise fallback to simType from older scraper runs
      const specVal = normalizeDisplaySpec(row.specification || row.simType || 'Unknown');
      const condition = normalizeDisplayCondition(row.condition || 'Unknown');
      const storage = normalizeDisplayStorage(row.storage || 'Unknown');
      const variationKey = `${condition}__${specVal}__${storage}`;
      tree[row.category][row.brandSubCategory][row.series][row.deviceType][variationKey] ??= {
        condition,
        specification: specVal,
        storage,
        totalAccumulatedPrice: 0,
        stockCount: 0,
        vendors: [],
      };
      const variation = tree[row.category][row.brandSubCategory][row.series][row.deviceType][variationKey];
      variation.totalAccumulatedPrice += row.priceValue;
      variation.stockCount += 1;
      variation.vendors.push({
        id: row.id,
        vendorName: row.vendorName,
        vendorLink: row.vendorLink,
        price: row.price,
        priceValue: row.priceValue,
        date: row.date,
      });
    });
    return tree;
  }, [filteredProductRows]);
  const flattenedVariations = useMemo(() => {
    const rows = [];
    Object.entries(groupedGlobalProducts).forEach(([category, brands]) => {
      Object.entries(brands).forEach(([brand, seriesMap]) => {
        Object.entries(seriesMap).forEach(([series, devices]) => {
          Object.entries(devices).forEach(([deviceType, variations]) => {
            Object.values(variations).forEach((variation) => {
              rows.push({ category, brand, series, deviceType, ...variation });
            });
          });
        });
      });
    });
    if (productSortMode === 'highest_price') {
      rows.sort((a, b) => b.totalAccumulatedPrice - a.totalAccumulatedPrice);
    } else if (productSortMode === 'lowest_price') {
      rows.sort((a, b) => a.totalAccumulatedPrice - b.totalAccumulatedPrice);
    } else {
      rows.sort((a, b) => b.totalAccumulatedPrice - a.totalAccumulatedPrice);
    }
    return rows;
  }, [groupedGlobalProducts, productSortMode]);
  const totalPages = Math.max(1, Math.ceil(filteredOffline.length / itemsPerPage));
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);
  const paginatedOffline = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredOffline.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredOffline, currentPage, itemsPerPage]);
  const groupedPaginatedOffline = useMemo(() => {
    return paginatedOffline.reduce((acc, vendor) => {
      const key = vendor.metaData || 'Electronics';
      if (!acc[key]) acc[key] = [];
      acc[key].push(vendor);
      return acc;
    }, {});
  }, [paginatedOffline]);
  const totalProductPages = Math.max(1, Math.ceil(flattenedVariations.length / itemsPerPage));
  useEffect(() => {
    setCurrentProductPage(1);
    setExpandedProductGroups([]);
  }, [productSearchQuery, productCategoryFilter, productConditionFilter, productSortMode, selectedVendorFilter, dataViewMode, excludedPhrases]);
  const paginatedGroupedProducts = useMemo(() => {
    const startIndex = (currentProductPage - 1) * itemsPerPage;
    return flattenedVariations.slice(startIndex, startIndex + itemsPerPage);
  }, [flattenedVariations, currentProductPage, itemsPerPage]);
  const paginatedGroupKeySet = useMemo(() => {
    const keys = new Set();
    paginatedGroupedProducts.forEach((row) => {
      keys.add(`category:${row.category}`);
      keys.add(`brand:${row.category}__${row.brand}`);
      keys.add(`series:${row.category}__${row.brand}__${row.series}`);
      keys.add(`device:${row.category}__${row.brand}__${row.series}__${row.deviceType}`);
      keys.add(`variation:${row.category}__${row.brand}__${row.series}__${row.deviceType}__${row.condition}__${row.specification || row.simType || 'Unknown'}__${row.storage}`);
    });
    return keys;
  }, [paginatedGroupedProducts]);
  const filteredGlobalProducts = flattenedVariations;
  useEffect(() => {
    if (currentProductPage > totalProductPages) setCurrentProductPage(totalProductPages);
  }, [currentProductPage, totalProductPages]);
  const uniqueGlobalCategories = useMemo(
    () => ['All', ...new Set(normalizedProductRows.map((row) => row.category))],
    [normalizedProductRows]
  );
  const uniqueGlobalConditions = useMemo(
    () => ['All', ...new Set(normalizedProductRows.map((row) => row.condition))],
    [normalizedProductRows]
  );
  const uniqueVendorFilters = useMemo(
    () => ['All', ...new Set(offlineVendors.map((vendor) => vendor.vendorName).filter(Boolean))],
    [offlineVendors]
  );
  const uniqueVendorNames = useMemo(() => uniqueVendorFilters.filter((name) => name !== 'All'), [uniqueVendorFilters]);
  const platformActivityTimeline = useMemo(() => {
    const allEntries = [];
    offlineVendors.forEach((vendor) => {
      const logs = normalizeLogs(vendor.logs);
      [...logs.admin, ...logs.vendor].forEach((entry) => {
        allEntries.push({
          ...entry,
          vendorId: vendor.vendorId,
          vendorName: vendor.vendorName,
          channel: logs.admin.includes(entry) ? 'admin' : 'vendor',
        });
      });
    });
    return allEntries.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 50);
  }, [offlineVendors]);
  const analytics = useMemo(() => {
    const vendorSet = new Set(normalizedProductRows.map((row) => row.vendorName));
    const totalVendors = offlineVendors.length;
    const filteredVendorCount = vendorSet.size;
    const vendorSource = offlineVendors.filter((vendor) => vendorSet.has(vendor.vendorName));
    const totalInventoryValue = normalizedProductRows.reduce((sum, row) => sum + row.priceValue, 0);
    const totalStoreViews = vendorSource.reduce((sum, vendor) => sum + (vendor.viewCount || 0), 0);
    const totalWhatsAppOrders = vendorSource.reduce((sum, vendor) => sum + (vendor.whatsappClicks || 0), 0);
    const deviceFrequency = {};
    normalizedProductRows.forEach((row) => {
      deviceFrequency[row.deviceType] = (deviceFrequency[row.deviceType] || 0) + 1;
    });
    const mostTrackedDevice = Object.entries(deviceFrequency).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    const topVendor = [...vendorSource].sort((a, b) => (b.whatsappClicks || 0) - (a.whatsappClicks || 0))[0]?.vendorName || 'N/A';
    return {
      totalVendors,
      filteredVendorCount,
      totalInventoryValue,
      totalStoreViews,
      totalWhatsAppOrders,
      mostTrackedDevice,
      topVendor,
    };
  }, [offlineVendors, normalizedProductRows]);
  const insightCharts = useMemo(() => {
    const categoryCount = {};
    const priceDensityMap = {
      '< ₦100k': 0,
      '₦100k - ₦500k': 0,
      '₦500k+': 0,
    };
    const conditionMap = {};
    const leadMap = {};
    normalizedProductRows.forEach((row) => {
      categoryCount[row.category] = (categoryCount[row.category] || 0) + 1;
      if (row.priceValue > 0 && row.priceValue < 100000) priceDensityMap['< ₦100k'] += 1;
      else if (row.priceValue >= 100000 && row.priceValue <= 500000) priceDensityMap['₦100k - ₦500k'] += 1;
      else if (row.priceValue > 500000) priceDensityMap['₦500k+'] += 1;
      conditionMap[row.condition] = (conditionMap[row.condition] || 0) + 1;
    });
    offlineVendors.forEach((vendor) => {
      if (selectedVendorFilter !== 'All' && vendor.vendorName !== selectedVendorFilter) return;
      const customerLogs = normalizeLogs(vendor.logs).customer || [];
      customerLogs.forEach((log) => {
        if (!log.action?.toLowerCase().includes('clicked whatsapp')) return;
        const date = new Date(log.date);
        if (Number.isNaN(date.getTime()) || !isWithinDateRange(date.toISOString(), startDate, endDate)) return;
        const key = date.toISOString().slice(0, 10);
        leadMap[key] = (leadMap[key] || 0) + 1;
      });
    });
    const now = new Date();
    const leadVelocity = Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      return {
        day: date.toLocaleDateString([], { weekday: 'short' }),
        clicks: leadMap[key] || 0,
      };
    });
    return {
      categoryMix: Object.entries(categoryCount).map(([name, value]) => ({ name, value })),
      priceDensity: Object.entries(priceDensityMap).map(([range, count]) => ({ range, count })),
      conditionMix: Object.entries(conditionMap).map(([condition, count]) => ({ condition, count })),
      leadVelocity,
    };
  }, [normalizedProductRows, offlineVendors, selectedVendorFilter, startDate, endDate]);
  const unreadMessages = useMemo(
    () => allMessages.filter((message) => message.sender === 'vendor' && !message.readByAdmin),
    [allMessages]
  );
  const allFilteredSelected =
    filteredOffline.length > 0 && filteredOffline.every((vendor) => selectedVendorIds.includes(vendor.docId));
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredOffline.map((vendor) => vendor.docId));
      setSelectedVendorIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      const merged = new Set([...selectedVendorIds, ...filteredOffline.map((vendor) => vendor.docId)]);
      setSelectedVendorIds(Array.from(merged));
    }
  };
  const toggleVendor = (docId) => {
    setSelectedVendorIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };
  const toggleProductGroup = (groupKey) => {
    setExpandedProductGroups((prev) =>
      prev.includes(groupKey) ? prev.filter((key) => key !== groupKey) : [...prev, groupKey]
    );
  };
  const handleCategoryChartClick = (entry) => {
    const category = entry?.name || entry?.payload?.name || entry?.payload?.payload?.name;
    if (!category) return;
    setActiveTab('products');
    setProductCategoryFilter(category);
    setProductSortMode('highest_price');
  };
  const handleConditionChartClick = (entry) => {
    const condition = entry?.condition || entry?.payload?.condition || entry?.payload?.payload?.condition;
    if (!condition) return;
    setActiveTab('products');
    setProductConditionFilter(condition);
    setProductSortMode('highest_price');
  };
  const toggleAdvancedTools = async (vendor) => {
    const nextValue = !vendor.advancedEnabled;
    setTogglingAdvancedVendorId(vendor.docId);
    try {
      await updateDoc(doc(db, COLLECTIONS.offline, vendor.docId), {
        advancedEnabled: nextValue,
        lastUpdated: new Date().toISOString(),
      });
      setOfflineVendors((prev) =>
        prev.map((item) =>
          item.docId === vendor.docId
            ? { ...item, advancedEnabled: nextValue, lastUpdated: new Date().toISOString() }
            : item
        )
      );
    } catch (error) {
      console.error('Advanced toggle update failed:', error);
      alert('❌ Failed to update advanced tools toggle.');
    } finally {
      setTogglingAdvancedVendorId(null);
    }
  };
  const bulkAssignMetaData = async () => {
    if (!selectedVendorIds.length) return;
    try {
      setBulkUpdating(true);
      const batch = writeBatch(db);
      selectedVendorIds.forEach((docId) => {
        batch.update(doc(db, COLLECTIONS.offline, docId), {
          metaData: bulkMetaDataValue || 'Electronics',
          lastUpdated: new Date().toISOString(),
        });
      });
      await batch.commit();
      await fetchInventory();
      alert('✅ Meta data assigned successfully.');
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setBulkUpdating(false);
    }
  };
  const bulkUpdateStatus = async (status) => {
    if (!selectedVendorIds.length) {
      alert('Please select at least one vendor first.');
      return;
    }
    setBulkUpdating(true);
    try {
      const batch = writeBatch(db);
      selectedVendorIds.forEach((vendorDocId) => {
        const vendorRef = doc(db, COLLECTIONS.offline, vendorDocId);
        batch.update(vendorRef, {
          status,
          lastUpdated: new Date().toISOString(),
        });
      });
      await batch.commit();
      fetchInventory();
      setSelectedVendorIds([]);
      alert(`✅ ${status === 'suspended' ? 'Suspended' : 'Activated'} selected vendors successfully.`);
    } catch (error) {
      console.error('Bulk vendor status update failed:', error);
      alert('❌ Could not update selected vendors.');
    } finally {
      setBulkUpdating(false);
    }
  };
  const triggerManualBackup = async () => {
    setManualBackupLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/backup/manual`, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Manual backup failed');
      alert(`✅ Manual backup completed. Backup ID: ${data.backupId}`);
      fetchBackups();
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setManualBackupLoading(false);
    }
  };
  const runRetroactiveCleanup = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/admin/retroactive-sweep`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Retroactive cleanup failed');
      alert(`✅ Cleanup finished. Corrected ${data.correctedProducts || 0} products.`);
      fetchInventory();
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  };
  const forceBuildProductCache = async () => {
    try {
      alert('Starting cache build. This may take 10-30 seconds depending on inventory size...');
      const res = await fetch(`${BASE_URL}/api/admin/force-build-cache`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': 'admin',
        },
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ Cache built successfully! Please refresh the page (F5) to see the products.');
        return;
      }
      alert(`❌ Failed: ${data.error}`);
    } catch (error) {
      alert(`❌ Error: ${error.message}`);
    }
  };
  const restoreBackup = async (backupId) => {
    if (!window.confirm(`Restore backup ${backupId}? This will overwrite the live offline inventory.`)) return;
    setRestoringBackupId(backupId);
    try {
      const res = await fetch(`${BASE_URL}/api/backup/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ backupId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Restore failed');
      alert(`✅ Restore complete. Restored ${data.restoredDocuments} records.`);
      fetchInventory();
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setRestoringBackupId(null);
    }
  };
  const handleExport = () => {
    const rows = filteredOffline.map(v => ({
      Vendor: v.vendorName,
      Status: v.status,
      Views: v.viewCount,
      Orders: v.whatsappClicks,
      Products: v.totalProducts,
      Value: v.inventoryValue,
      Password: v.vendorPassword
    }));
    downloadCsv('platform-directory.csv', rows);
  };
  const loadCompanyCsv = async () => {
    setLoadingCompanyCsv(true);
    try {
      const normalizedUrl = normalizeGoogleSheetCsvUrl(companyCsvUrl);
      let csvText = '';
      if (normalizedUrl.includes('\n') || normalizedUrl.includes(',')) {
        csvText = normalizedUrl;
      } else {
        const res = await fetch(normalizedUrl, { headers: { Accept: 'text/csv,text/plain,*/*' } });
        if (!res.ok) throw new Error(`Unable to fetch company CSV (${res.status})`);
        csvText = await res.text();
      }
      let parsedRows = parseCompanyCsvText(csvText);
      if (!parsedRows.length && /^\s*<!DOCTYPE|^\s*<html/i.test(csvText)) {
        const sheetId = extractGoogleSheetId(companyCsvUrl);
        if (!sheetId) {
          throw new Error('Company CSV URL returned HTML. Please provide a direct CSV link or Google Sheets URL.');
        }
        const fallbackUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
        const fallbackRes = await fetch(fallbackUrl, { headers: { Accept: 'text/csv,text/plain,*/*' } });
        if (!fallbackRes.ok) throw new Error(`Unable to fetch fallback company CSV (${fallbackRes.status})`);
        const fallbackText = await fallbackRes.text();
        parsedRows = parseCompanyCsvText(fallbackText);
      }
      if (!parsedRows.length) {
        throw new Error('No rows found in company CSV. Confirm the sheet has a header row and data rows.');
      }
      setCompanyCsvRows(parsedRows);
      alert(`✅ Loaded ${parsedRows.length} company pricing rows.`);
    } catch (error) {
      alert(`❌ ${error.message}`);
      setCompanyCsvRows([]);
    } finally {
      setLoadingCompanyCsv(false);
    }
  };

  const nukeAndRebuildDictionary = async () => {
    const confirmed = window.prompt('⚠️ WARNING: Type NUKE to confirm.');
    if (confirmed === 'NUKE') {
      try {
        const CAT_LIST = ['Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'];
        const batch = writeBatch(db);

        // Delete all sharded dictionaries
        CAT_LIST.forEach((cat) => {
          batch.delete(doc(db, 'horleyTech_Settings', `mappings_${cat}`));
        });
        // Delete the old legacy dictionary just in case
        batch.delete(doc(db, 'horleyTech_Settings', 'customMappings'));

        await batch.commit();
        setMasterDictionary({});
        alert('💥 Global AI Dictionary completely wiped.');
      } catch (err) {
        alert(`Error nuking dictionary: ${err.message}`);
      }
    }
  };

  const nukeLocalCache = async () => {
    try {
      const localKeysToDelete = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        if (key === 'globalProducts' || key === 'globalProductsCache' || key.startsWith('lastCache')) {
          localKeysToDelete.push(key);
        }
      }
      localKeysToDelete.forEach((key) => localStorage.removeItem(key));

      if (window.indexedDB) {
        if (typeof window.indexedDB.databases === 'function') {
          const dbList = await window.indexedDB.databases();
          await Promise.allSettled(
            (dbList || [])
              .map((entry) => entry?.name)
              .filter(Boolean)
              .map((name) => new Promise((resolve) => {
                const request = window.indexedDB.deleteDatabase(name);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
              }))
          );
        }
      }
    } catch (error) {
      console.error('Failed to nuke local cache:', error);
    }

    window.location.reload(true);
  };

  const handleNukeEverything = async () => {
    if (nukeEverythingConfirmText.trim().toUpperCase() !== 'NUKE EVERYTHING') {
      alert('Type "NUKE EVERYTHING" exactly to continue.');
      return;
    }

    setNukingEverything(true);
    try {
      const response = await fetch(`${BASE_URL}/api/admin/nuke-everything`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to wipe all collections');

      const deletedCount = Object.values(payload?.stats || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
      const deletedBreakdown = Object.entries(payload?.stats || {})
        .map(([collectionName, count]) => `• ${collectionName}: ${Number(count) || 0}`)
        .join('\n');
      const preservedBreakdown = Object.entries(payload?.preserved || {})
        .map(([collectionName, info]) => `• ${collectionName}: ${Array.isArray(info) ? info.join(', ') : info}`)
        .join('\n');
      setNukeEverythingConfirmText('');
      alert(
        `✅ Total nuke complete. Deleted ${deletedCount} documents.\n\nDeleted collections:\n${deletedBreakdown || '• None'}\n\nPreserved:\n${preservedBreakdown || '• None'}`
      );
      await fetchInventory();
      await fetchBackups();
      setAllMessages([]);
      setAuditLogs([]);
      setGlobalProductsCacheRows([]);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setNukingEverything(false);
    }
  };

  const handleNukeAndRebuild = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/admin/nuke-cache-system`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to wipe global cache system');
    } catch (error) {
      alert(`❌ ${error.message}`);
      return;
    }

    await nukeAndRebuildDictionary();
    alert('🛑 Global cache + product containers wiped. Cache automation is now OFF. Use "Force Build Product Cache" to turn it ON again.');
    await nukeLocalCache();
  };

  const applyTinbrControlsToAllVendors = async (nextTinbrLinksEnabled, nextShowBothTinbrAndNormalLinks) => {
    const summaryText = [
      `Use Tiny links as primary: ${nextTinbrLinksEnabled ? 'ON' : 'OFF'}`,
      `Let vendor see both Tiny + normal links: ${nextShowBothTinbrAndNormalLinks ? 'ON' : 'OFF'}`,
    ].join('\n');

    if (!window.confirm(`Apply these Tiny settings for ALL vendors?\n\n${summaryText}`)) return;

    setBulkTinbrSaving(true);
    try {
      const now = new Date().toISOString();
      const actionLabel = `${nextTinbrLinksEnabled ? 'Enabled' : 'Disabled'} Tiny Links + ${nextShowBothTinbrAndNormalLinks ? 'Enabled' : 'Disabled'} Both Tiny + Normal Links View (Bulk)`;
      const response = await fetch(`${BASE_URL}/api/admin/tiny-link-controls/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': 'admin',
        },
        body: JSON.stringify({
          tinyLinksEnabled: nextTinbrLinksEnabled,
          showBothTinyAndNormalLinks: nextShowBothTinbrAndNormalLinks,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to apply Tiny link controls');
      }

      await setDoc(doc(db, 'horleyTech_Settings', 'adminPreferences'), {
        globalTinyLinksEnabled: nextTinbrLinksEnabled,
        globalShowBothTinyAndNormalLinks: nextShowBothTinbrAndNormalLinks,
        tinyLinkControlsUpdatedAt: now,
      }, { merge: true });

      setOfflineVendors((prev) =>
        prev.map((vendor) => {
          const logs = normalizeLogs(vendor.logs);
          const nextAdminLogs = [{ action: actionLabel, date: now }, ...(logs.admin || [])].slice(0, 200);
          return {
            ...vendor,
            tinyLinksEnabled: nextTinbrLinksEnabled,
            showBothTinyAndNormalLinks: nextShowBothTinbrAndNormalLinks,
            lastUpdated: now,
            logs: {
              ...logs,
              admin: nextAdminLogs,
            },
          };
        })
      );

      alert(`✅ Tiny link controls updated for ${payload.updatedVendors || offlineVendors.length || 0} vendors.`);
    } catch (error) {
      console.error('Failed to bulk update Tiny controls:', error);
      alert(`❌ ${error.message}`);
    } finally {
      setBulkTinbrSaving(false);
    }
  };


  const getPricingRowKey = (row, index) => {
    const device = String(row?.mappedDevice || getCsvValueByAliases(row, ['Device Type', 'device type', 'device', 'product']) || 'unknown').toLowerCase();
    const condition = String(row?.Condition || row?.condition || 'unknown').toLowerCase();
    const spec = String(row?.['SIM Type/Model/Processor'] || row?.specification || row?.sim || 'unknown').toLowerCase();
    const storage = String(row?.['Storage Capacity/Configuration'] || row?.storage || 'na').toLowerCase();
    const companyPrice = parseNairaValue(getCsvValueByAliases(row, ['Regular price', 'Company Price', 'price']) || row?.companyPrice || 0);
    return `${device}::${condition}::${spec}::${storage}::${companyPrice}::${index}`;
  };

  useEffect(() => {
    setSelectedProducts([]);
  }, [pricingVendor, pricingVendorExtraOne, pricingVendorExtraTwo, priceReferenceMode, marginType, marginValue, companyCsvRows.length]);

  const pricingResults = useMemo(() => {
    const margin = Number(marginValue) || 0;
    const aggregatePrice = (prices = [], mode = 'highest') => {
      if (!prices.length) return 0;
      if (mode === 'lowest') return Math.min(...prices);
      if (mode === 'average') return Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length);
      return Math.max(...prices);
    };

    const resolveReferenceFromMode = ({ selectedPrices = [], globalPrices = [], primaryVendorPrice = 0 }) => {
      switch (priceReferenceMode) {
        case 'selected_highest':
          return aggregatePrice(selectedPrices, 'highest');
        case 'selected_lowest':
          return aggregatePrice(selectedPrices, 'lowest');
        case 'selected_average':
          return aggregatePrice(selectedPrices, 'average');
        case 'global_highest':
          return aggregatePrice(globalPrices, 'highest');
        case 'global_lowest':
          return aggregatePrice(globalPrices, 'lowest');
        case 'global_average':
          return aggregatePrice(globalPrices, 'average');
        case 'selected_primary':
        default:
          return primaryVendorPrice || 0;
      }
    };

    return companyCsvRows.map((row, index) => {
     // FIX: Ensure original name is captured perfectly
      const companyDevice = String(getCsvValueByAliases(row, ['Device Type', 'device type', 'Device', 'device', 'Device Name']) || row['Device Type'] || row['device type'] || '');
      const companyCondition = getCsvValueByAliases(row, ['Condition']) || 'Unknown';
      const companySpec = getCsvValueByAliases(row, ['SIM Type/Model/Processor', 'sim type', 'model', 'processor']);
      const companyRawDescriptor = `${companyDevice} ${companyCondition} ${companySpec}`.trim();
      const mappedResult = smartMapDevice(companyRawDescriptor, officialTargets, masterDictionary);
      const mappedDevice = mappedResult.standardName;
      const condition = mappedResult.condition;
      const storage = getCsvValueByAliases(row, ['Storage Capacity/Configuration', 'storage', 'configuration']);
      const mappedSpec = mappedResult.specification;
      const companyPriceRaw = getCsvValueByAliases(row, ['Regular price', 'Company Price', 'price']);
      const companyPrice = parseNairaValue(companyPriceRaw);
      const requiresConditionMatch = condition !== 'Unknown';
      const requiresSpecMatch = mappedSpec !== 'Unknown';
      const isRowMatch = (item) => item.deviceType === mappedDevice
        && (!storage || item.storage === storage)
        && (!requiresSpecMatch || (item.specification || item.simType) === mappedSpec)
        && (!requiresConditionMatch || item.condition === condition);
      const getLatestMatchForVendor = (vendorName) => normalizedProductRows
        .filter((item) => item.vendorName === vendorName)
        .filter(isRowMatch)
        .sort((a, b) => {
          const timeA = new Date(a.date).getTime() || 0;
          const timeB = new Date(b.date).getTime() || 0;
          return timeB - timeA;
        })[0] || null;

      const comparePriceEntries = selectedCompareVendors.map((vendorName) => {
        const match = getLatestMatchForVendor(vendorName);
        return {
          vendorName,
          priceValue: Number(match?.priceValue || 0),
        };
      });
      const primaryVendorPrice = pricingVendor && pricingVendor !== 'All'
        ? Number(getLatestMatchForVendor(pricingVendor)?.priceValue || 0)
        : 0;
      const selectedVendorPrices = comparePriceEntries.map((entry) => entry.priceValue).filter((value) => value > 0);
      const globalPrices = normalizedProductRows.filter(isRowMatch).map((item) => Number(item?.priceValue || 0)).filter((value) => value > 0);
      const referencePrice = resolveReferenceFromMode({ selectedPrices: selectedVendorPrices, globalPrices, primaryVendorPrice });
      const hasVendorMatch = referencePrice > 0;
      const shouldCalculate = hasVendorMatch;
      const vendorPrice = shouldCalculate ? referencePrice : 0;
  const baseTarget = shouldCalculate
    ? (marginType === 'percentage' ? Math.round(vendorPrice * (1 + (margin / 100))) : vendorPrice + margin)
    : 0;
  const rowKey = getPricingRowKey({ ...row, mappedDevice, companyPrice }, index);
  const override = pricingOverrides[rowKey] || null;
  const overrideMarginValue = Number(override?.marginValue) || 0;
  
  // FIX 2: Apply custom margin against Company Price, override vendor rules
  let target = baseTarget;
  let adjustment = shouldCalculate ? (target - companyPrice) : 0;
  let adjustmentPercent = shouldCalculate && companyPrice > 0 ? Math.round((adjustment / companyPrice) * 100) : 0;
  if (override) {
    if (override.marginType === 'percentage') {
      target = Math.round(companyPrice * (1 + (overrideMarginValue / 100)));
    } else {
      target = companyPrice + overrideMarginValue;
    }
    adjustment = target - companyPrice;
    adjustmentPercent = companyPrice > 0 ? Math.round((adjustment / companyPrice) * 100) : 0;
  }
  return {
    ...row,
    rowKey,
    companyDevice,
    mappedDevice,
    companyPrice,
    vendorPrice,
    comparePriceEntries,
    selectedVendorPrices,
    globalPriceCandidates: globalPrices,
    target,
    adjustment,
    adjustmentPercent,
    hasVendorMatch,
    assignedVendor: override?.assignedVendor || pricingVendor || selectedCompareVendors[0] || 'All',
    isOverridden: Boolean(override),
  };
});
}, [companyCsvRows, pricingVendor, selectedCompareVendors, priceReferenceMode, marginType, marginValue, normalizedProductRows, officialTargets, masterDictionary, pricingOverrides]);

  const groupedPricingResults = useMemo(() => {
    const groups = [];
    let activeTopCategory = { name: 'General Inventory', subGroups: [] };
    let activeSubGroup = { name: 'Uncategorized', items: [] };

    pricingResults.forEach((row) => {
      const rawValues = Object.values(row.originalRow || row);
      const hashtagVal = rawValues.find((v) => typeof v === 'string' && v.trim().startsWith('#'));

      if (hashtagVal) {
        const cleanHash = hashtagVal.trim();
        const topCategories = ['#smartphones', '#laptops', '#tablets', '#smartwatches', '#sounds', '#accessories', '#gaming'];

        if (topCategories.some((tc) => cleanHash.toLowerCase().includes(tc))) {
          if (activeSubGroup.items.length > 0) activeTopCategory.subGroups.push(activeSubGroup);
          if (activeTopCategory.subGroups.length > 0) groups.push(activeTopCategory);

          activeTopCategory = { name: cleanHash, subGroups: [] };
          activeSubGroup = { name: 'General Items', items: [] };
        } else {
          if (activeSubGroup.items.length > 0) activeTopCategory.subGroups.push(activeSubGroup);
          activeSubGroup = { name: cleanHash, items: [] };
        }
      } else if (row.companyPrice > 0 || (row.mappedDevice && row.mappedDevice !== 'Unknown Device')) {
        activeSubGroup.items.push(row);
      }
    });

    if (activeSubGroup.items.length > 0) activeTopCategory.subGroups.push(activeSubGroup);
    if (activeTopCategory.subGroups.length > 0) groups.push(activeTopCategory);

    return groups;
  }, [pricingResults]);
  const pricingRowKeys = useMemo(
    () => pricingResults.map((row) => row?.rowKey).filter(Boolean),
    [pricingResults]
  );

  const resolveBulkTargetKeys = () => (
    selectedProducts.length > 0 ? selectedProducts : pricingRowKeys
  );

  const toggleProductSelection = (rowKey) => {
    setSelectedProducts((prev) => (prev.includes(rowKey) ? prev.filter((item) => item !== rowKey) : [...prev, rowKey]));
  };

  const togglePricingGroup = (groupName) => {
    setExpandedPricingGroups((prev) => (
      prev.includes(groupName) ? prev.filter((name) => name !== groupName) : [...prev, groupName]
    ));
  };

  const toggleSelectGroup = (groupRowKeys) => {
    const allSelected = groupRowKeys.length > 0 && groupRowKeys.every((key) => selectedProducts.includes(key));
    if (allSelected) {
      setSelectedProducts((prev) => prev.filter((key) => !groupRowKeys.includes(key)));
    } else {
      setSelectedProducts((prev) => Array.from(new Set([...prev, ...groupRowKeys])));
    }
  };

  const applyCustomMarginToSelected = () => {
    const parsedMargin = Number(customMarginValue);
    if (!Number.isFinite(parsedMargin)) {
      alert('Please enter a valid margin value.');
      return;
    }
    const targetKeys = resolveBulkTargetKeys();
    if (!targetKeys.length) {
      alert('No products available to update yet. Load a company CSV first.');
      return;
    }

    setPricingOverrides((prev) => {
      const next = { ...prev };
      targetKeys.forEach((rowKey) => {
        next[rowKey] = {
          ...(next[rowKey] || {}),
          marginType: customMarginType,
          marginValue: parsedMargin,
        };
      });
      return next;
    });

    setCustomMarginModalOpen(false);
    const scopeLabel = selectedProducts.length > 0 ? `${selectedProducts.length} selected products` : `all ${targetKeys.length} loaded products`;
    alert(`✅ Applied custom margin to ${scopeLabel}.`);
  };

  const assignSelectedToVendor = () => {
    if (!assignVendorValue.trim()) {
      alert('Please choose a vendor.');
      return;
    }
    const targetKeys = resolveBulkTargetKeys();
    if (!targetKeys.length) {
      alert('No products available to assign yet. Load a company CSV first.');
      return;
    }

    setPricingOverrides((prev) => {
      const next = { ...prev };
      targetKeys.forEach((rowKey) => {
        next[rowKey] = {
          ...(next[rowKey] || {}),
          assignedVendor: assignVendorValue,
        };
      });
      return next;
    });

    setAssignVendorModalOpen(false);
    const scopeLabel = selectedProducts.length > 0 ? `${selectedProducts.length} selected products` : `all ${targetKeys.length} loaded products`;
    alert(`✅ Assigned ${scopeLabel} to ${assignVendorValue}.`);
  };

  const exportPricingTxt = () => {
    const validItems = pricingResults.filter((item) => Number.isFinite(item.companyPrice) && item.companyPrice > 0 && (item.hasVendorMatch || item.isOverridden));
    if (!validItems.length) return alert('No valid pricing adjustments to export.');
    
    const pairs = validItems.map((item) => {
      const override = pricingOverrides[item.rowKey];
      const isPercent = override ? override.marginType === 'percentage' : marginType === 'percentage';
      if (isPercent) return `${item.companyPrice}: ${item.adjustmentPercent}%`;
      return `${item.companyPrice}: ${item.adjustment}`;
    });
    
    const exportString = pairs.join(', ');
    const blob = new Blob([exportString], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `pricing-adjustments-${Date.now()}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenSaveModal = () => {
    if (!pricingResults.length) return alert('No pricing result to save.');
    setSessionNameInput(`Session ${new Date().toLocaleDateString()}`);
    setSaveSessionModalOpen(true);
  };

  const savePricingSessionToFirebase = async () => {
    if (!sessionNameInput.trim()) return alert('Please enter a session name.');

    const session = {
      id: `session_${Date.now()}`,
      name: sessionNameInput.trim(),
      createdAt: new Date().toISOString(),
      pricingVendor,
      pricingVendorExtraOne,
      pricingVendorExtraTwo,
      selectedCompareVendors,
      priceReferenceMode,
      marginType,
      marginValue,
      companyCsvUrl,
      overrides: pricingOverrides,
    };

    try {
      await setDoc(doc(db, 'horleyTech_PricingSessions', session.id), session);

      const updated = [session, ...savedPricingSessions];
      setSavedPricingSessions(updated);
      setSaveSessionModalOpen(false);
      setSessionNameInput('');
      alert('✅ Pricing session securely saved to Firebase.');
    } catch (error) {
      alert(`❌ Failed to save session: ${error.message}`);
    }
  };

  const loadPricingSession = (session) => {
    if (!window.confirm(`Load session "${session.name}"? This will overwrite your current progress.`)) return;

    setCompanyCsvUrl(session.companyCsvUrl || '');
    setPricingVendor(session.pricingVendor || session.selectedCompareVendors?.[0] || 'All');
    setPricingVendorExtraOne(session.pricingVendorExtraOne || session.selectedCompareVendors?.[1] || '');
    setPricingVendorExtraTwo(session.pricingVendorExtraTwo || session.selectedCompareVendors?.[2] || '');
    setPriceReferenceMode(session.priceReferenceMode || 'selected_primary');
    setMarginType(session.marginType || 'amount');
    setMarginValue(session.marginValue || '0');
    setPricingOverrides(session.overrides || {});

    if (session.companyCsvUrl) {
      loadCompanyCsv();
    }
    alert(`✅ Loaded session: ${session.name}`);
  };

  const deletePricingSession = async (sessionId) => {
    if (!window.confirm('Are you sure you want to delete this session permanently?')) return;
    try {
      await deleteDoc(doc(db, 'horleyTech_PricingSessions', sessionId));
      setSavedPricingSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (error) {
      alert(`❌ Failed to delete session: ${error.message}`);
    }
  };

  const openChatForVendor = async (vendor) => {
    setChatVendor(vendor);
    setChatOpen(true);
    try {
      const response = await fetch(`${BASE_URL}/api/messages/${vendor.vendorId}`, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load conversation');
      setChatMessages(Array.isArray(data.messages) ? data.messages : []);
      fetchAllMessages(); 
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  };
  const sendAdminChat = async () => {
    if (!chatVendor || !chatInput.trim()) return;
    setSendingChat(true);
    try {
      const response = await fetch(`${BASE_URL}/api/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          vendorId: chatVendor.vendorId,
          sender: 'admin',
          recipient: 'vendor',
          text: chatInput.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Message failed');
      
      setChatInput('');
      setChatMessages((prev) => [...prev, data.message]);
      fetchAllMessages();
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setSendingChat(false);
    }
  };
  const openBulkEdit = () => {
    if (!selectedVendorIds.length) {
      alert('Select at least one vendor first.');
      return;
    }
    setBulkCondition('');
    setBulkCategory('');
    setBulkPrice('');
    setBulkEditOpen(true);
  };
  const runBulkEdit = async () => {
    const fields = {};
    if (bulkCondition.trim()) fields.Condition = bulkCondition.trim();
    if (bulkCategory.trim()) fields.Category = bulkCategory.trim();
    if (bulkPrice.trim()) fields['Regular price'] = bulkPrice.trim();
    if (!Object.keys(fields).length) {
      alert('Please add at least one field update.');
      return;
    }
    const selectedVendors = offlineVendors.filter((vendor) => selectedVendorIds.includes(vendor.docId));
    const productIds = [];
    selectedVendors.forEach((vendor) => {
      (vendor.products || []).forEach((_product, index) => {
        productIds.push(`${vendor.docId}::${index}`);
      });
    });
    if (!productIds.length) {
      alert('No products found for selected vendors.');
      return;
    }
    setBulkEditLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/api/inventory/bulk-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ productIds, fields }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Bulk edit failed');
      alert(`✅ Updated ${data.updatedProducts || 0} products.`);
      setBulkEditOpen(false);
      fetchInventory();
      fetchAuditLogs();
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setBulkEditLoading(false);
    }
  };
  const undoAuditAction = async (auditId) => {
    if (!window.confirm('Are you sure you want to proceed? This will change the live user experience/data.')) return;
    setRestoringAuditId(auditId);
    try {
      const response = await fetch(`${BASE_URL}/api/admin/restore-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ auditId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Undo failed');
      alert('✅ Action restored successfully.');
      fetchInventory();
      fetchAuditLogs();
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setRestoringAuditId(null);
    }
  };
  const advancedAnalytics = useMemo(() => {
    const buckets = {};
    const heat = { 'Admin edits': 0, 'Vendor WhatsApp updates': 0 };
    const accuracy = { 'Automated Fixes': 0, 'Manual Edits': 0 };
    normalizedProductRows.forEach((row) => {
      const key = `${row.deviceType} (${row.condition})`;
      if (!buckets[key]) buckets[key] = { total: 0, count: 0 };
      buckets[key].total += row.priceValue;
      buckets[key].count += 1;
    });
    offlineVendors.forEach((vendor) => {
      if (selectedVendorFilter !== 'All' && vendor.vendorName !== selectedVendorFilter) return;
      const logs = normalizeLogs(vendor.logs);
      logs.admin.forEach((entry) => {
        const action = String(entry?.action || '').toLowerCase();
        if (action.includes('edited')) {
          heat['Admin edits'] += 1;
          accuracy['Manual Edits'] += 1;
        }
        if (action.includes('ai')) accuracy['Automated Fixes'] += 1;
      });
      logs.vendor.forEach((entry) => {
        const action = String(entry?.action || '').toLowerCase();
        if (action.includes('whatsapp') || action.includes('updated')) {
          heat['Vendor WhatsApp updates'] += 1;
        }
      });
    });
    return {
      priceVariance: Object.entries(buckets).slice(0, 10).map(([name, v]) => ({
        name,
        averagePrice: Math.round(v.total / Math.max(v.count, 1)),
      })),
      actionHeatmap: Object.entries(heat).map(([type, frequency]) => ({ type, frequency })),
      scraperAccuracy: Object.entries(accuracy).map(([name, value]) => ({ name, value })),
    };
  }, [normalizedProductRows, offlineVendors, selectedVendorFilter]);
  return (
    <AdminDashboardLayout notificationCount={unreadMessages.length} onNotificationClick={() => setNotificationOpen(true)}>
      {location.pathname === '/dashboard' || location.pathname === '/dashboard/' ? (
        <div className="p-6">
          {/* Analytics Hub Top Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4 mb-6">
            <button type="button" onClick={() => setActiveTab('offline')} className="group text-left bg-gradient-to-br from-white to-slate-50 border border-slate-200/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer">
              <p className="text-[11px] font-extrabold text-slate-500 uppercase tracking-[0.15em]">Total Vendors</p>
              <p className="text-3xl font-black text-[#12141B] mt-3 leading-none">{analytics.totalVendors}</p>
              <p className="text-xs text-slate-400 mt-2">Registered storefronts</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('products');
                setProductSortMode('highest_price');
              }}
              className="group text-left bg-gradient-to-br from-emerald-50 via-white to-green-50 border border-emerald-200/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer"
            >
              <p className="text-[11px] font-extrabold text-emerald-700 uppercase tracking-[0.15em]">Inventory Value</p>
              <p className="text-[clamp(1.2rem,2.1vw,2rem)] font-black text-emerald-700 mt-3 leading-tight break-words">{formatNaira(analytics.totalInventoryValue)}</p>
              <p className="text-xs text-emerald-600/80 mt-2">~ {formatCompactNaira(analytics.totalInventoryValue)}</p>
            </button>
            <button type="button" onClick={() => setActiveTab('offline')} className="group text-left bg-gradient-to-br from-blue-50 via-white to-indigo-50 border border-blue-200/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer">
              <p className="text-[11px] font-extrabold text-blue-700 uppercase tracking-[0.15em]">Store Views</p>
              <p className="text-3xl font-black text-blue-700 mt-3 leading-none">{analytics.totalStoreViews}</p>
              <p className="text-xs text-blue-600/80 mt-2">Traffic this period</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('products');
                setProductSortMode('highest_price');
              }}
              className="group text-left bg-gradient-to-br from-teal-50 via-white to-emerald-50 border border-teal-200/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer"
            >
              <p className="text-[11px] font-extrabold text-teal-700 uppercase tracking-[0.15em]">WA Orders</p>
              <p className="text-3xl font-black text-teal-700 mt-3 leading-none">{analytics.totalWhatsAppOrders}</p>
              <p className="text-xs text-teal-600/80 mt-2">Buyer intent clicks</p>
            </button>
            <button
              type="button"
              onClick={() => {
                if (analytics.mostTrackedDevice && analytics.mostTrackedDevice !== 'N/A') {
                  setActiveTab('products');
                  setProductSearchQuery(analytics.mostTrackedDevice);
                  setProductSortMode('highest_price');
                }
              }}
              className="group text-left bg-gradient-to-br from-orange-50 via-white to-amber-50 border border-orange-200/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer"
            >
              <p className="text-[11px] font-extrabold text-orange-700 uppercase tracking-[0.15em]">Top Device</p>
              <p className="text-lg font-black text-[#12141B] mt-3 leading-tight break-words">{analytics.mostTrackedDevice}</p>
              <p className="text-xs text-orange-600/80 mt-2">Most listed category</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('offline');
                setSearchQuery(analytics.topVendor === 'N/A' ? '' : analytics.topVendor);
              }}
              className="group text-left bg-gradient-to-br from-violet-50 via-white to-purple-50 border border-violet-200/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer"
            >
              <p className="text-[11px] font-extrabold text-violet-700 uppercase tracking-[0.15em]">Star Vendor</p>
              <p className="text-lg font-black text-[#12141B] mt-3 leading-tight break-all">{analytics.topVendor}</p>
              <p className="text-xs text-violet-600/80 mt-2">Highest WA conversions</p>
            </button>
          </div>
          {/* Tab Navigation */}
          <div className="mb-6 flex overflow-x-auto hide-scrollbar whitespace-nowrap w-full gap-2 pb-2 items-center">
            <div className="flex gap-2 bg-white border border-gray-200 p-1.5 rounded-2xl shadow-sm">
              <button onClick={() => setActiveTab('offline')} className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'offline' ? 'bg-[#1A1C23] text-white shadow-sm' : 'text-gray-600 hover:text-[#1A1C23] hover:bg-gray-100'}`}>Directory</button>
              <button onClick={() => setActiveTab('analytics')} className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'analytics' ? 'bg-[#1A1C23] text-white shadow-sm' : 'text-gray-600 hover:text-[#1A1C23] hover:bg-gray-100'}`}>Visual Analytics</button>
              <button onClick={() => setActiveTab('activity')} className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'activity' ? 'bg-[#1A1C23] text-white shadow-sm' : 'text-gray-600 hover:text-[#1A1C23] hover:bg-gray-100'}`}>Activity Log</button>
              <button onClick={() => setActiveTab('products')} className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'products' ? 'bg-[#1A1C23] text-white shadow-sm' : 'text-gray-600 hover:text-[#1A1C23] hover:bg-gray-100'}`}>Global Products</button>
              <button onClick={() => setActiveTab('pricing')} className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'pricing' ? 'bg-[#1A1C23] text-white shadow-sm' : 'text-gray-600 hover:text-[#1A1C23] hover:bg-gray-100'}`}>Pricing Engine</button>
              <button onClick={() => setActiveTab('backups')} className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'backups' ? 'bg-[#1A1C23] text-white shadow-sm' : 'text-gray-600 hover:text-[#1A1C23] hover:bg-gray-100'}`}>Backups</button>
              <button onClick={() => setActiveTab('history')} className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'history' ? 'bg-[#1A1C23] text-white shadow-sm' : 'text-gray-600 hover:text-[#1A1C23] hover:bg-gray-100'}`}>History</button>
              <button onClick={() => setActiveTab('promote')} className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'promote' ? 'bg-[#1A1C23] text-white shadow-sm' : 'text-gray-600 hover:text-[#1A1C23] hover:bg-gray-100'}`}>Promote</button>
              <button onClick={() => setActiveTab('maintenance')} className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'maintenance' ? 'bg-[#1A1C23] text-white shadow-sm' : 'text-gray-600 hover:text-[#1A1C23] hover:bg-gray-100'}`}>System Maintenance</button>
            </div>
          </div>
          <datalist id="vendor-search-list">
            <option value="All">All</option>
            {uniqueVendorNames.map((vendor) => <option key={`vendor-search-${vendor}`} value={vendor} />)}
          </datalist>
          {/* Conditional Rendering of Tabs */}
          {activeTab === 'analytics' ? (
            <div className="bg-white/70 backdrop-blur-xl rounded-3xl overflow-hidden mb-10 p-6 border border-gray-100 shadow-sm">
              <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4 mb-8">
                <div>
                  <h2 className="text-2xl font-black text-[#1A1C23]">📊 Platform Data Insights</h2>
                  <p className="text-xs text-gray-500 mt-2">Showing {analytics.filteredVendorCount} vendors in selected range/mode.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="grid grid-cols-2 gap-3 bg-white/70 backdrop-blur-xl rounded-2xl border border-gray-100 shadow-sm p-2">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="px-4 py-2.5 rounded-xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text"
                    />
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="px-4 py-2.5 rounded-xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text"
                    />
                  </div>
                  <select
                    value={dataViewMode}
                    onChange={(e) => setDataViewMode(e.target.value)}
                    className="px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider border border-gray-100 bg-white/70 backdrop-blur-xl shadow-sm text-gray-700"
                  >
                    <option value="all">All Data</option>
                    <option value="clean">Clean</option>
                    <option value="unclean">Unclean</option>
                    <option value="excluded">Excluded</option>
                  </select>
                  <input
                    type="text"
                    list="vendor-search-list"
                    value={selectedVendorFilter}
                    onChange={(e) => setSelectedVendorFilter(e.target.value || 'All')}
                    placeholder="Search vendor"
                    className="px-4 py-2.5 rounded-2xl text-xs font-black border border-gray-100 bg-white/70 backdrop-blur-xl shadow-sm text-gray-700 cursor-text select-text"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-8">
                {/* Pie Chart: Category Mix */}
                <div className="h-[380px] border border-gray-100 rounded-2xl p-5 shadow-sm bg-gray-50">
                  <h3 className="font-bold text-gray-700 mb-4 uppercase tracking-widest text-xs">Category Distribution</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <PieChart>
                      <Pie
                        data={insightCharts.categoryMix}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={110}
                        label
                        onClick={handleCategoryChartClick}
                      >
                        {insightCharts.categoryMix.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`${value} Items`, 'Stock']} />
                      <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Bar Chart: Condition Distribution */}
                <div className="h-[380px] border border-gray-100 rounded-2xl p-5 shadow-sm bg-gray-50">
                  <h3 className="font-bold text-gray-700 mb-4 uppercase tracking-widest text-xs">Condition Distribution</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={insightCharts.conditionMix} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="condition" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip cursor={{ fill: 'transparent' }} />
                      <Bar
                        dataKey="count"
                        fill="#3b82f6"
                        radius={[6, 6, 0, 0]}
                        name="Products by Condition"
                        onClick={handleConditionChartClick}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* Line Chart: Lead Velocity */}
              <div className="h-[400px] border border-gray-100 rounded-2xl p-5 shadow-sm bg-gray-50">
                <h3 className="font-bold text-gray-700 mb-4 uppercase tracking-widest text-xs">Lead Velocity (WhatsApp Clicks - Last 7 Days)</h3>
                <ResponsiveContainer width="100%" height="90%">
                  <LineChart data={insightCharts.leadVelocity} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="clicks" stroke="#10b981" strokeWidth={4} dot={{ r: 6, fill: '#10b981' }} activeDot={{ r: 8 }} name="WhatsApp Clicks" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-8">
                <div className="h-[320px] border border-gray-100 rounded-2xl p-5 shadow-sm bg-gray-50">
                  <h3 className="font-bold text-gray-700 mb-4 uppercase tracking-widest text-xs">Price Variance Chart</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={advancedAnalytics.priceVariance}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" hide />
                      <YAxis />
                      <Tooltip formatter={(value) => [formatNaira(value), 'Average Price']} />
                      <Bar dataKey="averagePrice" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-[320px] border border-gray-100 rounded-2xl p-5 shadow-sm bg-gray-50">
                  <h3 className="font-bold text-gray-700 mb-4 uppercase tracking-widest text-xs">Action Heatmap</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={advancedAnalytics.actionHeatmap}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="type" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="frequency" fill="#10b981" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-[320px] border border-gray-100 rounded-2xl p-5 shadow-sm bg-gray-50">
                  <h3 className="font-bold text-gray-700 mb-4 uppercase tracking-widest text-xs">Scraper Accuracy</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <PieChart>
                      <Pie data={advancedAnalytics.scraperAccuracy} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                        {advancedAnalytics.scraperAccuracy.map((entry, index) => (
                          <Cell key={`scraper-cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : activeTab === 'products' ? (
            <div className="bg-white/70 backdrop-blur-xl border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-gray-900">Global Products</h2>
                  <p className="text-sm text-gray-500">6-level hierarchy: Category → Brand → Series → Device → Variation → Vendors.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full lg:w-auto">
                  <input
                    type="text"
                    value={productSearchQuery}
                    onChange={(e) => setProductSearchQuery(e.target.value)}
                    placeholder="Search category, device, series, vendor..."
                    className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text"
                  />
                  <select value={productCategoryFilter} onChange={(e) => setProductCategoryFilter(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text">
                    {uniqueGlobalCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                  <select value={productConditionFilter} onChange={(e) => setProductConditionFilter(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text">
                    {uniqueGlobalConditions.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
                  </select>
                  <input type="text" list="vendor-search-list" value={selectedVendorFilter} onChange={(e) => setSelectedVendorFilter(e.target.value || 'All')} placeholder="Search vendor" className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text" />
                  <select value={dataViewMode} onChange={(e) => setDataViewMode(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text">
                    <option value="all">All</option>
                    <option value="clean">Clean</option>
                    <option value="unclean">Unclean</option>
                    <option value="excluded">Excluded</option>
                  </select>
                  <select value={productSortMode} onChange={(e) => setProductSortMode(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text">
                    <option value="highest_price">Highest Total Price</option>
                    <option value="lowest_price">Lowest Total Price</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
                <div className="lg:col-span-2 flex gap-2">
                  <input
                    type="text"
                    value={excludedPhrases}
                    onChange={(e) => setExcludedPhrases(e.target.value)}
                    placeholder="Phrases to Exclude (comma separated)"
                    className="flex-1 px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text"
                  />
                  <button type="button" onClick={saveExcludedPhrasesFilter} className="px-3 py-2 rounded-2xl text-[11px] font-black uppercase tracking-wider border border-gray-100 bg-white/80 hover:bg-white whitespace-nowrap">Save Filter</button>
                  <button type="button" onClick={exportGlobalProductsCSV} className="px-3 py-2 rounded-2xl text-[11px] font-black uppercase tracking-wider border border-gray-700 bg-gray-800 text-white hover:bg-gray-900 whitespace-nowrap">📥 Export CSV</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text" />
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text" />
                </div>
              </div>
              <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white/70 backdrop-blur-xl rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Dictionary Mappings: {Object.keys(masterDictionary).length}</p>
                <div className="flex items-center gap-3">
                  <select
                    value={selectedAIProvider}
                    onChange={(e) => saveAIProviderSetting(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-xs font-semibold"
                    title="Choose which text AI model provider powers sync/judging"
                    disabled={syncJobState.isSyncing}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="qwen">Qwen</option>
                  </select>
                  <select
                    value={selectedImageAIProvider}
                    onChange={(e) => saveImageAIProviderSetting(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-xs font-semibold"
                    title="Choose which image AI provider powers container image generation"
                    disabled={syncJobState.isSyncing}
                  >
                    <option value="openai">Image: OpenAI</option>
                    <option value="qwen">Image: Qwen</option>
                  </select>
                  <button
                    type="button"
                    onClick={runMasterAutoSync}
                    disabled={syncJobState.isSyncing}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${syncJobState.isSyncing ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'}`}
                  >
                    {syncJobState.isSyncing ? (syncJobState.progress || 'Syncing...') : 'Master Sync & AI Clean'}
                  </button>
                  {syncJobState.isSyncing && (
                    <button
                      type="button"
                      onClick={stopMasterSync}
                      className="px-4 py-2 bg-red-100 text-red-600 hover:bg-red-200 rounded-lg font-medium transition-all shadow-sm border border-red-200"
                    >
                      🛑 Stop Process
                    </button>
                  )}
                  <button type="button" onClick={handleNukeAndRebuild} className="px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider border border-red-200 text-red-700 bg-red-50 hover:bg-red-100">⚠️ Nuke & Rebuild Dictionary</button>
                </div>
              </div>
              <div className="space-y-3">
                {Object.entries(groupedGlobalProducts).map(([category, brands]) => {
                  const categoryKey = `category:${category}`;
                  if (!paginatedGroupKeySet.has(categoryKey)) return null;
                  const categoryExpanded = expandedProductGroups.includes(categoryKey);
                  return (
                    <div key={categoryKey} className="bg-white rounded-2xl border border-gray-100">
                      <button type="button" onClick={() => toggleProductGroup(categoryKey)} className="w-full px-4 py-3 text-left font-bold text-gray-900 flex items-center justify-between">{category} ({Object.values(brands).flatMap((seriesMap) => Object.values(seriesMap).flatMap((devices) => Object.values(devices).flatMap((variations) => Object.values(variations).map((variation) => variation.stockCount)))).reduce((sum, count) => sum + count, 0)})<span>{categoryExpanded ? '⌄' : '›'}</span></button>
                      {categoryExpanded && (
                        <div className="pl-4 pr-2 pb-3 space-y-2">
                          {Object.entries(brands).map(([brand, seriesMap]) => {
                            const brandKey = `brand:${category}__${brand}`;
                            if (!paginatedGroupKeySet.has(brandKey)) return null;
                            const brandExpanded = expandedProductGroups.includes(brandKey);
                            return (
                              <div key={brandKey} className="bg-gray-50 rounded-2xl border border-gray-100">
                                <button type="button" onClick={() => toggleProductGroup(brandKey)} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-800 flex items-center justify-between">{brand} ({Object.values(seriesMap).flatMap((devices) => Object.values(devices).flatMap((variations) => Object.values(variations).map((variation) => variation.stockCount))).reduce((sum, count) => sum + count, 0)})<span>{brandExpanded ? '⌄' : '›'}</span></button>
                                {brandExpanded && (
                                  <div className="pl-4 pr-2 pb-3 space-y-2">
                                    {Object.entries(seriesMap).map(([series, devices]) => {
                                      const seriesKey = `series:${category}__${brand}__${series}`;
                                      if (!paginatedGroupKeySet.has(seriesKey)) return null;
                                      const seriesExpanded = expandedProductGroups.includes(seriesKey);
                                      return (
                                        <div key={seriesKey} className="bg-white rounded-xl border border-gray-100">
                                          <button type="button" onClick={() => toggleProductGroup(seriesKey)} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-800 flex items-center justify-between">{series} ({Object.values(devices).flatMap((variations) => Object.values(variations).map((variation) => variation.stockCount)).reduce((sum, count) => sum + count, 0)})<span>{seriesExpanded ? '⌄' : '›'}</span></button>
                                          {seriesExpanded && (
                                            <div className="pl-4 pr-2 pb-3 space-y-2">
                                              {Object.entries(devices).map(([deviceType, variations]) => {
                                                const deviceKey = `device:${category}__${brand}__${series}__${deviceType}`;
                                                if (!paginatedGroupKeySet.has(deviceKey)) return null;
                                                const deviceExpanded = expandedProductGroups.includes(deviceKey);
                                                return (
                                                  <div key={deviceKey} className="rounded-xl border border-gray-100 bg-gray-50">
                                                    <button type="button" onClick={() => toggleProductGroup(deviceKey)} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-900 flex items-center justify-between">{deviceType} ({Object.values(variations).reduce((sum, variation) => sum + variation.stockCount, 0)})<span>{deviceExpanded ? '⌄' : '›'}</span></button>
                                                    {deviceExpanded && (
                                                      <div className="px-2 pb-3 space-y-2">
                                                        {Object.entries(variations).map(([variationRawKey, variation]) => {
                                                          const variationKey = `variation:${category}__${brand}__${series}__${deviceType}__${variationRawKey}`;
                                                          if (!paginatedGroupKeySet.has(variationKey)) return null;
                                                          const variationExpanded = expandedProductGroups.includes(variationKey);
                                                          return (
                                                            <div key={variationKey} className="rounded-xl border border-gray-100 bg-white">
                                                              <button type="button" onClick={() => toggleProductGroup(variationKey)} className="w-full px-3 py-2 text-left text-xs font-semibold text-gray-700 grid grid-cols-5 gap-2">
                                                                <span>{variation.condition}</span>
                                                                <span>{variation.specification}</span>
                                                                <span>{variation.storage}</span>
                                                                <span>{formatNaira(variation.totalAccumulatedPrice)}</span>
                                                                <span className="text-right">{variation.stockCount} in stock {variationExpanded ? '⌄' : '›'}</span>
                                                              </button>
                                                              {variationExpanded && (
                                                                <div className="px-3 pb-3">
                                                                  <div className="flex overflow-x-auto hide-scrollbar gap-4 snap-x snap-mandatory pb-2">
                                                                    {variation.vendors
                                                                      .sort((a, b) => (productSortMode === 'lowest_price' ? a.priceValue - b.priceValue : b.priceValue - a.priceValue))
                                                                      .slice(0, 10)
                                                                      .map((item) => (
                                                                        <article key={item.id} className="min-w-[200px] snap-center bg-gray-50 border border-gray-100 rounded-xl p-3 shadow-sm flex-shrink-0">
                                                                          <p className="text-xs font-bold text-gray-900">{item.vendorName}</p>
                                                                          <p className="text-sm font-bold text-green-600 mt-1">{item.price}</p>
                                                                          <p className="text-[11px] text-gray-500 mt-1">{formatTimelineDate(item.date)}</p>
                                                                          <Link to={item.vendorLink} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-blue-600 font-bold mt-2">Open ↗</Link>
                                                                        </article>
                                                                      ))}
                                                                  </div>
                                                                </div>
                                                              )}
                                                            </div>
                                                          );
                                                        })}
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {filteredGlobalProducts.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No grouped products match your filters.</p>}
              {filteredGlobalProducts.length > 0 && (
                <div className="flex items-center justify-between px-2 pt-5">
                  <p className="text-xs font-semibold text-gray-600">Page {currentProductPage} of {totalProductPages} • Showing {paginatedGroupedProducts.length} of {filteredGlobalProducts.length} grouped rows</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setCurrentProductPage((prev) => Math.max(1, prev - 1))} disabled={currentProductPage === 1} className="px-4 py-2 rounded-xl text-xs font-black uppercase border border-gray-100 bg-white/80 disabled:opacity-40">Prev</button>
                    <button type="button" onClick={() => setCurrentProductPage((prev) => Math.min(totalProductPages, prev + 1))} disabled={currentProductPage === totalProductPages} className="px-4 py-2 rounded-xl text-xs font-black uppercase border border-gray-100 bg-white/80 disabled:opacity-40">Next</button>
                  </div>
                </div>
              )}
            </div>
                    ) : activeTab === 'pricing' ? (
            <div className="bg-white/70 backdrop-blur-xl border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 space-y-5">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-gray-900">WordPress Pricing Session Manager</h2>
                <p className="text-sm text-gray-500">Mirror global rows, compare up to 3 vendors, use selected/global highest-lowest-average price references, apply margin logic, save sessions, and export strict TXT adjustments.</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                <input value={companyCsvUrl} onChange={(e) => setCompanyCsvUrl(e.target.value)} placeholder="Company CSV URL" className="lg:col-span-2 px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text" />
                <input type="text" list="vendor-search-list" value={pricingVendor} onChange={(e) => setPricingVendor(e.target.value)} placeholder="Primary Vendor (1/3)" className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text" />
                <input type="text" list="vendor-search-list" value={pricingVendorExtraOne} onChange={(e) => setPricingVendorExtraOne(e.target.value)} placeholder="Vendor (2/3)" className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text" />
                <input type="text" list="vendor-search-list" value={pricingVendorExtraTwo} onChange={(e) => setPricingVendorExtraTwo(e.target.value)} placeholder="Vendor (3/3)" className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text" />
                <button onClick={loadCompanyCsv} disabled={loadingCompanyCsv} className="px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider border border-gray-100 bg-white/80 hover:bg-white disabled:opacity-50">{loadingCompanyCsv ? 'Loading...' : 'Load Company CSV'}</button>
                <select value={priceReferenceMode} onChange={(e) => setPriceReferenceMode(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text">
                  <option value="selected_primary">Selected Vendors • Primary Vendor Price</option>
                  <option value="selected_highest">Selected Vendors • Highest Price</option>
                  <option value="selected_lowest">Selected Vendors • Lowest Price</option>
                  <option value="selected_average">Selected Vendors • Average Price</option>
                  <option value="global_highest">Global Inventory • Highest Price</option>
                  <option value="global_lowest">Global Inventory • Lowest Price</option>
                  <option value="global_average">Global Inventory • Average Price</option>
                </select>
                <select value={marginType} onChange={(e) => setMarginType(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text">
                  <option value="amount">Amount</option>
                  <option value="percentage">Percentage</option>
                </select>
                <input value={marginValue} onChange={(e) => setMarginValue(e.target.value)} placeholder="Margin value" className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300 cursor-text select-text" />
                <button onClick={handleOpenSaveModal} className="px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider border border-gray-100 bg-white/80 hover:bg-white">Save Session</button>
                <button onClick={exportPricingTxt} className="px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider border border-gray-100 bg-white/80 hover:bg-white">Export to TXT</button>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-white/70 px-4 py-3 text-xs text-gray-600 space-y-2">
                <p className="font-black text-gray-800 uppercase tracking-wider">Reference Mode Guide</p>
                <p>
                  Active mode: <span className="font-bold">{priceReferenceModeLabelMap[priceReferenceMode] || 'Primary Vendor only'}</span>.
                  {' '}Primary Vendor affects <span className="font-bold">Selected Vendors • Primary Vendor Price</span> only.
                </p>
                <p>
                  Compare Vendors (max 3):{' '}
                  <span className="font-semibold">
                    {selectedCompareVendors.length ? selectedCompareVendors.join(', ') : 'None selected'}
                  </span>
                </p>
              </div>
              {pricingResults.length > 0 && (
                <div className="sticky top-20 z-20 rounded-2xl border border-indigo-100 bg-white/95 backdrop-blur-xl shadow-lg px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-800">Quick Actions</p>
                    <p className="text-xs text-gray-500 font-semibold">
                      {selectedProducts.length > 0
                        ? `${selectedProducts.length} selected product(s) will be updated.`
                        : `No selection: actions apply to all ${pricingRowKeys.length} loaded products.`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setCustomMarginModalOpen(true)} className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide bg-indigo-600 text-white hover:bg-indigo-700">Apply Custom Margin</button>
                    <button type="button" onClick={() => setAssignVendorModalOpen(true)} className="px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide bg-emerald-600 text-white hover:bg-emerald-700">Assign to Vendor</button>
                  </div>
                </div>
              )}
              <div className="space-y-4">
                {groupedPricingResults.map((topCat, tIdx) => {
                  const topCatKeys = topCat.subGroups.flatMap((sg) => sg.items.map((item) => item.rowKey));
                  const topCatSelected = topCatKeys.length > 0 && topCatKeys.every((key) => selectedProducts.includes(key));
                  const topCatExpanded = expandedPricingGroups.includes(topCat.name);
                  return (
                    <div key={`top-${tIdx}`} className="bg-white/80 rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                      <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-gray-100 to-gray-50 cursor-pointer hover:bg-gray-200/50 transition-colors" onClick={() => togglePricingGroup(topCat.name)}>
                        <div className="flex items-center gap-4">
                          <input type="checkbox" checked={topCatSelected} onChange={(e) => { e.stopPropagation(); toggleSelectGroup(topCatKeys); }} className="w-5 h-5 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                          <h3 className="font-black text-lg text-[#1A1C23] uppercase tracking-widest">{topCat.name}</h3>
                          <span className="bg-white px-3 py-1 rounded-lg text-xs font-bold text-gray-500 shadow-sm border border-gray-200">{topCatKeys.length} Products</span>
                        </div>
                        <span className="text-gray-400 font-bold text-lg">{topCatExpanded ? '▼' : '▶'}</span>
                      </div>
                      {topCatExpanded && (
                        <div className="p-4 space-y-4 bg-gray-50/50">
                          {topCat.subGroups.map((subCat, sIdx) => {
                            const subCatKeys = subCat.items.map((item) => item.rowKey);
                            const subCatSelected = subCatKeys.length > 0 && subCatKeys.every((key) => selectedProducts.includes(key));
                            const subCatExpanded = expandedPricingGroups.includes(subCat.name + tIdx);
                            return (
                              <div key={`sub-${sIdx}`} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
                                <div className="flex items-center justify-between px-4 py-3 bg-white cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100" onClick={() => togglePricingGroup(subCat.name + tIdx)}>
                                  <div className="flex items-center gap-3">
                                    <input type="checkbox" checked={subCatSelected} onChange={(e) => { e.stopPropagation(); toggleSelectGroup(subCatKeys); }} className="w-4 h-4 cursor-pointer rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                                    <h4 className="font-bold text-sm text-gray-800 uppercase tracking-wider">{subCat.name}</h4>
                                    <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{subCat.items.length} items</span>
                                  </div>
                                  <span className="text-gray-300 text-xs font-bold">{subCatExpanded ? '▼' : '▶'}</span>
                                </div>
                                {subCatExpanded && subCat.items.length > 0 && (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left min-w-[1200px]">
                                      <thead className="bg-gray-50/80 text-[10px] uppercase text-gray-500 font-black border-b border-gray-100">
                                        <tr>
                                          <th className="px-4 py-3">Select</th>
                                          <th className="px-3 py-3">Device</th>
                                          <th className="px-3 py-3">Condition</th>
                                          <th className="px-3 py-3">Spec / Processor</th>
                                          <th className="px-3 py-3">Storage</th>
                                          <th className="px-3 py-3">Assigned Vendor</th>
                                          <th className="px-3 py-3">Company Price</th>
                                          <th className="px-3 py-3">Vendor Price(s)</th>
                                          <th className="px-3 py-3">Target Price</th>
                                          <th className="px-3 py-3">Adjustment</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {subCat.items.map((row) => (
                                          <tr key={`pricing-${row.rowKey}`} className="border-t border-gray-50 text-sm hover:bg-blue-50/30 transition-colors">
                                            <td className="px-4 py-2">
                                              <input type="checkbox" className="h-4 w-4 rounded border-gray-300 cursor-pointer" checked={selectedProducts.includes(row.rowKey)} onChange={() => toggleProductSelection(row.rowKey)} />
                                            </td>
                                            <td className="px-3 py-2 font-semibold text-gray-800">{row.companyDevice || row['Device Type'] || 'Unknown'}</td>
                                            <td className="px-3 py-2 text-gray-600">{row.Condition || row.condition || 'Unknown'}</td>
                                            <td className="px-3 py-2 text-gray-600">{row['SIM Type/Model/Processor'] || row.specification || row.sim || 'Unknown'}</td>
                                            <td className="px-3 py-2 font-mono text-xs">{row['Storage Capacity/Configuration'] || row.storage || 'N/A'}</td>
                                            <td className="px-3 py-2">
                                              <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest">{row.assignedVendor || 'Unassigned'}</span>
                                            </td>
                                            <td className="px-3 py-2 font-bold">{formatNaira(row.companyPrice)}</td>
                                            <td className="px-3 py-2 text-gray-500">
                                              {row.comparePriceEntries?.length ? (
                                                <div className="flex flex-col gap-1">
                                                  {row.comparePriceEntries.map((entry) => (
                                                    <span key={`${row.rowKey}-${entry.vendorName}`} className="inline-flex items-center gap-1 text-[10px] font-bold">
                                                      <span className="text-gray-700">{entry.vendorName}:</span>
                                                      <span className={entry.priceValue > 0 ? 'text-indigo-600' : 'text-gray-400'}>
                                                        {entry.priceValue > 0 ? formatNaira(entry.priceValue) : 'N/A'}
                                                      </span>
                                                    </span>
                                                  ))}
                                                  <span className="text-[10px] font-black text-emerald-600">
                                                    Base: {row.hasVendorMatch ? formatNaira(row.vendorPrice) : 'N/A'}
                                                  </span>
                                                </div>
                                              ) : (row.hasVendorMatch ? formatNaira(row.vendorPrice) : 'N/A')}
                                            </td>
                                            <td className="px-3 py-2 font-bold text-indigo-600">{(row.hasVendorMatch || row.isOverridden) ? formatNaira(row.target) : 'N/A'}</td>
                                            <td className="px-3 py-2">
                                              {(row.hasVendorMatch || row.isOverridden) ? (
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${row.adjustment > 0 ? 'bg-green-100 text-green-700' : row.adjustment < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                                                  {row.adjustment > 0 ? '+' : ''}{formatNaira(row.adjustment)}
                                                </span>
                                              ) : 'N/A'}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!pricingResults.length && (
                  <div className="border border-gray-100 rounded-2xl bg-white/60 px-4 py-4 text-sm text-gray-500">No matched rows. Load CSV and choose up to 3 vendors for comparison.</div>
                )}
              </div>
              {customMarginModalOpen && (
                <div className="fixed top-0 left-0 w-screen h-screen z-[99999] bg-black/60 flex items-center justify-center p-4 m-0" style={{ position: 'fixed' }}>
                  <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-5 space-y-4 relative">
                    <h3 className="text-lg font-black text-gray-900">Apply Custom Margin {selectedProducts.length > 0 ? '(Selected)' : '(All Loaded)'}</h3>
                    <select value={customMarginType} onChange={(e) => setCustomMarginType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                      <option value="amount">Amount</option>
                      <option value="percentage">Percentage</option>
                    </select>
                    <input value={customMarginValue} onChange={(e) => setCustomMarginValue(e.target.value)} placeholder="Enter margin value" className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setCustomMarginModalOpen(false)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">Cancel</button>
                      <button type="button" onClick={applyCustomMarginToSelected} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold">Apply</button>
                    </div>
                  </div>
                </div>
              )}
              {saveSessionModalOpen && (
                <div className="fixed top-0 left-0 w-screen h-screen z-[99999] bg-black/60 flex items-center justify-center p-4 m-0" style={{ position: 'fixed' }}>
                  <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 space-y-4 relative">
                    <h3 className="text-xl font-black text-gray-900">Name Your Session</h3>
                    <p className="text-xs text-gray-500 font-bold mb-2">This will save your custom margins and vendor rules to the cloud.</p>
                    <input autoFocus value={sessionNameInput} onChange={(e) => setSessionNameInput(e.target.value)} placeholder="e.g., iPhone Resell March 2026" className="w-full px-4 py-3 rounded-xl border border-gray-300 font-bold text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    <div className="flex justify-end gap-3 mt-4">
                      <button type="button" onClick={() => setSaveSessionModalOpen(false)} className="px-4 py-3 rounded-xl border border-gray-200 font-bold text-gray-600 hover:bg-gray-50">Cancel</button>
                      <button type="button" onClick={savePricingSessionToFirebase} className="px-4 py-3 rounded-xl bg-[#1A1C23] text-white text-sm font-black uppercase tracking-widest hover:bg-black">Save to Cloud</button>
                    </div>
                  </div>
                </div>
              )}
              {assignVendorModalOpen && (
                <div className="fixed top-0 left-0 w-screen h-screen z-[99999] bg-black/60 flex items-center justify-center p-4 m-0" style={{ position: 'fixed' }}>
                  <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-5 space-y-4 relative">
                    <h3 className="text-lg font-black text-gray-900">Assign Products to Vendor {selectedProducts.length > 0 ? '(Selected)' : '(All Loaded)'}</h3>
                    <select value={assignVendorValue} onChange={(e) => setAssignVendorValue(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                      <option value="">Select Vendor</option>
                      {offlineVendors.map((vendor) => (
                        <option key={vendor.docId} value={vendor.vendorName}>{vendor.vendorName}</option>
                      ))}
                    </select>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setAssignVendorModalOpen(false)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">Cancel</button>
                      <button type="button" onClick={assignSelectedToVendor} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold">Assign</button>
                    </div>
                  </div>
                </div>
              )}
              <div className="border border-gray-100 rounded-2xl p-4 bg-white/60 mt-6">
                <p className="text-xs font-black uppercase tracking-wider text-gray-500 mb-3">Cloud Saved Sessions</p>
                {savedPricingSessions.length ? (
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {savedPricingSessions.map((session) => (
                      <div key={session.id} className="flex items-center justify-between border border-gray-100 rounded-xl px-4 py-3 bg-white/80 hover:bg-white shadow-sm transition-all">
                        <div>
                          <p className="text-sm font-black text-gray-900">{session.name}</p>
                          <p className="text-xs font-bold text-gray-500 mt-0.5">
                            {(session.selectedCompareVendors?.length ? session.selectedCompareVendors.join(', ') : (session.pricingVendor || 'All Vendors'))}
                            {' • '}
                            {priceReferenceModeLabelMap[session.priceReferenceMode || 'selected_primary'] || 'Primary Vendor only'}
                            {' • '}
                            {session.marginType} {session.marginValue}
                            {' • '}
                            {new Date(session.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => loadPricingSession(session)} className="text-xs font-black uppercase tracking-wider px-3 py-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100">Load</button>
                          <button type="button" onClick={() => deletePricingSession(session.id)} className="text-xs font-black uppercase tracking-wider px-3 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-gray-500">No sessions saved to the cloud yet.</p>}
              </div>
            </div>
) : activeTab === 'backups' ? (
            <div className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
              <div className="p-5 bg-gray-50 border-b flex justify-between items-center gap-4">
                <h2 className="text-lg font-bold text-[#1A1C23]">Backup Version History ({backups.length})</h2>
                <div>
                  <button onClick={triggerManualBackup} disabled={manualBackupLoading} className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-700 transition-all shadow-md disabled:opacity-50">
                    {manualBackupLoading ? 'Running...' : 'Run Backup'}
                  </button>
                  <p className="text-xs text-gray-400 mt-2">Creates a manual snapshot and uploads it to Cloud Storage and Firebase.</p>
                </div>
              </div>
              <table className="w-full text-left">
                <thead className="bg-white text-gray-400 text-[11px] font-black uppercase tracking-widest border-b">
                  <tr>
                    <th className="p-4 pl-6">Backup ID</th>
                    <th className="p-4">Created At</th>
                    <th className="p-4">Total Docs</th>
                    <th className="p-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {backups.map(backup => (
                    <tr key={backup.id} className="hover:bg-gray-50">
                      <td className="p-4 pl-6 text-sm font-mono text-blue-600">{backup.id}</td>
                      <td className="p-4 text-sm text-gray-600 font-medium">{backup.createdAt ? new Date(backup.createdAt).toLocaleString() : 'N/A'}</td>
                      <td className="p-4 text-sm font-bold text-gray-800">{backup.totalDocuments || 0} Vendors</td>
                      <td className="p-4">
                        <div className="flex flex-col items-end">
                          <button onClick={() => restoreBackup(backup.id)} disabled={restoringBackupId === backup.id} className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-xs font-black uppercase hover:bg-red-600 hover:text-white transition-all disabled:opacity-50">
                            {restoringBackupId === backup.id ? 'Restoring...' : 'Safe Restore'}
                          </button>
                          <p className="text-xs text-gray-400 mt-2 text-right">Reverts the selected item or collection to a previous historical state.</p>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : activeTab === 'activity' ? (
            <div className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
              <div className="p-5 bg-gray-50 border-b">
                <h2 className="text-lg font-bold text-[#1A1C23]">Global Platform Activity (Newest 50)</h2>
              </div>
              <div className="p-5 space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar">
                {platformActivityTimeline.map((entry, idx) => (
                  <div key={idx} className="border-l-4 border-blue-500 pl-4 py-3 bg-gray-50 rounded-r-lg shadow-sm">
                    <div className="flex justify-between items-start">
                      <p className="font-bold text-sm text-[#1A1C23] max-w-[80%]">{entry.action}</p>
                      <span className={`text-[9px] px-2 py-1 rounded-md font-black uppercase tracking-wider ${entry.channel === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{entry.channel}</span>
                    </div>
                    <p className="text-[11px] font-bold text-gray-400 mt-2 uppercase tracking-wider">{entry.vendorName} • {formatTimelineDate(entry.date)}</p>
                  </div>
                ))}
                {platformActivityTimeline.length === 0 && <p className="p-10 text-center text-gray-400 font-bold uppercase tracking-widest">No activity logs recorded.</p>}
              </div>
            </div>
          ) : activeTab === 'history' ? (
            <div className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
              <div className="p-5 border-b bg-gray-50 flex items-center justify-between">
                <h2 className="text-xl font-black text-[#1A1C23]">Audit Trail</h2>
                <button onClick={fetchAuditLogs} className="text-xs font-bold uppercase tracking-wider bg-gray-100 px-4 py-2 rounded-lg">Refresh</button>
              </div>
              <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
                {loadingAuditLogs ? (
                  <p className="text-sm text-gray-400">Loading audit logs...</p>
                ) : auditLogs.length ? auditLogs.map((log) => (
                  <div key={log.id} className="border border-gray-200 rounded-xl p-4 bg-white">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div>
                        <p className="text-sm font-black text-[#1A1C23]">{log.userRole || 'Unknown'} • {log.method} {log.path}</p>
                        <p className="text-xs text-gray-500">{formatTimelineDate(log.timestamp)}</p>
                      </div>
                      <div className="flex flex-col items-end">
                        <button onClick={() => undoAuditAction(log.id)} disabled={restoringAuditId === log.id} className="bg-red-600 text-white px-4 py-2 rounded-lg text-xs font-black uppercase disabled:opacity-50">
                          {restoringAuditId === log.id ? 'Undoing...' : 'Undo'}
                        </button>
                        <p className="text-xs text-gray-400 mt-2 text-right">Reverts the selected item or collection to a previous historical state.</p>
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="text-sm text-gray-400">No audit logs found.</p>
                )}
              </div>
            </div>
          ) : activeTab === 'promote' ? (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                <h3 className="text-sm font-black text-emerald-800 uppercase tracking-wider mb-3">Onboard Vendor</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input value={onboardVendorName} onChange={(e) => setOnboardVendorName(e.target.value)} placeholder="Vendor's Name" className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-emerald-500 outline-none cursor-text select-text" />
                  <input value={botNumber} onChange={(e) => setBotNumber(e.target.value)} placeholder="Your Admin Bot Number" className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-emerald-500 outline-none cursor-text select-text" />
                  <button onClick={generateOnboardingLink} className="bg-emerald-600 text-white px-4 py-3 rounded-[8px] font-bold hover:bg-emerald-700 transition-colors">Generate & Copy Link</button>
                </div>
                <div className="mt-3 p-3 rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-900 text-xs">
                  Generates a pre-formatted WhatsApp onboarding link for vendors and copies a shortened version to your clipboard.
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="font-black text-[#1A1C23] mb-3">Tutorial Video Manager</h3>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                  <input
                    value={tutorialVideoUrl}
                    onChange={(e) => setTutorialVideoUrl(e.target.value)}
                    placeholder="Paste YouTube link"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-text select-text"
                  />
                  <button
                    onClick={saveTutorialVideo}
                    disabled={savingTutorialVideo}
                    className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingTutorialVideo ? 'Saving...' : 'Save Video'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-2">Update the tutorial video shown to all vendors on their tips page.</p>
              </div>
            </div>
          ) : activeTab === 'maintenance' ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-xl font-black text-[#1A1C23] mb-2">System Maintenance</h2>
              <p className="text-sm text-gray-500 mb-4">Restore backup snapshots from local JSON or Google Drive versions using Safe Restore auto-save.</p>
              <div className="mb-5 flex gap-3 flex-wrap">
                <label className="inline-flex items-center gap-2 bg-[#1A1C23] text-white px-4 py-2 rounded-lg font-bold text-sm cursor-pointer hover:bg-black">
                  {uploadRestoreLoading ? 'Uploading...' : 'Upload & Safe Restore from Local JSON'}
                  <input type="file" accept="application/json,.json" className="hidden" onChange={uploadAndRestoreLocalBackup} disabled={uploadRestoreLoading} />
                </label>
                <button onClick={runRetroactiveCleanup} className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-emerald-700">🧹 Run Retroactive Cleanup</button>
                <button onClick={forceBuildProductCache} className="bg-purple-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-purple-700">🏗️ Force Build Product Cache</button>
              </div>
              <div className="mb-5 border border-indigo-200 rounded-2xl p-4 bg-indigo-50">
                <h3 className="text-sm font-black uppercase tracking-wider text-indigo-700 mb-2">Tiny Link Controls (All Vendors)</h3>
                <p className="text-xs text-indigo-700 mb-3">
                  Apply both controls globally: <span className="font-black">Use Tiny links as primary</span> and <span className="font-black">Let vendor see both Tiny + normal links</span>.
                </p>
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
                    <input
                      type="checkbox"
                      checked={bulkTinbrUseTinyChecked}
                      onChange={(event) => setBulkTinbrUseTinyChecked(event.target.checked)}
                      disabled={bulkTinbrSaving}
                      className="h-4 w-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Use Tiny links as primary
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
                    <input
                      type="checkbox"
                      checked={bulkTinbrShowBothChecked}
                      onChange={(event) => setBulkTinbrShowBothChecked(event.target.checked)}
                      disabled={bulkTinbrSaving}
                      className="h-4 w-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Let vendor see both Tiny + normal links
                  </label>
                </div>
                <p className="text-[11px] text-indigo-800 mt-3">
                  Applies directly to all vendors immediately.
                </p>
                <div className="flex flex-wrap gap-3 mt-4">
                  <button
                    onClick={() => applyTinbrControlsToAllVendors(bulkTinbrUseTinyChecked, bulkTinbrShowBothChecked)}
                    disabled={bulkTinbrSaving}
                    className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {bulkTinbrSaving ? 'Saving...' : 'Apply to All Vendors'}
                  </button>
                  <button
                    onClick={() => {
                      setBulkTinbrUseTinyChecked(false);
                      setBulkTinbrShowBothChecked(false);
                    }}
                    disabled={bulkTinbrSaving}
                    className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    Uncheck Both
                  </button>
                </div>
              </div>
              <div className="mb-5 border border-red-200 rounded-2xl p-4 bg-red-50">
                <h3 className="text-sm font-black uppercase tracking-wider text-red-700 mb-2">Danger Zone: Nuke All Live Data</h3>
                <p className="text-xs text-red-700 mb-3">
                  This permanently clears Scrapebot + Auto Responder operational collections from Firebase containers. Type <span className="font-black">NUKE EVERYTHING</span> to enable the button.
                </p>
                <div className="text-[11px] text-red-800 bg-white border border-red-200 rounded-lg p-3 mb-3 space-y-1">
                  <p className="font-black uppercase tracking-wider">Impact summary:</p>
                  <p>This wipes operational live data used by the bot and storefront flows while preserving core control/config records required to boot the system safely.</p>
                </div>
                <div className="flex flex-col md:flex-row gap-3">
                  <input
                    value={nukeEverythingConfirmText}
                    onChange={(e) => setNukeEverythingConfirmText(e.target.value)}
                    placeholder="Type: NUKE EVERYTHING"
                    className="flex-1 px-4 py-2.5 rounded-xl border border-red-300 bg-white text-sm font-semibold outline-none focus:ring-2 focus:ring-red-300"
                  />
                  <button
                    onClick={handleNukeEverything}
                    disabled={nukingEverything || nukeEverythingConfirmText.trim().toUpperCase() !== 'NUKE EVERYTHING'}
                    className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {nukingEverything ? 'Nuking Live Data...' : 'Nuke All Data Now'}
                  </button>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-black uppercase tracking-wider text-gray-600">Cloud Backups (Drive)</h3>
                  <button onClick={fetchDriveBackups} className="text-xs font-bold px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200">Refresh</button>
                </div>
                {loadingDriveBackups ? (
                  <p className="text-sm text-gray-400">Loading cloud backups...</p>
                ) : driveBackups.length ? (
                  <div className="space-y-2">
                    {driveBackups.map((file) => (
                      <div key={file.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border border-gray-100 rounded-lg p-3">
                        <div>
                          <p className="text-sm font-bold text-[#1A1C23]">{file.name}</p>
                          <p className="text-xs text-gray-500">{file.createdTime ? new Date(file.createdTime).toLocaleString() : 'Unknown time'}</p>
                        </div>
                        <button
                          onClick={() => restoreDriveBackup(file.id)}
                          disabled={restoringDriveId === file.id}
                          className="bg-red-600 text-white px-4 py-2 rounded-lg text-xs font-black uppercase hover:bg-red-700 disabled:opacity-50"
                        >
                          {restoringDriveId === file.id ? 'Restoring...' : 'Safe Restore'}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">No Drive backups found.</p>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex flex-col xl:flex-row gap-4 mb-6">
                <div className="flex-1 relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                  <input type="text" placeholder="Search for a WhatsApp Vendor..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-12 pr-4 py-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm font-medium cursor-text select-text" />
                </div>
                <div className="flex gap-3 flex-wrap items-center">
                  <button onClick={() => bulkUpdateStatus('suspended')} disabled={!selectedVendorIds.length || bulkUpdating} className="bg-red-600 text-white px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-red-700 disabled:opacity-50 shadow-md transition-all">Suspend</button>
                  <button onClick={() => bulkUpdateStatus('active')} disabled={!selectedVendorIds.length || bulkUpdating} className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 shadow-md transition-all">Activate</button>
                  <input value={bulkMetaDataValue} onChange={(e) => setBulkMetaDataValue(e.target.value)} placeholder="Meta Data" className="px-3 py-2 rounded-xl border border-gray-200 bg-white/80 text-xs font-semibold cursor-text select-text" />
                  <button onClick={bulkAssignMetaData} disabled={!selectedVendorIds.length || bulkUpdating} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-blue-700 disabled:opacity-50 shadow-md transition-all">Assign Meta Data</button>
                  <button onClick={handleExport} className="bg-gray-800 text-white px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-black shadow-md transition-all">Export</button>
                </div>
              </div>
              {selectedVendorIds.length > 0 && (
                <div className="sticky bottom-4 z-20 bg-[#1A1C23] text-white px-4 py-3 rounded-xl shadow-lg mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-bold">{selectedVendorIds.length} vendors selected</p>
                  <div className="flex flex-col">
                    <button onClick={openBulkEdit} className="bg-blue-600 px-4 py-2 rounded-lg text-xs font-black uppercase">Bulk Edit</button>
                    <p className="text-xs text-gray-400 mt-2">Updates condition, category, or price for all selected items instantly.</p>
                  </div>
                </div>
              )}
              {/* Vendor Directory */}
              <div className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr className="text-gray-400 text-[11px] font-black uppercase tracking-widest">
                      <th className="p-4 pl-6 w-[50px]"><input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-gray-300 cursor-pointer" /></th>
                      <th className="p-4">Vendor Name</th>
                      <th className="p-4">Status</th>
                      <th className="hidden md:table-cell p-4">View</th>
                      <th className="hidden md:table-cell p-4">Access Details</th>
                      <th className="hidden md:table-cell p-4">Monetization</th>
                      <th className="hidden md:table-cell p-4">Total Inventory</th>
                      <th className="p-4">Action</th>
                      <th className="hidden md:table-cell p-4 pr-6">Contact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {Object.entries(groupedPaginatedOffline).map(([metaDataGroup, vendors]) => (
                      <React.Fragment key={metaDataGroup}>
                        <tr className="bg-gray-50/80">
                          <td colSpan={9} className="px-6 py-2 text-[11px] font-black uppercase tracking-wider text-gray-500">{metaDataGroup}</td>
                        </tr>
                        {vendors.map((vendor) => (
                      <tr key={vendor.docId} className="hover:bg-blue-50/30 transition-colors">
                        <td className="p-4 pl-6"><input type="checkbox" checked={selectedVendorIds.includes(vendor.docId)} onChange={() => toggleVendor(vendor.docId)} className="w-4 h-4 rounded border-gray-300 cursor-pointer" /></td>
                        <td className="p-4 font-bold text-blue-600 hover:text-blue-800"><Link to={vendor.shareableLink} target="_blank" rel="noopener noreferrer">{vendor.vendorName}</Link></td>
                        <td className="p-4">
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${vendor.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{vendor.status}</span>
                        </td>
                        <td className="hidden md:table-cell p-4 text-xs font-bold text-gray-500 space-y-1">
                          <p>👁️ {vendor.viewCount} Views</p>
                          <p className="hidden md:block">🔗 {vendor.whatsappClicks} Clicks</p>
                        </td>
                        <td className="hidden md:table-cell p-4 text-[11px] text-gray-600 space-y-1">
                          <p><span className="font-black uppercase text-[9px] text-gray-400 mr-1">Pass:</span><span className="font-mono">{vendor.vendorPassword || 'N/A'}</span></p>
                          <p><span className="font-black uppercase text-[9px] text-gray-400 mr-1">WA:</span>{vendor.storeWhatsappNumber || 'N/A'}</p>
                        </td>
                        <td className="hidden md:table-cell p-4">
                          <button
                            onClick={() => toggleAdvancedTools(vendor)}
                            disabled={togglingAdvancedVendorId === vendor.docId}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${vendor.advancedEnabled ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'} disabled:opacity-50`}
                          >
                            {togglingAdvancedVendorId === vendor.docId ? '...' : vendor.advancedEnabled ? 'AI Enabled' : 'AI Locked'}
                          </button>
                        </td>
                        <td className="hidden md:table-cell p-4"><span className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full text-[11px] font-bold">{vendor.totalProducts} Items</span></td>
                        <td className="p-4"><Link to={vendor.shareableLink} target="_blank" rel="noopener noreferrer" className="inline-block bg-[#1A1C23] text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-black transition-all shadow-sm">Manage</Link></td>
                        <td className="hidden md:table-cell p-4 pr-6">
                          <button onClick={() => openChatForVendor(vendor)} className="p-2.5 rounded-xl bg-blue-100 text-blue-600 hover:bg-blue-600 hover:text-white transition-all shadow-sm relative group">
                            <IoMdChatboxes className="w-5 h-5" />
                            {allMessages.some(m => m.vendorId === vendor.vendorId && m.sender === 'vendor' && !m.readByAdmin) && (
                              <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
                            )}
                          </button>
                        </td>
                      </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                {filteredOffline.length === 0 && <div className="p-20 text-center text-gray-400 font-bold uppercase tracking-widest">No vendors found.</div>}
                {filteredOffline.length > 0 && (
                  <div className="flex items-center justify-between px-6 py-4 border-t border-white/20 bg-white/50">
                    <p className="text-xs font-semibold text-gray-600">Page {currentPage} of {totalPages} • Showing {paginatedOffline.length} of {filteredOffline.length} vendors</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="px-4 py-2 rounded-xl text-xs font-black uppercase border border-white/20 bg-white/80 disabled:opacity-40"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="px-4 py-2 rounded-xl text-xs font-black uppercase border border-white/20 bg-white/80 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <Outlet />
      )}
      {bulkEditOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="p-5 border-b bg-gray-50 flex items-center justify-between">
              <h3 className="text-lg font-black text-[#1A1C23]">Bulk Edit Products</h3>
              <button onClick={() => setBulkEditOpen(false)} className="text-gray-400 hover:text-red-500 text-xl">✕</button>
            </div>
            <div className="p-5 grid grid-cols-1 gap-3">
              <input value={bulkCondition} onChange={(e) => setBulkCondition(e.target.value)} placeholder="Condition (e.g. Used)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-text select-text" />
              <input value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} placeholder="Category (e.g. Smartphones)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-text select-text" />
              <input value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} placeholder="Price (e.g. ₦350,000)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-text select-text" />
            </div>
            <div className="p-5 border-t bg-gray-50 flex justify-end gap-3">
              <button onClick={() => setBulkEditOpen(false)} className="px-4 py-2 rounded-lg border border-gray-200 font-bold text-gray-600">Cancel</button>
              <button onClick={runBulkEdit} disabled={bulkEditLoading} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-black uppercase disabled:opacity-50">
                {bulkEditLoading ? 'Applying...' : 'Apply Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Global Notification Modal */}
      {notificationOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
              <h3 className="text-xl font-black text-[#1A1C23]">Vendor Messages</h3>
              <button onClick={() => setNotificationOpen(false)} className="text-gray-400 hover:text-red-500 font-bold text-xl transition-colors">✕</button>
            </div>
            <div className="p-6 max-h-[65vh] overflow-y-auto bg-gray-100 space-y-4">
              {unreadMessages.length > 0 ? unreadMessages.map((message) => (
                <div key={message.id} className="border border-blue-100 rounded-xl p-4 bg-white shadow-sm relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>
                  <div className="flex justify-between items-start mb-2">
                    <p className="text-sm font-black text-[#1A1C23]">{message.vendorId}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">{formatTimelineDate(message.timestamp)}</p>
                  </div>
                  <p className="text-sm text-gray-700 font-medium cursor-text select-text">{message.text}</p>
                  <button 
                    onClick={() => {
                      setNotificationOpen(false);
                      const vendor = offlineVendors.find(v => v.vendorId === message.vendorId);
                      if(vendor) openChatForVendor(vendor);
                    }} 
                    className="mt-3 text-xs font-bold text-blue-600 hover:text-blue-800 uppercase tracking-widest"
                  >
                    Reply to Vendor &rarr;
                  </button>
                </div>
              )) : (
                <div className="text-center py-10">
                  <span className="text-5xl block mb-4 grayscale opacity-50">📭</span>
                  <p className="text-gray-400 font-bold uppercase tracking-widest">Inbox is zero.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Admin-to-Vendor Chat Modal */}
      {chatOpen && chatVendor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col h-[50vh] md:h-[600px] animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-black text-[#1A1C23]">Chat: {chatVendor.vendorName}</h3>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">ID: {chatVendor.vendorId}</p>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-red-500 font-bold text-xl transition-colors">✕</button>
            </div>
            <div className="p-5 flex-1 overflow-y-auto bg-gray-100 space-y-4 custom-scrollbar">
              {chatMessages.length > 0 ? chatMessages.map((message) => {
                const mine = isAdmin ? message.sender === 'admin' : message.sender === 'vendor';
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-sm ${mine ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'}`}>
                      <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${mine ? 'text-blue-200' : 'text-gray-400'}`}>{mine ? 'You (Admin)' : chatVendor.vendorName}</p>
                      <p className="text-sm whitespace-pre-wrap font-medium leading-relaxed cursor-text select-text">{message.text}</p>
                      <p className={`text-[9px] font-bold mt-2 ${mine ? 'text-right text-blue-300' : 'text-left text-gray-400'}`}>{formatTimelineDate(message.timestamp)}</p>
                    </div>
                  </div>
                );
              }) : (
                 <div className="h-full flex flex-col items-center justify-center text-gray-400">
                  <span className="text-4xl mb-3">💬</span>
                  <p className="font-bold text-sm uppercase tracking-widest">Start the conversation</p>
                </div>
              )}
            </div>
            <div className="p-5 border-t bg-white flex gap-3">
              <textarea 
                value={chatInput} 
                onChange={(e) => setChatInput(e.target.value)} 
                className="flex-1 border border-gray-200 rounded-xl p-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none resize-none shadow-sm cursor-text select-text" 
                placeholder="Type your reply to the vendor..." 
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendAdminChat();
                  }
                }}
              />
              <button 
                onClick={sendAdminChat} 
                disabled={sendingChat || !chatInput.trim()} 
                className="bg-[#1A1C23] text-white px-8 rounded-xl font-black uppercase tracking-wider disabled:opacity-50 hover:bg-black transition-all shadow-md"
              >
                {sendingChat ? '...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminDashboardLayout>
  );
};
export default AdminDashboard;
