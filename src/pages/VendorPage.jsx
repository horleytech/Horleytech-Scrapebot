import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc, getDocs, updateDoc, collection, addDoc, serverTimestamp, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../services/firebase/index.js';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';
import { BASE_URL } from '../services/constants/apiConstants.js';

const MAX_LOG_ITEMS = 200;
const THEME_PRESETS = ['#16a34a', '#1d4ed8', '#7c3aed', '#ea580c'];

const HD_IMAGE_STYLE = {
  imageRendering: '-webkit-optimize-contrast',
  filter: 'contrast(1.1) brightness(1.03) saturate(1.05)',
};

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


const normalizePriceInput = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '0';
  if (/available|negotiable/i.test(raw)) return '0';
  return raw;
};

const toBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  if (typeof value === 'number') return value === 1;
  return fallback;
};

const resolveStore1Visibility = (product) => {
  if (product?.visibleInStore1 !== undefined) return toBoolean(product.visibleInStore1, true);
  return toBoolean(product?.isVisible, true);
};

const resolveStore2Visibility = (product) => {
  if (product?.visibleInStore2 !== undefined) return toBoolean(product.visibleInStore2, false);
  return false;
};

const normalizeDualStoreProduct = (product) => {
  const priceStore1 = normalizePriceInput(product.priceStore1 || product['Store 1 price'] || product.storeOnePrice || product['Regular price'] || '0');
  const priceStore2 = normalizePriceInput(product.priceStore2 || product['Store 2 price'] || product.storeTwoPrice || product['Regular price'] || '0');
  const visibleInStore1 = resolveStore1Visibility(product);
  const visibleInStore2 = resolveStore2Visibility(product);

  return {
    ...product,
    'Regular price': priceStore1,
    priceStore1,
    priceStore2,
    'Store 1 price': priceStore1,
    'Store 2 price': priceStore2,
    visibleInStore1,
    visibleInStore2,
    isVisible: visibleInStore1,
  };
};

const parsePriceValue = (value) => {
  const normalized = normalizePriceInput(value);
  const digits = normalized.replace(/[^0-9.]/g, '');
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Log Helpers
const normalizeLogs = (logs) => ({
  admin: Array.isArray(logs?.admin) ? logs.admin : [],
  vendor: Array.isArray(logs?.vendor) ? logs.vendor : [],
  customer: Array.isArray(logs?.customer) ? logs.customer : [],
});

const appendRollingLog = (logs, channel, entry) => {
  const normalized = normalizeLogs(logs);
  return {
    ...normalized,
    [channel]: [...normalized[channel], entry].slice(-MAX_LOG_ITEMS),
  };
};

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

const buildSpecificationParts = (product) => ({
  specification: product['SIM Type/Model/Processor'] || '',
  storage: product['Storage Capacity/Configuration'] || '',
});

const parseEditFromValues = (specification, storage) => ({
  'SIM Type/Model/Processor': specification,
  'Storage Capacity/Configuration': storage,
});


const toYoutubeEmbedUrl = (url) => {
  if (!url) return '';

  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes('youtu.be')) {
      const id = parsed.pathname.replace('/', '').trim();
      return id ? `https://www.youtube.com/embed/${id}` : '';
    }

    if (parsed.hostname.includes('youtube.com')) {
      const id = parsed.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}`;

      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const embedIndex = pathParts.findIndex((part) => part === 'embed');
      if (embedIndex !== -1 && pathParts[embedIndex + 1]) {
        return `https://www.youtube.com/embed/${pathParts[embedIndex + 1]}`;
      }
    }
  } catch (error) {
    return '';
  }

  return '';
};

// Security Gate UI
const VendorLogin = ({ vendorName, onSubmit, passwordValue, setPasswordValue, error }) => {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-[95%] mx-auto max-w-md bg-white border border-gray-200 rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🔒</span>
          </div>
          <h2 className="text-2xl font-black text-[#1A1C23]">Private Access</h2>
          <p className="text-sm text-gray-500 mt-2">
            Enter the password to manage <strong>{vendorName || 'this store'}</strong>
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="space-y-6"
        >
          <div>
            <label className="block text-xs font-black text-gray-400 uppercase mb-2">Access Password</label>
            <input
              type="password"
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              className="w-full p-4 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold bg-gray-50"
              placeholder="••••••••"
              autoFocus
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-xs font-bold rounded-lg border border-red-100">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-[#1A1C23] text-white py-4 rounded-xl font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95"
          >
            Unlock Dashboard
          </button>
        </form>
      </div>
    </div>
  );
};

VendorLogin.propTypes = {
  vendorName: PropTypes.string,
  onSubmit: PropTypes.func.isRequired,
  passwordValue: PropTypes.string.isRequired,
  setPasswordValue: PropTypes.func.isRequired,
  error: PropTypes.string,
};

VendorLogin.defaultProps = {
  vendorName: '',
  error: '',
};

const VendorPage = () => {
  const { vendorId } = useParams();
  const isAdmin = useSelector((state) => state.auth?.isAuthenticated);
  const logChannel = isAdmin ? 'admin' : 'vendor';

  const [vendorData, setVendorData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticatedVendor, setIsAuthenticatedVendor] = useState(false);
  const [vendorPasswordEntry, setVendorPasswordEntry] = useState('');
  const [vendorLoginError, setVendorLoginError] = useState('');

  const [mainTab, setMainTab] = useState('settings');
  const [dateFilter, setDateFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [groupFilter, setGroupFilter] = useState('All');
  const [selectedProductIndexes, setSelectedProductIndexes] = useState([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);

  // Settings & Advanced State
  const [savingSettings, setSavingSettings] = useState(false);
  const [runningAutoFix, setRunningAutoFix] = useState(false);
  const [aiAction, setAiAction] = useState('fix');
  const [aiTarget, setAiTarget] = useState('all');
  const [togglingAdvanced, setTogglingAdvanced] = useState(false);
  const [vendorNameInput, setVendorNameInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [storeDescriptionInput, setStoreDescriptionInput] = useState('');
  const [themeColorInput, setThemeColorInput] = useState('#16a34a');
  const [storeLayoutInput, setStoreLayoutInput] = useState('classic');
  const [logoBase64, setLogoBase64] = useState('');
  const [whatsappNumbersInput, setWhatsappNumbersInput] = useState(['', '', '']);
  const [storeWhatsappNumberInput, setStoreWhatsappNumberInput] = useState('');
  const [vendorPasswordInput, setVendorPasswordInput] = useState('');
  const [allowedGroups, setAllowedGroups] = useState([]);
  const [tutorialVideoUrl, setTutorialVideoUrl] = useState('');
  const [businessTypeInput, setBusinessTypeInput] = useState('Other');
  const [storefrontDisplayLimit, setStorefrontDisplayLimit] = useState(20);
  const [tinbrLinksEnabled, setTinbrLinksEnabled] = useState(true);
  const [showBothTinbrAndNormalLinks, setShowBothTinbrAndNormalLinks] = useState(true);
  const [tinbrVendorLinkInput, setTinbrVendorLinkInput] = useState('');
  const [tinbrStoreOneLinkInput, setTinbrStoreOneLinkInput] = useState('');
  const [tinbrStoreTwoLinkInput, setTinbrStoreTwoLinkInput] = useState('');

  // Timeline & Chat State
  const [timelineTab, setTimelineTab] = useState('vendor');
  const [activityLogs, setActivityLogs] = useState(normalizeLogs());
  const [supportMessages, setSupportMessages] = useState([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportInput, setSupportInput] = useState('');
  const [sendingSupportMessage, setSendingSupportMessage] = useState(false);
  const [shorteningLinkKey, setShorteningLinkKey] = useState('');

  // Inline Edit State
  const [editingIndex, setEditingIndex] = useState(null);
  const [editDeviceType, setEditDeviceType] = useState('');
  const [editSpecification, setEditSpecification] = useState('');
  const [editStorage, setEditStorage] = useState('');
  const [editCondition, setEditCondition] = useState('');
  const [editPriceStore1, setEditPriceStore1] = useState('');
  const [editPriceStore2, setEditPriceStore2] = useState('');
  const [editVisStore1, setEditVisStore1] = useState(true);
  const [editVisStore2, setEditVisStore2] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [inventoryView, setInventoryView] = useState('all');
  const [manualDeviceName, setManualDeviceName] = useState('');
  const [manualCategory, setManualCategory] = useState('Smartphones');
  const [manualBrand, setManualBrand] = useState('');
  const [manualCondition, setManualCondition] = useState('');
  const [manualSpec, setManualSpec] = useState('');
  const [manualStorage, setManualStorage] = useState('');
  const [manualPriceStore1, setManualPriceStore1] = useState('');
  const [manualPriceStore2, setManualPriceStore2] = useState('');
  const [manualGroupName, setManualGroupName] = useState('Manual Entry');
  const [addingManualProduct, setAddingManualProduct] = useState(false);

  const vendorRef = useMemo(() => doc(db, 'horleyTech_OfflineInventories', vendorId), [vendorId]);

  const saveAuditLog = async (action, channelOverride = logChannel) => {
    if (!action) return;
    const date = new Date().toISOString();
    setActivityLogs((prev) => appendRollingLog(prev, channelOverride, { action, date }));
    try {
      await addDoc(collection(db, 'horleyTech_OfflineInventories', vendorId, 'activityLogs'), {
        action,
        channel: channelOverride,
        date,
        actor: channelOverride,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      console.error('Failed to save activity log entry:', error);
    }
  };

  const saveAuditLogs = async (actions = [], channelOverride = logChannel) => {
    const normalizedActions = actions.map((action) => String(action || '').trim()).filter(Boolean);
    if (!normalizedActions.length) return;
    await Promise.all(normalizedActions.map((action) => saveAuditLog(action, channelOverride)));
  };

  const syncVendorFromFirebase = useCallback(async () => {
    const freshSnap = await getDoc(vendorRef);
    if (!freshSnap.exists()) return null;

    const payload = freshSnap.data() || {};
    const normalizedProducts = (Array.isArray(payload.products) ? payload.products : []).map((product) => normalizeDualStoreProduct(product));
    const existingNumbers = Array.isArray(payload.whatsappNumbers) ? payload.whatsappNumbers : [];
    const existingAllowedGroups = Array.isArray(payload.storefrontAllowedGroups) ? payload.storefrontAllowedGroups : [];

    setVendorData({
      ...payload,
      products: normalizedProducts,
      logs: normalizeLogs(payload.logs),
    });
    setVendorNameInput(payload.vendorName || '');
    setAddressInput(payload.address || '');
    setStoreDescriptionInput(payload.storeDescription || '');
    setThemeColorInput(payload.themeColor || '#16a34a');
    setStoreLayoutInput(payload.storeLayout || 'classic');
    setLogoBase64(payload.logoBase64 || '');
    setAllowedGroups(existingAllowedGroups);
    setStoreWhatsappNumberInput(payload.storeWhatsappNumber || '');
    setVendorPasswordInput(payload.vendorPassword || '');
    setWhatsappNumbersInput([
      existingNumbers[0] || '',
      existingNumbers[1] || '',
      existingNumbers[2] || '',
    ]);
    setBusinessTypeInput(payload.metaData || payload.businessType || 'Other');
    setStorefrontDisplayLimit(Number(payload.storefrontDisplayLimit) > 0 ? Number(payload.storefrontDisplayLimit) : 20);
    setTinbrLinksEnabled((payload.tinyLinksEnabled ?? payload.tinbrLinksEnabled) !== false);
    setShowBothTinbrAndNormalLinks((payload.showBothTinyAndNormalLinks ?? payload.showBothTinbrAndNormalLinks) !== false);
    setTinbrVendorLinkInput(String(payload.tinyVendorLink || payload.tinbrVendorLink || ''));
    setTinbrStoreOneLinkInput(String(payload.tinyStoreOneLink || payload.tinbrStoreOneLink || ''));
    setTinbrStoreTwoLinkInput(String(payload.tinyStoreTwoLink || payload.tinbrStoreTwoLink || ''));
    return payload;
  }, [vendorRef]);

  const loadActivityLogs = useCallback(async () => {
    try {
      const logsRef = collection(db, 'horleyTech_OfflineInventories', vendorId, 'activityLogs');
      const logsQuery = query(logsRef, orderBy('date', 'desc'), limit(MAX_LOG_ITEMS * 3));
      const logsSnap = await getDocs(logsQuery);
      const nextLogs = normalizeLogs({});

      logsSnap.forEach((docSnap) => {
        const payload = docSnap.data() || {};
        const channel = ['admin', 'vendor', 'customer'].includes(payload.channel) ? payload.channel : 'vendor';
        const action = String(payload.action || '').trim();
        const date = String(payload.date || '').trim();
        if (!action || !date) return;
        nextLogs[channel].push({ action, date });
      });

      setActivityLogs(nextLogs);
    } catch (error) {
      console.error('Failed to load activity logs subcollection:', error);
    }
  }, [vendorId]);

  useEffect(() => {
    const fetchVendorData = async () => {
      try {
        const payload = await syncVendorFromFirebase();
        if (payload) {
          const originalProducts = Array.isArray(payload.products) ? payload.products : [];
          const normalizedProducts = originalProducts.map((product) => normalizeDualStoreProduct(product));
          const productsChanged = JSON.stringify(originalProducts) !== JSON.stringify(normalizedProducts);
          setActivityLogs(normalizeLogs(payload.logs));

          const shouldUseTinyByDefault = (payload.tinyLinksEnabled ?? payload.tinbrLinksEnabled) !== false;
          const currentVendorTinyLink = String(payload.tinyVendorLink || payload.tinbrVendorLink || '').trim();
          const currentStoreOneTinyLink = String(payload.tinyStoreOneLink || payload.tinbrStoreOneLink || '').trim();
          const currentStoreTwoTinyLink = String(payload.tinyStoreTwoLink || payload.tinbrStoreTwoLink || '').trim();
          if (shouldUseTinyByDefault && (currentVendorTinyLink === '' || currentStoreOneTinyLink === '' || currentStoreTwoTinyLink === '')) {
            const autoPatch = {};
            const vendorNormal = `${window.location.origin}/vendor/${vendorId}`;
            const storeOneNormal = `${window.location.origin}/store/1/${vendorId}`;
            const storeTwoNormal = `${window.location.origin}/store/2/${vendorId}`;
            try {
              if (currentVendorTinyLink === '') {
                autoPatch.tinbrVendorLink = await createTinyUrl(vendorNormal);
                autoPatch.tinyVendorLink = autoPatch.tinbrVendorLink;
                setTinbrVendorLinkInput(autoPatch.tinbrVendorLink);
              }
              if (currentStoreOneTinyLink === '') {
                autoPatch.tinbrStoreOneLink = await createTinyUrl(storeOneNormal);
                autoPatch.tinyStoreOneLink = autoPatch.tinbrStoreOneLink;
                setTinbrStoreOneLinkInput(autoPatch.tinbrStoreOneLink);
              }
              if (currentStoreTwoTinyLink === '') {
                autoPatch.tinbrStoreTwoLink = await createTinyUrl(storeTwoNormal);
                autoPatch.tinyStoreTwoLink = autoPatch.tinbrStoreTwoLink;
                setTinbrStoreTwoLinkInput(autoPatch.tinbrStoreTwoLink);
              }
              if (Object.keys(autoPatch).length) {
                await updateDoc(vendorRef, {
                  ...autoPatch,
                  tinbrLinksEnabled: true,
                  tinyLinksEnabled: true,
                  showBothTinbrAndNormalLinks: (payload.showBothTinyAndNormalLinks ?? payload.showBothTinbrAndNormalLinks) !== false,
                  showBothTinyAndNormalLinks: (payload.showBothTinyAndNormalLinks ?? payload.showBothTinbrAndNormalLinks) !== false,
                  lastUpdated: new Date().toISOString(),
                });
                setVendorData((prev) => ({
                  ...prev,
                  ...autoPatch,
                  tinbrLinksEnabled: true,
                  tinyLinksEnabled: true,
                  showBothTinbrAndNormalLinks: (payload.showBothTinyAndNormalLinks ?? payload.showBothTinbrAndNormalLinks) !== false,
                  showBothTinyAndNormalLinks: (payload.showBothTinyAndNormalLinks ?? payload.showBothTinbrAndNormalLinks) !== false,
                }));
              }
            } catch (tinyError) {
              console.error('Auto TinyURL generation failed:', tinyError);
            }
          }

          if (productsChanged) {
            await updateDoc(vendorRef, {
              products: normalizedProducts,
              lastUpdated: new Date().toISOString(),
            });
          }

          await loadActivityLogs();

        } else {
          setVendorData(null);
        }
      } catch (err) {
        console.error('Error fetching vendor:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchVendorData();
  }, [vendorRef, loadActivityLogs, syncVendorFromFirebase, vendorId]);

  useEffect(() => {
    fetchTutorialVideo();
  }, []);

  const products = useMemo(() => vendorData?.products || [], [vendorData]);

  const uniqueGroups = useMemo(() => {
    const filteredProducts = products.filter((product) => {
      const productGroup = product.groupName || 'Direct Message';
      return allowedGroups.length > 0 ? allowedGroups.includes(productGroup) : true;
    });

    return ['All', ...new Set(filteredProducts.map((p) => p.groupName || 'Direct Message'))];
  }, [products, allowedGroups]);
  const sourceGroups = useMemo(() => [...new Set(products.map((p) => p.groupName || 'Direct Message'))], [products]);
  const uniqueCategories = useMemo(() => ['All', ...new Set(products.map((p) => p.Category).filter(Boolean))], [products]);

  useEffect(() => {
    if (!loading && sourceGroups.length > 0 && allowedGroups.length === 0) {
      setAllowedGroups(sourceGroups);
    }
  }, [loading, sourceGroups, allowedGroups.length]);

  const displayData = useMemo(() => {
    if (!products.length) return [];
    const now = new Date();

    return products
      .map((product, index) => ({ product, index }))
      .filter(({ product }) => {
        let passesDate = true;
        if (dateFilter !== 'All' && product.DatePosted) {
          const postDate = new Date(product.DatePosted);
          const diffDays = Math.ceil(Math.abs(now - postDate) / (1000 * 60 * 60 * 24));
          if (dateFilter === 'This Week') passesDate = diffDays <= 7;
          if (dateFilter === 'This Month') passesDate = diffDays <= 30;
        }

        const passesCategory = categoryFilter === 'All' || product.Category === categoryFilter;
        const productGroup = product.groupName || 'Direct Message';
        const passesGroup = groupFilter === 'All' || productGroup === groupFilter;
        const passesAllowedGroup = allowedGroups.length > 0 ? allowedGroups.includes(productGroup) : true;

        return passesDate && passesCategory && passesGroup && passesAllowedGroup;
      });
  }, [products, dateFilter, categoryFilter, groupFilter, allowedGroups]);

  const getInventoryPriceByView = (product, view = 'all') => {
    if (view === 'store1') return normalizePriceInput(product.priceStore1 || product['Store 1 price'] || product.storeOnePrice || product['Regular price'] || '0');
    if (view === 'store2') return normalizePriceInput(product.priceStore2 || product['Store 2 price'] || product.storeTwoPrice || product['Regular price'] || '0');
    return normalizePriceInput(product['Regular price'] || '0');
  };

  const getInventoryPreviewImage = (product) => {
    if (inventoryView === 'store1') return product.productImageStore1Base64 || product.productImageBase64 || product.productImageStore2Base64 || '';
    if (inventoryView === 'store2') return product.productImageStore2Base64 || product.productImageBase64 || product.productImageStore1Base64 || '';
    return product.productImageBase64 || product.productImageStore1Base64 || product.productImageStore2Base64 || '';
  };

  const handleAddManualProduct = async () => {
    const deviceType = String(manualDeviceName || '').trim();
    const priceStore1 = normalizePriceInput(manualPriceStore1);
    if (!deviceType) {
      alert('Device name is required.');
      return;
    }

    setAddingManualProduct(true);
    try {
      const now = new Date();
      const exactServerDate = now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' });
      const normalizedStore2 = normalizePriceInput(manualPriceStore2);
      const nextProduct = normalizeDualStoreProduct({
        Category: String(manualCategory || '').trim() || 'Others',
        Brand: String(manualBrand || '').trim(),
        Series: 'Manual Entry',
        'Device Type': deviceType,
        Condition: String(manualCondition || '').trim(),
        'SIM Type/Model/Processor': String(manualSpec || '').trim(),
        'Storage Capacity/Configuration': String(manualStorage || '').trim(),
        'Regular price': priceStore1,
        priceStore1,
        priceStore2: normalizedStore2,
        'Store 1 price': priceStore1,
        'Store 2 price': normalizedStore2,
        DatePosted: exactServerDate,
        isGroupMessage: false,
        groupName: String(manualGroupName || '').trim() || 'Manual Entry',
        trustedFastLane: false,
        ignored: false,
        ignoreReason: '',
        confidenceScore: 100,
        confidenceLevel: 'high',
        variationId: null,
        isVisible: true,
        visibleInStore1: true,
        visibleInStore2: false,
      });

      const existingProducts = Array.isArray(vendorData?.products) ? vendorData.products : [];
      const nextProducts = [...existingProducts, nextProduct];
      await updateDoc(vendorRef, {
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
      });

      setVendorData((prev) => ({
        ...(prev || {}),
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
      }));
      await saveAuditLog(`Added manual product ${deviceType}`, logChannel);

      setManualDeviceName('');
      setManualBrand('');
      setManualCondition('');
      setManualSpec('');
      setManualStorage('');
      setManualPriceStore1('');
      setManualPriceStore2('');
      setManualGroupName('Manual Entry');
      alert('✅ Product added successfully.');
    } catch (error) {
      console.error('Manual add product failed:', error);
      alert('Failed to add product.');
    } finally {
      setAddingManualProduct(false);
    }
  };

  const inventoryRows = useMemo(() => displayData
    .filter(({ product }) => {
      if (inventoryView === 'store1') return resolveStore1Visibility(product);
      if (inventoryView === 'store2') return resolveStore2Visibility(product);
      return true;
    })
    .map((entry) => ({
      ...entry,
      displayPrice: getInventoryPriceByView(entry.product, inventoryView),
    })), [displayData, inventoryView]);

  const allVisibleRowsSelected = inventoryRows.length > 0 && inventoryRows.every(({ index }) => selectedProductIndexes.includes(index));

  const marketTrend = useMemo(() => {
    const now = Date.now();
    const thisWeek = [];
    const lastWeek = [];
    const vendorOnlyRows = products.filter((product) => product.isVisible !== false);

    vendorOnlyRows.forEach((product) => {
      const postedAt = new Date(product.DatePosted || product.lastUpdated || 0).getTime();
      if (!postedAt) return;
      const ageDays = (now - postedAt) / (1000 * 60 * 60 * 24);
      const price = parsePriceValue(product['Regular price']);
      if (ageDays <= 7) thisWeek.push(price);
      if (ageDays > 7 && ageDays <= 14) lastWeek.push(price);
    });

    const avg = (arr) => (arr.length ? arr.reduce((sum, item) => sum + item, 0) / arr.length : 0);
    const thisWeekAvg = avg(thisWeek);
    const lastWeekAvg = avg(lastWeek);
    const direction = thisWeekAvg >= lastWeekAvg ? 'up' : 'down';

    return { thisWeekAvg, lastWeekAvg, direction };
  }, [products]);

  const storefrontProducts = useMemo(
    () => displayData.map(({ product }) => product).filter((product) => resolveStore1Visibility(product) || resolveStore2Visibility(product)),
    [displayData]
  );

  const exportLines = useMemo(() => (
    storefrontProducts.map((product) => {
      const category = product.Category || 'Others';
      const brand = product.Brand || 'Others';
      const device = product['Device Type'] || 'Unknown Device';
      const p1 = normalizePriceInput(product.priceStore1 || product['Regular price']);
      const p2 = normalizePriceInput(product.priceStore2 || product['Regular price']);
      return `${category} -> ${brand} -> ${device} -> Store 1: ${p1} | Store 2: ${p2}`;
    })
  ), [storefrontProducts]);


  const handleVendorPasswordSubmit = () => {
    if (!vendorData?.vendorPassword) {
      setIsAuthenticatedVendor(true);
      return;
    }

    if (vendorPasswordEntry === vendorData.vendorPassword) {
      setIsAuthenticatedVendor(true);
      setVendorLoginError('');
    } else {
      setVendorLoginError('Incorrect password. Please try again.');
    }
  };

  const requiresVendorAuth = Boolean(vendorData?.vendorPassword) && !isAdmin && !isAuthenticatedVendor;

  const fetchTutorialVideo = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/settings/tutorial-video`, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not load tutorial video');
      setTutorialVideoUrl(data.youtubeUrl || '');
    } catch (error) {
      console.error('Tutorial video fetch failed:', error);
    }
  };

  const tutorialVideoEmbedUrl = useMemo(() => toYoutubeEmbedUrl(tutorialVideoUrl), [tutorialVideoUrl]);

  const handleExport = () => {
    const rows = displayData.map(({ product }) => ({
      Group: product.groupName || 'Direct Message',
      Device: product['Device Type'] || '',
      Condition: product.Condition || '',
      Specification: product['SIM Type/Model/Processor'] || '',
      Storage: product['Storage Capacity/Configuration'] || '',
      'Price Store 1': product.priceStore1 || product['Regular price'] || '',
      'Price Store 2': product.priceStore2 || product['Regular price'] || '',
      'Store 1 Status': resolveStore1Visibility(product) ? 'Visible' : 'Hidden',
      'Store 2 Status': resolveStore2Visibility(product) ? 'Visible' : 'Hidden',
    }));
    downloadCsv(`${vendorData?.vendorName || 'Vendor'}-inventory.csv`, rows);
  };

  const handleCopyLink = async (link) => {
    await navigator.clipboard.writeText(link);
    alert(`✅ Link copied to clipboard!\n\n${link}`);
  };

  const handleTinyUrlCopy = async (link, keyLabel) => {
    if (!link || !/^https?:\/\//i.test(link)) {
      alert('❌ Invalid link. Please provide a full URL first.');
      return;
    }

    setShorteningLinkKey(keyLabel);
    try {
      const tinyUrlRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(link)}`);
      const shortUrl = await tinyUrlRes.text();
      if (!tinyUrlRes.ok || !/^https?:\/\//i.test(shortUrl)) {
        throw new Error('TinyURL generation failed.');
      }

      if (isAdmin && (keyLabel === 'vendor' || keyLabel === 'store1' || keyLabel === 'store2')) {
        const fieldName = keyLabel === 'vendor' ? 'tinbrVendorLink' : keyLabel === 'store1' ? 'tinbrStoreOneLink' : 'tinbrStoreTwoLink';
        const tinyFieldName = keyLabel === 'vendor' ? 'tinyVendorLink' : keyLabel === 'store1' ? 'tinyStoreOneLink' : 'tinyStoreTwoLink';
        const actionLabel = keyLabel === 'vendor' ? 'Updated Tiny Vendor Link' : keyLabel === 'store1' ? 'Updated Tiny Store 1 Link' : 'Updated Tiny Store 2 Link';

        await updateDoc(vendorRef, {
          [fieldName]: shortUrl,
          [tinyFieldName]: shortUrl,
          lastUpdated: new Date().toISOString(),
        });
        await saveAuditLog(actionLabel, 'admin');
        await syncVendorFromFirebase();

        if (keyLabel === 'vendor') setTinbrVendorLinkInput(shortUrl);
        else if (keyLabel === 'store1') setTinbrStoreOneLinkInput(shortUrl);
        else setTinbrStoreTwoLinkInput(shortUrl);
      }

      await navigator.clipboard.writeText(shortUrl);
      alert(`✅ Shortened link copied to clipboard!\n\n${shortUrl}`);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setShorteningLinkKey('');
    }
  };

  const createTinyUrl = async (link) => {
    if (!link || !/^https?:\/\//i.test(link)) return '';
    const tinyUrlRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(link)}`);
    const shortUrl = await tinyUrlRes.text();
    if (!tinyUrlRes.ok || !/^https?:\/\//i.test(shortUrl)) {
      throw new Error('TinyURL generation failed.');
    }
    return shortUrl;
  };

  const saveLinkPreference = async (patch, actionLabel) => {
    if (!isAdmin) return;
    const nextPatch = { ...patch };

    if (patch.tinbrLinksEnabled === true) {
      const vendorNormal = `${window.location.origin}/vendor/${vendorId}`;
      const storeOneNormal = `${window.location.origin}/store/1/${vendorId}`;
      const storeTwoNormal = `${window.location.origin}/store/2/${vendorId}`;
      try {
        if (!String(vendorData?.tinyVendorLink || vendorData?.tinbrVendorLink || '').trim()) {
          nextPatch.tinbrVendorLink = await createTinyUrl(vendorNormal);
          nextPatch.tinyVendorLink = nextPatch.tinbrVendorLink;
          setTinbrVendorLinkInput(nextPatch.tinbrVendorLink);
        }
        if (!String(vendorData?.tinyStoreOneLink || vendorData?.tinbrStoreOneLink || '').trim()) {
          nextPatch.tinbrStoreOneLink = await createTinyUrl(storeOneNormal);
          nextPatch.tinyStoreOneLink = nextPatch.tinbrStoreOneLink;
          setTinbrStoreOneLinkInput(nextPatch.tinbrStoreOneLink);
        }
        if (!String(vendorData?.tinyStoreTwoLink || vendorData?.tinbrStoreTwoLink || '').trim()) {
          nextPatch.tinbrStoreTwoLink = await createTinyUrl(storeTwoNormal);
          nextPatch.tinyStoreTwoLink = nextPatch.tinbrStoreTwoLink;
          setTinbrStoreTwoLinkInput(nextPatch.tinbrStoreTwoLink);
        }
      } catch (error) {
        console.error('Failed to auto-generate TinyURL links:', error);
      }
    }

    try {
      await updateDoc(vendorRef, {
        ...nextPatch,
        ...(Object.prototype.hasOwnProperty.call(nextPatch, 'tinbrLinksEnabled') ? { tinyLinksEnabled: Boolean(nextPatch.tinbrLinksEnabled) } : {}),
        ...(Object.prototype.hasOwnProperty.call(nextPatch, 'showBothTinbrAndNormalLinks') ? { showBothTinyAndNormalLinks: Boolean(nextPatch.showBothTinbrAndNormalLinks) } : {}),
        lastUpdated: new Date().toISOString(),
      });
      await saveAuditLog(actionLabel, 'admin');
      await syncVendorFromFirebase();
    } catch (error) {
      console.error('Failed to save link preference:', error);
      alert('❌ Could not save link preference.');
    }
  };

  const toggleSelectAll = () => {
    if (allVisibleRowsSelected) {
      const visibleSet = new Set(inventoryRows.map(({ index }) => index));
      setSelectedProductIndexes((prev) => prev.filter((idx) => !visibleSet.has(idx)));
    } else {
      const merged = new Set([...selectedProductIndexes, ...inventoryRows.map(({ index }) => index)]);
      setSelectedProductIndexes(Array.from(merged));
    }
  };

  const toggleProductSelection = (index) => {
    setSelectedProductIndexes((prev) =>
      prev.includes(index) ? prev.filter((idx) => idx !== index) : [...prev, index]
    );
  };

  const toggleAllowedGroup = (group) => {
    setAllowedGroups((prev) =>
      prev.includes(group) ? prev.filter((entry) => entry !== group) : [...prev, group]
    );
  };

  const compressImageToBase64 = (file, options = {}) =>
    new Promise((resolve, reject) => {
      const {
        square = false,
        canvasSize = 150,
        maxWidth = 1280,
        maxHeight = 1280,
        qualityStart = 0.84,
        minQuality = 0.5,
        targetKB = 140,
        format = 'image/webp',
      } = options;

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas rendering context unavailable'));
            return;
          }

          let drawWidth;
          let drawHeight;
          if (square) {
            canvas.width = canvasSize;
            canvas.height = canvasSize;
            drawWidth = canvasSize;
            drawHeight = canvasSize;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvasSize, canvasSize);
            const scale = Math.min(canvasSize / img.width, canvasSize / img.height);
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const x = (canvasSize - scaledWidth) / 2;
            const y = (canvasSize - scaledHeight) / 2;
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
          } else {
            const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
            drawWidth = Math.max(1, Math.round(img.width * scale));
            drawHeight = Math.max(1, Math.round(img.height * scale));
            canvas.width = drawWidth;
            canvas.height = drawHeight;
            ctx.drawImage(img, 0, 0, drawWidth, drawHeight);
          }

          let quality = qualityStart;
          let result = canvas.toDataURL(format, quality);
          const targetChars = targetKB * 1024 * 1.37; // base64 overhead approximation

          while (result.length > targetChars && quality > minQuality) {
            quality = Math.max(minQuality, quality - 0.06);
            result = canvas.toDataURL(format, quality);
          }

          resolve(result);
        };
        img.onerror = reject;
        img.src = event.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleLogoChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const base64 = await compressImageToBase64(file, {
        square: true,
        canvasSize: 150,
        targetKB: 35,
        format: 'image/webp',
        qualityStart: 0.82,
      });
      setLogoBase64(base64);
    } catch (error) {
      console.error('Logo compression failed:', error);
      alert('❌ Could not process image. Try another file.');
    }
  };

  const handleProductImageUpload = async (index, file, target = 'both') => {
    if (!file) return;

    try {
      const thumbBase64 = await compressImageToBase64(file, {
        maxWidth: 1280,
        maxHeight: 1280,
        targetKB: 140,
        format: 'image/webp',
        qualityStart: 0.86,
      });
      const nextProducts = products.map((product, pIndex) => {
        if (pIndex !== index) return product;

        if (target === 'store1') {
          return {
            ...product,
            productImageStore1Base64: thumbBase64,
          };
        }

        if (target === 'store2') {
          return {
            ...product,
            productImageStore2Base64: thumbBase64,
          };
        }

        return {
          ...product,
          productImageBase64: thumbBase64,
          productImageStore1Base64: thumbBase64,
          productImageStore2Base64: thumbBase64,
        };
      });

      const targetLabel = target === 'both' ? 'Store 1 + Store 2' : target === 'store1' ? 'Store 1' : 'Store 2';

      await updateDoc(vendorRef, {
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
      });
      await saveAuditLog(`Updated Product Image (${targetLabel})`, logChannel);
      await syncVendorFromFirebase();

      alert('✅ Product image updated.');
    } catch (error) {
      console.error('Product image update failed:', error);
      alert('❌ Could not update product image.');
    }
  };

  const updateSelectedVisibility = async (storeKey, isVisible) => {
    if (!selectedProductIndexes.length) {
      alert('Please select one or more products first.');
      return;
    }

    const nextProducts = products.map((product, index) => {
      if (!selectedProductIndexes.includes(index)) return product;
      if (storeKey === 'store1') return { ...product, visibleInStore1: isVisible, isVisible };
      if (storeKey === 'store2') return { ...product, visibleInStore2: isVisible };
      return product;
    });

    setBulkUpdating(true);
    try {
      await updateDoc(vendorRef, {
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
      });
      await saveAuditLog(`Updated visibility in ${storeKey} for ${selectedProductIndexes.length} items`, logChannel);
      await syncVendorFromFirebase();
      setSelectedProductIndexes([]);
      alert('✅ Selected products updated.');
    } catch (error) {
      console.error('Error updating product visibility:', error);
      alert('❌ Could not update product visibility.');
    } finally {
      setBulkUpdating(false);
    }
  };

  const runAiAutoFix = async () => {
    if (!products.length) {
      alert('No products available for AI processing.');
      return;
    }

    const validSelectedIndexes = Array.from(new Set(selectedProductIndexes))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < products.length);

    if (aiTarget === 'selected' && !validSelectedIndexes.length) {
      alert('Please select one or more products first.');
      return;
    }

    const targetIndexes = aiTarget === 'selected'
      ? validSelectedIndexes
      : products.map((_, index) => index);

    const targetProducts = targetIndexes.map((index) => products[index]).filter(Boolean);

    if (!targetProducts.length) {
      alert('No products available for this target.');
      return;
    }

    setRunningAutoFix(true);
    try {
      const response = await fetch(`${BASE_URL}/api/ai/fix-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ products: targetProducts, actionType: aiAction }),
      });

      const data = await response.json();
      if (!response.ok || !Array.isArray(data.products)) {
        throw new Error(data.error || 'AI processing failed');
      }

      const mergedProducts = [...products];
      data.products.forEach((processedProduct, resultIndex) => {
        const originalIndex = targetIndexes[resultIndex];
        if (originalIndex !== undefined) {
          mergedProducts[originalIndex] = processedProduct;
        }
      });

      const actionLabel = aiAction === 'images' ? 'Used AI Image Generation' : 'Used AI Auto-Fix';
      const scopeLabel = aiTarget === 'selected' ? `${targetProducts.length} selected products` : 'all products';

      await updateDoc(vendorRef, {
        products: mergedProducts,
        lastUpdated: new Date().toISOString(),
      });
      await saveAuditLog(`${actionLabel} (${scopeLabel})`, logChannel);
      await syncVendorFromFirebase();

      alert(`✅ ${aiAction === 'images' ? 'AI Image Generation' : 'AI Data Correction'} completed successfully.`);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setRunningAutoFix(false);
    }
  };

  const toggleVendorAiTools = async () => {
    if (!isAdmin) return;

    const nextAdvancedEnabled = !vendorData?.advancedEnabled;
    const action = nextAdvancedEnabled ? 'Enabled AI Tools for Vendor' : 'Revoked AI Tools for Vendor';

    try {
      setTogglingAdvanced(true);
      await updateDoc(vendorRef, {
        advancedEnabled: nextAdvancedEnabled,
        lastUpdated: new Date().toISOString(),
      });
      await saveAuditLog(action, 'admin');
      await syncVendorFromFirebase();

      alert(`✅ ${action}.`);
    } catch (error) {
      console.error('Failed to toggle vendor AI tools:', error);
      alert('❌ Could not update vendor AI access.');
    } finally {
      setTogglingAdvanced(false);
    }
  };

  const buildDeepComparisonActions = (previousVendorData, nextState) => {
    const actions = [];
    if ((previousVendorData.vendorName || '') !== nextState.vendorName) actions.push(`Changed Store Name to '${nextState.vendorName}'`);
    if ((previousVendorData.address || '') !== nextState.address) actions.push(`Updated Store Address to '${nextState.address || 'N/A'}'`);
    if ((previousVendorData.storeDescription || '') !== nextState.storeDescription) actions.push('Updated Store Description');
    if ((previousVendorData.themeColor || '#16a34a') !== nextState.themeColor) actions.push(`Updated Store Theme Color to '${nextState.themeColor}'`);
    if ((previousVendorData.storeLayout || 'classic') !== nextState.storeLayout) actions.push(`Updated Store Layout Theme to '${nextState.storeLayout}'`);
    if ((previousVendorData.logoBase64 || '') !== nextState.logoBase64) actions.push('Updated Store Logo');
    
    const prevNumbers = JSON.stringify(previousVendorData.whatsappNumbers || []);
    const nextNumbers = JSON.stringify(nextState.whatsappNumbers);
    if (prevNumbers !== nextNumbers) actions.push(`Updated Staff WhatsApp Numbers`);

    if ((previousVendorData.storeWhatsappNumber || '') !== nextState.storeWhatsappNumber) actions.push('Updated Primary Store Number');
    
    if ((previousVendorData.vendorPassword || '') !== nextState.vendorPassword) {
      actions.push('Updated Store Access Password');
    }

    const prevGroups = JSON.stringify(previousVendorData.storefrontAllowedGroups || []);
    const nextGroups = JSON.stringify(nextState.storefrontAllowedGroups);
    if (prevGroups !== nextGroups) actions.push(`Updated Allowed Inventory Groups`);

    if ((previousVendorData.businessType || 'Other') !== nextState.businessType) actions.push('Updated Business Type');

    if (Number(previousVendorData.storefrontDisplayLimit || 20) !== Number(nextState.storefrontDisplayLimit || 20)) {
      actions.push('Updated Storefront Display Limit');
    }


    if (Boolean(previousVendorData.tinbrLinksEnabled ?? previousVendorData.tinyLinksEnabled) !== Boolean(nextState.tinbrLinksEnabled)) {
      actions.push(nextState.tinbrLinksEnabled ? 'Enabled Tiny Links' : 'Disabled Tiny Links');
    }

    if (Boolean(previousVendorData.showBothTinbrAndNormalLinks ?? previousVendorData.showBothTinyAndNormalLinks) !== Boolean(nextState.showBothTinbrAndNormalLinks)) {
      actions.push(nextState.showBothTinbrAndNormalLinks ? 'Enabled Both Tiny + Normal Links View' : 'Disabled Both Tiny + Normal Links View');
    }

    if ((previousVendorData.tinbrVendorLink || previousVendorData.tinyVendorLink || '') !== nextState.tinbrVendorLink) actions.push('Updated Tiny Vendor Link');
    if ((previousVendorData.tinbrStoreOneLink || previousVendorData.tinyStoreOneLink || '') !== nextState.tinbrStoreOneLink) actions.push('Updated Tiny Store 1 Link');
    if ((previousVendorData.tinbrStoreTwoLink || previousVendorData.tinyStoreTwoLink || '') !== nextState.tinbrStoreTwoLink) actions.push('Updated Tiny Store 2 Link');
    if (!actions.length) actions.push('Saved Settings (No Field Changes Detected)');
    return actions;
  };

  const handleSaveSettings = async () => {
    const cleanedNumbers = whatsappNumbersInput.map((number) => number.trim()).filter(Boolean).slice(0, 3);
    const cleanedAllowedGroups = allowedGroups.map((group) => group.trim()).filter(Boolean);

    const nextState = {
      vendorName: vendorNameInput.trim() || vendorData?.vendorName || vendorId,
      address: addressInput.trim(),
      storeDescription: storeDescriptionInput.slice(0, 1000),
      themeColor: themeColorInput || '#16a34a',
      storeLayout: storeLayoutInput || 'classic',
      logoBase64: logoBase64 || '',
      whatsappNumbers: cleanedNumbers,
      storeWhatsappNumber: storeWhatsappNumberInput.trim(),
      vendorPassword: vendorPasswordInput,
      storefrontAllowedGroups: cleanedAllowedGroups,
      businessType: businessTypeInput || 'Other',
      metaData: businessTypeInput || 'Other',
      storefrontDisplayLimit: Number(storefrontDisplayLimit) > 0 ? Number(storefrontDisplayLimit) : 20,
      tinbrLinksEnabled: isAdmin ? Boolean(tinbrLinksEnabled) : (vendorData?.tinyLinksEnabled ?? vendorData?.tinbrLinksEnabled) !== false,
      tinyLinksEnabled: isAdmin ? Boolean(tinbrLinksEnabled) : (vendorData?.tinyLinksEnabled ?? vendorData?.tinbrLinksEnabled) !== false,
      showBothTinbrAndNormalLinks: isAdmin ? Boolean(showBothTinbrAndNormalLinks) : (vendorData?.showBothTinyAndNormalLinks ?? vendorData?.showBothTinbrAndNormalLinks) !== false,
      showBothTinyAndNormalLinks: isAdmin ? Boolean(showBothTinbrAndNormalLinks) : (vendorData?.showBothTinyAndNormalLinks ?? vendorData?.showBothTinbrAndNormalLinks) !== false,
      tinbrVendorLink: isAdmin ? tinbrVendorLinkInput.trim() : String(vendorData?.tinyVendorLink || vendorData?.tinbrVendorLink || '').trim(),
      tinyVendorLink: isAdmin ? tinbrVendorLinkInput.trim() : String(vendorData?.tinyVendorLink || vendorData?.tinbrVendorLink || '').trim(),
      tinbrStoreOneLink: isAdmin ? tinbrStoreOneLinkInput.trim() : String(vendorData?.tinyStoreOneLink || vendorData?.tinbrStoreOneLink || '').trim(),
      tinyStoreOneLink: isAdmin ? tinbrStoreOneLinkInput.trim() : String(vendorData?.tinyStoreOneLink || vendorData?.tinbrStoreOneLink || '').trim(),
      tinbrStoreTwoLink: isAdmin ? tinbrStoreTwoLinkInput.trim() : String(vendorData?.tinyStoreTwoLink || vendorData?.tinbrStoreTwoLink || '').trim(),
      tinyStoreTwoLink: isAdmin ? tinbrStoreTwoLinkInput.trim() : String(vendorData?.tinyStoreTwoLink || vendorData?.tinbrStoreTwoLink || '').trim(),
    };

    const actions = buildDeepComparisonActions(vendorData || {}, nextState);

    setSavingSettings(true);
    try {
      await updateDoc(vendorRef, {
        ...nextState,
        lastUpdated: new Date().toISOString(),
      });
      await saveAuditLogs(actions, logChannel);
      await syncVendorFromFirebase();

      setWhatsappNumbersInput([
        cleanedNumbers[0] || '',
        cleanedNumbers[1] || '',
        cleanedNumbers[2] || '',
      ]);

      alert('✅ Store settings saved successfully.');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('❌ Could not save store settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const openEditModal = (index, product) => {
    const { specification, storage } = buildSpecificationParts(product);
    setEditingIndex(index);
    setEditDeviceType(product['Device Type'] || '');
    setEditSpecification(specification);
    setEditStorage(storage);
    setEditCondition(product.Condition || '');
    setEditPriceStore1(normalizePriceInput(product.priceStore1 || product['Store 1 price'] || product.storeOnePrice || product['Regular price'] || '0'));
    setEditPriceStore2(normalizePriceInput(product.priceStore2 || product['Store 2 price'] || product.storeTwoPrice || product['Regular price'] || '0'));
    setEditVisStore1(resolveStore1Visibility(product));
    setEditVisStore2(resolveStore2Visibility(product));
  };

  const closeEditModal = () => {
    setEditingIndex(null);
    setEditDeviceType('');
    setEditSpecification('');
    setEditStorage('');
    setEditCondition('');
    setEditPriceStore1('');
    setEditPriceStore2('');
    setEditVisStore1(true);
    setEditVisStore2(false);
  };

  const saveInlineEdit = async () => {
    if (editingIndex === null || editingIndex === undefined) return;

    setSavingEdit(true);
    try {
      const freshDoc = await getDoc(vendorRef);
      if (!freshDoc.exists()) {
        throw new Error('Vendor document not found.');
      }

      const freshData = freshDoc.data() || {};
      const currentProducts = Array.isArray(freshData.products) ? freshData.products.map((product) => normalizeDualStoreProduct(product)) : [];
      const oldProduct = currentProducts[editingIndex] || {};
      if (!currentProducts[editingIndex]) {
        throw new Error('Product index no longer exists. Refresh and try again.');
      }

      const nextProducts = [...currentProducts];
      const parsed = parseEditFromValues(editSpecification.trim(), editStorage.trim());
      nextProducts[editingIndex] = {
        ...nextProducts[editingIndex],
        'Device Type': editDeviceType.trim(),
        Condition: editCondition.trim(),
        'Regular price': normalizePriceInput(editPriceStore1),
        priceStore1: normalizePriceInput(editPriceStore1),
        priceStore2: normalizePriceInput(editPriceStore2),
        'Store 1 price': normalizePriceInput(editPriceStore1),
        'Store 2 price': normalizePriceInput(editPriceStore2),
        visibleInStore1: editVisStore1,
        isVisible: editVisStore1,
        visibleInStore2: editVisStore2,
        ...parsed,
      };

      await updateDoc(vendorRef, {
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
      });
      await saveAuditLog(`Edited product details for ${oldProduct['Device Type'] || 'Unknown Device'}`, logChannel);
      await syncVendorFromFirebase();

      closeEditModal();
      alert('✅ Product updated successfully.');
    } catch (error) {
      console.error('Failed to save inline edit:', error);
      alert('❌ Could not save product changes.');
    } finally {
      setSavingEdit(false);
    }
  };

  const fetchSupportMessages = useCallback(async () => {
    setSupportLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/api/messages/${vendorId}`, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Unable to fetch messages');
      }
      setSupportMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (error) {
      console.error('Failed to fetch support messages:', error);
    } finally {
      setSupportLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    if (!vendorData || mainTab !== 'support') return;
    fetchSupportMessages();
    const timer = setInterval(fetchSupportMessages, 12000);
    return () => clearInterval(timer);
  }, [vendorData, mainTab, fetchSupportMessages]);

  const sendSupportMessage = async () => {
    if (!supportInput.trim()) return;

    setSendingSupportMessage(true);
    try {
      const response = await fetch(`${BASE_URL}/api/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          vendorId,
          sender: isAdmin ? 'admin' : 'vendor',
          recipient: isAdmin ? 'vendor' : 'admin',
          text: supportInput.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to send message');
      }

      setSupportInput('');
      setSupportMessages((prev) => [...prev, data.message]);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setSendingSupportMessage(false);
    }
  };

  if (loading) return <div className="p-10 text-center text-gray-600">Loading vendor data...</div>;
  if (!vendorData) return <div className="p-10 text-center font-bold text-red-500">Vendor has no inventory.</div>;

  if (requiresVendorAuth) {
    return (
      <VendorLogin
        vendorName={vendorData.vendorName}
        onSubmit={handleVendorPasswordSubmit}
        passwordValue={vendorPasswordEntry}
        setPasswordValue={setVendorPasswordEntry}
        error={vendorLoginError}
      />
    );
  }

  const vendorBackendLink = `${window.location.origin}/vendor/${vendorId}`;
  const tinbrVendorLink = tinbrVendorLinkInput.trim();
  const customerStoreOneLink = `${window.location.origin}/store/1/${vendorId}`;
  const customerStoreTwoLink = `${window.location.origin}/store/2/${vendorId}`;
  const tinbrStoreOneLink = tinbrStoreOneLinkInput.trim();
  const tinbrStoreTwoLink = tinbrStoreTwoLinkInput.trim();
  const canVendorSeeBothLinkSets = isAdmin || showBothTinbrAndNormalLinks;
  const vendorTinyActive = tinbrLinksEnabled && Boolean(tinbrVendorLink);
  const storeOneTinyActive = tinbrLinksEnabled && Boolean(tinbrStoreOneLink);
  const storeTwoTinyActive = tinbrLinksEnabled && Boolean(tinbrStoreTwoLink);
  const primaryVendorLink = vendorTinyActive ? tinbrVendorLink : vendorBackendLink;
  const primaryStoreOneLink = storeOneTinyActive ? tinbrStoreOneLink : customerStoreOneLink;
  const primaryStoreTwoLink = storeTwoTinyActive ? tinbrStoreTwoLink : customerStoreTwoLink;
  const timelineLogs = normalizeLogs(activityLogs);
  const timelineEntries = {
    vendor: [...timelineLogs.vendor].sort((a, b) => new Date(b.date) - new Date(a.date)),
    customer: [...timelineLogs.customer].sort((a, b) => new Date(b.date) - new Date(a.date)),
    admin: [...timelineLogs.admin].sort((a, b) => new Date(b.date) - new Date(a.date)),
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto bg-gradient-to-b from-slate-100 via-white to-slate-100 min-h-screen">
      {isAdmin && (
        <Link to="/dashboard" className="text-blue-600 font-semibold hover:underline mb-4 inline-block">
          &larr; Back to Directory
        </Link>
      )}

      {/* Share Links Section */}
      <div className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-3xl p-5 mb-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Share Links</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border rounded-[10px] p-4 bg-gray-50">
            <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Vendor Backend Link {vendorTinyActive ? '(Tiny Active)' : '(Normal Active)'}</p>
            <p className="text-sm break-all text-[#1A1C23] mb-2 font-mono bg-white p-2 rounded border">{primaryVendorLink}</p>
            {canVendorSeeBothLinkSets && (
              <div className="mb-3 text-[11px] space-y-1 text-gray-600">
                <p><span className="font-black">Normal:</span> {vendorBackendLink}</p>
                <p><span className="font-black">Tiny:</span> {tinbrVendorLink || 'Not set'}</p>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => handleCopyLink(primaryVendorLink)} className="bg-blue-600 text-white px-4 py-2 rounded-[8px] text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm">Copy Backend Link</button>
              {isAdmin && (
                <button onClick={() => handleTinyUrlCopy(vendorBackendLink, 'vendor')} disabled={shorteningLinkKey === 'vendor'} className="bg-slate-700 text-white px-4 py-2 rounded-[8px] text-sm font-bold hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50">{shorteningLinkKey === 'vendor' ? 'Shortening...' : 'Copy TinyURL'}</button>
              )}
            </div>
          </div>
          <div className="border rounded-[10px] p-4 bg-gray-50">
            <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Customer Store One Link {storeOneTinyActive ? '(Tiny Active)' : '(Normal Active)'}</p>
            <p className="text-sm break-all text-[#1A1C23] mb-2 font-mono bg-white p-2 rounded border">{primaryStoreOneLink}</p>
            {canVendorSeeBothLinkSets && (
              <div className="mb-3 text-[11px] space-y-1 text-gray-600">
                <p><span className="font-black">Normal:</span> {customerStoreOneLink}</p>
                <p><span className="font-black">Tiny:</span> {tinbrStoreOneLink || 'Not set'}</p>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => handleCopyLink(primaryStoreOneLink)} className="bg-green-600 text-white px-4 py-2 rounded-[8px] text-sm font-bold hover:bg-green-700 transition-colors shadow-sm">Copy Store 1 Link</button>
              {isAdmin && (
                <button onClick={() => handleTinyUrlCopy(customerStoreOneLink, 'store1')} disabled={shorteningLinkKey === 'store1'} className="bg-slate-700 text-white px-4 py-2 rounded-[8px] text-sm font-bold hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50">{shorteningLinkKey === 'store1' ? 'Shortening...' : 'Copy TinyURL'}</button>
              )}
            </div>
          </div>
          <div className="border rounded-[10px] p-4 bg-gray-50">
            <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Customer Store Two Link {storeTwoTinyActive ? '(Tiny Active)' : '(Normal Active)'}</p>
            <p className="text-sm break-all text-[#1A1C23] mb-2 font-mono bg-white p-2 rounded border">{primaryStoreTwoLink}</p>
            {canVendorSeeBothLinkSets && (
              <div className="mb-3 text-[11px] space-y-1 text-gray-600">
                <p><span className="font-black">Normal:</span> {customerStoreTwoLink}</p>
                <p><span className="font-black">Tiny:</span> {tinbrStoreTwoLink || 'Not set'}</p>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => handleCopyLink(primaryStoreTwoLink)} className="bg-emerald-600 text-white px-4 py-2 rounded-[8px] text-sm font-bold hover:bg-emerald-700 transition-colors shadow-sm">Copy Store 2 Link</button>
              {isAdmin && (
                <button onClick={() => handleTinyUrlCopy(customerStoreTwoLink, 'store2')} disabled={shorteningLinkKey === 'store2'} className="bg-slate-700 text-white px-4 py-2 rounded-[8px] text-sm font-bold hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50">{shorteningLinkKey === 'store2' ? 'Shortening...' : 'Copy TinyURL'}</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="mb-4 flex overflow-x-auto hide-scrollbar whitespace-nowrap w-full gap-2 pb-2 bg-gray-100 p-1.5 rounded-xl">
        <button onClick={() => setMainTab('settings')} className={`flex-shrink-0 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${mainTab === 'settings' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Store Settings</button>
        <button onClick={() => setMainTab('inventory')} className={`flex-shrink-0 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${mainTab === 'inventory' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Inventory</button>
        <button onClick={() => setMainTab('advanced')} className={`flex-shrink-0 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${mainTab === 'advanced' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Advanced Tools</button>
        <button onClick={() => setMainTab('metadata')} className={`flex-shrink-0 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${mainTab === 'metadata' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Metadata</button>
        <button onClick={() => setMainTab('support')} className={`flex-shrink-0 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${mainTab === 'support' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Support Chat</button>
        <button onClick={() => setMainTab('timeline')} className={`flex-shrink-0 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${mainTab === 'timeline' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Store Timeline</button>
        <button onClick={() => setMainTab('tips')} className={`flex-shrink-0 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${mainTab === 'tips' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Tips</button>
      </div>

      {/* Store Settings Tab */}
      {mainTab === 'settings' && (
        <div className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-3xl p-5 mb-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Store Settings</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Vendor Name</label>
              <input type="text" value={vendorNameInput} onChange={(e) => setVendorNameInput(e.target.value)} className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Enter store name" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Store Address</label>
              <input type="text" value={addressInput} onChange={(e) => setAddressInput(e.target.value)} className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Enter physical address" />
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-bold text-gray-700 mb-2">Store Description (max 1000 chars)</label>
            <textarea
              value={storeDescriptionInput}
              onChange={(e) => setStoreDescriptionInput(e.target.value.slice(0, 1000))}
              className="w-full p-3 border rounded-[8px] min-h-[120px] focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Describe your store..."
            />
            <p className="text-xs font-bold text-gray-400 mt-1">{storeDescriptionInput.length}/1000</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Store Theme Color</label>
              <div className="flex items-center gap-3 mb-3">
                <input type="color" value={themeColorInput} onChange={(e) => setThemeColorInput(e.target.value)} className="w-14 h-12 border rounded cursor-pointer" />
                <span className="text-sm font-mono font-bold text-gray-600">{themeColorInput.toUpperCase()}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {THEME_PRESETS.map((preset) => (
                  <button key={preset} onClick={() => setThemeColorInput(preset)} className={`w-8 h-8 rounded-full border-2 shadow-sm transition-transform hover:scale-110 ${themeColorInput === preset ? 'border-gray-900' : 'border-white'}`} style={{ backgroundColor: preset }} aria-label={`Theme ${preset}`} />
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-white/70 backdrop-blur-xl border border-white/20 p-4">
              <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2">Storefront Display Limit</label>
              <input
                type="number"
                min={1}
                value={storefrontDisplayLimit}
                onChange={(e) => setStorefrontDisplayLimit(e.target.value)}
                className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-semibold"
              />
              <p className="text-xs text-gray-500 mt-2">By default, only your latest items show to customers to keep your page fast. Increase this to show more.</p>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Store Layout Theme</label>
              <select
                value={storeLayoutInput}
                onChange={(e) => setStoreLayoutInput(e.target.value)}
                className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="classic">classic (Table)</option>
                <option value="grid">grid (Modern Cards)</option>
                <option value="minimal">minimal (Clean List)</option>
                <option value="compact">compact (Dense List)</option>
                <option value="dark">dark (Dark Mode)</option>
                <option value="premium">premium (Luxury Cards)</option>
              </select>
              <p className="text-xs text-gray-500 mt-2">Store 2 uses Premium layout automatically (no separate premium selector needed).</p>
            </div>

            {isAdmin && (
              <div className="md:col-span-2 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
              <label className="block text-sm font-bold text-indigo-900 mb-3">Tiny Link Controls</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <label className="flex items-center gap-3 text-sm font-semibold text-indigo-900">
                  <input
                    type="checkbox"
                    checked={tinbrLinksEnabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setTinbrLinksEnabled(checked);
                      saveLinkPreference({ tinbrLinksEnabled: checked }, checked ? 'Enabled Tiny Links' : 'Disabled Tiny Links');
                    }}
                    className="w-4 h-4"
                  />
                  Use Tiny links as primary store links
                </label>
                <label className="flex items-center gap-3 text-sm font-semibold text-indigo-900">
                  <input
                    type="checkbox"
                    checked={showBothTinbrAndNormalLinks}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setShowBothTinbrAndNormalLinks(checked);
                      saveLinkPreference(
                        { showBothTinbrAndNormalLinks: checked },
                        checked ? 'Enabled Both Tiny + Normal Links View' : 'Disabled Both Tiny + Normal Links View'
                      );
                    }}
                    className="w-4 h-4"
                  />
                  Let vendor see both Tiny and normal links
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-indigo-700 mb-1">Tiny Vendor URL</label>
                  <input type="text" value={tinbrVendorLinkInput} readOnly className="w-full p-3 border rounded-[8px] bg-gray-100 text-gray-600 cursor-not-allowed" placeholder="Auto-generated from Share Links" />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-indigo-700 mb-1">Tiny Store 1 URL</label>
                  <input type="text" value={tinbrStoreOneLinkInput} readOnly className="w-full p-3 border rounded-[8px] bg-gray-100 text-gray-600 cursor-not-allowed" placeholder="Auto-generated from Share Links" />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-indigo-700 mb-1">Tiny Store 2 URL</label>
                  <input type="text" value={tinbrStoreTwoLinkInput} readOnly className="w-full p-3 border rounded-[8px] bg-gray-100 text-gray-600 cursor-not-allowed" placeholder="Auto-generated from Share Links" />
                </div>
              </div>
              <p className="text-xs text-indigo-800 mt-3">
                Use the Copy TinyURL buttons in Share Links to generate and save Tiny links to Firebase. Vendors only see both normal + Tiny links when enabled above.<br />
                Product images are saved with each product in Firebase using <span className="font-black">productImageBase64</span>, <span className="font-black">productImageStore1Base64</span>, and <span className="font-black">productImageStore2Base64</span> so Store 1 and Store 2 load the correct image automatically.
              </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Store Logo (150x150)</label>
              <input type="file" accept="image/*" onChange={handleLogoChange} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
              {logoBase64 && <img src={logoBase64} alt="Store logo preview" style={HD_IMAGE_STYLE} className="w-16 h-16 rounded-full mt-3 border object-cover shadow-sm" />}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Primary Store WhatsApp Number</label>
              <input type="text" value={storeWhatsappNumberInput} onChange={(e) => setStoreWhatsappNumberInput(e.target.value)} className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. 2348012345678" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Store Access Password</label>
              <input type="password" value={vendorPasswordInput} onChange={(e) => setVendorPasswordInput(e.target.value)} className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Set vendor dashboard password" />
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-bold text-gray-700 mb-2">Staff WhatsApp Numbers (Routing)</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {whatsappNumbersInput.map((value, index) => (
                <input key={`whatsapp-${index}`} type="text" value={value} onChange={(e) => {
                  const next = [...whatsappNumbersInput];
                  next[index] = e.target.value;
                  setWhatsappNumbersInput(next);
                }} className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-blue-500 outline-none" placeholder={`Staff Number ${index + 1}`} />
              ))}
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-bold text-gray-700 mb-2">Allowed Inventory Groups</label>
            <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
              {sourceGroups.map((group) => (
                <label key={group} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 text-blue-600 rounded" checked={allowedGroups.includes(group)} onChange={() => toggleAllowedGroup(group)} />
                  <span className="text-sm font-medium text-gray-700">{group}</span>
                </label>
              ))}
            </div>
          </div>

          <button onClick={handleSaveSettings} disabled={savingSettings} className="bg-[#1A1C23] text-white px-8 py-3 rounded-[10px] font-bold hover:bg-black transition-all disabled:opacity-50 shadow-md">
            {savingSettings ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {/* Inventory Tab */}
      {mainTab === 'inventory' && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
            <div>
              <h1 className="text-3xl font-bold text-[#1A1C23]">{vendorData.vendorName}&apos;s Inventory</h1>
              <p className="text-gray-500 mt-1 font-medium">Viewing {inventoryRows.length} of {products.length} Items</p>
            </div>
            <button onClick={handleExport} className="bg-green-600 text-white px-6 py-3 rounded-[10px] shadow-md hover:bg-green-700 font-bold transition-all">Export CSV</button>
          </div>


          <div className="mb-4 inline-flex bg-gray-100 p-1.5 rounded-xl gap-1">
            <button onClick={() => setInventoryView('all')} className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider ${inventoryView === 'all' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Vendor Inventory</button>
            <button onClick={() => setInventoryView('store1')} className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider ${inventoryView === 'store1' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Inventory for Store 1</button>
            <button onClick={() => setInventoryView('store2')} className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider ${inventoryView === 'store2' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Inventory for Store 2</button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="bg-white/70 backdrop-blur-xl border border-gray-100 rounded-2xl p-4">
              <p className="text-xs font-black uppercase tracking-wider text-gray-500 mb-2">Market Trend</p>
              <p className={`text-lg font-black ${marketTrend.direction === 'up' ? 'text-emerald-600' : 'text-red-600'}`}>{marketTrend.direction === 'up' ? '↗ Prices Up' : '↘ Prices Down'}</p>
              <p className="text-sm text-gray-600 mt-1">Last Week Avg: {Math.round(marketTrend.lastWeekAvg).toLocaleString()} • This Week Avg: {Math.round(marketTrend.thisWeekAvg).toLocaleString()}</p>
              <p className="text-[11px] font-semibold text-gray-500 mt-2">Private Vendor Analytics: Only your storefront-enabled products are analyzed.</p>
            </div>
            <div className="bg-white/70 backdrop-blur-xl border border-gray-100 rounded-2xl p-4">
              <p className="text-xs font-black uppercase tracking-wider text-gray-500 mb-3">Export My Pricelist</p>
              <p className="text-[11px] text-gray-500 mb-2">Strict format: Category -&gt; Brand -&gt; Device -&gt; Price</p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={async () => { await navigator.clipboard.writeText(exportLines.join('\n')); alert('✅ Pricelist copied for WhatsApp.'); }} className="bg-[#1A1C23] text-white px-3 py-2 rounded-lg text-xs font-black uppercase">Copy for WhatsApp</button>
                <button onClick={() => { const blob = new Blob([exportLines.join('\n')], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${vendorData.vendorName || 'vendor'}-pricelist.txt`; a.click(); }} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-black uppercase">Download TXT</button>
                <button onClick={() => downloadCsv(`${vendorData.vendorName || 'vendor'}-pricelist.csv`, storefrontProducts.map((product) => ({ Export: `${product.Category || 'Others'} -> ${product.Brand || 'Others'} -> ${product['Device Type'] || ''} -> Store 1: ${normalizePriceInput(product.priceStore1 || product['Regular price'])} | Store 2: ${normalizePriceInput(product.priceStore2 || product['Regular price'])}` })))} className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-black uppercase">Download CSV</button>
              </div>
            </div>
          </div>

          <div className="mb-6 bg-white p-5 rounded-[12px] border border-emerald-100 shadow-sm">
            <h3 className="text-3 font-black text-emerald-700 uppercase tracking-wider mb-4">Add Product Manually</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="text"
                value={manualDeviceName}
                onChange={(e) => setManualDeviceName(e.target.value)}
                className="md:col-span-2 p-3 border rounded-[8px] font-semibold bg-gray-50"
                placeholder="Device name (required)"
              />
              <select
                value={manualCategory}
                onChange={(e) => setManualCategory(e.target.value)}
                className="p-3 border rounded-[8px] font-semibold bg-gray-50"
              >
                {['Smartphones', 'Smartwatches', 'Laptops', 'Sounds', 'Accessories', 'Tablets', 'Gaming', 'Others'].map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <input type="text" value={manualBrand} onChange={(e) => setManualBrand(e.target.value)} className="p-3 border rounded-[8px] font-semibold bg-gray-50" placeholder="Brand" />
              <input type="text" value={manualCondition} onChange={(e) => setManualCondition(e.target.value)} className="p-3 border rounded-[8px] font-semibold bg-gray-50" placeholder="Condition" />
              <input type="text" value={manualSpec} onChange={(e) => setManualSpec(e.target.value)} className="p-3 border rounded-[8px] font-semibold bg-gray-50" placeholder="SIM / Processor / Spec" />
              <input type="text" value={manualStorage} onChange={(e) => setManualStorage(e.target.value)} className="p-3 border rounded-[8px] font-semibold bg-gray-50" placeholder="Storage (e.g. 256GB)" />
              <input type="text" value={manualPriceStore1} onChange={(e) => setManualPriceStore1(e.target.value)} className="p-3 border rounded-[8px] font-semibold bg-gray-50" placeholder="Store 1 Price" />
              <input type="text" value={manualPriceStore2} onChange={(e) => setManualPriceStore2(e.target.value)} className="p-3 border rounded-[8px] font-semibold bg-gray-50" placeholder="Store 2 Price (optional)" />
              <input type="text" value={manualGroupName} onChange={(e) => setManualGroupName(e.target.value)} className="p-3 border rounded-[8px] font-semibold bg-gray-50" placeholder="Manual Entry" />
            </div>
            <button
              onClick={handleAddManualProduct}
              disabled={addingManualProduct}
              className="mt-4 bg-emerald-600 text-white px-6 py-3 rounded-[10px] shadow-md hover:bg-emerald-700 font-bold transition-all disabled:opacity-50"
            >
              {addingManualProduct ? 'Adding...' : 'ADD PRODUCT'}
            </button>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 bg-white p-5 rounded-[12px] border border-gray-200 shadow-sm">
            <div>
              <label className="block text-xs font-black text-gray-500 uppercase mb-2">WhatsApp Group</label>
              <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="w-full p-3 border rounded-[8px] font-semibold bg-gray-50">
                {uniqueGroups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-black text-gray-500 uppercase mb-2">Timeframe</label>
              <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full p-3 border rounded-[8px] font-semibold bg-gray-50">
                <option value="All">All Time</option>
                <option value="This Week">Last 7 Days</option>
                <option value="This Month">Last 30 Days</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-black text-gray-500 uppercase mb-2">Category</label>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-full p-3 border rounded-[8px] font-semibold bg-gray-50">
                {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Bulk Actions */}
          <div className="mb-4 flex flex-wrap gap-2 items-center bg-blue-50 p-4 rounded-xl border border-blue-100">
            <button onClick={() => updateSelectedVisibility('store1', true)} disabled={!selectedProductIndexes.length || bulkUpdating} className="bg-blue-600 text-white px-3 py-2 text-xs rounded-lg font-bold disabled:opacity-50">Show in Store 1</button>
            <button onClick={() => updateSelectedVisibility('store1', false)} disabled={!selectedProductIndexes.length || bulkUpdating} className="bg-gray-400 text-white px-3 py-2 text-xs rounded-lg font-bold disabled:opacity-50">Hide in Store 1</button>
            <button onClick={() => updateSelectedVisibility('store2', true)} disabled={!selectedProductIndexes.length || bulkUpdating} className="bg-purple-600 text-white px-3 py-2 text-xs rounded-lg font-bold disabled:opacity-50">Show in Store 2</button>
            <button onClick={() => updateSelectedVisibility('store2', false)} disabled={!selectedProductIndexes.length || bulkUpdating} className="bg-gray-400 text-white px-3 py-2 text-xs rounded-lg font-bold disabled:opacity-50">Hide in Store 2</button>
            <span className="text-sm font-bold text-blue-700">{selectedProductIndexes.length} products selected</span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto bg-white shadow-lg rounded-[12px] border border-gray-200">
            <table className="min-w-full text-left">
              <thead className="bg-[#1A1C23] text-white">
                <tr>
                  <th className="p-4 w-[50px]"><input type="checkbox" checked={allVisibleRowsSelected} onChange={toggleSelectAll} className="w-4 h-4" /></th>
                  <th className="hidden md:table-cell p-4 text-xs font-bold uppercase tracking-wider">Group</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider">Device</th>
                  <th className="hidden md:table-cell p-4 text-xs font-bold uppercase tracking-wider">Condition</th>
                  <th className="hidden md:table-cell p-4 text-xs font-bold uppercase tracking-wider">Specification</th>
                  <th className="hidden md:table-cell p-4 text-xs font-bold uppercase tracking-wider">Storage</th>
                  <th className="p-4 text-xs font-bold uppercase">Store 1 (Classic)</th>
                  <th className="p-4 text-xs font-bold uppercase">Store 2 (Premium)</th>
                  <th className="hidden md:table-cell p-4 text-xs font-bold uppercase tracking-wider">Extracted</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider">Image</th>
                  <th className="p-4 text-xs font-bold uppercase tracking-wider">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inventoryRows.map(({ product, index }) => (
                  <tr key={`${product['Device Type']}-${index}`} className={`hover:bg-blue-50/30 transition-colors ${(!resolveStore1Visibility(product) && !resolveStore2Visibility(product)) ? 'bg-gray-50 opacity-60 line-through text-gray-400' : ''}`}>
                    <td className="p-4"><input type="checkbox" checked={selectedProductIndexes.includes(index)} onChange={() => toggleProductSelection(index)} className="w-4 h-4" /></td>
                    <td className="hidden md:table-cell p-4"><span className="text-[10px] font-bold bg-white border px-2 py-1 rounded text-gray-500 whitespace-nowrap">{product.groupName || 'Direct Message'}</span></td>
                    <td className="p-4 font-bold text-[#1A1C23]">{product['Device Type'] || 'N/A'}</td>
                    <td className="hidden md:table-cell p-4"><span className={`text-xs font-bold px-2 py-1 rounded ${product.Condition?.toLowerCase().includes('new') ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{product.Condition || 'N/A'}</span></td>
                    <td className="hidden md:table-cell p-4 text-sm text-gray-600">{product['SIM Type/Model/Processor'] || 'N/A'}</td>
                    <td className="hidden md:table-cell p-4 text-sm font-semibold text-gray-700">{product['Storage Capacity/Configuration'] || 'N/A'}</td>
                    <td className="p-4">
                      <div className="font-black text-blue-700">{normalizePriceInput(product.priceStore1 || product['Regular price'] || '0')}</div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${resolveStore1Visibility(product) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                        {resolveStore1Visibility(product) ? 'Visible' : 'Hidden'}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="font-black text-purple-700">{normalizePriceInput(product.priceStore2 || product['Regular price'] || '0')}</div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${resolveStore2Visibility(product) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                        {resolveStore2Visibility(product) ? 'Visible' : 'Hidden'}
                      </span>
                    </td>
                    <td className="hidden md:table-cell p-4 text-[11px] text-gray-400 font-medium">{product.DatePosted || 'N/A'}</td>
                    <td className="p-4">
                      <div className="flex flex-col gap-2">
                        {getInventoryPreviewImage(product) && <img src={getInventoryPreviewImage(product)} alt="Product" style={HD_IMAGE_STYLE} className="w-10 h-10 object-cover rounded border shadow-sm" />}
                        <input id={`product-image-store1-${index}`} type="file" accept="image/*" className="hidden" onChange={(e) => handleProductImageUpload(index, e.target.files?.[0], 'store1')} />
                        <input id={`product-image-store2-${index}`} type="file" accept="image/*" className="hidden" onChange={(e) => handleProductImageUpload(index, e.target.files?.[0], 'store2')} />
                        <input id={`product-image-both-${index}`} type="file" accept="image/*" className="hidden" onChange={(e) => handleProductImageUpload(index, e.target.files?.[0], 'both')} />
                        <div className="flex flex-wrap gap-1">
                          <label htmlFor={`product-image-store1-${index}`} className="cursor-pointer bg-blue-100 text-blue-700 px-2 py-1 rounded-md text-[9px] font-black uppercase text-center hover:bg-blue-200">S1</label>
                          <label htmlFor={`product-image-store2-${index}`} className="cursor-pointer bg-purple-100 text-purple-700 px-2 py-1 rounded-md text-[9px] font-black uppercase text-center hover:bg-purple-200">S2</label>
                          <label htmlFor={`product-image-both-${index}`} className="cursor-pointer bg-emerald-100 text-emerald-700 px-2 py-1 rounded-md text-[9px] font-black uppercase text-center hover:bg-emerald-200">Both</label>
                        </div>
                      </div>
                    </td>
                    <td className="p-4"><button onClick={() => openEditModal(index, product)} className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-xs font-bold hover:bg-blue-700">✏️ Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {inventoryRows.length === 0 && <div className="p-12 text-center text-gray-400 font-medium">No inventory matches your filters.</div>}
          </div>
        </>
      )}

      {/* Advanced Tab (Version 3.0 Monetization Lock) */}
      {mainTab === 'advanced' && (
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 mb-6 shadow-sm relative overflow-hidden">
          <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Advanced Tools</h2>
          <div className={`${(vendorData.advancedEnabled || isAdmin) ? '' : 'blur-sm'}`}>
            <p className="text-sm font-bold text-gray-600 mb-4">Use AI to clean inventory data or generate product imagery. Choose the action and target before running.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2">AI Action</label>
                <select
                  value={aiAction}
                  onChange={(e) => setAiAction(e.target.value)}
                  className="w-full p-3 border rounded-[8px] font-semibold bg-white"
                >
                  <option value="fix">✨ AI Data Correction</option>
                  <option value="images">🖼️ AI Image Generation</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2">Target Scope</label>
                <select
                  value={aiTarget}
                  onChange={(e) => setAiTarget(e.target.value)}
                  className="w-full p-3 border rounded-[8px] font-semibold bg-white"
                >
                  <option value="all">Apply to All Products</option>
                  <option value="selected">Apply to Selected Products Only</option>
                </select>
              </div>
            </div>

            <p className="text-xs font-black uppercase tracking-wider text-indigo-700 mb-4">
              This action will process {aiTarget === 'selected' ? selectedProductIndexes.length : products.length} products.
            </p>

            <button
              onClick={runAiAutoFix}
              disabled={runningAutoFix}
              className="bg-indigo-600 text-white px-6 py-3 rounded-[10px] font-black uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50 shadow-md transition-all mb-6"
            >
              {runningAutoFix 
                ? 'AI Working...' 
                : aiAction === 'images' 
                  ? '🖼️ Generate Product Images' 
                  : '✨ Run AI Data Correction'}
            </button>
            
            {isAdmin && (
              <div className="pt-6 border-t border-gray-200 mt-2">
                <h3 className="text-sm font-bold text-gray-800 mb-2">Admin Controls</h3>
                <button
                  onClick={toggleVendorAiTools}
                  disabled={togglingAdvanced}
                  className={`px-4 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider shadow-sm transition-colors ${vendorData.advancedEnabled ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'} disabled:opacity-50`}
                >
                  {togglingAdvanced ? 'Updating...' : (vendorData.advancedEnabled ? 'Revoke AI Access' : 'Enable AI Tools for Vendor')}
                </button>
              </div>
            )}
          </div>

          {!(vendorData.advancedEnabled || isAdmin) && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-sm z-10">
              <div className="bg-white border-2 border-amber-400 rounded-2xl p-8 text-center shadow-2xl max-w-sm">
                <span className="text-4xl mb-4 block">👑</span>
                <h3 className="text-xl font-black text-gray-900 mb-2">Premium Feature Locked</h3>
                <p className="text-sm text-gray-600 mb-6 font-medium">Unlock the AI-powered store assistant to automatically fix your product listings or generate images.</p>
                <button onClick={() => setMainTab('support')} className="bg-amber-500 text-amber-950 font-black uppercase tracking-widest px-6 py-3 rounded-xl w-full hover:bg-amber-400 transition-all shadow-md">
                  Contact Admin
                </button>
              </div>
            </div>
          )}
        </div>
      )}


      {mainTab === 'metadata' && (
        <div className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <h2 className="text-2xl font-black tracking-tight text-gray-900 mb-2">Metadata</h2>
          <p className="text-sm text-gray-500 mb-5">Set your business classification for better customer context.</p>
          <div className="mb-4 p-3 rounded-xl bg-white/80 border border-gray-100 max-w-md">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-black">CRM Assigned Category</p>
            <p className="text-sm font-bold text-gray-800">{vendorData.metaData || vendorData.businessType || 'Other'}</p>
          </div>
          <div className="max-w-md">
            <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2">Business Type</label>
            <select
              value={businessTypeInput}
              onChange={(e) => setBusinessTypeInput(e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none font-semibold"
            >
              {['Electronics', 'Computer Accessories', 'Computers', 'Phones and Laptops', 'Agriculture', 'Fashion', 'Real Estate', 'Vehicles', 'Services', 'Other'].map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-2">Click Save Settings in Store Settings to persist this value to Firebase.</p>
          </div>
        </div>
      )}

      {/* Support Chat Hub (Version 3.1) */}
      {mainTab === 'support' && (
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 mb-6 shadow-sm flex flex-col h-[50vh] md:h-[600px]">
          <div className="flex items-center justify-between mb-4 border-b pb-4">
            <h2 className="text-xl font-black text-[#1A1C23]">Live Support</h2>
            <button onClick={fetchSupportMessages} className="text-xs font-bold uppercase tracking-wider bg-gray-100 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors">Refresh Chat</button>
          </div>

          <div className="flex-1 border border-gray-100 rounded-xl overflow-y-auto p-4 bg-gray-50/50 space-y-4 mb-4 custom-scrollbar">
            {supportLoading && supportMessages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400 font-bold uppercase tracking-widest text-sm">Loading history...</div>
            ) : supportMessages.length > 0 ? (
              supportMessages.map((message) => {
                const mine = isAdmin ? message.sender === 'admin' : message.sender === 'vendor';
                const senderLabel = mine ? 'Me' : (isAdmin ? vendorData.vendorName : 'Admin Support');
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-sm ${mine ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'}`}>
                      <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${mine ? 'text-blue-200' : 'text-gray-400'}`}>
                        {senderLabel}
                      </p>
                      <p className="text-sm whitespace-pre-wrap font-medium leading-relaxed">{message.text}</p>
                      <p className={`text-[9px] font-bold mt-2 ${mine ? 'text-right text-blue-300' : 'text-left text-gray-400'}`}>
                        {formatTimelineDate(message.timestamp)}
                      </p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <span className="text-4xl mb-3">💬</span>
                <p className="font-bold text-sm">{isAdmin ? 'Send a message to this vendor.' : 'Send a message to the Admin team.'}</p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <textarea
              value={supportInput}
              onChange={(e) => setSupportInput(e.target.value)}
              className="flex-1 border border-gray-200 rounded-xl p-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none resize-none shadow-sm"
              placeholder={isAdmin ? 'Type your message to the vendor...' : 'Type your message to the admin...'}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendSupportMessage();
                }
              }}
            />
            <button
              onClick={sendSupportMessage}
              disabled={sendingSupportMessage || !supportInput.trim()}
              className="bg-[#1A1C23] text-white px-8 rounded-xl font-black uppercase tracking-wider disabled:opacity-50 hover:bg-black transition-all shadow-md"
            >
              {sendingSupportMessage ? '...' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* Store Timeline */}
      {mainTab === 'timeline' && (
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
          <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Store Timeline</h2>
          <div className="mb-4 flex gap-3 bg-gray-50 p-1 rounded-lg w-fit">
            {['vendor', 'customer', 'admin'].map((tab) => (
              (tab !== 'admin' || isAdmin) && (
                <button key={tab} onClick={() => setTimelineTab(tab)} className={`px-4 py-2 rounded-md text-xs font-bold uppercase transition-all ${timelineTab === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                  {tab} logs
                </button>
              )
            ))}
          </div>

          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {(timelineEntries[timelineTab] || []).map((log, idx) => (
              <div key={idx} className="border-l-4 border-blue-500 pl-4 py-2 bg-gray-50 rounded-r-lg">
                <p className="font-bold text-sm text-[#1A1C23]">{log.action}</p>
                <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase tracking-wider">{formatTimelineDate(log.date)}</p>
              </div>
            ))}
            {(timelineEntries[timelineTab] || []).length === 0 && <p className="text-gray-400 text-sm italic">No logs found in this category.</p>}
          </div>
        </div>
      )}


      {mainTab === 'tips' && (
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
          <div className="mb-4 p-4 border border-amber-100 bg-amber-50 rounded-xl">
            <h3 className="text-sm font-black text-amber-800 uppercase tracking-wider mb-2">Pro Tips</h3>
            <p className="text-sm text-amber-900 font-medium">Best formatting style for the AI scraper: <span className="font-black">Product | Specs | Condition | Price</span>.</p>
            <p className="text-xs text-amber-800 mt-2">Using the pipe-separated format (<span className="font-black">|</span>) guarantees 100% scraper accuracy for property mapping.</p>
          </div>

          <div className="mb-4 p-4 border border-blue-100 bg-blue-50 rounded-xl">
            <h3 className="text-sm font-black text-blue-800 uppercase tracking-wider mb-2">Video Tutorial</h3>
            <p className="text-xs text-blue-900 mb-3">Watch this quick guide to learn how to format your WhatsApp messages for the fastest AI inventory updates.</p>
            {tutorialVideoEmbedUrl ? (
              <div className="w-full aspect-video rounded-lg overflow-hidden border border-blue-200 bg-black">
                <iframe
                  src={tutorialVideoEmbedUrl}
                  title="Scraper tutorial video"
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <p className="text-xs text-blue-700 font-medium">No tutorial video has been configured yet. Please contact admin.</p>
            )}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingIndex !== null && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white w-[95%] mx-auto max-w-xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 bg-gray-50 border-b">
              <h3 className="text-xl font-black text-[#1A1C23]">Edit Product Details</h3>
              <p className="text-sm text-gray-500 font-medium">Manual override for AI-extracted data.</p>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-black text-gray-400 uppercase mb-1">Device Type</label>
                <input type="text" value={editDeviceType} onChange={(e) => setEditDeviceType(e.target.value)} className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-800" />
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-1">Specification</label>
                <input type="text" value={editSpecification} onChange={(e) => setEditSpecification(e.target.value)} className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium text-gray-700" />
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-1">Storage</label>
                <input type="text" value={editStorage} onChange={(e) => setEditStorage(e.target.value)} className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium text-gray-700" />
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-1">Condition</label>
                <input type="text" value={editCondition} onChange={(e) => setEditCondition(e.target.value)} className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium text-gray-700" />
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-1">Store 1 Price</label>
                <input type="text" value={editPriceStore1} onChange={(e) => setEditPriceStore1(e.target.value)} className="w-full p-3 border rounded-xl font-black text-blue-600" />
              </div>
              <div className="flex items-center mt-6">
                <input type="checkbox" checked={editVisStore1} onChange={(e) => setEditVisStore1(e.target.checked)} className="w-5 h-5 mr-2" />
                <label className="text-sm font-bold">Show in Store 1</label>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-400 uppercase mb-1">Store 2 Price</label>
                <input type="text" value={editPriceStore2} onChange={(e) => setEditPriceStore2(e.target.value)} className="w-full p-3 border rounded-xl font-black text-purple-600" />
              </div>
              <div className="flex items-center mt-6">
                <input type="checkbox" checked={editVisStore2} onChange={(e) => setEditVisStore2(e.target.checked)} className="w-5 h-5 mr-2" />
                <label className="text-sm font-bold">Show in Store 2</label>
              </div>
            </div>
            <div className="p-6 bg-gray-50 border-t flex justify-end gap-3">
              <button onClick={closeEditModal} className="px-6 py-2.5 rounded-xl bg-white border border-gray-200 font-bold text-gray-600 hover:bg-gray-100 transition-all">Cancel</button>
              <button onClick={saveInlineEdit} disabled={savingEdit} className="px-6 py-2.5 rounded-xl bg-blue-600 text-white font-black uppercase tracking-wider hover:bg-blue-700 transition-all shadow-md disabled:opacity-50">
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorPage;
