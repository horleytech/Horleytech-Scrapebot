import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { collection, getDocs, doc, writeBatch, query, orderBy, updateDoc, setDoc, getDoc } from 'firebase/firestore';
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
const MASTER_DICTIONARY_STORAGE_KEY = 'admin-master-dictionary-v1';
const FALLBACK_MASTER_DICTIONARY_CSV = 'https://example.com/master-dictionary.csv';
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

const normalizeDictionaryKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const normalizeGoogleSheetCsvUrl = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  if (!raw.includes('docs.google.com/spreadsheets')) return raw;
  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const editIndex = segments.findIndex((segment) => segment === 'edit');
    if (editIndex !== -1) {
      segments[editIndex] = 'export';
      parsed.pathname = `/${segments.join('/')}`;
    }
    parsed.searchParams.set('format', 'csv');
    return parsed.toString();
  } catch {
    return raw.replace('/edit', '/export').replace(/\?.*$/, '?format=csv');
  }
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

const parseMasterDictionaryCsv = (csvText = '') => {
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

const smartMapDevice = (rawString, officialTargets = [], customMappings = {}) => {
  const original = String(rawString || '').trim();
  if (!original) {
    return {
      standardName: 'Unknown Device',
      condition: 'Unknown',
      sim: 'Unknown',
      isOthers: true,
      aiRequired: true,
    };
  }

  const mappingKey = normalizeDictionaryKey(original);
  const mappingEntry = customMappings?.[mappingKey];
  const mappedSeed = typeof mappingEntry === 'object'
    ? (mappingEntry.standardName || mappingEntry.deviceType || original)
    : (mappingEntry || original);

  const normalizedRaw = String(mappedSeed || '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/\bpm\b/g, ' pro max ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const samsungSuffixGuard = (targetNormalized) => {
    const samsungBaseMatch = targetNormalized.match(/\b(?:samsung\s+galaxy\s+|galaxy\s+|samsung\s+)?s(\d{1,3})\b/);
    if (!samsungBaseMatch) return true;
    const modelToken = `s${samsungBaseMatch[1]}`;
    const hasExactBase = new RegExp(`\\b${modelToken}\\b`, 'i').test(normalizedRaw)
      || new RegExp(`\\b(?:samsung\\s+|galaxy\\s+|samsung\\s+galaxy\\s+)${modelToken}\\b`, 'i').test(normalizedRaw);
    if (!hasExactBase) return false;

    const targetHasUltra = /\bultra\b/.test(targetNormalized);
    const targetHasPlus = /\bplus\b/.test(targetNormalized);
    const rawHasUltra = /\bultra\b/.test(normalizedRaw);
    const rawHasPlus = /\bplus\b/.test(normalizedRaw);

    if (!targetHasUltra && rawHasUltra) return false;
    if (!targetHasPlus && rawHasPlus) return false;
    return true;
  };

  const normalizedTargets = officialTargets
    .map((target) => ({
      raw: target,
      normalized: String(target || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter((target) => target.normalized);

  const exact = normalizedTargets.find((target) => normalizedRaw === target.normalized);
  const standardName = exact?.raw || normalizedTargets
    .filter((target) => normalizedRaw.includes(target.normalized) && samsungSuffixGuard(target.normalized))
    .sort((a, b) => b.normalized.length - a.normalized.length)[0]?.raw || mappedSeed;

  const normalizedStandardName = String(standardName || '').trim();
  const laptopSpecs = extractLaptopSpecs(original);

  const result = {
    standardName: normalizedStandardName || 'Unknown Device',
    condition: 'Unknown',
    sim: 'Unknown',
    isOthers: false,
    aiRequired: false,
    laptopSpecs,
  };

  result.condition = standardizeCondition(original);
  result.sim = normalizeSimType(original);

  if (result.standardName === 'Unknown Device' || result.condition === 'Unknown') {
    result.isOthers = true;
    result.aiRequired = true;
  }

  return result;
};

const getConditionRank = (condition) => {
  const standardized = standardizeCondition(condition);
  if (standardized === 'Brand New') return 0;
  if (standardized === 'Grade A UK Used') return 1;
  return 2;
};


const extractDeviceVersion = (deviceType) => {
  const matches = String(deviceType || '').match(/\d+(?:\.\d+)?/g);
  if (!matches?.length) return -1;
  return Math.max(...matches.map((entry) => Number(entry) || 0));
};

const getDeviceTierWeight = (deviceType) => {
  const normalized = String(deviceType || '').toLowerCase();
  if (normalized.includes('pro max')) return 3;
  if (normalized.includes('pro')) return 2;
  if (normalized.includes('plus')) return 1;
  return 0;
};

const getSimRank = (specification) => {
  const normalized = String(specification || '').toLowerCase();
  if (normalized.includes('dual sim') || normalized.includes('physical sim+esim') || (normalized.includes('physical sim') && normalized.includes('esim'))) return 0;
  if (normalized.includes('physical sim')) return 1;
  if (normalized.includes('esim')) return 2;
  if (normalized.includes('locked') || normalized.includes('wi-fi only') || normalized.includes('wifi only')) return 3;
  return 4;
};

const getStorageRank = (storage) => {
  const normalized = String(storage || '').toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(tb|gb)/);
  if (!match) return -1;
  const value = Number(match[1]) || 0;
  const unit = match[2];
  return unit === 'tb' ? value * 1024 : value;
};

const standardizeCondition = (raw) => {
  const normalized = String(raw || '').toLowerCase();
  if (/(used|open\s*box|uk)/i.test(normalized)) return 'Grade A UK Used';
  if (/(new|pristine|sealed)/i.test(normalized)) return 'Brand New';
  return 'Unknown';
};

const normalizeSimType = (raw) => {
  const normalized = String(raw || '').toLowerCase();
  const hasEsim = /\besim\b/i.test(normalized);
  const hasPhysical = /\bphysical\b/i.test(normalized);
  const hasDual = /\bdual\b/i.test(normalized);

  if ((hasPhysical && hasEsim) || hasDual) return 'Physical SIM + ESIM';
  if (hasEsim) return 'ESIM';
  if (hasPhysical) return 'Physical SIM';
  return 'Unknown';
};

const inferBrandSubCategory = (deviceType) => {
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

const AdminDashboard = () => {
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
  const [isResolvingAI, setIsResolvingAI] = useState(false);
  const queueRef = useRef([]);
  const [bulkMetaDataValue, setBulkMetaDataValue] = useState('Electronics');
  const [globalProductsCacheRows, setGlobalProductsCacheRows] = useState([]);
  const [syncingDictionary, setSyncingDictionary] = useState(false);
  const [companyCsvUrl, setCompanyCsvUrl] = useState(FALLBACK_COMPANY_PRICING_CSV);
  const [loadingCompanyCsv, setLoadingCompanyCsv] = useState(false);
  const [companyCsvRows, setCompanyCsvRows] = useState([]);
  const [savedPricingSessions, setSavedPricingSessions] = useState([]);
  const [expandedVariationCounts, setExpandedVariationCounts] = useState({});
  const [pricingVendor, setPricingVendor] = useState('All');
  const [marginType, setMarginType] = useState('amount');
  const [marginValue, setMarginValue] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
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

  useEffect(() => {
    if (location.pathname === '/dashboard' || location.pathname === '/dashboard/') {
      fetchInventory();
      fetchBackups();
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
    try {
      const cached = localStorage.getItem(MASTER_DICTIONARY_STORAGE_KEY);
      if (!cached) return;
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        setMasterDictionary(parsed.dictionary || parsed);
        setOfficialTargets(Array.isArray(parsed.officialTargets) ? parsed.officialTargets : []);
      }
    } catch (error) {
      console.error('Failed to load cached master dictionary:', error);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('admin-pricing-sessions-v1') || '[]');
      if (Array.isArray(saved)) setSavedPricingSessions(saved);
    } catch (error) {
      console.error('Failed to load pricing sessions:', error);
    }
  }, []);

  useEffect(() => {
    const loadGlobalCache = async () => {
      try {
        const cacheRef = doc(db, 'horleyTech_Settings', 'globalProductsCache');
        const snapshot = await getDoc(cacheRef);
        if (!snapshot.exists()) return;

        const metadata = snapshot.data() || {};
        const totalChunks = Number(metadata.totalChunks || 0);

        if (totalChunks > 0) {
          const chunkDocs = await Promise.all(
            Array.from({ length: totalChunks }, (_, index) => getDoc(doc(db, 'horleyTech_Settings', `cache_chunk_${index}`)))
          );
          const flattenedRows = chunkDocs.flatMap((chunkSnap) => (Array.isArray(chunkSnap.data()?.products) ? chunkSnap.data().products : []));
          setGlobalProductsCacheRows(flattenedRows);
          if (Array.isArray(metadata.officialTargets)) setOfficialTargets(metadata.officialTargets);
          return;
        }

        const rows = metadata.products;
        if (Array.isArray(rows)) setGlobalProductsCacheRows(rows);
      } catch (error) {
        console.error('Failed to load global products cache:', error);
      }
    };

    loadGlobalCache();
  }, []);

  const syncMasterDictionary = async () => {
    const csvUrl = normalizeGoogleSheetCsvUrl(import.meta.env.VITE_MASTER_DICTIONARY_CSV || FALLBACK_MASTER_DICTIONARY_CSV);
    setSyncingDictionary(true);

    try {
      const response = await fetch(csvUrl, { headers: { Accept: 'text/csv,text/plain,*/*' } });
      if (!response.ok) throw new Error(`Unable to fetch CSV (${response.status})`);

      const csvText = await response.text();
      const parsed = parseMasterDictionaryCsv(csvText);
      setMasterDictionary(parsed.dictionary);
      setOfficialTargets(parsed.officialTargets);
      localStorage.setItem(MASTER_DICTIONARY_STORAGE_KEY, JSON.stringify(parsed));

      const mappedRows = [];
      offlineVendors.forEach((vendor) => {
        (vendor.products || []).forEach((product, index) => {
          const rawDeviceType = (product['Device Type'] || 'Unknown Device').trim() || 'Unknown Device';
          const rawDescriptor = `${rawDeviceType} ${product.Condition || ''} ${product['SIM Type/Model/Processor'] || ''}`.trim();
          const mappedResult = smartMapDevice(rawDescriptor, parsed.officialTargets, parsed.dictionary);
          const smartMappedDeviceType = mappedResult.standardName;
          const productDate = product.DatePosted || vendor.lastUpdated;
          const category = (product.Category || 'Others').trim() || 'Others';
          const rawCondition = mappedResult.condition;
          const cleanStatus = rawCondition === 'Unknown' ? 'unclean' : 'clean';
          const normalizedSim = mappedResult.sim;
          const storage = (product['Storage Capacity/Configuration'] || 'N/A').trim() || 'N/A';

          mappedRows.push({
            id: `${vendor.docId}-${index}-${smartMappedDeviceType}`,
            vendorName: vendor.vendorName,
            vendorLink: vendor.shareableLink,
            date: productDate || 'N/A',
            category,
            brandSubCategory: inferBrandSubCategory(smartMappedDeviceType),
            series: inferSeries(smartMappedDeviceType),
            deviceType: smartMappedDeviceType,
            condition: rawCondition,
            cleanStatus,
            simType: normalizedSim,
            storage,
            price: product['Regular price'] || 'N/A',
            priceValue: parseNairaValue(product['Regular price']),
          });
        });
      });

      const cacheRef = doc(db, 'horleyTech_Settings', 'globalProductsCache');
      const chunkSize = 1500;
      const chunks = [];
      for (let i = 0; i < mappedRows.length; i += chunkSize) {
        chunks.push(mappedRows.slice(i, i + chunkSize));
      }

      await Promise.all(
        chunks.map((chunk, index) => setDoc(doc(db, 'horleyTech_Settings', `cache_chunk_${index}`), {
          products: chunk,
          chunkIndex: index,
          syncedAt: new Date().toISOString(),
        }, { merge: true }))
      );

      await setDoc(cacheRef, {
        cache_metadata: true,
        syncedAt: new Date().toISOString(),
        totalItems: mappedRows.length,
        totalChunks: chunks.length,
        officialTargets: parsed.officialTargets,
      }, { merge: true });

      setGlobalProductsCacheRows(mappedRows);

      alert(`✅ Synced ${Object.keys(parsed.dictionary).length} dictionary mappings and cached ${mappedRows.length} products.`);
    } catch (error) {
      console.error('Master dictionary sync failed:', error);
      alert(`❌ Failed to sync dictionary: ${error.message}`);
    } finally {
      setSyncingDictionary(false);
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

    const rows = [];
    const sourceRows = offlineVendors.flatMap((vendor) => (vendor.products || []).map((product, index) => ({ vendor, product, index })));

    if (!offlineVendors.length && globalProductsCacheRows.length) {
      globalProductsCacheRows.forEach((row, index) => {
        if (selectedVendorFilter !== 'All' && row.vendorName !== selectedVendorFilter) return;
        if (!isWithinDateRange(row.date, startDate, endDate)) return;

        const haystack = [row.category, row.deviceType, row.condition, row.simType, row.storage].join(' ').toLowerCase();
        const isExcluded = excludedTokens.some((phrase) => haystack.includes(phrase));
        const cleanStatus = isExcluded ? 'excluded' : row.cleanStatus;
        if (dataViewMode !== 'all' && cleanStatus !== dataViewMode) return;

        rows.push({ ...row, id: row.id || `cache-${index}`, cleanStatus });
      });
      return rows;
    }

    sourceRows.forEach(({ vendor, product, index }) => {
      if (selectedVendorFilter !== 'All' && vendor.vendorName !== selectedVendorFilter) return;
      const productDate = product.DatePosted || vendor.lastUpdated;
      if (!isWithinDateRange(productDate, startDate, endDate)) return;

      const rawDeviceType = (product['Device Type'] || 'Unknown Device').trim() || 'Unknown Device';
      const rawDescriptor = `${rawDeviceType} ${product.Condition || ''} ${product['SIM Type/Model/Processor'] || ''}`.trim();
      const mappedResult = smartMapDevice(rawDescriptor, officialTargets, masterDictionary);
      const mappedDeviceType = mappedResult.standardName;
      const rawCondition = mappedResult.condition;
      const normalizedSim = mappedResult.sim;
      const storage = (product['Storage Capacity/Configuration'] || 'N/A').trim() || 'N/A';
      const category = (product.Category || 'Others').trim() || 'Others';
      const brandSubCategory = inferBrandSubCategory(mappedDeviceType);
      const series = inferSeries(mappedDeviceType);

      const haystack = [
        product.Category,
        rawDeviceType,
        mappedDeviceType,
        product.Condition,
        product['SIM Type/Model/Processor'],
        product['Storage Capacity/Configuration'],
      ].join(' ').toLowerCase();

      const isExcluded = excludedTokens.some((phrase) => haystack.includes(phrase));
      const cleanStatus = isExcluded ? 'excluded' : ((rawCondition === 'Unknown' || mappedResult.aiRequired) ? 'unclean' : 'clean');

      if (dataViewMode !== 'all' && cleanStatus !== dataViewMode) return;

      rows.push({
        id: `${vendor.docId}-${index}-${mappedDeviceType}`,
        vendorName: vendor.vendorName,
        vendorLink: vendor.shareableLink,
        date: productDate || 'N/A',
        category,
        brandSubCategory,
        series,
        deviceType: mappedDeviceType,
        condition: rawCondition,
        cleanStatus,
        simType: normalizedSim,
        storage,
        price: product['Regular price'] || 'N/A',
        priceValue: parseNairaValue(product['Regular price']),
      });
    });

    return rows;
  }, [offlineVendors, globalProductsCacheRows, startDate, endDate, masterDictionary, officialTargets, selectedVendorFilter, dataViewMode, excludedPhrases]);


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

      const variationKey = `${row.condition}__${row.simType}__${row.storage}`;
      tree[row.category][row.brandSubCategory][row.series][row.deviceType][variationKey] ??= {
        condition: row.condition,
        simType: row.simType,
        storage: row.storage,
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
      keys.add(`variation:${row.category}__${row.brand}__${row.series}__${row.deviceType}__${row.condition}__${row.simType}__${row.storage}`);
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
      const res = await fetch(normalizedUrl, { headers: { Accept: 'text/csv,text/plain,*/*' } });
      if (!res.ok) throw new Error(`Unable to fetch company CSV (${res.status})`);
      const csvText = await res.text();
      const lines = csvText.split(/\r?\n/).filter(Boolean);
      if (!lines.length) {
        setCompanyCsvRows([]);
        return;
      }
      const headers = parseCsvLine(lines[0]).map((header) => String(header || '').replace(/^\uFEFF/, '').trim());
      const parsedRows = lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        return headers.reduce((acc, header, index) => {
          acc[header] = values[index] || '';
          return acc;
        }, {});
      }).filter((row) => Object.values(row).some((value) => String(value || '').trim()));
      setCompanyCsvRows(parsedRows);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setLoadingCompanyCsv(false);
    }
  };

  const runTwoLayerAIJudge = async () => {
    const candidates = normalizedProductRows.filter((row) => row.cleanStatus !== 'clean' || row.deviceType === 'Unknown Device');
    if (!candidates.length) {
      alert('No unclean rows detected for AI judge.');
      return;
    }

    setIsResolvingAI(true);
    try {
      const payload = candidates.map((row) => ({ raw: `${row.deviceType} ${row.condition} ${row.simType} ${row.storage}`.trim() }));
      const response = await fetch(`${BASE_URL}/api/admin/extract-detailed-schema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-user-role': 'admin' },
        body: JSON.stringify({ rows: payload }),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) throw new Error(data?.error || 'AI judge failed');

      const mergedMappings = {};
      data.forEach((item) => {
        const raw = String(item?.raw || '').trim();
        if (!raw) return;
        const key = normalizeDictionaryKey(raw);
        mergedMappings[key] = {
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

      if (Object.keys(mergedMappings).length) {
        setMasterDictionary((prev) => ({ ...prev, ...mergedMappings }));
        localStorage.setItem(MASTER_DICTIONARY_STORAGE_KEY, JSON.stringify({
          dictionary: { ...masterDictionary, ...mergedMappings },
          officialTargets,
        }));
        await setDoc(doc(db, 'horleyTech_Settings', 'customMappings'), {
          mappings: mergedMappings,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      alert(`✅ Two-Layer AI Judge processed ${data.length} records.`);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setIsResolvingAI(false);
    }
  };

  const pricingResults = useMemo(() => {
    const margin = Number(marginValue) || 0;
    const vendorRows = normalizedProductRows.filter((row) => row.vendorName === pricingVendor);

    return companyCsvRows.reduce((acc, row) => {
      const companyDevice = getCsvValueByAliases(row, ['Device Type', 'device', 'product', 'model']);
      const companyCondition = getCsvValueByAliases(row, ['Condition']) || 'Unknown';
      const companySim = getCsvValueByAliases(row, ['SIM Type/Model/Processor', 'sim type', 'model']);
      const companyRawDescriptor = `${companyDevice} ${companyCondition} ${companySim}`.trim();
      const mappedResult = smartMapDevice(companyRawDescriptor, officialTargets);
      const mappedDevice = mappedResult.standardName;
      const condition = mappedResult.condition;
      const storage = getCsvValueByAliases(row, ['Storage Capacity/Configuration', 'storage', 'configuration']);
      const simType = mappedResult.sim;
      const companyPriceRaw = getCsvValueByAliases(row, ['Regular price', 'Company Price', 'price']);
      const companyPrice = parseNairaValue(companyPriceRaw);

      const requiresConditionMatch = condition !== 'Unknown';
      const requiresSimMatch = simType !== 'Unknown';

      const vendorMatch = vendorRows
        .filter((item) => item.deviceType === mappedDevice)
        .find((item) => (!storage || item.storage === storage)
          && (!requiresSimMatch || item.simType === simType)
          && (!requiresConditionMatch || item.condition === condition));

      if (!vendorMatch) return acc;

      const vendorPrice = vendorMatch.priceValue;
      const target = marginType === 'percentage' ? Math.round(vendorPrice * (1 + (margin / 100))) : vendorPrice + margin;
      const adjustment = target - companyPrice;
      const adjustmentPercent = companyPrice > 0 ? Math.round((adjustment / companyPrice) * 100) : 0;

      acc.push({
        ...row,
        mappedDevice,
        companyPrice,
        vendorPrice,
        target,
        adjustment,
        adjustmentPercent,
      });
      return acc;
    }, []);
  }, [companyCsvRows, pricingVendor, marginType, marginValue, normalizedProductRows, officialTargets]);

  const exportPricingTxt = () => {
    const lines = pricingResults
      .filter((item) => Number.isFinite(item.companyPrice) && item.companyPrice > 0)
      .map((item) => {
        if (marginType === 'percentage') return `${item.companyPrice}: ${item.adjustmentPercent}%`;
        return `${item.companyPrice}: ${item.adjustment}`;
      });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `pricing-adjustments-${Date.now()}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const savePricingSession = () => {
    if (!pricingResults.length) {
      alert('No pricing result to save.');
      return;
    }
    const session = {
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      pricingVendor,
      marginType,
      marginValue,
      rows: pricingResults,
    };
    const updated = [session, ...savedPricingSessions].slice(0, 20);
    setSavedPricingSessions(updated);
    localStorage.setItem('admin-pricing-sessions-v1', JSON.stringify(updated));
    alert('✅ Pricing session saved.');
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
            <button type="button" onClick={() => setActiveTab('offline')} className="group text-left bg-gradient-to-br from-white to-slate-50 border border-slate-200/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
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
              className="group text-left bg-gradient-to-br from-emerald-50 via-white to-green-50 border border-emerald-200/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all"
            >
              <p className="text-[11px] font-extrabold text-emerald-700 uppercase tracking-[0.15em]">Inventory Value</p>
              <p className="text-[clamp(1.2rem,2.1vw,2rem)] font-black text-emerald-700 mt-3 leading-tight break-words">{formatNaira(analytics.totalInventoryValue)}</p>
              <p className="text-xs text-emerald-600/80 mt-2">~ {formatCompactNaira(analytics.totalInventoryValue)}</p>
            </button>
            <button type="button" onClick={() => setActiveTab('offline')} className="group text-left bg-gradient-to-br from-blue-50 via-white to-indigo-50 border border-blue-200/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
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
              className="group text-left bg-gradient-to-br from-teal-50 via-white to-emerald-50 border border-teal-200/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all"
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
              className="group text-left bg-gradient-to-br from-orange-50 via-white to-amber-50 border border-orange-200/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all"
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
              className="group text-left bg-gradient-to-br from-violet-50 via-white to-purple-50 border border-violet-200/70 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all"
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
                      className="px-4 py-2.5 rounded-xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300"
                    />
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="px-4 py-2.5 rounded-xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300"
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
                    className="px-4 py-2.5 rounded-2xl text-xs font-black border border-gray-100 bg-white/70 backdrop-blur-xl shadow-sm text-gray-700"
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
                    className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300"
                  />
                  <select value={productCategoryFilter} onChange={(e) => setProductCategoryFilter(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300">
                    {uniqueGlobalCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                  <select value={productConditionFilter} onChange={(e) => setProductConditionFilter(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300">
                    {uniqueGlobalConditions.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
                  </select>
                  <input type="text" list="vendor-search-list" value={selectedVendorFilter} onChange={(e) => setSelectedVendorFilter(e.target.value || 'All')} placeholder="Search vendor" className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300" />
                  <select value={dataViewMode} onChange={(e) => setDataViewMode(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300">
                    <option value="all">All</option>
                    <option value="clean">Clean</option>
                    <option value="unclean">Unclean</option>
                    <option value="excluded">Excluded</option>
                  </select>
                  <select value={productSortMode} onChange={(e) => setProductSortMode(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300">
                    <option value="highest_price">Highest Total Price</option>
                    <option value="lowest_price">Lowest Total Price</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
                <input
                  type="text"
                  value={excludedPhrases}
                  onChange={(e) => setExcludedPhrases(e.target.value)}
                  placeholder="Phrases to Exclude (comma separated)"
                  className="lg:col-span-2 px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300" />
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300" />
                </div>
              </div>

              <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white/70 backdrop-blur-xl rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Dictionary Mappings: {Object.keys(masterDictionary).length}</p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={syncMasterDictionary} disabled={syncingDictionary} className="px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider border border-gray-100 bg-white/80 hover:bg-white disabled:opacity-50">{syncingDictionary ? 'Syncing...' : 'Sync Master Dictionary'}</button>
                  <button type="button" onClick={runTwoLayerAIJudge} disabled={isResolvingAI} className="px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider border border-gray-100 bg-white/80 hover:bg-white disabled:opacity-50">{isResolvingAI ? 'Judging...' : 'Run Two-Layer AI Judge'}</button>
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
                                                                <span>{variation.simType}</span>
                                                                <span>{variation.storage}</span>
                                                                <span>{formatNaira(variation.totalAccumulatedPrice)}</span>
                                                                <span className="text-right">{variation.stockCount} in stock {variationExpanded ? '⌄' : '›'}</span>
                                                              </button>
                                                              {variationExpanded && (
                                                                <div className="px-3 pb-3">
                                                                  <table className="w-full text-left">
                                                                    <thead>
                                                                      <tr className="text-[10px] uppercase text-gray-500"><th className="py-1">Vendor</th><th className="py-1">Price</th><th className="py-1">Date</th><th className="py-1">Link</th></tr>
                                                                    </thead>
                                                                    <tbody>
                                                                      {variation.vendors
                                                                        .sort((a, b) => (productSortMode === 'lowest_price' ? a.priceValue - b.priceValue : b.priceValue - a.priceValue))
                                                                        .slice(0, expandedVariationCounts[variationKey] || 3)
                                                                        .map((item) => (
                                                                        <tr key={item.id} className="border-t border-gray-100">
                                                                          <td className="py-2 text-xs font-semibold">{item.vendorName}</td>
                                                                          <td className="py-2 text-xs">{item.price}</td>
                                                                          <td className="py-2 text-xs">{formatTimelineDate(item.date)}</td>
                                                                          <td className="py-2 text-xs"><Link to={item.vendorLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold">Open ↗</Link></td>
                                                                        </tr>
                                                                      ))}
                                                                    </tbody>
                                                                  </table>
                                                                  {variation.vendors.length > (expandedVariationCounts[variationKey] || 3) && (
                                                                    <button
                                                                      type="button"
                                                                      onClick={() => setExpandedVariationCounts((prev) => ({ ...prev, [variationKey]: (prev[variationKey] || 3) + 3 }))}
                                                                      className="mt-2 px-3 py-2 rounded-xl border border-gray-100 bg-white/80 text-[11px] font-black uppercase tracking-wider text-gray-700 hover:bg-white"
                                                                    >
                                                                      + Load Next 3
                                                                    </button>
                                                                  )}
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
                <p className="text-sm text-gray-500">Mirror global rows, apply margin logic, save sessions, and export strict TXT adjustments.</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                <input value={companyCsvUrl} onChange={(e) => setCompanyCsvUrl(e.target.value)} placeholder="Company CSV URL" className="lg:col-span-2 px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300" />
                <input type="text" list="vendor-search-list" value={pricingVendor} onChange={(e) => setPricingVendor(e.target.value)} placeholder="Vendor" className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300" />
                <button onClick={loadCompanyCsv} disabled={loadingCompanyCsv} className="px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider border border-gray-100 bg-white/80 hover:bg-white disabled:opacity-50">{loadingCompanyCsv ? 'Loading...' : 'Load Company CSV'}</button>
                <select value={marginType} onChange={(e) => setMarginType(e.target.value)} className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300">
                  <option value="amount">Amount</option>
                  <option value="percentage">Percentage</option>
                </select>
                <input value={marginValue} onChange={(e) => setMarginValue(e.target.value)} placeholder="Margin value" className="px-4 py-3 rounded-2xl border border-gray-100 bg-white/80 text-sm outline-none focus:ring-2 focus:ring-gray-300" />
                <button onClick={savePricingSession} className="px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider border border-gray-100 bg-white/80 hover:bg-white">Save Session</button>
                <button onClick={exportPricingTxt} className="px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider border border-gray-100 bg-white/80 hover:bg-white">Export to TXT</button>
              </div>
              <div className="overflow-x-auto border border-gray-100 rounded-2xl">
                <table className="w-full text-left min-w-[1250px]">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Brand</th>
                      <th className="px-3 py-2">Device</th>
                      <th className="px-3 py-2">Condition</th>
                      <th className="px-3 py-2">SIM</th>
                      <th className="px-3 py-2">Storage</th>
                      <th className="px-3 py-2">Company Price</th>
                      <th className="px-3 py-2">Vendor Price</th>
                      <th className="px-3 py-2">Target Price</th>
                      <th className="px-3 py-2">Adjustment Amount</th>
                      <th className="px-3 py-2">Adjustment %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricingResults.map((row, index) => (
                      <tr key={`pricing-${index}`} className="border-t border-gray-100 text-sm">
                        <td className="px-3 py-2">{row.Category || row.category || 'Others'}</td>
                        <td className="px-3 py-2">{row.Brand || row.brand || 'Others'}</td>
                        <td className="px-3 py-2 font-semibold">{row.mappedDevice}</td>
                        <td className="px-3 py-2">{row.Condition || row.condition || 'Unknown'}</td>
                        <td className="px-3 py-2">{row['SIM Type/Model/Processor'] || row.sim || 'Unknown'}</td>
                        <td className="px-3 py-2">{row['Storage Capacity/Configuration'] || row.storage || 'N/A'}</td>
                        <td className="px-3 py-2">{formatNaira(row.companyPrice)}</td>
                        <td className="px-3 py-2">{formatNaira(row.vendorPrice)}</td>
                        <td className="px-3 py-2">{formatNaira(row.target)}</td>
                        <td className="px-3 py-2">{formatNaira(row.adjustment)}</td>
                        <td className="px-3 py-2">{row.adjustmentPercent}%</td>
                      </tr>
                    ))}
                    {!pricingResults.length && (
                      <tr><td className="px-3 py-4 text-sm text-gray-500" colSpan={11}>No matched rows. Load CSV and choose a valid vendor.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="border border-gray-100 rounded-2xl p-4 bg-white/60">
                <p className="text-xs font-black uppercase tracking-wider text-gray-500 mb-3">Saved Sessions</p>
                {savedPricingSessions.length ? (
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {savedPricingSessions.map((session) => (
                      <div key={session.id} className="flex items-center justify-between border border-gray-100 rounded-xl px-3 py-2 bg-white/80">
                        <div>
                          <p className="text-sm font-bold text-gray-800">{session.pricingVendor || 'All Vendors'} • {session.marginType} {session.marginValue}</p>
                          <p className="text-xs text-gray-500">{new Date(session.createdAt).toLocaleString()} • {session.rows?.length || 0} rows</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-gray-500">No saved sessions yet.</p>}
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
                  <input value={onboardVendorName} onChange={(e) => setOnboardVendorName(e.target.value)} placeholder="Vendor's Name" className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-emerald-500 outline-none" />
                  <input value={botNumber} onChange={(e) => setBotNumber(e.target.value)} placeholder="Your Admin Bot Number" className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-emerald-500 outline-none" />
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
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
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
                  <input type="text" placeholder="Search for a WhatsApp Vendor..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-12 pr-4 py-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm font-medium" />
                </div>
                <div className="flex gap-3 flex-wrap items-center">
                  <button onClick={() => bulkUpdateStatus('suspended')} disabled={!selectedVendorIds.length || bulkUpdating} className="bg-red-600 text-white px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-red-700 disabled:opacity-50 shadow-md transition-all">Suspend</button>
                  <button onClick={() => bulkUpdateStatus('active')} disabled={!selectedVendorIds.length || bulkUpdating} className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 shadow-md transition-all">Activate</button>
                  <input value={bulkMetaDataValue} onChange={(e) => setBulkMetaDataValue(e.target.value)} placeholder="Meta Data" className="px-3 py-2 rounded-xl border border-gray-200 bg-white/80 text-xs font-semibold" />
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
              <input value={bulkCondition} onChange={(e) => setBulkCondition(e.target.value)} placeholder="Condition (e.g. Used)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <input value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} placeholder="Category (e.g. Smartphones)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <input value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} placeholder="Price (e.g. ₦350,000)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
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
                  <p className="text-sm text-gray-700 font-medium">{message.text}</p>
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
                      <p className="text-sm whitespace-pre-wrap font-medium leading-relaxed">{message.text}</p>
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
                className="flex-1 border border-gray-200 rounded-xl p-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none resize-none shadow-sm" 
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
