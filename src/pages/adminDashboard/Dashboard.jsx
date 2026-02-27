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
// 🔥 HARDCODED MASTER CSV SO YOU DON'T NEED VERCEL ENV VARIABLES
const FALLBACK_MASTER_DICTIONARY_CSV = 'https://docs.google.com/spreadsheets/d/1LYvixRWFuZYWa8VqI7pDvTjzsepEWqAkE7oDbv1L4j4/export?format=csv';
const CHART_COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#7c3aed', '#ef4444', '#14b8a6', '#f97316'];

const BRAND_NEW_CONDITIONS = new Set(['pristine boxed', 'brand new', 'new']);
const USED_CONDITIONS = new Set(['grade a uk used', 'grade a used', 'used']);

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

const parseMasterDictionaryCsv = (csvText = '') => {
  const rows = parseRowsFromCsv(csvText);
  if (!rows.length) return [];
  const sample = rows[0];
  // 🔥 STRIPS HIDDEN EXCEL BOM CHARACTERS TO PREVENT DEVICE TYPE ERROR
  const header = Object.keys(sample).find((key) => key.toLowerCase().replace(/[^a-z ]/g, '').includes('device type'));
  if (!header) {
    throw new Error(`Master CSV must include a Device Type column. Found headers: ${Object.keys(sample).join(', ')}`);
  }
  return Array.from(new Set(rows.map((row) => String(row[header] || '').trim()).filter(Boolean)));
};

const standardizeCondition = (condition) => {
  const normalized = String(condition || '').toLowerCase().trim();
  if (BRAND_NEW_CONDITIONS.has(normalized)) return 'Brand New';
  if (USED_CONDITIONS.has(normalized)) return 'Grade A UK Used';
  return 'Unclean';
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
  const hasUltraOrUOrPlus = /\bultra\b|\bplus\b|\+|\bs\d{1,2}\s*u\b/.test(raw);
  return hasUltraOrUOrPlus;
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

const buildProductTree = (rows) => {
  const tree = {};
  rows.forEach((row) => {
    const category = row.category || 'Others';
    const brand = row.brand || 'Others';
    const series = row.series || 'Others';
    const device = row.deviceType || 'Unknown Device';
    const variation = `${row.condition} | ${row.simType} | ${row.storage}`;
    tree[category] ??= { count: 0, children: {} }; tree[category].count += 1;
    tree[category].children[brand] ??= { count: 0, children: {} }; tree[category].children[brand].count += 1;
    tree[category].children[brand].children[series] ??= { count: 0, children: {} }; tree[category].children[brand].children[series].count += 1;
    tree[category].children[brand].children[series].children[device] ??= { count: 0, children: {} }; tree[category].children[brand].children[series].children[device].count += 1;
    tree[category].children[brand].children[series].children[device].children[variation] ??= { count: 0, vendors: [] };
    tree[category].children[brand].children[series].children[device].children[variation].count += 1;
    tree[category].children[brand].children[series].children[device].children[variation].vendors.push(row);
  });
  return tree;
};

const inferBrand = (deviceType) => {
  const normalized = String(deviceType || '').toLowerCase();
  if (normalized.includes('iphone') || normalized.includes('ipad') || normalized.includes('macbook')) return 'Apple';
  if (normalized.includes('samsung') || /\bs\d{1,2}/.test(normalized)) return 'Samsung';
  if (normalized.includes('pixel')) return 'Google';
  return 'Others';
};

const inferSeries = (deviceType) => {
  const normalized = String(deviceType || '').toLowerCase();
  const iphone = normalized.match(/iphone\s*(\d+)/);
  if (iphone) return `iPhone ${iphone[1]} Series`;
  const samsung = normalized.match(/s\s?(\d{1,2})/);
  if (samsung) return `Samsung S${samsung[1]} Series`;
  return 'Others';
};

const AdminDashboard = () => {
  const location = useLocation();
  const isAdmin = true;

  const [activeTab, setActiveTab] = useState('offline');
  const [offlineVendors, setOfflineVendors] = useState([]);
  const [globalProductsCache, setGlobalProductsCache] = useState([]);
  const [officialTargets, setOfficialTargets] = useState([]);
  const [syncing, setSyncing] = useState(false);

  const [search, setSearch] = useState('');
  const [selectedVendorFilter, setSelectedVendorFilter] = useState('All');
  const [excludedPhrases, setExcludedPhrases] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('All');
  const [productConditionFilter, setProductConditionFilter] = useState('All');

  const [pricingCsvUrl, setPricingCsvUrl] = useState('');
  const [pricingRows, setPricingRows] = useState([]);
  const [pricingVendor, setPricingVendor] = useState('');
  const [pricingMarginType, setPricingMarginType] = useState('amount');
  const [pricingMarginValue, setPricingMarginValue] = useState('0');

  const [expanded, setExpanded] = useState({});

  const uniqueVendorNames = useMemo(() => Array.from(new Set(offlineVendors.map((vendor) => vendor.vendorName).filter(Boolean))).sort(), [offlineVendors]);

  const fetchInventory = async () => {
    const snap = await getDocs(collection(db, COLLECTIONS.offline));
    const rows = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      rows.push({
        docId: docSnap.id,
        vendorName: data.vendorName || data.vendorId || docSnap.id,
        products: Array.isArray(data.products) ? data.products : [],
      });
    });
    setOfflineVendors(rows);
  };

  const fetchCache = async () => {
    const ref = doc(db, COLLECTIONS.settings, CACHE_DOC);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      setGlobalProductsCache(Array.isArray(data.products) ? data.products : []);
      setOfficialTargets(Array.isArray(data.officialTargets) ? data.officialTargets : []);
    }
  };

  useEffect(() => {
    fetchInventory();
    fetchCache();
  }, []);

  const syncMasterDictionary = async () => {
    const csvUrl = import.meta.env.VITE_MASTER_DICTIONARY_CSV || FALLBACK_MASTER_DICTIONARY_CSV;
    setSyncing(true);
    try {
      const response = await fetch(csvUrl);
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
            category: String(product.Category || 'Others').trim() || 'Others',
            brand: inferBrand(mappedDevice),
            series: inferSeries(mappedDevice),
            deviceType: mappedDevice,
            condition: standardizeCondition(product.Condition),
            simType: String(product['SIM Type/Model/Processor'] || 'N/A').trim() || 'N/A',
            storage: String(product['Storage Capacity/Configuration'] || 'N/A').trim() || 'N/A',
            price: String(product['Regular price'] || '0').trim(),
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
      alert(`✅ Synced ${mapped.length.toLocaleString()} mapped rows to global cache.`);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const excluded = excludedPhrases.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    return globalProductsCache.filter((row) => {
      const haystack = `${row.category} ${row.brand} ${row.series} ${row.deviceType} ${row.condition} ${row.storage} ${row.vendorName}`.toLowerCase();
      const phraseBlocked = excluded.some((phrase) => haystack.includes(phrase));
      if (phraseBlocked) return false;
      if (selectedVendorFilter !== 'All' && row.vendorName !== selectedVendorFilter) return false;
      if (productCategoryFilter !== 'All' && row.category !== productCategoryFilter) return false;
      if (productConditionFilter !== 'All' && row.condition !== productConditionFilter) return false;
      if (search && !haystack.includes(search.toLowerCase())) return false;
      return true;
    });
  }, [globalProductsCache, excludedPhrases, selectedVendorFilter, productCategoryFilter, productConditionFilter, search]);

  const productTree = useMemo(() => buildProductTree(filteredProducts), [filteredProducts]);

  const chartData = useMemo(() => {
    const categories = {};
    const conditions = {};
    filteredProducts.forEach((row) => {
      categories[row.category] = (categories[row.category] || 0) + 1;
      conditions[row.condition] = (conditions[row.condition] || 0) + 1;
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
    
    // 🔥 AUTO-CONVERTS WEB LINKS TO CSV DOWNLOAD LINKS
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
        const key = `${row.deviceType}__${row.condition}__${row.storage}`;
        const prev = vendorInventory.get(key);
        if (!prev || row.priceValue < prev.priceValue) {
          vendorInventory.set(key, row);
        }
      });

    const marginValue = Number(pricingMarginValue) || 0;

    return companyRows.map((companyRow) => {
      const companyDevice = smartMapDevice(companyRow.__device, officialTargets);
      const condition = standardizeCondition(companyRow.Condition || companyRow.condition);
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
        <div key={categoryKey} className="rounded-2xl bg-white/10 border border-white/20 p-3">
          <button className="w-full text-left font-semibold" onClick={() => toggleNode(categoryKey)}>
            {category} ({categoryNode.count.toLocaleString()})
          </button>
          {expanded[categoryKey] && Object.entries(categoryNode.children).map(([brand, brandNode]) => {
            const brandKey = `${categoryKey}|brand:${brand}`;
            return (
              <div key={brandKey} className="ml-4 mt-2">
                <button className="w-full text-left font-medium text-emerald-400" onClick={() => toggleNode(brandKey)}>
                  {brand} ({brandNode.count.toLocaleString()})
                </button>
                {expanded[brandKey] && Object.entries(brandNode.children).map(([series, seriesNode]) => {
                  const seriesKey = `${brandKey}|series:${series}`;
                  return (
                    <div key={seriesKey} className="ml-4 mt-2">
                      <button className="w-full text-left text-blue-400" onClick={() => toggleNode(seriesKey)}>
                        {series} ({seriesNode.count.toLocaleString()})
                      </button>
                      {expanded[seriesKey] && Object.entries(seriesNode.children).map(([device, deviceNode]) => {
                        const deviceKey = `${seriesKey}|device:${device}`;
                        return (
                          <div key={deviceKey} className="ml-4 mt-2">
                            <button className="w-full text-left text-orange-300 font-bold" onClick={() => toggleNode(deviceKey)}>
                              {device} ({deviceNode.count.toLocaleString()})
                            </button>
                            {expanded[deviceKey] && Object.entries(deviceNode.children).map(([variation, variationNode]) => {
                              const variationKey = `${deviceKey}|variation:${variation}`;
                              return (
                                <div key={variationKey} className="ml-4 mt-2 rounded-xl bg-black/20 p-2">
                                  <button className="w-full text-left text-gray-300 text-sm" onClick={() => toggleNode(variationKey)}>
                                    {variation} ({variationNode.count.toLocaleString()})
                                  </button>
                                  {expanded[variationKey] && (
                                    <ul className="ml-4 mt-2 space-y-2">
                                      {variationNode.vendors.map((vendorRow) => (
                                        <li key={vendorRow.id} className="text-xs text-white bg-black/40 p-2 rounded-lg flex justify-between items-center">
                                          <span><span className="font-bold text-emerald-300">{vendorRow.vendorName}</span> • {formatTimelineDate(vendorRow.date)}</span>
                                          <span className="font-black text-lg">{formatNaira(vendorRow.priceValue)}</span>
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
    <AdminDashboardLayout>
      <section className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">
          <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 shadow-2xl">
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setActiveTab('offline')} className={`px-4 py-2 rounded-2xl ${activeTab === 'offline' ? 'bg-white/30' : 'bg-white/10'}`}>Directory</button>
              <button onClick={() => setActiveTab('products')} className={`px-4 py-2 rounded-2xl ${activeTab === 'products' ? 'bg-white/30' : 'bg-white/10'}`}>Global Products</button>
              <button onClick={() => setActiveTab('insights')} className={`px-4 py-2 rounded-2xl ${activeTab === 'insights' ? 'bg-white/30' : 'bg-white/10'}`}>Insights</button>
              <button onClick={() => setActiveTab('pricing')} className={`px-4 py-2 rounded-2xl ${activeTab === 'pricing' ? 'bg-white/30' : 'bg-white/10'}`}>Pricing Engine</button>
              <button onClick={syncMasterDictionary} className="ml-auto px-4 py-2 rounded-2xl bg-emerald-500/70 font-bold hover:bg-emerald-400/80 transition-all shadow-[0_0_15px_rgba(16,185,129,0.5)]">
                {syncing ? 'Syncing...' : 'Sync Master Dictionary'}
              </button>
            </div>
          </div>

          {activeTab === 'products' && (
            <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 space-y-4 shadow-2xl">
              <div className="grid md:grid-cols-4 gap-3">
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500" placeholder="Search devices..." value={search} onChange={(e) => setSearch(e.target.value)} />
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500" type="text" list="vendor-search-list" placeholder="Vendor filter (All)" value={selectedVendorFilter === 'All' ? '' : selectedVendorFilter} onChange={(e) => setSelectedVendorFilter(e.target.value.trim() || 'All')} />
                <datalist id="vendor-search-list">{uniqueVendorNames.map((name) => <option key={name} value={name} />)}</datalist>
                <input className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500" placeholder="Excluded phrases (e.g. active, swap)" value={excludedPhrases} onChange={(e) => setExcludedPhrases(e.target.value)} />
                <select className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 outline-none focus:border-blue-500 text-white" value={productConditionFilter} onChange={(e) => setProductConditionFilter(e.target.value)}>
                  <option value="All">All Conditions</option>
                  <option value="Brand New">Brand New (Clean)</option>
                  <option value="Grade A UK Used">Used (Clean)</option>
                  <option value="Unclean">Unclean Data</option>
                </select>
              </div>
              <div className="space-y-3 max-h-[65vh] overflow-y-auto custom-scrollbar p-2">{renderTree()}</div>
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
        </div>
      </section>
    </AdminDashboardLayout>
  );
};

export default AdminDashboard;
