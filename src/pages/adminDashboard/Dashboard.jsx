import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import AdminDashboardLayout from '../../components/layouts/DashboardLayout';
import { db } from '../../services/firebase/index.js';

const COLLECTIONS = {
  offline: 'horleyTech_OfflineInventories',
  settings: 'horleyTech_Settings',
};

const CACHE_DOC = 'globalProductsCache';
const FALLBACK_MASTER_DICTIONARY_CSV = 'https://example.com/master-dictionary.csv';
const CHART_COLORS = ['#2563eb', '#7c3aed', '#14b8a6', '#f59e0b', '#ef4444', '#16a34a'];

const BRAND_NEW_CONDITIONS = new Set(['pristine boxed', 'brand new', 'new']);
const USED_CONDITIONS = new Set(['grade a uk used', 'grade a used', 'used']);

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

const formatNaira = (amount) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount || 0);

const parseMasterDictionaryCsv = (csvText = '') => {
  const rows = parseRowsFromCsv(csvText);
  if (!rows.length) return [];
  const sample = rows[0];
  const header = Object.keys(sample).find((key) => key.toLowerCase().includes('device type'));
  if (!header) {
    throw new Error('Master CSV must include a Device Type column.');
  }
  return Array.from(
    new Set(
      rows
        .map((row) => String(row[header] || '').trim())
        .filter(Boolean)
    )
  );
};

const standardizeCondition = (condition) => {
  const normalized = String(condition || '').toLowerCase().trim();
  if (BRAND_NEW_CONDITIONS.has(normalized)) return 'Brand New';
  if (USED_CONDITIONS.has(normalized)) return 'Grade A UK Used';
  return 'Unclean';
};

const normalizeDeviceRaw = (rawString) =>
  String(rawString || '')
    .replace(/\+/g, ' Plus ')
    .replace(/\bpm\b/gi, ' ProMax ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

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

  const scored = officialTargets
    .map((target) => {
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
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

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

    tree[category] ??= { count: 0, children: {} };
    tree[category].count += 1;

    tree[category].children[brand] ??= { count: 0, children: {} };
    tree[category].children[brand].count += 1;

    tree[category].children[brand].children[series] ??= { count: 0, children: {} };
    tree[category].children[brand].children[series].count += 1;

    tree[category].children[brand].children[series].children[device] ??= { count: 0, children: {} };
    tree[category].children[brand].children[series].children[device].count += 1;

    tree[category].children[brand].children[series].children[device].children[variation] ??= {
      count: 0,
      vendors: [],
    };

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
  const [activeTab, setActiveTab] = useState('products');
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

  const uniqueVendorNames = useMemo(
    () => Array.from(new Set(offlineVendors.map((vendor) => vendor.vendorName).filter(Boolean))).sort(),
    [offlineVendors]
  );

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
    const excluded = excludedPhrases
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

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

  const companyRows = useMemo(
    () => pricingRows.map((row) => ({ ...row, __device: String(row['Device Type'] || row.deviceType || '').trim() })),
    [pricingRows]
  );

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
        return {
          ...companyRow,
          mappedDevice: companyDevice,
          companyPrice,
          vendorPrice: null,
          targetPrice: null,
          adjustment: null,
        };
      }

      const vendorPrice = vendorItem.priceValue;
      const targetPrice = pricingMarginType === 'percentage'
        ? Math.round(vendorPrice * (1 + (marginValue / 100)))
        : Math.round(vendorPrice + marginValue);
      const adjustment = targetPrice - companyPrice;

      return {
        ...companyRow,
        mappedDevice: companyDevice,
        companyPrice,
        vendorPrice,
        targetPrice,
        adjustment,
      };
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

  const loadCompanyCsv = async () => {
    if (!pricingCsvUrl.trim()) return;
    const response = await fetch(pricingCsvUrl.trim());
    if (!response.ok) {
      alert(`❌ Failed to load company CSV (${response.status})`);
      return;
    }
    const text = await response.text();
    setPricingRows(parseRowsFromCsv(text));
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
                <button className="w-full text-left font-medium" onClick={() => toggleNode(brandKey)}>
                  {brand} ({brandNode.count.toLocaleString()})
                </button>
                {expanded[brandKey] && Object.entries(brandNode.children).map(([series, seriesNode]) => {
                  const seriesKey = `${brandKey}|series:${series}`;
                  return (
                    <div key={seriesKey} className="ml-4 mt-2">
                      <button className="w-full text-left" onClick={() => toggleNode(seriesKey)}>
                        {series} ({seriesNode.count.toLocaleString()})
                      </button>
                      {expanded[seriesKey] && Object.entries(seriesNode.children).map(([device, deviceNode]) => {
                        const deviceKey = `${seriesKey}|device:${device}`;
                        return (
                          <div key={deviceKey} className="ml-4 mt-2">
                            <button className="w-full text-left" onClick={() => toggleNode(deviceKey)}>
                              {device} ({deviceNode.count.toLocaleString()})
                            </button>
                            {expanded[deviceKey] && Object.entries(deviceNode.children).map(([variation, variationNode]) => {
                              const variationKey = `${deviceKey}|variation:${variation}`;
                              return (
                                <div key={variationKey} className="ml-4 mt-2 rounded-xl bg-black/20 p-2">
                                  <button className="w-full text-left" onClick={() => toggleNode(variationKey)}>
                                    {variation} ({variationNode.count.toLocaleString()})
                                  </button>
                                  {expanded[variationKey] && (
                                    <ul className="ml-4 mt-2 space-y-1">
                                      {variationNode.vendors.map((vendorRow) => (
                                        <li key={vendorRow.id}>
                                          {vendorRow.vendorName} - {formatNaira(vendorRow.priceValue)}
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
              {['products', 'insights', 'pricing'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-2xl ${activeTab === tab ? 'bg-white/30' : 'bg-white/10'}`}
                >
                  {tab === 'products' ? 'Global Products' : tab === 'insights' ? 'Insights' : 'Pricing Engine'}
                </button>
              ))}
              <button onClick={syncMasterDictionary} className="ml-auto px-4 py-2 rounded-2xl bg-emerald-500/70">
                {syncing ? 'Syncing...' : 'Sync Master Dictionary'}
              </button>
            </div>
          </div>

          {activeTab === 'products' && (
            <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 space-y-3">
              <div className="grid md:grid-cols-4 gap-3">
                <input className="rounded-2xl bg-black/20 border border-white/20 px-3 py-2" placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
                <input
                  className="rounded-2xl bg-black/20 border border-white/20 px-3 py-2"
                  type="text"
                  list="vendor-search-list"
                  placeholder="Vendor filter (All)"
                  value={selectedVendorFilter === 'All' ? '' : selectedVendorFilter}
                  onChange={(e) => setSelectedVendorFilter(e.target.value.trim() || 'All')}
                />
                <datalist id="vendor-search-list">
                  {uniqueVendorNames.map((name) => <option key={name} value={name} />)}
                </datalist>
                <input className="rounded-2xl bg-black/20 border border-white/20 px-3 py-2" placeholder="Excluded phrases (comma-separated)" value={excludedPhrases} onChange={(e) => setExcludedPhrases(e.target.value)} />
                <input className="rounded-2xl bg-black/20 border border-white/20 px-3 py-2" placeholder="Category filter" value={productCategoryFilter === 'All' ? '' : productCategoryFilter} onChange={(e) => setProductCategoryFilter(e.target.value.trim() || 'All')} />
              </div>
              <div className="space-y-2 max-h-[70vh] overflow-auto">{renderTree()}</div>
            </div>
          )}

          {activeTab === 'insights' && (
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-4 h-80">
                <h3 className="font-semibold mb-2">Category Mix</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData.categoryMix}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={95}
                      onClick={(entry) => {
                        const category = entry?.name || entry?.payload?.name;
                        if (!category) return;
                        setProductCategoryFilter(category);
                        setActiveTab('products');
                      }}
                    >
                      {chartData.categoryMix.map((_, index) => <Cell key={`cat-${index + 1}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-4 h-80">
                <h3 className="font-semibold mb-2">Condition Mix</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData.conditionMix}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.2)" />
                    <XAxis dataKey="condition" stroke="#fff" />
                    <YAxis stroke="#fff" />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      fill="#14b8a6"
                      onClick={(entry) => {
                        const condition = entry?.condition || entry?.payload?.condition;
                        if (!condition) return;
                        setProductConditionFilter(condition);
                        setActiveTab('products');
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {activeTab === 'pricing' && (
            <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-5 space-y-4">
              <div className="grid md:grid-cols-5 gap-3">
                <input className="rounded-2xl bg-black/20 border border-white/20 px-3 py-2 md:col-span-2" placeholder="Company CSV URL" value={pricingCsvUrl} onChange={(e) => setPricingCsvUrl(e.target.value)} />
                <button onClick={loadCompanyCsv} className="rounded-2xl bg-blue-500/70 px-3 py-2">Load CSV</button>
                <input
                  className="rounded-2xl bg-black/20 border border-white/20 px-3 py-2"
                  type="text"
                  list="vendor-search-list"
                  placeholder="Vendor"
                  value={pricingVendor}
                  onChange={(e) => setPricingVendor(e.target.value)}
                />
                <select className="rounded-2xl bg-black/20 border border-white/20 px-3 py-2" value={pricingMarginType} onChange={(e) => setPricingMarginType(e.target.value)}>
                  <option value="amount">Amount</option>
                  <option value="percentage">Percentage</option>
                </select>
                <input className="rounded-2xl bg-black/20 border border-white/20 px-3 py-2" placeholder="Margin value" value={pricingMarginValue} onChange={(e) => setPricingMarginValue(e.target.value)} />
                <button onClick={exportPricingTxt} className="rounded-2xl bg-emerald-500/70 px-3 py-2">Export to TXT</button>
              </div>

              <div className="overflow-auto rounded-2xl border border-white/20">
                <table className="w-full text-sm">
                  <thead className="bg-black/30">
                    <tr>
                      <th className="p-2 text-left">Device</th>
                      <th className="p-2 text-left">Company Price</th>
                      <th className="p-2 text-left">Vendor Price</th>
                      <th className="p-2 text-left">Target</th>
                      <th className="p-2 text-left">Adjustment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricingCalculations.map((row, index) => (
                      <tr key={`${row.__device}-${index + 1}`} className="border-t border-white/10">
                        <td className="p-2">{row.mappedDevice || row.__device || 'N/A'}</td>
                        <td className="p-2">{formatNaira(row.companyPrice || 0)}</td>
                        <td className="p-2">{row.vendorPrice === null ? 'N/A' : formatNaira(row.vendorPrice)}</td>
                        <td className="p-2">{row.targetPrice === null ? 'N/A' : formatNaira(row.targetPrice)}</td>
                        <td className="p-2">{row.adjustment === null ? 'N/A' : formatNaira(row.adjustment)}</td>
                      </tr>
                    ))}
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
