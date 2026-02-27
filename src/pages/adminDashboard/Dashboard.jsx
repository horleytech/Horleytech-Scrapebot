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

const BRAND_NEW_CONDITIONS = new Set(['brand new', 'pristine boxed', 'new']);
const USED_CONDITIONS = new Set(['grade a uk used', 'grade a used', 'used']);

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

const parseNairaValue = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const original = String(value || '');
  const groupedNumber = original.match(/(\d{1,3}(?:,\d{3})+)/);
  if (groupedNumber) {
    const parsedGrouped = Number(groupedNumber[1].replace(/,/g, ''));
    if (Number.isFinite(parsedGrouped)) return parsedGrouped;
  }

  const raw = original.toLowerCase().replace(/[₦n\s,]/g, '').trim();
  if (!raw || raw.includes('available')) return 0;

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

const parseMasterDictionaryCsv = (csvText = '') => {
  const rows = parseRowsFromCsv(csvText);
  if (!rows.length) return [];
  const sample = rows[0];
  const header = Object.keys(sample).find((key) => key.toLowerCase().replace(/[^a-z ]/g, '').includes('device type'));
  if (!header) {
    throw new Error(`Master CSV must include a Device Type column. Found headers: ${Object.keys(sample).join(', ')}`);
  }
  return Array.from(new Set(rows.map((row) => String(row[header] || '').trim()).filter(Boolean)));
};

const getConditionRank = (condition) => {
  const standardized = standardizeCondition(condition).condition;
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

const standardizeCondition = (condition) => {
  const normalized = String(condition || '').toLowerCase().trim();
  if (BRAND_NEW_CONDITIONS.has(normalized)) return { condition: 'Brand New', cleanStatus: 'clean' };
  if (USED_CONDITIONS.has(normalized)) return { condition: 'Grade A UK Used', cleanStatus: 'clean' };
  return { condition: String(condition || 'Unknown').trim() || 'Unknown', cleanStatus: 'unclean' };
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
  const [productSortMode, setProductSortMode] = useState('hierarchy');
  const [dataViewMode, setDataViewMode] = useState('all');
  const [excludedPhrases, setExcludedPhrases] = useState('active');
  const [masterDictionary, setMasterDictionary] = useState({});
  const [syncingDictionary, setSyncingDictionary] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedProductGroups, setExpandedProductGroups] = useState([]);
  const itemsPerPage = 50;
  
  const [offlineVendors, setOfflineVendors] = useState([]);
  const [globalProductsCache, setGlobalProductsCache] = useState([]);
  const [officialTargets, setOfficialTargets] = useState([]);
  
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

  // Pricing Engine State
  const [pricingCsvUrl, setPricingCsvUrl] = useState('');
  const [pricingRows, setPricingRows] = useState([]);
  const [pricingVendor, setPricingVendor] = useState('');
  const [pricingMarginType, setPricingMarginType] = useState('amount');
  const [pricingMarginValue, setPricingMarginValue] = useState('0');

  const uniqueVendorNames = useMemo(() => Array.from(new Set(offlineVendors.map((vendor) => vendor.vendorName).filter(Boolean))).sort(), [offlineVendors]);

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

  const fetchCache = async () => {
    try {
      const ref = doc(db, COLLECTIONS.settings, CACHE_DOC);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        setGlobalProductsCache(Array.isArray(data.products) ? data.products : []);
        setOfficialTargets(Array.isArray(data.officialTargets) ? data.officialTargets : []);
      }
    } catch (error) {
      console.error('Failed to fetch product cache', error);
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
      const response = await fetch(`${BASE_URL}/api/admin/audit-logs`, {
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

  useEffect(() => {
    if (activeTab === 'maintenance') {
      fetchDriveBackups();
    }
  }, [activeTab]);

  const syncMasterDictionary = async () => {
    const csvUrl = import.meta.env.VITE_MASTER_DICTIONARY_CSV || FALLBACK_MASTER_DICTIONARY_CSV;
    setSyncingDictionary(true);

    try {
      const response = await fetch(csvUrl, { headers: { Accept: 'text/csv,text/plain,*/*' } });
      if (!response.ok) throw new Error(`Unable to fetch CSV (${response.status})`);

      const csvText = await response.text();
      const targets = parseMasterDictionaryCsv(csvText);

      const mapped = [];
      offlineVendors.forEach((vendor) => {
        (vendor.products || []).forEach((product, index) => {
          const rawDeviceType = String(product['Device Type'] || 'Unknown Device').trim();
          const mappedDeviceType = smartMapDevice(rawDeviceType, targets);
          const rawCondition = standardizeCondition(product.Condition);
          const normalizedSim = normalizeSimType(product['SIM Type/Model/Processor'], mappedDeviceType);
          const storage = String(product['Storage Capacity/Configuration'] || 'N/A').trim() || 'N/A';
          const category = String(product.Category || 'Others').trim() || 'Others';
          const brandSubCategory = inferBrandSubCategory(mappedDeviceType);
          const series = inferSeries(mappedDeviceType);

          mapped.push({
            id: `${vendor.docId}-${index}-${mappedDeviceType}`,
            vendorName: vendor.vendorName,
            vendorLink: vendor.shareableLink,
            date: product.DatePosted || vendor.lastUpdated || 'N/A',
            category,
            brandSubCategory,
            series,
            deviceType: mappedDeviceType,
            condition: rawCondition.condition,
            cleanStatus: rawCondition.cleanStatus,
            simType: normalizedSim,
            storage,
            price: product['Regular price'] || 'N/A',
            priceValue: parseNairaValue(product['Regular price']),
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
      alert(`✅ Synced ${mapped.length.toLocaleString()} mapped products to global cache.`);
    } catch (error) {
      console.error('Master dictionary sync failed:', error);
      alert(`❌ Failed to sync dictionary: ${error.message}`);
    } finally {
      setSyncingDictionary(false);
    }
  };

  const filteredProductRows = useMemo(() => {
    const excludedTokens = excludedPhrases.split(',').map((token) => token.trim().toLowerCase()).filter(Boolean);
    const queryText = productSearchQuery.trim().toLowerCase();

    return globalProductsCache.filter((row) => {
      const haystack = [row.category, row.brandSubCategory, row.series, row.deviceType, row.condition, row.simType, row.storage, row.vendorName].join(' ').toLowerCase();
      const isExcluded = excludedTokens.some((phrase) => haystack.includes(phrase));
      const cleanStatus = isExcluded ? 'excluded' : row.cleanStatus;

      if (dataViewMode !== 'all' && cleanStatus !== dataViewMode) return false;
      if (selectedVendorFilter !== 'All' && row.vendorName !== selectedVendorFilter) return false;
      if (productCategoryFilter !== 'All' && row.category !== productCategoryFilter) return false;
      if (productConditionFilter !== 'All' && row.condition !== productConditionFilter) return false;
      if (queryText && !haystack.includes(queryText)) return false;
      if (!isWithinDateRange(row.date, startDate, endDate)) return false;

      return true;
    });
  }, [globalProductsCache, excludedPhrases, dataViewMode, selectedVendorFilter, productCategoryFilter, productConditionFilter, productSearchQuery, startDate, endDate]);

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
            Object.entries(variations).forEach(([variationKey, variation]) => {
              rows.push({ category, brand, series, deviceType, variationKey, ...variation });
            });
          });
        });
      });
    });

    if (productSortMode === 'highest_price') {
      rows.sort((a, b) => b.totalAccumulatedPrice - a.totalAccumulatedPrice);
    } else if (productSortMode === 'highest_demand') {
      rows.sort((a, b) => b.stockCount - a.stockCount);
    } else {
      rows.sort((a, b) => {
        const categoryDiff = a.category.localeCompare(b.category);
        if (categoryDiff !== 0) return categoryDiff;
        const deviceDiff = extractDeviceVersion(b.deviceType) - extractDeviceVersion(a.deviceType);
        if (deviceDiff !== 0) return deviceDiff;
        const tierDiff = getDeviceTierWeight(b.deviceType) - getDeviceTierWeight(a.deviceType);
        if (tierDiff !== 0) return tierDiff;
        const conditionDiff = getConditionRank(a.condition) - getConditionRank(b.condition);
        if (conditionDiff !== 0) return conditionDiff;
        const simDiff = getSimRank(a.simType) - getSimRank(b.simType);
        if (simDiff !== 0) return simDiff;
        return getStorageRank(b.storage) - getStorageRank(a.storage);
      });
    }

    return rows;
  }, [groupedGlobalProducts, productSortMode]);

  const totalProductPages = Math.max(1, Math.ceil(flattenedVariations.length / itemsPerPage));

  useEffect(() => {
    setCurrentProductPage(1);
    setExpandedProductGroups([]);
  }, [productSearchQuery, productCategoryFilter, productConditionFilter, productSortMode, selectedVendorFilter, dataViewMode, excludedPhrases, startDate, endDate]);

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
      keys.add(`variation:${row.category}__${row.brand}__${row.series}__${row.deviceType}__${row.variationKey}`);
    });
    return keys;
  }, [paginatedGroupedProducts]);

  useEffect(() => {
    if (currentProductPage > totalProductPages) setCurrentProductPage(totalProductPages);
  }, [currentProductPage, totalProductPages]);

  const uniqueGlobalCategories = useMemo(() => ['All', ...new Set(globalProductsCache.map((row) => row.category))], [globalProductsCache]);
  const uniqueGlobalConditions = useMemo(() => ['All', ...new Set(globalProductsCache.map((row) => row.condition))], [globalProductsCache]);
  const uniqueVendorFilters = useMemo(() => ['All', ...new Set(offlineVendors.map((vendor) => vendor.vendorName).filter(Boolean))], [offlineVendors]);

  const buildProductTreeWithCounts = (rows) => {
    const tree = {};
    rows.forEach((row) => {
      const category = row.category;
      const brand = row.brand;
      const series = row.series;
      const device = row.deviceType;
      const variation = row.variationKey;
      
      tree[category] ??= { count: 0, children: {} };
      tree[category].count += row.stockCount;
      
      tree[category].children[brand] ??= { count: 0, children: {} };
      tree[category].children[brand].count += row.stockCount;
      
      tree[category].children[brand].children[series] ??= { count: 0, children: {} };
      tree[category].children[brand].children[series].count += row.stockCount;
      
      tree[category].children[brand].children[series].children[device] ??= { count: 0, children: {} };
      tree[category].children[brand].children[series].children[device].count += row.stockCount;
      
      tree[category].children[brand].children[series].children[device].children[variation] = row;
    });
    return tree;
  };

  const productTree = useMemo(() => buildProductTreeWithCounts(paginatedGroupedProducts), [paginatedGroupedProducts]);

  const filteredOffline = useMemo(() => offlineVendors.filter((v) => !searchQuery || v.vendorName?.toLowerCase().includes(searchQuery.toLowerCase())), [offlineVendors, searchQuery]);
  const totalPages = Math.max(1, Math.ceil(filteredOffline.length / itemsPerPage));
  useEffect(() => { setCurrentPage(1); }, [searchQuery]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
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

  const analytics = useMemo(() => {
    const vendorSet = new Set(filteredProductRows.map((row) => row.vendorName));
    const totalVendors = offlineVendors.length;
    const filteredVendorCount = vendorSet.size;
    const vendorSource = offlineVendors.filter((vendor) => vendorSet.has(vendor.vendorName));
    const totalInventoryValue = filteredProductRows.reduce((sum, row) => sum + row.priceValue, 0);
    const totalStoreViews = vendorSource.reduce((sum, vendor) => sum + (vendor.viewCount || 0), 0);
    const totalWhatsAppOrders = vendorSource.reduce((sum, vendor) => sum + (vendor.whatsappClicks || 0), 0);

    const deviceFrequency = {};
    filteredProductRows.forEach((row) => {
      deviceFrequency[row.deviceType] = (deviceFrequency[row.deviceType] || 0) + 1;
    });

    const mostTrackedDevice = Object.entries(deviceFrequency).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    const topVendor = [...vendorSource].sort((a, b) => (b.whatsappClicks || 0) - (a.whatsappClicks || 0))[0]?.vendorName || 'N/A';

    return { totalVendors, filteredVendorCount, totalInventoryValue, totalStoreViews, totalWhatsAppOrders, mostTrackedDevice, topVendor };
  }, [offlineVendors, filteredProductRows]);

  const insightCharts = useMemo(() => {
    const categoryCount = {};
    const conditionMap = {};
    const leadMap = {};

    filteredProductRows.forEach((row) => {
      categoryCount[row.category] = (categoryCount[row.category] || 0) + 1;
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
      return { day: date.toLocaleDateString([], { weekday: 'short' }), clicks: leadMap[key] || 0 };
    });

    return {
      categoryMix: Object.entries(categoryCount).map(([name, value]) => ({ name, value })),
      conditionMix: Object.entries(conditionMap).map(([condition, count]) => ({ condition, count })),
      leadVelocity,
    };
  }, [filteredProductRows, offlineVendors, selectedVendorFilter, startDate, endDate]);

  const unreadMessages = useMemo(() => allMessages.filter((message) => message.sender === 'vendor' && !message.readByAdmin), [allMessages]);

  const allFilteredSelected = filteredOffline.length > 0 && filteredOffline.every((vendor) => selectedVendorIds.includes(vendor.docId));
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredOffline.map((vendor) => vendor.docId));
      setSelectedVendorIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      const merged = new Set([...selectedVendorIds, ...filteredOffline.map((vendor) => vendor.docId)]);
      setSelectedVendorIds(Array.from(merged));
    }
  };

  const toggleVendor = (docId) => setSelectedVendorIds((prev) => prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]);
  const toggleProductGroup = (groupKey) => setExpandedProductGroups((prev) => prev.includes(groupKey) ? prev.filter((key) => key !== groupKey) : [...prev, groupKey]);

  const handleCategoryChartClick = (entry) => {
    const category = entry?.name || entry?.payload?.name || entry?.payload?.payload?.name;
    if (!category) return;
    setActiveTab('products');
    setProductCategoryFilter(category);
    setProductSortMode('hierarchy');
  };

  const handleConditionChartClick = (entry) => {
    const condition = entry?.condition || entry?.payload?.condition || entry?.payload?.payload?.condition;
    if (!condition) return;
    setActiveTab('products');
    setProductConditionFilter(condition);
    setProductSortMode('hierarchy');
  };

  const toggleAdvancedTools = async (vendor) => {
    const nextValue = !vendor.advancedEnabled;
    setTogglingAdvancedVendorId(vendor.docId);
    try {
      await updateDoc(doc(db, COLLECTIONS.offline, vendor.docId), { advancedEnabled: nextValue, lastUpdated: new Date().toISOString() });
      setOfflineVendors((prev) => prev.map((item) => item.docId === vendor.docId ? { ...item, advancedEnabled: nextValue, lastUpdated: new Date().toISOString() } : item));
    } catch (error) {
      alert('❌ Failed to update advanced tools toggle.');
    } finally {
      setTogglingAdvancedVendorId(null);
    }
  };

  const bulkUpdateStatus = async (status) => {
    if (!selectedVendorIds.length) return alert('Please select at least one vendor first.');
    setBulkUpdating(true);
    try {
      const batch = writeBatch(db);
      selectedVendorIds.forEach((vendorDocId) => {
        const vendorRef = doc(db, COLLECTIONS.offline, vendorDocId);
        batch.update(vendorRef, { status, lastUpdated: new Date().toISOString() });
      });
      await batch.commit();
      fetchInventory();
      setSelectedVendorIds([]);
      alert(`✅ ${status === 'suspended' ? 'Suspended' : 'Activated'} selected vendors successfully.`);
    } catch (error) {
      alert('❌ Could not update selected vendors.');
    } finally {
      setBulkUpdating(false);
    }
  };

  const openBulkEdit = () => {
    if (!selectedVendorIds.length) return alert('Select at least one vendor first.');
    setBulkCondition(''); setBulkCategory(''); setBulkPrice(''); setBulkEditOpen(true);
  };

  const runBulkEdit = async () => {
    const fields = {};
    if (bulkCondition.trim()) fields.Condition = bulkCondition.trim();
    if (bulkCategory.trim()) fields.Category = bulkCategory.trim();
    if (bulkPrice.trim()) fields['Regular price'] = bulkPrice.trim();
    if (!Object.keys(fields).length) return alert('Please add at least one field update.');

    const selectedVendors = offlineVendors.filter((vendor) => selectedVendorIds.includes(vendor.docId));
    const productIds = [];
    selectedVendors.forEach((vendor) => {
      (vendor.products || []).forEach((_product, index) => productIds.push(`${vendor.docId}::${index}`));
    });

    if (!productIds.length) return alert('No products found for selected vendors.');
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
    if (!window.confirm('Are you sure you want to proceed?')) return;
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

  const companyRows = useMemo(() => pricingRows.map((row) => ({ ...row, __device: String(row['Device Type'] || row.deviceType || '').trim() })), [pricingRows]);

  const pricingCalculations = useMemo(() => {
    const vendorInventory = new Map();
    filteredProductRows
      .filter((row) => !pricingVendor || row.vendorName === pricingVendor)
      .forEach((row) => {
        const key = `${row.deviceType}__${row.condition}__${row.storage}`;
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
  }, [companyRows, filteredProductRows, pricingVendor, pricingMarginType, pricingMarginValue, officialTargets]);

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

  const handleExport = () => {
    const rows = filteredOffline.map(v => ({
      Vendor: v.vendorName, Status: v.status, Views: v.viewCount, Orders: v.whatsappClicks, Products: v.totalProducts, Value: v.inventoryValue, Password: v.vendorPassword
    }));
    downloadCsv('platform-directory.csv', rows);
  };

  const openChatForVendor = async (vendor) => {
    setChatVendor(vendor); setChatOpen(true);
    try {
      const response = await fetch(`${BASE_URL}/api/messages/${vendor.vendorId}`, { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }});
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load conversation');
      setChatMessages(Array.isArray(data.messages) ? data.messages : []);
      fetchAllMessages(); 
    } catch (error) { alert(`❌ ${error.message}`); }
  };

  const sendAdminChat = async () => {
    if (!chatVendor || !chatInput.trim()) return;
    setSendingChat(true);
    try {
      const response = await fetch(`${BASE_URL}/api/messages/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ vendorId: chatVendor.vendorId, sender: 'admin', recipient: 'vendor', text: chatInput.trim() }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Message failed');
      setChatInput(''); setChatMessages((prev) => [...prev, data.message]); fetchAllMessages();
    } catch (error) { alert(`❌ ${error.message}`); } finally { setSendingChat(false); }
  };

  const renderTree = () => (
    Object.entries(productTree).map(([category, categoryNode]) => {
      const categoryKey = `cat:${category}`;
      return (
        <div key={categoryKey} className="rounded-2xl bg-white/10 border border-white/20 p-3 mb-3">
          <button className="w-full text-left font-semibold flex justify-between" onClick={() => toggleProductGroup(categoryKey)}>
            <span>{category} <span className="text-gray-400 text-xs ml-2">({categoryNode.count.toLocaleString()} items)</span></span>
            <span>{expandedProductGroups.includes(categoryKey) ? '⌄' : '›'}</span>
          </button>
          {expandedProductGroups.includes(categoryKey) && Object.entries(categoryNode.children).map(([brand, brandNode]) => {
            const brandKey = `${categoryKey}|brand:${brand}`;
            return (
              <div key={brandKey} className="ml-4 mt-2 border-l border-white/10 pl-3">
                <button className="w-full text-left font-medium text-emerald-400 flex justify-between" onClick={() => toggleProductGroup(brandKey)}>
                  <span>{brand} <span className="text-gray-500 text-xs ml-2">({brandNode.count.toLocaleString()})</span></span>
                  <span>{expandedProductGroups.includes(brandKey) ? '⌄' : '›'}</span>
                </button>
                {expandedProductGroups.includes(brandKey) && Object.entries(brandNode.children).map(([series, seriesNode]) => {
                  const seriesKey = `${brandKey}|series:${series}`;
                  return (
                    <div key={seriesKey} className="ml-4 mt-2 border-l border-white/10 pl-3">
                      <button className="w-full text-left text-blue-400 flex justify-between" onClick={() => toggleProductGroup(seriesKey)}>
                        <span>{series} <span className="text-gray-500 text-xs ml-2">({seriesNode.count.toLocaleString()})</span></span>
                        <span>{expandedProductGroups.includes(seriesKey) ? '⌄' : '›'}</span>
                      </button>
                      {expandedProductGroups.includes(seriesKey) && Object.entries(seriesNode.children).map(([device, deviceNode]) => {
                        const deviceKey = `${seriesKey}|device:${device}`;
                        return (
                          <div key={deviceKey} className="ml-4 mt-2 border-l border-white/10 pl-3">
                            <button className="w-full text-left text-orange-300 font-bold flex justify-between" onClick={() => toggleProductGroup(deviceKey)}>
                              <span>{device} <span className="text-gray-500 text-xs ml-2">({deviceNode.count.toLocaleString()})</span></span>
                              <span>{expandedProductGroups.includes(deviceKey) ? '⌄' : '›'}</span>
                            </button>
                            {expandedProductGroups.includes(deviceKey) && Object.entries(deviceNode.children).map(([variationKeyRaw, variationNode]) => {
                              const variationKey = `${deviceKey}|variation:${variationKeyRaw}`;
                              return (
                                <div key={variationKey} className="ml-4 mt-2 rounded-xl bg-black/20 p-3">
                                  <button className="w-full text-left text-gray-200 text-sm flex justify-between items-center" onClick={() => toggleProductGroup(variationKey)}>
                                    <span className="flex-1">{variationKeyRaw}</span>
                                    <span className="font-black text-emerald-400 mx-4">{formatNaira(variationNode.totalAccumulatedPrice)}</span>
                                    <span className="text-xs bg-white/10 px-2 py-1 rounded">{variationNode.count.toLocaleString()} vendors {expandedProductGroups.includes(variationKey) ? '⌄' : '›'}</span>
                                  </button>
                                  {expandedProductGroups.includes(variationKey) && (
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

  return (
    <AdminDashboardLayout notificationCount={unreadMessages.length} onNotificationClick={() => setNotificationOpen(true)}>
      <section className="min-h-screen bg-[#111111] text-white p-4 md:p-8">
        <div className="max-w-[1400px] mx-auto space-y-5">
          <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-5 shadow-2xl">
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setActiveTab('offline')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'offline' ? 'bg-white/20 text-white' : 'bg-transparent text-gray-400 hover:bg-white/5'}`}>Directory</button>
              <button onClick={() => setActiveTab('products')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'products' ? 'bg-white/20 text-white' : 'bg-transparent text-gray-400 hover:bg-white/5'}`}>Global Products</button>
              <button onClick={() => setActiveTab('insights')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'insights' ? 'bg-white/20 text-white' : 'bg-transparent text-gray-400 hover:bg-white/5'}`}>Insights</button>
              <button onClick={() => setActiveTab('pricing')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'pricing' ? 'bg-white/20 text-white' : 'bg-transparent text-gray-400 hover:bg-white/5'}`}>Pricing Engine</button>
              <button onClick={() => setActiveTab('activity')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'activity' ? 'bg-white/20 text-white' : 'bg-transparent text-gray-400 hover:bg-white/5'}`}>Activity Log</button>
              <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'history' ? 'bg-white/20 text-white' : 'bg-transparent text-gray-400 hover:bg-white/5'}`}>Audit Trail</button>
              <button onClick={() => setActiveTab('promote')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'promote' ? 'bg-white/20 text-white' : 'bg-transparent text-gray-400 hover:bg-white/5'}`}>Promote</button>
              <button onClick={() => setActiveTab('maintenance')} className={`px-4 py-2 rounded-2xl font-bold transition-all ${activeTab === 'maintenance' ? 'bg-white/20 text-white' : 'bg-transparent text-gray-400 hover:bg-white/5'}`}>Backups</button>
              
              <button onClick={syncMasterDictionary} className="ml-auto px-5 py-2 rounded-2xl bg-blue-600 text-white font-black hover:bg-blue-500 transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)]">
                {syncingDictionary ? 'Syncing...' : 'Sync Master Dictionary'}
              </button>
            </div>
          </div>

          {activeTab === 'products' && (
            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 space-y-4 shadow-2xl">
              <div className="grid md:grid-cols-4 gap-3">
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500 placeholder-gray-500" placeholder="Search devices..." value={productSearchQuery} onChange={(e) => setProductSearchQuery(e.target.value)} />
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500 placeholder-gray-500" type="text" list="vendor-search-list" placeholder="Vendor filter (All)" value={selectedVendorFilter === 'All' ? '' : selectedVendorFilter} onChange={(e) => setSelectedVendorFilter(e.target.value.trim() || 'All')} />
                <datalist id="vendor-search-list">{uniqueVendorNames.map((name) => <option key={name} value={name} />)}</datalist>
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500 placeholder-gray-500" placeholder="Excluded phrases (e.g. active, swap)" value={excludedPhrases} onChange={(e) => setExcludedPhrases(e.target.value)} />
                <select className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500 text-white" value={dataViewMode} onChange={(e) => setDataViewMode(e.target.value)}>
                  <option value="all">All Data</option>
                  <option value="clean">Clean Only</option>
                  <option value="unclean">Unclean Data</option>
                  <option value="excluded">Excluded Data</option>
                </select>
              </div>
              <div className="space-y-3 max-h-[70vh] overflow-y-auto custom-scrollbar p-2">{renderTree()}</div>
            </div>
          )}

          {activeTab === 'offline' && (
            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-2xl space-y-6">
              <div className="flex gap-3">
                  <input type="text" placeholder="Search for a WhatsApp Vendor..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-5 py-4 rounded-2xl bg-black/40 border border-white/10 outline-none focus:border-blue-500 placeholder-gray-500" />
                  <button onClick={() => bulkUpdateStatus('suspended')} disabled={!selectedVendorIds.length || bulkUpdating} className="bg-red-600/80 hover:bg-red-500 text-white px-6 py-2 rounded-2xl text-xs font-black uppercase tracking-wider disabled:opacity-50 transition-all">Suspend</button>
                  <button onClick={() => bulkUpdateStatus('active')} disabled={!selectedVendorIds.length || bulkUpdating} className="bg-emerald-600/80 hover:bg-emerald-500 text-white px-6 py-2 rounded-2xl text-xs font-black uppercase tracking-wider disabled:opacity-50 transition-all">Activate</button>
                  <button onClick={handleExport} className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-2xl text-xs font-black uppercase tracking-wider transition-all">Export</button>
              </div>
              
              {selectedVendorIds.length > 0 && (
                <div className="bg-blue-600/20 border border-blue-500/50 text-white px-5 py-4 rounded-2xl flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-bold">{selectedVendorIds.length} vendors selected</p>
                  <button onClick={openBulkEdit} className="bg-blue-600 px-5 py-2.5 rounded-xl text-xs font-black uppercase hover:bg-blue-500">Bulk Edit Categories</button>
                </div>
              )}

               <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
                <table className="w-full text-left text-sm">
                  <thead className="bg-black/40 text-gray-400">
                    <tr>
                      <th className="p-4 pl-6 w-[50px]"><input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-gray-600 bg-transparent" /></th>
                      <th className="p-4 font-black uppercase tracking-widest text-xs">Vendor Name</th>
                      <th className="p-4 font-black uppercase tracking-widest text-xs">Status</th>
                      <th className="p-4 font-black uppercase tracking-widest text-xs">Products</th>
                      <th className="p-4 font-black uppercase tracking-widest text-xs">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {paginatedOffline.map(vendor => (
                      <tr key={vendor.docId} className="hover:bg-white/5 transition-colors">
                        <td className="p-4 pl-6"><input type="checkbox" checked={selectedVendorIds.includes(vendor.docId)} onChange={() => toggleVendor(vendor.docId)} className="w-4 h-4 rounded border-gray-600 bg-transparent" /></td>
                        <td className="p-4 font-bold text-blue-400"><Link to={vendor.shareableLink} target="_blank">{vendor.vendorName}</Link></td>
                        <td className="p-4"><span className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider ${vendor.status === 'suspended' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>{vendor.status}</span></td>
                        <td className="p-4 text-gray-300 font-medium">{vendor.totalProducts} Items</td>
                        <td className="p-4">
                          <Link to={vendor.shareableLink} target="_blank" className="bg-white/10 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-white/20 transition-all mr-2">Manage</Link>
                          <button onClick={() => openChatForVendor(vendor)} className="bg-blue-600/20 text-blue-400 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-blue-600/40 transition-all">Chat</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'insights' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 shadow-xl">
                  <p className="text-[11px] font-extrabold text-gray-500 uppercase tracking-widest">Total Vendors</p>
                  <p className="text-3xl font-black text-white mt-3 leading-none">{analytics.totalVendors}</p>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-3xl p-6 shadow-xl">
                  <p className="text-[11px] font-extrabold text-blue-400 uppercase tracking-widest">Inventory Value</p>
                  <p className="text-[clamp(1.2rem,2.1vw,2rem)] font-black text-blue-400 mt-3 leading-tight">{formatNaira(analytics.totalInventoryValue)}</p>
                </div>
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-3xl p-6 shadow-xl">
                  <p className="text-[11px] font-extrabold text-purple-400 uppercase tracking-widest">Store Views</p>
                  <p className="text-3xl font-black text-purple-400 mt-3 leading-none">{analytics.totalStoreViews}</p>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-6 shadow-xl">
                  <p className="text-[11px] font-extrabold text-emerald-400 uppercase tracking-widest">WA Orders</p>
                  <p className="text-3xl font-black text-emerald-400 mt-3 leading-none">{analytics.totalWhatsAppOrders}</p>
                </div>
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-3xl p-6 shadow-xl">
                  <p className="text-[11px] font-extrabold text-orange-400 uppercase tracking-widest">Top Device</p>
                  <p className="text-lg font-black text-orange-400 mt-3 leading-tight truncate">{analytics.mostTrackedDevice}</p>
                </div>
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-3xl p-6 shadow-xl">
                  <p className="text-[11px] font-extrabold text-rose-400 uppercase tracking-widest">Star Vendor</p>
                  <p className="text-lg font-black text-rose-400 mt-3 leading-tight truncate">{analytics.topVendor}</p>
                </div>
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 h-96 shadow-2xl">
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
                <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 h-96 shadow-2xl">
                  <h3 className="font-bold text-xl mb-4 text-blue-400">Condition Quality</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData.conditionMix}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="condition" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '12px' }} />
                      <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} onClick={(entry) => { if (!entry?.condition) return; setProductConditionFilter(entry.condition); setActiveTab('products'); }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'pricing' && (
            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 space-y-6 shadow-2xl">
              <div>
                <h2 className="text-2xl font-black mb-2 text-orange-400">Pricing Engine</h2>
                <p className="text-gray-400 text-sm">Paste a Google Sheet link. It auto-converts to CSV and maps vendor prices against your master list.</p>
              </div>
              <div className="grid md:grid-cols-5 gap-3">
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 md:col-span-2 outline-none focus:border-blue-500 placeholder-gray-500" placeholder="Paste Google Sheet URL..." value={pricingCsvUrl} onChange={(e) => setPricingCsvUrl(e.target.value)} />
                <button onClick={loadCompanyCsv} className="rounded-2xl bg-blue-600 hover:bg-blue-500 px-4 py-3 font-bold transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)]">Load Sheet</button>
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500 placeholder-gray-500" type="text" list="vendor-search-list" placeholder="Target Vendor" value={pricingVendor} onChange={(e) => setPricingVendor(e.target.value)} />
                <select className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500 text-white" value={pricingMarginType} onChange={(e) => setPricingMarginType(e.target.value)}>
                  <option value="amount">Amount (₦)</option>
                  <option value="percentage">Percentage (%)</option>
                </select>
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500 placeholder-gray-500" placeholder="Margin (e.g. 10000)" value={pricingMarginValue} onChange={(e) => setPricingMarginValue(e.target.value)} />
                <button onClick={exportPricingTxt} className="rounded-2xl bg-emerald-600 hover:bg-emerald-500 px-4 py-3 font-bold transition-all md:col-span-2 lg:col-span-1 shadow-[0_0_15px_rgba(16,185,129,0.4)]">Export to TXT</button>
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
            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-2xl">
              <h2 className="text-xl font-black mb-6 text-white">Platform Activity Log</h2>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                {platformActivityTimeline.map((entry, idx) => (
                  <div key={idx} className="bg-black/20 p-4 rounded-2xl border border-white/5 flex items-start justify-between">
                    <div>
                      <p className="font-bold text-sm text-gray-200">{entry.action}</p>
                      <p className="text-xs text-gray-500 mt-2">{entry.vendorName} • {formatTimelineDate(entry.date)}</p>
                    </div>
                    <span className={`text-[10px] px-3 py-1 rounded-lg font-black uppercase tracking-wider ${entry.channel === 'admin' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>{entry.channel}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-black text-white">Audit Trail</h2>
                <button onClick={fetchAuditLogs} className="text-xs font-black uppercase tracking-wider bg-white/10 hover:bg-white/20 px-5 py-2.5 rounded-xl transition-all">Refresh</button>
              </div>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                {loadingAuditLogs ? <p className="text-sm text-gray-400">Loading audit logs...</p> : auditLogs.length ? auditLogs.map((log) => (
                  <div key={log.id} className="bg-black/20 p-4 rounded-2xl border border-white/5 flex justify-between items-center">
                    <div>
                      <p className="text-sm font-bold text-gray-200">{log.method} {log.path}</p>
                      <p className="text-xs text-gray-500 mt-2">{log.userRole} • {formatTimelineDate(log.timestamp)}</p>
                    </div>
                    <button onClick={() => undoAuditAction(log.id)} disabled={restoringAuditId === log.id} className="bg-red-600/80 hover:bg-red-500 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase disabled:opacity-50 transition-all">
                      {restoringAuditId === log.id ? 'Undoing...' : 'Undo'}
                    </button>
                  </div>
                )) : <p className="text-sm text-gray-400">No audit logs found.</p>}
              </div>
            </div>
          )}

          {activeTab === 'promote' && (
            <div className="space-y-6">
              <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 backdrop-blur-xl p-6 shadow-2xl">
                <h3 className="text-lg font-black text-emerald-400 mb-4">Onboard Vendor</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input value={onboardVendorName} onChange={(e) => setOnboardVendorName(e.target.value)} placeholder="Vendor's Name" className="px-4 py-3 rounded-2xl bg-black/40 border border-white/10 outline-none focus:border-emerald-500 placeholder-gray-500" />
                  <input value={botNumber} onChange={(e) => setBotNumber(e.target.value)} placeholder="Your Admin Bot Number" className="px-4 py-3 rounded-2xl bg-black/40 border border-white/10 outline-none focus:border-emerald-500 placeholder-gray-500" />
                  <button onClick={generateOnboardingLink} className="bg-emerald-600 text-white px-4 py-3 rounded-2xl font-bold hover:bg-emerald-500 transition-all shadow-[0_0_15px_rgba(16,185,129,0.4)]">Generate & Copy Link</button>
                </div>
              </div>

              <div className="rounded-3xl border border-blue-500/20 bg-blue-500/5 backdrop-blur-xl p-6 shadow-2xl">
                <h3 className="text-lg font-black text-blue-400 mb-4">Tutorial Video Manager</h3>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                  <input value={tutorialVideoUrl} onChange={(e) => setTutorialVideoUrl(e.target.value)} placeholder="Paste YouTube link" className="px-4 py-3 rounded-2xl bg-black/40 border border-white/10 outline-none focus:border-blue-500 placeholder-gray-500" />
                  <button onClick={saveTutorialVideo} disabled={savingTutorialVideo} className="bg-blue-600 text-white rounded-2xl px-6 py-3 font-bold hover:bg-blue-500 disabled:opacity-50 transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)]">
                    {savingTutorialVideo ? 'Saving...' : 'Save Video'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'maintenance' && (
            <div className="rounded-3xl border border-red-500/20 bg-red-500/5 backdrop-blur-xl p-6 shadow-2xl">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
                <div>
                  <h2 className="text-2xl font-black text-red-400">System Maintenance</h2>
                  <p className="text-sm text-gray-400 mt-1">Manage platform backups and restore points.</p>
                </div>
                <button onClick={triggerManualBackup} disabled={manualBackupLoading} className="bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-2xl font-black uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(220,38,38,0.4)] disabled:opacity-50">
                  {manualBackupLoading ? 'Running Backup...' : 'Run Manual Backup'}
                </button>
              </div>

              <div className="mb-8 p-5 bg-black/20 border border-white/10 rounded-2xl">
                <label className="inline-flex items-center gap-3 bg-white/10 hover:bg-white/20 text-white px-5 py-3 rounded-xl font-bold cursor-pointer transition-all">
                  {uploadRestoreLoading ? 'Uploading...' : 'Upload & Restore from Local JSON'}
                  <input type="file" accept="application/json,.json" className="hidden" onChange={uploadAndRestoreLocalBackup} disabled={uploadRestoreLoading} />
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-black uppercase tracking-widest text-gray-500">Cloud Backups (Drive)</h3>
                  <button onClick={fetchDriveBackups} className="text-xs font-bold px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl transition-all">Refresh</button>
                </div>

                {loadingDriveBackups ? (
                  <p className="text-sm text-gray-400">Loading cloud backups...</p>
                ) : driveBackups.length ? (
                  <div className="space-y-3 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                    {driveBackups.map((file) => (
                      <div key={file.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 border border-white/10 bg-black/20 rounded-2xl">
                        <div>
                          <p className="text-sm font-bold text-gray-200">{file.name}</p>
                          <p className="text-xs text-gray-500 mt-1">{file.createdTime ? new Date(file.createdTime).toLocaleString() : 'Unknown time'}</p>
                        </div>
                        <button
                          onClick={() => restoreDriveBackup(file.id)}
                          disabled={restoringDriveId === file.id}
                          className="bg-red-600/80 hover:bg-red-500 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                          {restoringDriveId === file.id ? 'Restoring...' : 'Restore'}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 p-4 border border-dashed border-white/10 rounded-2xl text-center">No Drive backups found.</p>
                )}
              </div>
            </div>
          )}

        </div>
      </section>

      {/* Modals & Popups remain outside the main section flow */}
      {bulkEditOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#1A1C23] border border-white/10 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-xl font-black text-white">Bulk Edit Products</h3>
              <button onClick={() => setBulkEditOpen(false)} className="text-gray-500 hover:text-red-500 text-xl transition-colors">✕</button>
            </div>
            <div className="p-6 grid grid-cols-1 gap-4">
              <input value={bulkCondition} onChange={(e) => setBulkCondition(e.target.value)} placeholder="Condition (e.g. Brand New)" className="bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white outline-none focus:border-blue-500" />
              <input value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} placeholder="Category (e.g. Smartphones)" className="bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white outline-none focus:border-blue-500" />
              <input value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} placeholder="Price (e.g. ₦350,000)" className="bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white outline-none focus:border-blue-500" />
            </div>
            <div className="p-6 border-t border-white/10 bg-white/5 flex justify-end gap-3">
              <button onClick={() => setBulkEditOpen(false)} className="px-6 py-3 rounded-xl font-bold text-gray-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={runBulkEdit} disabled={bulkEditLoading} className="px-6 py-3 rounded-xl bg-blue-600 text-white font-black uppercase tracking-wider hover:bg-blue-500 disabled:opacity-50 transition-all">
                {bulkEditLoading ? 'Applying...' : 'Apply Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {notificationOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#1A1C23] border border-white/10 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <h3 className="text-xl font-black text-white">Vendor Messages</h3>
              <button onClick={() => setNotificationOpen(false)} className="text-gray-500 hover:text-red-500 font-bold text-xl transition-colors">✕</button>
            </div>
            <div className="p-6 max-h-[65vh] overflow-y-auto space-y-4">
              {unreadMessages.length > 0 ? unreadMessages.map((message) => (
                <div key={message.id} className="border border-blue-500/30 rounded-2xl p-5 bg-blue-500/5 relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>
                  <div className="flex justify-between items-start mb-3">
                    <p className="text-sm font-black text-white">{message.vendorId}</p>
                    <p className="text-[10px] font-bold text-blue-300 uppercase">{formatTimelineDate(message.timestamp)}</p>
                  </div>
                  <p className="text-sm text-gray-300 font-medium">{message.text}</p>
                  <button 
                    onClick={() => {
                      setNotificationOpen(false);
                      const vendor = offlineVendors.find(v => v.vendorId === message.vendorId);
                      if(vendor) openChatForVendor(vendor);
                    }} 
                    className="mt-4 text-xs font-black text-blue-400 hover:text-blue-300 uppercase tracking-widest transition-colors"
                  >
                    Reply to Vendor &rarr;
                  </button>
                </div>
              )) : (
                <div className="text-center py-12">
                  <span className="text-5xl block mb-4 grayscale opacity-20">📭</span>
                  <p className="text-gray-500 font-bold uppercase tracking-widest">Inbox is zero.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {chatOpen && chatVendor && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#1A1C23] border border-white/10 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col h-[50vh] md:h-[600px]">
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
              <div>
                <h3 className="text-xl font-black text-white">Chat: {chatVendor.vendorName}</h3>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-1">ID: {chatVendor.vendorId}</p>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-gray-500 hover:text-red-500 font-bold text-xl transition-colors">✕</button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto space-y-5 custom-scrollbar">
              {chatMessages.length > 0 ? chatMessages.map((message) => {
                const mine = isAdmin ? message.sender === 'admin' : message.sender === 'vendor';
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-5 py-4 ${mine ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white/10 border border-white/10 text-gray-200 rounded-bl-none'}`}>
                      <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${mine ? 'text-blue-200' : 'text-gray-500'}`}>{mine ? 'You (Admin)' : chatVendor.vendorName}</p>
                      <p className="text-sm whitespace-pre-wrap font-medium leading-relaxed">{message.text}</p>
                      <p className={`text-[9px] font-bold mt-3 ${mine ? 'text-right text-blue-300' : 'text-left text-gray-500'}`}>{formatTimelineDate(message.timestamp)}</p>
                    </div>
                  </div>
                );
              }) : (
                 <div className="h-full flex flex-col items-center justify-center text-gray-500">
                  <span className="text-4xl mb-4 opacity-50">💬</span>
                  <p className="font-bold text-sm uppercase tracking-widest">Start the conversation</p>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-white/10 bg-white/5 flex gap-3">
              <textarea 
                value={chatInput} 
                onChange={(e) => setChatInput(e.target.value)} 
                className="flex-1 bg-black/40 border border-white/10 rounded-2xl p-4 text-sm font-medium text-white placeholder-gray-500 focus:border-blue-500 outline-none resize-none" 
                placeholder="Type your reply to the vendor..." 
                rows={2}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAdminChat(); } }}
              />
              <button onClick={sendAdminChat} disabled={sendingChat || !chatInput.trim()} className="bg-blue-600 text-white px-8 rounded-2xl font-black uppercase tracking-wider disabled:opacity-50 hover:bg-blue-500 transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)]">
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
