import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { collection, getDocs, doc, writeBatch, query, orderBy, updateDoc, getDoc, setDoc } from 'firebase/firestore';
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
  settings: 'horleyTech_Settings',
};

const CACHE_DOC = 'globalProductsCache';
const FALLBACK_MASTER_DICTIONARY_CSV = 'https://docs.google.com/spreadsheets/d/1LYvixRWFuZYWa8VqI7pDvTjzsepEWqAkE7oDbv1L4j4/export?format=csv';
const CHART_COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#7c3aed', '#ef4444', '#14b8a6', '#f97316'];
const MASTER_DICTIONARY_STORAGE_KEY = 'admin-master-dictionary-v1';

const BRAND_NEW_CONDITIONS = new Set(['pristine boxed', 'brand new', 'new']);
const USED_CONDITIONS = new Set(['grade a uk used', 'grade a used', 'used']);

const toCsv = (rows) => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const csvRows = rows.map((row) => headers.map((header) => `"${String(row[header] ?? '').replaceAll('"', '""')}"`).join(','));
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

const parseCsvLine = (line = '') => {
  const parsed = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i += 1; }
      else { inQuotes = !inQuotes; }
      continue;
    }
    if (char === ',' && !inQuotes) { parsed.push(current.trim()); current = ''; continue; }
    current += char;
  }
  parsed.push(current.trim());
  return parsed;
};

const parseRowsFromCsv = (csvText = '') => {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((acc, header, idx) => {
      acc[header] = values[idx] ?? '';
      return acc;
    }, {});
  });
};

const parseNairaValue = (val) => {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const original = String(val).toLowerCase().trim();
  if (!original || original.includes('available')) return 0;
  const normalized = original.replace(/[₦n,\s]/g, '');
  if (!/\d/.test(normalized)) return 0;
  const shorthand = normalized.match(/(\d+(?:\.\d+)?)([mk])/);
  if (shorthand) {
    const amount = Number(shorthand[1]);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * (shorthand[2] === 'm' ? 1000000 : 1000));
  }
  const numberOnly = normalized.match(/\d+(?:\.\d+)?/);
  if (!numberOnly) return 0;
  const parsed = Number(numberOnly[0]);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatNaira = (amount) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount || 0);
const formatCompactNaira = (amount) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', notation: 'compact', maximumFractionDigits: 1 }).format(amount || 0);

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

const parseMasterDictionaryCsv = (csvText = '') => {
  const rows = parseRowsFromCsv(csvText);
  if (!rows.length) return [];
  const sample = rows[0];
  const header = Object.keys(sample).find((key) => key.toLowerCase().replace(/[^a-z ]/g, '').includes('device type'));
  if (!header) throw new Error(`Master CSV must include a Device Type column. Found headers: ${Object.keys(sample).join(', ')}`);
  return Array.from(new Set(rows.map((row) => String(row[header] || '').trim()).filter(Boolean)));
};

const standardizeCondition = (condition) => {
  const normalized = String(condition || '').toLowerCase().trim();
  if (BRAND_NEW_CONDITIONS.has(normalized)) return { condition: 'Brand New', cleanStatus: 'clean' };
  if (USED_CONDITIONS.has(normalized)) return { condition: 'Grade A UK Used', cleanStatus: 'clean' };
  return { condition: String(condition || 'Unknown').trim() || 'Unknown', cleanStatus: 'unclean' };
};

const normalizeDeviceRaw = (rawString) =>
  String(rawString || '').replace(/\+/g, ' Plus ').replace(/\bpm\b/gi, ' ProMax ').replace(/[^a-z0-9\s]/gi, ' ').toLowerCase().replace(/\s+/g, ' ').trim();

const hasSamsungStrictSuffixConflict = (raw, target) => {
  const targetNormalized = target.toLowerCase();
  const samsungSMatch = targetNormalized.match(/\bs\d{1,2}\b/);
  if (!samsungSMatch) return false;
  const includesUltraInTarget = targetNormalized.includes('ultra');
  const includesPlusInTarget = targetNormalized.includes('plus');
  const includesUInTarget = /\bs\d{1,2}\s*u\b/.test(targetNormalized);
  if (includesUltraInTarget || includesPlusInTarget || includesUInTarget) return false;
  return /\bultra\b|\bplus\b|\+|\bs\d{1,2}\s*u\b/.test(raw);
};

const smartMapDevice = (rawString, officialTargets) => {
  const normalizedRaw = normalizeDeviceRaw(rawString);
  if (!normalizedRaw) return String(rawString || 'Unknown Device').trim() || 'Unknown Device';
  const scored = officialTargets.map((target) => {
    const normalizedTarget = normalizeDeviceRaw(target);
    if (!normalizedTarget) return null;
    if (hasSamsungStrictSuffixConflict(normalizedRaw, target)) return null;
    const targetTokens = normalizedTarget.split(' ').filter(Boolean);
    const matchedTokens = targetTokens.filter((token) => normalizedRaw.includes(token)).length;
    if (!matchedTokens) return null;
    const exact = normalizedRaw.includes(normalizedTarget) ? 3 : 0;
    const tokenCoverage = matchedTokens / Math.max(1, targetTokens.length);
    const score = (tokenCoverage * 10) + exact;
    return { target, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return scored[0]?.target || String(rawString || 'Unknown Device').trim() || 'Unknown Device';
};

const normalizeSimType = (simType, deviceType) => {
  const rawSim = String(simType || '').trim();
  if (rawSim) return rawSim;
  const normalizedDevice = String(deviceType || '').toLowerCase();
  if (normalizedDevice.includes('iphone') || normalizedDevice.includes('ipad') || normalizedDevice.includes('apple')) {
    return 'Physical SIM + ESIM (Dual)';
  }
  return 'N/A';
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

const buildProductTree = (rows) => {
  const tree = {};
  rows.forEach((row) => {
    const category = row.category || 'Others';
    const brand = row.brandSubCategory || 'Others';
    const series = row.series || 'Others';
    const device = row.deviceType || 'Unknown Device';
    const variation = `${row.condition} | ${row.simType} | ${row.storage}`;
    tree[category] ??= { count: 0, children: {} }; tree[category].count += 1;
    tree[category].children[brand] ??= { count: 0, children: {} }; tree[category].children[brand].count += 1;
    tree[category].children[brand].children[series] ??= { count: 0, children: {} }; tree[category].children[brand].children[series].count += 1;
    tree[category].children[brand].children[series].children[device] ??= { count: 0, children: {} }; tree[category].children[brand].children[series].children[device].count += 1;
    tree[category].children[brand].children[series].children[device].children[variation] ??= { count: 0, totalAccumulatedPrice: 0, vendors: [] };
    tree[category].children[brand].children[series].children[device].children[variation].count += 1;
    tree[category].children[brand].children[series].children[device].children[variation].totalAccumulatedPrice += row.priceValue;
    tree[category].children[brand].children[series].children[device].children[variation].vendors.push(row);
  });
  return tree;
};

const AdminDashboard = () => {
  const location = useLocation();
  const isAdmin = true;

  const [activeTab, setActiveTab] = useState('offline');
  const [offlineVendors, setOfflineVendors] = useState([]);
  const [globalProductsCache, setGlobalProductsCache] = useState([]);
  const [officialTargets, setOfficialTargets] = useState([]);
  const [syncingDictionary, setSyncingDictionary] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [selectedVendorFilter, setSelectedVendorFilter] = useState('All');
  const [productCategoryFilter, setProductCategoryFilter] = useState('All');
  const [productConditionFilter, setProductConditionFilter] = useState('All');
  const [dataViewMode, setDataViewMode] = useState('all');
  const [excludedPhrases, setExcludedPhrases] = useState('active');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination & Accordion
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  const [expanded, setExpanded] = useState({});

  // Pricing Engine
  const [pricingCsvUrl, setPricingCsvUrl] = useState('');
  const [pricingRows, setPricingRows] = useState([]);
  const [pricingVendor, setPricingVendor] = useState('');
  const [pricingMarginType, setPricingMarginType] = useState('amount');
  const [pricingMarginValue, setPricingMarginValue] = useState('0');

  // Admin Tools
  const [backups, setBackups] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [selectedVendorIds, setSelectedVendorIds] = useState([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [manualBackupLoading, setManualBackupLoading] = useState(false);
  const [restoringBackupId, setRestoringBackupId] = useState(null);
  const [togglingAdvancedVendorId, setTogglingAdvancedVendorId] = useState(null);
  const [allMessages, setAllMessages] = useState([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatVendor, setChatVendor] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
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

  const uniqueVendorNames = useMemo(() => Array.from(new Set(offlineVendors.map((vendor) => vendor.vendorName).filter(Boolean))).sort(), [offlineVendors]);

  const fetchInventory = async () => {
    setLoadingSearch(true);
    try {
      const snap = await getDocs(collection(db, COLLECTIONS.offline));
      const rows = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        rows.push({
          docId: docSnap.id,
          vendorId: data.vendorId || docSnap.id,
          vendorName: data.vendorName || data.vendorId || docSnap.id,
          totalProducts: data.products ? data.products.length : 0,
          inventoryValue: Array.isArray(data.products) ? data.products.reduce((sum, p) => sum + parseNairaValue(p['Regular price']), 0) : 0,
          lastUpdated: data.lastUpdated,
          shareableLink: data.shareableLink || `/vendor/${docSnap.id}`,
          status: data.status || 'active',
          viewCount: data.viewCount || 0,
          whatsappClicks: data.whatsappClicks || 0,
          vendorPassword: data.vendorPassword || '',
          storeWhatsappNumber: data.storeWhatsappNumber || '',
          advancedEnabled: Boolean(data.advancedEnabled),
          products: Array.isArray(data.products) ? data.products : [],
          logs: normalizeLogs(data.logs),
        });
      });
      setOfflineVendors(rows);
      setSelectedVendorIds([]);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      setLoadingSearch(false);
    }
  };

  const fetchCache = async () => {
    try {
      const ref = doc(db, COLLECTIONS.settings, CACHE_DOC);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        setGlobalProductsCache(Array.isArray(data.products) ? data.products : []);
        setOfficialTargets(Array.isArray(data.officialTargets) ? data.officialTargets : []);
      }
    } catch (e) {
      console.log('No cache found or error loading cache', e);
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
      const response = await fetch(`${BASE_URL}/api/messages`, { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } });
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
      const response = await fetch(`${BASE_URL}/api/admin/audit-logs`, { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } });
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
      const response = await fetch(`${BASE_URL}/api/settings/tutorial-video`, { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load tutorial video setting');
      setTutorialVideoUrl(data.youtubeUrl || '');
    } catch (error) {
      console.error('Unable to fetch tutorial video setting:', error);
    }
  };

  useEffect(() => {
    if (location.pathname === '/dashboard' || location.pathname === '/dashboard/') {
      fetchInventory();
      fetchCache();
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

  const syncMasterDictionary = async () => {
    const csvUrl = import.meta.env.VITE_MASTER_DICTIONARY_CSV || FALLBACK_MASTER_DICTIONARY_CSV;
    setSyncingDictionary(true);
    try {
      const response = await fetch(csvUrl, { headers: { Accept: 'text/csv,text/plain,*/*' } });
      if (!response.ok) throw new Error(`Failed to fetch master CSV (${response.status})`);
      const csvText = await response.text();
      const targets = parseMasterDictionaryCsv(csvText);

      const mapped = [];
      offlineVendors.forEach((vendor) => {
        vendor.products.forEach((product, index) => {
          const rawDevice = String(product['Device Type'] || 'Unknown Device').trim();
          const mappedDevice = smartMapDevice(rawDevice, targets);
          mapped.push({
            id: `${vendor.docId}-${index}`,
            vendorName: vendor.vendorName,
            vendorLink: vendor.shareableLink,
            category: String(product.Category || 'Others').trim() || 'Others',
            brandSubCategory: inferBrandSubCategory(mappedDevice),
            series: inferSeries(mappedDevice),
            deviceType: mappedDevice,
            condition: product.Condition,
            simType: normalizeSimType(product['SIM Type/Model/Processor'], mappedDevice),
            storage: String(product['Storage Capacity/Configuration'] || 'N/A').trim() || 'N/A',
            price: String(product['Regular price'] || '0').trim(),
            priceValue: parseNairaValue(product['Regular price']),
            date: product.DatePosted || vendor.lastUpdated || 'N/A'
          });
        });
      });

      await setDoc(doc(db, COLLECTIONS.settings, CACHE_DOC), {
        products: mapped,
        officialTargets: targets,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      setOfficialTargets(targets);
      setGlobalProductsCache(mapped);
      alert(`✅ Synced ${mapped.length.toLocaleString()} mapped rows to global cache.`);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setSyncingDictionary(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const excludedTokens = excludedPhrases.split(',').map((token) => token.trim().toLowerCase()).filter(Boolean);
    return globalProductsCache.filter((row) => {
      const standardizedCond = standardizeCondition(row.condition);
      row.cleanCondition = standardizedCond.condition;
      
      const haystack = `${row.category} ${row.brandSubCategory} ${row.series} ${row.deviceType} ${row.condition} ${row.storage} ${row.vendorName}`.toLowerCase();
      const isExcluded = excludedTokens.some((phrase) => haystack.includes(phrase));
      const cleanStatus = isExcluded ? 'excluded' : standardizedCond.cleanStatus;

      if (dataViewMode !== 'all' && cleanStatus !== dataViewMode) return false;
      if (selectedVendorFilter !== 'All' && row.vendorName !== selectedVendorFilter) return false;
      if (productCategoryFilter !== 'All' && row.category !== productCategoryFilter) return false;
      if (productConditionFilter !== 'All' && row.cleanCondition !== productConditionFilter) return false;
      if (productSearchQuery && !haystack.includes(productSearchQuery.toLowerCase())) return false;
      if (!isWithinDateRange(row.date, startDate, endDate)) return false;

      return true;
    });
  }, [globalProductsCache, excludedPhrases, selectedVendorFilter, productCategoryFilter, productConditionFilter, productSearchQuery, dataViewMode, startDate, endDate]);

  const productTree = useMemo(() => buildProductTree(filteredProducts.map(p => ({...p, condition: p.cleanCondition}))), [filteredProducts]);

  const uniqueGlobalCategories = useMemo(() => ['All', ...new Set(globalProductsCache.map((row) => row.category))], [globalProductsCache]);
  const uniqueGlobalConditions = useMemo(() => ['All', ...new Set(globalProductsCache.map((row) => standardizeCondition(row.condition).condition))], [globalProductsCache]);

  const chartData = useMemo(() => {
    const categories = {};
    const conditions = {};
    filteredProducts.forEach((row) => {
      categories[row.category] = (categories[row.category] || 0) + 1;
      conditions[row.cleanCondition] = (conditions[row.cleanCondition] || 0) + 1;
    });
    return {
      categoryMix: Object.entries(categories).map(([name, value]) => ({ name, value })),
      conditionMix: Object.entries(conditions).map(([condition, count]) => ({ condition, count })),
    };
  }, [filteredProducts]);

  const companyRows = useMemo(() => pricingRows.map((row) => ({ ...row, __device: String(row['Device Type'] || row.deviceType || '').trim() })), [pricingRows]);

  const loadCompanyCsv = async () => {
    let url = pricingCsvUrl.trim();
    if (!url) return;
    if (url.includes('docs.google.com/spreadsheets') && url.includes('/edit')) {
      url = url.replace(/\/edit.*$/, '/export?format=csv');
      setPricingCsvUrl(url); 
    }
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      setPricingRows(parseRowsFromCsv(text));
      alert('✅ Company CSV Loaded Successfully!');
    } catch (error) {
      alert(`❌ Failed to load company CSV: ${error.message}`);
    }
  };

  const pricingCalculations = useMemo(() => {
    const vendorInventory = new Map();
    filteredProducts
      .filter((row) => !pricingVendor || row.vendorName === pricingVendor)
      .forEach((row) => {
        const key = `${row.deviceType}__${row.cleanCondition}__${row.storage}`;
        const prev = vendorInventory.get(key);
        if (!prev || row.priceValue < prev.priceValue) {
          vendorInventory.set(key, row);
        }
      });

    const marginValue = Number(pricingMarginValue) || 0;

    return companyRows.map((companyRow) => {
      const companyDevice = smartMapDevice(companyRow.__device, officialTargets);
      const condition = standardizeCondition(companyRow.Condition || companyRow.condition).condition;
      const storage = String(companyRow['Storage Capacity/Configuration'] || companyRow.storage || 'N/A').trim() || 'N/A';
      const companyPrice = parseNairaValue(companyRow['Regular price'] || companyRow.Price || companyRow.price);
      const key = `${companyDevice}__${condition}__${storage}`;
      const vendorItem = vendorInventory.get(key);

      if (!vendorItem) {
        return { ...companyRow, mappedDevice: companyDevice, companyPrice, vendorPrice: null, targetPrice: null, adjustment: null };
      }

      const vendorPrice = vendorItem.priceValue;
      const targetPrice = pricingMarginType === 'percentage'
        ? Math.round(vendorPrice * (1 + (marginValue / 100)))
        : Math.round(vendorPrice + marginValue);
      const adjustment = targetPrice - companyPrice;

      return { ...companyRow, mappedDevice: companyDevice, companyPrice, vendorPrice, targetPrice, adjustment };
    });
  }, [companyRows, filteredProducts, pricingVendor, pricingMarginType, pricingMarginValue, officialTargets]);

  const exportPricingTxt = () => {
    const lines = pricingCalculations
      .filter((row) => row.vendorPrice !== null)
      .map((row) => {
        if (pricingMarginType === 'percentage') {
          const percent = row.companyPrice ? Math.round((row.adjustment / row.companyPrice) * 100) : 0;
          return `${row.companyPrice}: ${percent}`;
        }
        return `${row.companyPrice}: ${row.adjustment}`;
      });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pricing-adjustments.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const toggleNode = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const renderTree = () => (
    Object.entries(productTree).map(([category, categoryNode]) => {
      const categoryKey = `cat:${category}`;
      return (
        <div key={categoryKey} className="rounded-2xl bg-white/10 border border-white/20 p-3 mb-3">
          <button className="w-full text-left font-semibold flex justify-between" onClick={() => toggleNode(categoryKey)}>
            <span>{category} <span className="text-gray-400 text-xs ml-2">({categoryNode.count.toLocaleString()} items)</span></span>
            <span>{expanded[categoryKey] ? '⌄' : '›'}</span>
          </button>
          {expanded[categoryKey] && Object.entries(categoryNode.children).map(([brand, brandNode]) => {
            const brandKey = `${categoryKey}|brand:${brand}`;
            return (
              <div key={brandKey} className="ml-4 mt-2 border-l border-white/10 pl-3">
                <button className="w-full text-left font-medium text-emerald-400 flex justify-between" onClick={() => toggleNode(brandKey)}>
                  <span>{brand} <span className="text-gray-500 text-xs ml-2">({brandNode.count.toLocaleString()})</span></span>
                  <span>{expanded[brandKey] ? '⌄' : '›'}</span>
                </button>
                {expanded[brandKey] && Object.entries(brandNode.children).map(([series, seriesNode]) => {
                  const seriesKey = `${brandKey}|series:${series}`;
                  return (
                    <div key={seriesKey} className="ml-4 mt-2 border-l border-white/10 pl-3">
                      <button className="w-full text-left text-blue-400 flex justify-between" onClick={() => toggleNode(seriesKey)}>
                        <span>{series} <span className="text-gray-500 text-xs ml-2">({seriesNode.count.toLocaleString()})</span></span>
                        <span>{expanded[seriesKey] ? '⌄' : '›'}</span>
                      </button>
                      {expanded[seriesKey] && Object.entries(seriesNode.children).map(([device, deviceNode]) => {
                        const deviceKey = `${seriesKey}|device:${device}`;
                        return (
                          <div key={deviceKey} className="ml-4 mt-2 border-l border-white/10 pl-3">
                            <button className="w-full text-left text-orange-300 font-bold flex justify-between" onClick={() => toggleNode(deviceKey)}>
                              <span>{device} <span className="text-gray-500 text-xs ml-2">({deviceNode.count.toLocaleString()})</span></span>
                              <span>{expanded[deviceKey] ? '⌄' : '›'}</span>
                            </button>
                            {expanded[deviceKey] && Object.entries(deviceNode.children).map(([variation, variationNode]) => {
                              const variationKey = `${deviceKey}|variation:${variation}`;
                              return (
                                <div key={variationKey} className="ml-4 mt-2 rounded-xl bg-black/20 p-3">
                                  <button className="w-full text-left text-gray-200 text-sm flex justify-between items-center" onClick={() => toggleNode(variationKey)}>
                                    <span className="flex-1">{variation}</span>
                                    <span className="font-black text-emerald-400 mx-4">{formatNaira(variationNode.totalAccumulatedPrice)}</span>
                                    <span className="text-xs bg-white/10 px-2 py-1 rounded">{variationNode.count.toLocaleString()} vendors {expanded[variationKey] ? '⌄' : '›'}</span>
                                  </button>
                                  {expanded[variationKey] && (
                                    <ul className="mt-3 space-y-2">
                                      {variationNode.vendors.map((vendorRow) => (
                                        <li key={vendorRow.id} className="text-xs text-white bg-black/40 p-3 rounded-lg flex justify-between items-center border border-white/5">
                                          <span><span className="font-bold text-emerald-300">{vendorRow.vendorName}</span> • {formatTimelineDate(vendorRow.date)}</span>
                                          <div className="flex items-center gap-4">
                                            <span className="font-black text-sm">{formatNaira(vendorRow.priceValue)}</span>
                                            <Link to={vendorRow.vendorLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 font-bold bg-blue-400/10 px-3 py-1.5 rounded-lg">Store ↗</Link>
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      );
    })
  );

  const filteredOffline = useMemo(
    () => offlineVendors.filter((v) => !searchQuery || v.vendorName?.toLowerCase().includes(searchQuery.toLowerCase())),
    [offlineVendors, searchQuery]
  );
  
  const totalPages = Math.max(1, Math.ceil(filteredOffline.length / itemsPerPage));
  const paginatedOffline = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredOffline.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredOffline, currentPage, itemsPerPage]);

  const platformActivityTimeline = useMemo(() => {
    const allEntries = [];
    offlineVendors.forEach((vendor) => {
      const logs = normalizeLogs(vendor.logs);
      [...logs.admin, ...logs.vendor].forEach((entry) => {
        allEntries.push({ ...entry, vendorId: vendor.vendorId, vendorName: vendor.vendorName, channel: logs.admin.includes(entry) ? 'admin' : 'vendor' });
      });
    });
    return allEntries.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 50);
  }, [offlineVendors]);

  const saveTutorialVideo = async () => { /* Existing Logic */ };
  const generateOnboardingLink = async () => { /* Existing Logic */ };
  const triggerManualBackup = async () => { /* Existing Logic */ };
  const restoreBackup = async (fileId) => { /* Existing Logic */ };
  const uploadAndRestoreLocalBackup = async (event) => { /* Existing Logic */ };
  const fetchDriveBackups = async () => { /* Existing Logic */ };
  const toggleSelectAll = () => { /* Existing Logic */ };
  const toggleVendor = (docId) => { /* Existing Logic */ };
  const handleExport = () => { /* Existing Logic */ };
  const bulkUpdateStatus = async (status) => { /* Existing Logic */ };
  const openBulkEdit = () => { /* Existing Logic */ };
  const runBulkEdit = async () => { /* Existing Logic */ };
  const undoAuditAction = async (auditId) => { /* Existing Logic */ };
  const toggleAdvancedTools = async (vendor) => { /* Existing Logic */ };
  const openChatForVendor = async (vendor) => { /* Existing Logic */ };
  const sendAdminChat = async () => { /* Existing Logic */ };

  return (
    <AdminDashboardLayout notificationCount={unreadMessages.length} onNotificationClick={() => setNotificationOpen(true)}>
      <section className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">
          <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 shadow-2xl">
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setActiveTab('offline')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'offline' ? 'bg-white/30 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>Directory</button>
              <button onClick={() => setActiveTab('products')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'products' ? 'bg-white/30 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>Global Products</button>
              <button onClick={() => setActiveTab('insights')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'insights' ? 'bg-white/30 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>Insights</button>
              <button onClick={() => setActiveTab('pricing')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'pricing' ? 'bg-white/30 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>Pricing Engine</button>
              <button onClick={() => setActiveTab('activity')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'activity' ? 'bg-white/30 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>Activity Log</button>
              <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'history' ? 'bg-white/30 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>Audit Trail</button>
              <button onClick={() => setActiveTab('promote')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'promote' ? 'bg-white/30 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>Promote</button>
              <button onClick={() => setActiveTab('maintenance')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'maintenance' ? 'bg-white/30 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>Backups</button>
              
              <button onClick={syncMasterDictionary} className="ml-auto px-4 py-2 rounded-2xl bg-emerald-500/70 font-black text-white hover:bg-emerald-400 transition-all shadow-[0_0_15px_rgba(16,185,129,0.5)]">
                {syncingDictionary ? 'Syncing...' : 'Sync Master Dictionary'}
              </button>
            </div>
          </div>

          {activeTab === 'products' && (
            <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 space-y-4 shadow-2xl">
              <div className="grid md:grid-cols-4 gap-3">
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500" placeholder="Search devices..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500" type="text" list="vendor-search-list" placeholder="Vendor filter (All)" value={selectedVendorFilter === 'All' ? '' : selectedVendorFilter} onChange={(e) => setSelectedVendorFilter(e.target.value.trim() || 'All')} />
                <datalist id="vendor-search-list">{uniqueVendorNames.map((name) => <option key={name} value={name} />)}</datalist>
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500" placeholder="Excluded phrases (e.g. active, swap)" value={excludedPhrases} onChange={(e) => setExcludedPhrases(e.target.value)} />
                <select className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500 text-white" value={dataViewMode} onChange={(e) => setDataViewMode(e.target.value)}>
                  <option value="all">All Data</option>
                  <option value="clean">Clean Only</option>
                  <option value="unclean">Unclean Data</option>
                  <option value="excluded">Excluded Data</option>
                </select>
              </div>
              <div className="space-y-3 max-h-[65vh] overflow-y-auto custom-scrollbar p-2">{renderTree()}</div>
            </div>
          )}

          {activeTab === 'offline' && (
            <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 space-y-4 shadow-2xl">
               <div className="flex gap-3">
                  <input type="text" placeholder="Search for a WhatsApp Vendor..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-4 py-3 rounded-2xl bg-black/40 border border-white/10 outline-none focus:border-blue-500" />
               </div>
               <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
                <table className="w-full text-left text-sm">
                  <thead className="bg-black/40 text-gray-400">
                    <tr>
                      <th className="p-4 font-black uppercase text-xs">Vendor Name</th>
                      <th className="p-4 font-black uppercase text-xs">Status</th>
                      <th className="p-4 font-black uppercase text-xs">Products</th>
                      <th className="p-4 font-black uppercase text-xs">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {paginatedOffline.map(vendor => (
                      <tr key={vendor.docId} className="hover:bg-white/5 transition-colors">
                        <td className="p-4 font-bold text-blue-400"><Link to={vendor.shareableLink} target="_blank">{vendor.vendorName}</Link></td>
                        <td className="p-4"><span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${vendor.status === 'suspended' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>{vendor.status}</span></td>
                        <td className="p-4 text-gray-300">{vendor.totalProducts} Items</td>
                        <td className="p-4"><Link to={vendor.shareableLink} target="_blank" className="bg-white/10 px-4 py-2 rounded-lg text-[10px] font-black uppercase hover:bg-white/20">Manage</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'insights' && (
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-6 h-96 shadow-2xl">
                <h3 className="font-bold text-xl mb-4 text-emerald-400">Category Distribution</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={chartData.categoryMix} dataKey="value" nameKey="name" outerRadius={110} label onClick={(entry) => { if (!entry?.name) return; setProductCategoryFilter(entry.name); setActiveTab('products'); }}>
                      {chartData.categoryMix.map((_, index) => <Cell key={`cat-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-6 h-96 shadow-2xl">
                <h3 className="font-bold text-xl mb-4 text-blue-400">Condition Quality</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData.conditionMix}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="condition" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '12px' }} />
                    <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} onClick={(entry) => { if (!entry?.condition) return; setProductConditionFilter(entry.condition); setActiveTab('products'); }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {activeTab === 'pricing' && (
            <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-6 space-y-6 shadow-2xl">
              <div>
                <h2 className="text-2xl font-black mb-2 text-orange-400">Pricing Engine</h2>
                <p className="text-gray-400 text-sm">Paste a Google Sheet link. It auto-converts to CSV and maps vendor prices against your master list.</p>
              </div>
              <div className="grid md:grid-cols-5 gap-3">
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 md:col-span-2 outline-none focus:border-blue-500" placeholder="Paste Google Sheet URL..." value={pricingCsvUrl} onChange={(e) => setPricingCsvUrl(e.target.value)} />
                <button onClick={loadCompanyCsv} className="rounded-2xl bg-blue-600/80 px-4 py-3 font-bold hover:bg-blue-500 transition-all shadow-[0_0_15px_rgba(37,99,235,0.5)]">Load Sheet</button>
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500" type="text" list="vendor-search-list" placeholder="Target Vendor" value={pricingVendor} onChange={(e) => setPricingVendor(e.target.value)} />
                <select className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500 text-white" value={pricingMarginType} onChange={(e) => setPricingMarginType(e.target.value)}>
                  <option value="amount">Amount (₦)</option>
                  <option value="percentage">Percentage (%)</option>
                </select>
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500" placeholder="Margin (e.g. 10000 or 10)" value={pricingMarginValue} onChange={(e) => setPricingMarginValue(e.target.value)} />
                <button onClick={exportPricingTxt} className="rounded-2xl bg-emerald-600/80 px-4 py-3 font-bold hover:bg-emerald-500 transition-all md:col-span-2 lg:col-span-1 shadow-[0_0_15px_rgba(16,185,129,0.5)]">Export to TXT</button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
                <table className="w-full text-sm text-left">
                  <thead className="bg-black/40 text-gray-400">
                    <tr>
                      <th className="p-4 font-black tracking-widest uppercase text-xs">Device</th>
                      <th className="p-4 font-black tracking-widest uppercase text-xs">Your Price</th>
                      <th className="p-4 font-black tracking-widest uppercase text-xs text-emerald-400">Vendor Price</th>
                      <th className="p-4 font-black tracking-widest uppercase text-xs text-blue-400">Target</th>
                      <th className="p-4 font-black tracking-widest uppercase text-xs text-orange-400">Adjustment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {pricingCalculations.map((row, index) => (
                      <tr key={`${row.__device}-${index + 1}`} className="hover:bg-white/5 transition-colors">
                        <td className="p-4 font-bold">{row.mappedDevice || row.__device || 'N/A'}</td>
                        <td className="p-4 text-gray-300">{formatNaira(row.companyPrice || 0)}</td>
                        <td className="p-4 text-emerald-300 font-bold">{row.vendorPrice === null ? 'N/A' : formatNaira(row.vendorPrice)}</td>
                        <td className="p-4 text-blue-300 font-bold">{row.targetPrice === null ? 'N/A' : formatNaira(row.targetPrice)}</td>
                        <td className="p-4 text-orange-300 font-bold">{row.adjustment === null ? 'N/A' : formatNaira(row.adjustment)}</td>
                      </tr>
                    ))}
                    {pricingCalculations.length === 0 && (
                      <tr><td colSpan={5} className="p-8 text-center text-gray-500">No data loaded. Paste a URL and click Load Sheet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 shadow-2xl">
              <h2 className="text-xl font-black mb-4">Activity Log</h2>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                {platformActivityTimeline.map((entry, idx) => (
                  <div key={idx} className="bg-black/20 p-3 rounded-xl border border-white/5">
                    <p className="font-bold text-sm text-gray-200">{entry.action}</p>
                    <p className="text-xs text-gray-500 mt-1">{entry.vendorName} • {formatTimelineDate(entry.date)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 shadow-2xl">
              <h2 className="text-xl font-black mb-4">Audit Trail</h2>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                {auditLogs.map((log) => (
                  <div key={log.id} className="bg-black/20 p-3 rounded-xl border border-white/5">
                    <p className="font-bold text-sm text-gray-200">{log.method} {log.path}</p>
                    <p className="text-xs text-gray-500 mt-1">{log.userRole} • {formatTimelineDate(log.timestamp)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'promote' && (
            <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 shadow-2xl">
              <h2 className="text-xl font-black mb-4 text-emerald-400">Promote & Onboard</h2>
               <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
                  <input value={onboardVendorName} onChange={(e) => setOnboardVendorName(e.target.value)} placeholder="Vendor's Name" className="p-3 rounded-xl bg-black/40 border border-white/10 outline-none focus:border-emerald-500" />
                  <input value={botNumber} onChange={(e) => setBotNumber(e.target.value)} placeholder="Your Admin Bot Number" className="p-3 rounded-xl bg-black/40 border border-white/10 outline-none focus:border-emerald-500" />
                  <button onClick={generateOnboardingLink} className="bg-emerald-600 text-white px-4 py-3 rounded-xl font-bold hover:bg-emerald-500 transition-colors">Generate Link</button>
               </div>
               <h2 className="text-xl font-black mb-4 text-blue-400">Tutorial Video</h2>
               <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input value={tutorialVideoUrl} onChange={(e) => setTutorialVideoUrl(e.target.value)} placeholder="Paste YouTube link" className="p-3 md:col-span-2 rounded-xl bg-black/40 border border-white/10 outline-none focus:border-blue-500" />
                  <button onClick={saveTutorialVideo} disabled={savingTutorialVideo} className="bg-blue-600 text-white rounded-xl px-4 py-3 font-bold hover:bg-blue-500 disabled:opacity-50">Save Video</button>
               </div>
            </div>
          )}

          {activeTab === 'maintenance' && (
            <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 shadow-2xl">
              <h2 className="text-xl font-black mb-4 text-red-400">System Maintenance & Backups</h2>
              <button onClick={triggerManualBackup} disabled={manualBackupLoading} className="bg-red-600 text-white px-5 py-3 rounded-xl font-bold hover:bg-red-500 transition-all shadow-[0_0_15px_rgba(220,38,38,0.5)] mb-8">
                  {manualBackupLoading ? 'Running Backup...' : 'Run Manual Backup'}
              </button>
              <div className="space-y-3">
                {backups.map(backup => (
                  <div key={backup.id} className="bg-black/20 p-4 rounded-xl border border-white/5 flex justify-between items-center">
                    <div>
                      <p className="font-bold text-gray-200">{backup.id}</p>
                      <p className="text-xs text-gray-500">{new Date(backup.createdAt).toLocaleString()} • {backup.totalDocuments} Docs</p>
                    </div>
                    <button onClick={() => restoreBackup(backup.id)} disabled={restoringBackupId === backup.id} className="text-xs bg-red-600/80 hover:bg-red-500 px-4 py-2 rounded-lg font-bold">
                      {restoringBackupId === backup.id ? 'Restoring...' : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </section>
    </AdminDashboardLayout>
  );
};

export default AdminDashboard;
