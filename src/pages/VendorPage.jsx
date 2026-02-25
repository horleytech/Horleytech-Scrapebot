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
  const [whatsappNumbersInput, setWhatsappNumbersInput] = useState(['', '', '']);

  const isAdmin = useSelector((state) => state.auth?.isAuthenticated);

  useEffect(() => {
    const fetchVendorData = async () => {
      try {
        const docRef = doc(db, 'horleyTech_OfflineInventories', vendorId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const payload = docSnap.data();
          const existingNumbers = Array.isArray(payload.whatsappNumbers) ? payload.whatsappNumbers : [];
          setVendorData(payload);
          setVendorNameInput(payload.vendorName || '');
          setAddressInput(payload.address || '');
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

  const vendorRef = useMemo(
    () => doc(db, 'horleyTech_OfflineInventories', vendorId),
    [vendorId]
  );

  const products = vendorData?.products || [];

  const uniqueGroups = useMemo(
    () => ['All', ...new Set(products.map((p) => p.groupName || 'Direct Message'))],
    [products]
  );
  const uniqueCategories = useMemo(
    () => ['All', ...new Set(products.map((p) => p.Category).filter(Boolean))],
    [products]
  );

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
        const passesGroup =
          groupFilter === 'All' || (product.groupName || 'Direct Message') === groupFilter;

        return passesDate && passesCategory && passesGroup;
      });
  }, [products, dateFilter, categoryFilter, groupFilter]);

  const allVisibleRowsSelected =
    displayData.length > 0 &&
    displayData.every(({ index }) => selectedProductIndexes.includes(index));

  const createActivityLog = (action) => ({
    action,
    date: new Date().toISOString(),
  });

  const handleExport = () => {
    const rows = displayData.map(({ product }) => ({
      Group: product.groupName || 'Direct Message',
      Category: product.Category || '',
      DeviceType: product['Device Type'] || '',
      Specification: `${product['Storage Capacity/Configuration'] || 'N/A'} | ${product['SIM Type/Model/Processor'] || 'N/A'}`,
      Condition: product.Condition || '',
      Storage: product['Storage Capacity/Configuration'] || '',
      SIMTypeModelProcessor: product['SIM Type/Model/Processor'] || '',
      Price: product['Regular price'] || '',
      DatePosted: product.DatePosted || '',
      Visibility: product.isVisible === false ? 'Hidden' : 'Visible',
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

  const updateSelectedVisibility = async (isVisible) => {
    if (!selectedProductIndexes.length) {
      alert('Please select one or more products first.');
      return;
    }

    const nextProducts = products.map((product, index) =>
      selectedProductIndexes.includes(index) ? { ...product, isVisible } : product
    );

    const now = new Date().toISOString();
    const activityLog = createActivityLog(
      `${isVisible ? 'Show Selected' : 'Hide Selected'} (${selectedProductIndexes.length} products)`
    );

    setBulkUpdating(true);
    try {
      await updateDoc(vendorRef, {
        products: nextProducts,
        lastUpdated: now,
        activityLogs: arrayUnion(activityLog),
      });

      setVendorData((prev) => ({
        ...prev,
        products: nextProducts,
        lastUpdated: now,
        activityLogs: [...(prev?.activityLogs || []), activityLog],
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

  const handleSaveSettings = async () => {
    const cleanedNumbers = whatsappNumbersInput
      .map((number) => number.trim())
      .filter((number) => number)
      .slice(0, 3);

    const now = new Date().toISOString();
    const activityLog = createActivityLog('Save Settings');

    setSavingSettings(true);
    try {
      await updateDoc(vendorRef, {
        vendorName: vendorNameInput.trim() || vendorData?.vendorName || vendorId,
        address: addressInput.trim(),
        whatsappNumbers: cleanedNumbers,
        lastUpdated: now,
        activityLogs: arrayUnion(activityLog),
      });

      setVendorData((prev) => ({
        ...prev,
        vendorName: vendorNameInput.trim() || prev?.vendorName || vendorId,
        address: addressInput.trim(),
        whatsappNumbers: cleanedNumbers,
        lastUpdated: now,
        activityLogs: [...(prev?.activityLogs || []), activityLog],
      }));
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

  if (loading) return <div className="p-10 text-center">Loading vendor data...</div>;
  if (!vendorData) {
    return <div className="p-10 text-center font-bold text-red-500">Vendor has no inventory.</div>;
  }

  const vendorBackendLink = `${window.location.origin}/vendor/${vendorId}`;
  const customerStorefrontLink = `${window.location.origin}/store/${vendorId}`;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {isAdmin && (
        <Link to="/dashboard" className="text-blue-500 hover:underline mb-4 inline-block">
          &larr; Back to Directory
        </Link>
      )}

      <div className="bg-white border border-gray-200 rounded-[12px] p-5 mb-6 shadow-sm">
        <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Store Settings</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Vendor Name</label>
            <input
              type="text"
              value={vendorNameInput}
              onChange={(e) => setVendorNameInput(e.target.value)}
              className="w-full p-3 border rounded-[8px]"
              placeholder="Enter store name"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Store Address</label>
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              className="w-full p-3 border rounded-[8px]"
              placeholder="Enter physical address"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-700 mb-2">Staff WhatsApp Numbers (max 3)</label>
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
                className="w-full p-3 border rounded-[8px]"
                placeholder={`Staff WhatsApp ${index + 1}`}
              />
            ))}
          </div>
        </div>

        <button
          onClick={handleSaveSettings}
          disabled={savingSettings}
          className="bg-[#1A1C23] text-white px-5 py-2.5 rounded-[10px] hover:bg-gray-800 disabled:opacity-50"
        >
          {savingSettings ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-[12px] p-5 mb-6 shadow-sm">
        <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Share Links</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-[10px] p-4 bg-gray-50">
            <p className="text-xs text-gray-500 mb-2">Vendor Backend Link</p>
            <p className="text-sm break-all text-[#1A1C23] mb-3">{vendorBackendLink}</p>
            <button
              onClick={() => handleCopyLink(vendorBackendLink)}
              className="bg-blue-600 text-white px-4 py-2 rounded-[8px] text-sm hover:bg-blue-700"
            >
              Copy Backend Link
            </button>
          </div>

          <div className="border rounded-[10px] p-4 bg-gray-50">
            <p className="text-xs text-gray-500 mb-2">Customer Storefront Link</p>
            <p className="text-sm break-all text-[#1A1C23] mb-3">{customerStorefrontLink}</p>
            <button
              onClick={() => handleCopyLink(customerStorefrontLink)}
              className="bg-green-600 text-white px-4 py-2 rounded-[8px] text-sm hover:bg-green-700"
            >
              Copy Storefront Link
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#1A1C23]">{vendorData.vendorName}&apos;s Inventory</h1>
          <p className="text-gray-500 mt-1">
            Showing {displayData.length} of {products.length} Items
          </p>
        </div>

        <div className="flex gap-3 w-full md:w-auto">
          <button
            onClick={handleExport}
            className="bg-green-600 text-white px-5 py-2.5 rounded-[10px] shadow-sm hover:bg-green-700 font-medium transition-colors flex-1 md:flex-none"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 bg-gray-50 p-5 rounded-[10px] border border-gray-200">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">WhatsApp Group</label>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="w-full p-2.5 border rounded-[8px]"
          >
            {uniqueGroups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">Timeframe</label>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-full p-2.5 border rounded-[8px]"
          >
            <option value="All">All Time</option>
            <option value="This Week">Last 7 Days</option>
            <option value="This Month">Last 30 Days</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">Category</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full p-2.5 border rounded-[8px]"
          >
            {uniqueCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isAdmin && (
        <div className="mb-4 flex flex-wrap gap-3 items-center">
          <button
            onClick={() => updateSelectedVisibility(false)}
            disabled={!selectedProductIndexes.length || bulkUpdating}
            className="bg-red-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50"
          >
            Hide Selected
          </button>
          <button
            onClick={() => updateSelectedVisibility(true)}
            disabled={!selectedProductIndexes.length || bulkUpdating}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            Show Selected
          </button>
          <span className="text-sm text-gray-600">{selectedProductIndexes.length} selected</span>
        </div>
      )}

      <div className="overflow-x-auto bg-white shadow rounded-[10px] border border-gray-100">
        <table className="min-w-full text-left">
          <thead className="bg-[#1A1C23] text-white">
            <tr>
              {isAdmin && (
                <th className="p-4 text-sm font-semibold w-[45px]">
                  <input
                    type="checkbox"
                    checked={allVisibleRowsSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all products"
                  />
                </th>
              )}
              <th className="p-4 text-sm font-semibold">Group</th>
              <th className="p-4 text-sm font-semibold">Device</th>
              <th className="p-4 text-sm font-semibold">Specification</th>
              <th className="p-4 text-sm font-semibold">Condition</th>
              <th className="p-4 text-sm font-semibold">Price</th>
              <th className="p-4 text-sm font-semibold">Status</th>
              <th className="p-4 text-sm font-semibold">Date Extracted</th>
            </tr>
          </thead>
          <tbody>
            {displayData.map(({ product, index }) => (
              <tr
                key={`${product['Device Type']}-${index}`}
                className={`border-b hover:bg-gray-50 ${product.isVisible === false ? 'bg-gray-100 text-gray-400 line-through' : ''}`}
              >
                {isAdmin && (
                  <td className="p-4">
                    <input
                      type="checkbox"
                      checked={selectedProductIndexes.includes(index)}
                      onChange={() => toggleProductSelection(index)}
                      aria-label={`Select product ${product['Device Type'] || index}`}
                    />
                  </td>
                )}
                <td className="p-4 text-xs">
                  <span className="bg-gray-100 px-2 py-1 rounded">{product.groupName || 'Direct Message'}</span>
                </td>
                <td className="p-4 font-medium">{product['Device Type']}</td>
                <td className="p-4 text-gray-600">
                  {(product['Storage Capacity/Configuration'] || 'N/A')}
                  {' | '}
                  {(product['SIM Type/Model/Processor'] || 'N/A')}
                </td>
                <td className="p-4 text-gray-600">{product.Condition}</td>
                <td className="p-4 font-bold text-green-600">{product['Regular price']}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${product.isVisible === false ? 'bg-gray-300 text-gray-700' : 'bg-emerald-100 text-emerald-800'}`}>
                    {product.isVisible === false ? 'Hidden' : 'Visible'}
                  </span>
                </td>
                <td className="p-4 text-sm text-gray-500">{product.DatePosted || 'N/A'}</td>
              </tr>
            ))}
            {displayData.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 8 : 7} className="p-6 text-center text-gray-500">
                  No products found for the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 mt-8 shadow-sm">
          <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Vendor Activity Logs</h2>
          {(vendorData.activityLogs || []).length > 0 ? (
            <div className="space-y-3">
              {[...(vendorData.activityLogs || [])]
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .map((log, idx) => (
                  <div key={`${log.date}-${idx}`} className="border rounded-[8px] p-3 bg-gray-50">
                    <p className="font-semibold text-[#1A1C23]">{log.action}</p>
                    <p className="text-xs text-gray-500 mt-1">{new Date(log.date).toLocaleString()}</p>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-gray-500">No activity logs recorded yet.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default VendorPage;
