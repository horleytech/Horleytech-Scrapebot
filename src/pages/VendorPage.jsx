import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../services/firebase/index.js';
import { useSelector } from 'react-redux';

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

const THEME_PRESETS = ['#16a34a', '#1d4ed8', '#7c3aed', '#ea580c'];

const VendorPage = () => {
  const { vendorId } = useParams();
  const [vendorData, setVendorData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [groupFilter, setGroupFilter] = useState('All');
  const [selectedProductIndexes, setSelectedProductIndexes] = useState([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const [savingSettings, setSavingSettings] = useState(false);
  const [vendorNameInput, setVendorNameInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [themeColorInput, setThemeColorInput] = useState('#16a34a');
  const [logoBase64, setLogoBase64] = useState('');
  const [whatsappNumbersInput, setWhatsappNumbersInput] = useState(['', '', '']);
  const [allowedGroups, setAllowedGroups] = useState([]);

  const isAdmin = useSelector((state) => state.auth?.isAuthenticated);

  useEffect(() => {
    const fetchVendorData = async () => {
      try {
        const docRef = doc(db, 'horleyTech_OfflineInventories', vendorId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const payload = docSnap.data();
          const existingNumbers = Array.isArray(payload.whatsappNumbers) ? payload.whatsappNumbers : [];
          const existingAllowedGroups = Array.isArray(payload.storefrontAllowedGroups)
            ? payload.storefrontAllowedGroups
            : [];

          setVendorData(payload);
          setVendorNameInput(payload.vendorName || '');
          setAddressInput(payload.address || '');
          setThemeColorInput(payload.themeColor || '#16a34a');
          setLogoBase64(payload.logoBase64 || '');
          setAllowedGroups(existingAllowedGroups);
          setWhatsappNumbersInput([
            existingNumbers[0] || '',
            existingNumbers[1] || '',
            existingNumbers[2] || '',
          ]);
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
  }, [vendorId]);

  const vendorRef = useMemo(() => doc(db, 'horleyTech_OfflineInventories', vendorId), [vendorId]);
  const products = vendorData?.products || [];

  const uniqueGroups = useMemo(
    () => ['All', ...new Set(products.map((p) => p.groupName || 'Direct Message'))],
    [products]
  );

  const sourceGroups = useMemo(
    () => [...new Set(products.map((p) => p.groupName || 'Direct Message'))],
    [products]
  );

  const uniqueCategories = useMemo(
    () => ['All', ...new Set(products.map((p) => p.Category).filter(Boolean))],
    [products]
  );

  useEffect(() => {
    // Default to all groups if none are explicitly selected yet
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
        const passesGroup = groupFilter === 'All' || (product.groupName || 'Direct Message') === groupFilter;

        return passesDate && passesCategory && passesGroup;
      });
  }, [products, dateFilter, categoryFilter, groupFilter]);

  const allVisibleRowsSelected =
    displayData.length > 0 &&
    displayData.every(({ index }) => selectedProductIndexes.includes(index));

  const createLog = (action) => ({ action, date: new Date().toISOString() });

  const handleExport = () => {
    const rows = displayData.map(({ product }) => ({
      Group: product.groupName || 'Direct Message',
      Device: product['Device Type'] || '',
      Condition: product.Condition || '',
      Specification: `${product['Storage Capacity/Configuration'] || 'N/A'} | ${product['SIM Type/Model/Processor'] || 'N/A'}`,
      Storage: product['Storage Capacity/Configuration'] || '',
      SIMTypeModelProcessor: product['SIM Type/Model/Processor'] || '',
      Price: product['Regular price'] || '',
      Status: product.isVisible === false ? 'Hidden' : 'Visible',
      Extracted: product.DatePosted || '',
    }));
    downloadCsv(`${vendorData?.vendorName || 'Vendor'}-inventory.csv`, rows);
  };

  const handleCopyLink = async (link) => {
    await navigator.clipboard.writeText(link);
    alert(`✅ Link copied to clipboard!\n\n${link}`);
  };

  const toggleSelectAll = () => {
    if (allVisibleRowsSelected) {
      const visibleSet = new Set(displayData.map(({ index }) => index));
      setSelectedProductIndexes((prev) => prev.filter((idx) => !visibleSet.has(idx)));
    } else {
      const merged = new Set([...selectedProductIndexes, ...displayData.map(({ index }) => index)]);
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

  const compressImageToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 150;
          canvas.height = 150;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 150, 150);

          const scale = Math.min(150 / img.width, 150 / img.height);
          const drawWidth = img.width * scale;
          const drawHeight = img.height * scale;
          const x = (150 - drawWidth) / 2;
          const y = (150 - drawHeight) / 2;
          ctx.drawImage(img, x, y, drawWidth, drawHeight);

          resolve(canvas.toDataURL('image/jpeg', 0.8));
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
      const base64 = await compressImageToBase64(file);
      setLogoBase64(base64);
    } catch (error) {
      console.error('Logo compression failed:', error);
      alert('❌ Could not process image. Try another file.');
    }
  };

  const updateSelectedVisibility = async (isVisible) => {
    if (!selectedProductIndexes.length) {
      alert('Please select one or more products first.');
      return;
    }

    const nextProducts = products.map((product, index) =>
      selectedProductIndexes.includes(index) ? { ...product, isVisible } : product
    );

    const log = createLog(`${isVisible ? 'Show Selected' : 'Hide Selected'} (${selectedProductIndexes.length} products)`);

    setBulkUpdating(true);
    try {
      await updateDoc(vendorRef, {
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
        activityLogs: arrayUnion(log),
      });

      setVendorData((prev) => ({
        ...prev,
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
        activityLogs: [...(prev?.activityLogs || []), log],
      }));
      setSelectedProductIndexes([]);
      alert(`✅ Selected products are now ${isVisible ? 'visible' : 'hidden'}.`);
    } catch (error) {
      console.error('Error updating product visibility:', error);
      alert('❌ Could not update product visibility.');
    } finally {
      setBulkUpdating(false);
    }
  };

  const buildDeepComparisonLogs = (previousVendorData, nextState) => {
    const logs = [];
    if ((previousVendorData.vendorName || '') !== nextState.vendorName) {
      logs.push(createLog(`Changed Store Name to '${nextState.vendorName}'`));
    }
    if ((previousVendorData.address || '') !== nextState.address) {
      logs.push(createLog(`Updated Store Address to '${nextState.address || 'N/A'}'`));
    }
    if ((previousVendorData.themeColor || '#16a34a') !== nextState.themeColor) {
      logs.push(createLog(`Updated Store Theme Color to '${nextState.themeColor}'`));
    }
    if ((previousVendorData.logoBase64 || '') !== nextState.logoBase64) {
      logs.push(createLog('Updated Store Logo'));
    }
    const prevNumbers = JSON.stringify(previousVendorData.whatsappNumbers || []);
    const nextNumbers = JSON.stringify(nextState.whatsappNumbers);
    if (prevNumbers !== nextNumbers) {
      logs.push(createLog(`Updated Staff WhatsApp Numbers to '${nextState.whatsappNumbers.join(', ') || 'None'}'`));
    }
    const prevGroups = JSON.stringify(previousVendorData.storefrontAllowedGroups || []);
    const nextGroups = JSON.stringify(nextState.storefrontAllowedGroups);
    if (prevGroups !== nextGroups) {
      logs.push(createLog(`Updated Storefront Allowed Groups`));
    }
    if (!logs.length) {
      logs.push(createLog('Saved Settings (No Field Changes Detected)'));
    }
    return logs;
  };

  const handleSaveSettings = async () => {
    const cleanedNumbers = whatsappNumbersInput
      .map((number) => number.trim())
      .filter((number) => number)
      .slice(0, 3);

    const cleanedAllowedGroups = allowedGroups.filter(Boolean);

    const nextState = {
      vendorName: vendorNameInput.trim() || vendorData?.vendorName || vendorId,
      address: addressInput.trim(),
      themeColor: themeColorInput || '#16a34a',
      logoBase64: logoBase64 || '',
      whatsappNumbers: cleanedNumbers,
      storefrontAllowedGroups: cleanedAllowedGroups,
    };

    const logs = buildDeepComparisonLogs(vendorData || {}, nextState);

    setSavingSettings(true);
    try {
      await updateDoc(vendorRef, {
        ...nextState,
        lastUpdated: new Date().toISOString(),
        activityLogs: arrayUnion(...logs),
      });

      setVendorData((prev) => ({
        ...prev,
        ...nextState,
        lastUpdated: new Date().toISOString(),
        activityLogs: [...(prev?.activityLogs || []), ...logs],
      }));
      alert('✅ Store settings saved successfully.');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('❌ Could not save store settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) return <div className="p-10 text-center text-gray-600">Loading vendor data...</div>;
  if (!vendorData) {
    return <div className="p-10 text-center font-bold text-red-500">Vendor has no inventory.</div>;
  }

  const vendorBackendLink = `${window.location.origin}/vendor/${vendorId}`;
  const customerStoreLink = `${window.location.origin}/store/${vendorId}`;

  return (
    <div className="p-6 max-w-7xl mx-auto bg-[#F9FAFB] min-h-screen">
      {isAdmin && (
        <Link to="/dashboard" className="text-blue-600 font-semibold hover:underline mb-4 inline-block">
          &larr; Back to Directory
        </Link>
      )}

      {/* Share Links Section */}
      <div className="bg-white border border-gray-200 rounded-[12px] p-5 mb-6 shadow-sm">
        <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Share Links</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-[10px] p-4 bg-gray-50">
            <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Vendor Backend Link</p>
            <p className="text-sm break-all text-[#1A1C23] mb-3 font-mono bg-white p-2 rounded border">{vendorBackendLink}</p>
            <button
              onClick={() => handleCopyLink(vendorBackendLink)}
              className="bg-blue-600 text-white px-4 py-2 rounded-[8px] text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm"
            >
              Copy Backend Link
            </button>
          </div>

          <div className="border rounded-[10px] p-4 bg-gray-50">
            <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Customer Storefront Link</p>
            <p className="text-sm break-all text-[#1A1C23] mb-3 font-mono bg-white p-2 rounded border">{customerStoreLink}</p>
            <button
              onClick={() => handleCopyLink(customerStoreLink)}
              className="bg-green-600 text-white px-4 py-2 rounded-[8px] text-sm font-bold hover:bg-green-700 transition-colors shadow-sm"
            >
              Copy Store Link
            </button>
          </div>
        </div>
      </div>

      {/* Settings Section */}
      <div className="bg-white border border-gray-200 rounded-[12px] p-5 mb-6 shadow-sm">
        <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Store Settings</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Vendor Name</label>
            <input
              type="text"
              value={vendorNameInput}
              onChange={(e) => setVendorNameInput(e.target.value)}
              className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Enter store name"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Store Address</label>
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Enter physical address"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Store Theme Color</label>
            <div className="flex items-center gap-3 mb-3">
              <input
                type="color"
                value={themeColorInput}
                onChange={(e) => setThemeColorInput(e.target.value)}
                className="w-14 h-12 border rounded cursor-pointer"
              />
              <span className="text-sm font-mono font-bold text-gray-600">{themeColorInput.toUpperCase()}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setThemeColorInput(preset)}
                  className={`w-8 h-8 rounded-full border-2 shadow-sm transition-transform hover:scale-110 ${themeColorInput === preset ? 'border-gray-900' : 'border-white'}`}
                  style={{ backgroundColor: preset }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Store Logo (150x150)</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleLogoChange}
              className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {logoBase64 && (
              <img src={logoBase64} alt="Logo preview" className="w-16 h-16 rounded-full mt-3 border-2 border-gray-100 object-cover shadow-sm" />
            )}
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-2">Staff WhatsApp Numbers (Routing)</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {whatsappNumbersInput.map((value, index) => (
              <input
                key={`whatsapp-${index}`}
                type="text"
                value={value}
                onChange={(e) => {
                  const next = [...whatsappNumbersInput];
                  next[index] = e.target.value;
                  setWhatsappNumbersInput(next);
                }}
                className="w-full p-3 border rounded-[8px] focus:ring-2 focus:ring-green-500 outline-none"
                placeholder={`Staff Number ${index + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-2">Allowed Storefront Groups</label>
          <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
            {sourceGroups.map((group) => (
              <label key={group} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 text-blue-600 rounded"
                  checked={allowedGroups.includes(group)}
                  onChange={() => toggleAllowedGroup(group)}
                />
                <span className="text-sm font-medium text-gray-700">{group}</span>
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={handleSaveSettings}
          disabled={savingSettings}
          className="bg-[#1A1C23] text-white px-8 py-3 rounded-[10px] font-bold hover:bg-black transition-all disabled:opacity-50 shadow-md"
        >
          {savingSettings ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* Inventory Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#1A1C23]">{vendorData.vendorName}&apos;s Inventory</h1>
          <p className="text-gray-500 mt-1 font-medium">Viewing {displayData.length} of {products.length} Items</p>
        </div>
        <button
          onClick={handleExport}
          className="bg-green-600 text-white px-6 py-3 rounded-[10px] shadow-md hover:bg-green-700 font-bold transition-all"
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 bg-white p-5 rounded-[12px] border border-gray-200 shadow-sm">
        <div>
          <label className="block text-xs font-black text-gray-500 uppercase mb-2">WhatsApp Group</label>
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="w-full p-3 border rounded-[8px] font-semibold bg-gray-50">
            {uniqueGroups.map((group) => <option key={group} value={group}>{group}</option>)}
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
            {uniqueCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>
      </div>

      {/* Bulk Actions */}
      {isAdmin && (
        <div className="mb-4 flex flex-wrap gap-3 items-center bg-blue-50 p-4 rounded-xl border border-blue-100">
          <button
            onClick={() => updateSelectedVisibility(false)}
            disabled={!selectedProductIndexes.length || bulkUpdating}
            className="bg-red-600 text-white px-5 py-2 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 transition-all shadow-sm"
          >
            Hide Selected
          </button>
          <button
            onClick={() => updateSelectedVisibility(true)}
            disabled={!selectedProductIndexes.length || bulkUpdating}
            className="bg-emerald-600 text-white px-5 py-2 rounded-lg font-bold hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-sm"
          >
            Show Selected
          </button>
          <span className="text-sm font-bold text-blue-700">{selectedProductIndexes.length} products selected</span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto bg-white shadow-lg rounded-[12px] border border-gray-200">
        <table className="min-w-full text-left">
          <thead className="bg-[#1A1C23] text-white">
            <tr>
              {isAdmin && (
                <th className="p-4 w-[50px]">
                  <input type="checkbox" checked={allVisibleRowsSelected} onChange={toggleSelectAll} className="w-4 h-4" />
                </th>
              )}
              <th className="p-4 text-xs font-bold uppercase tracking-wider">Group</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider">Device</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider">Condition</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider">Specification</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider">Storage</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider">Price</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider">Status</th>
              <th className="p-4 text-xs font-bold uppercase tracking-wider">Extracted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {displayData.map(({ product, index }) => (
              <tr
                key={`${product['Device Type']}-${index}`}
                className={`hover:bg-blue-50/30 transition-colors ${product.isVisible === false ? 'bg-gray-50 opacity-60' : ''}`}
              >
                {isAdmin && (
                  <td className="p-4">
                    <input
                      type="checkbox"
                      checked={selectedProductIndexes.includes(index)}
                      onChange={() => toggleProductSelection(index)}
                      className="w-4 h-4"
                    />
                  </td>
                )}
                <td className="p-4">
                  <span className="text-[10px] font-bold bg-white border px-2 py-1 rounded text-gray-500 whitespace-nowrap">
                    {product.groupName || 'Direct Message'}
                  </span>
                </td>
                <td className="p-4 font-bold text-[#1A1C23]">{product['Device Type'] || 'N/A'}</td>
                <td className="p-4">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${product.Condition?.toLowerCase().includes('new') ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                    {product.Condition || 'N/A'}
                  </span>
                </td>
                <td className="p-4 text-sm text-gray-600">
                  {product['SIM Type/Model/Processor'] || 'N/A'}
                </td>
                <td className="p-4 text-sm font-semibold text-gray-700">{product['Storage Capacity/Configuration'] || 'N/A'}</td>
                <td className="p-4 font-black text-green-700 text-lg">{product['Regular price'] || 'N/A'}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${product.isVisible === false ? 'bg-gray-200 text-gray-500' : 'bg-emerald-100 text-emerald-700'}`}>
                    {product.isVisible === false ? 'Hidden' : 'Visible'}
                  </span>
                </td>
                <td className="p-4 text-[11px] text-gray-400 font-medium">{product.DatePosted || 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {displayData.length === 0 && <div className="p-12 text-center text-gray-400 font-medium">No inventory matches your filters.</div>}
      </div>

      {/* Activity Logs */}
      {isAdmin && (
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 mt-8 shadow-sm">
          <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Vendor Activity Timeline</h2>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {[...(vendorData.activityLogs || [])]
              .sort((a, b) => new Date(b.date) - new Date(a.date))
              .map((log, idx) => (
                <div key={idx} className="border-l-4 border-blue-500 pl-4 py-2 bg-gray-50 rounded-r-lg">
                  <p className="font-bold text-sm text-[#1A1C23]">{log.action}</p>
                  <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase tracking-wider">{new Date(log.date).toLocaleString()}</p>
                </div>
              ))}
            {(!vendorData.activityLogs || vendorData.activityLogs.length === 0) && <p className="text-gray-400 text-sm italic">No activity recorded yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorPage;