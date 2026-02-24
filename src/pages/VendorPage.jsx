import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
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

  const isAdmin = useSelector((state) => state.auth?.isAuthenticated);

  useEffect(() => {
    const fetchVendorData = async () => {
      try {
        const docRef = doc(db, 'horleyTech_OfflineInventories', vendorId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setVendorData(docSnap.data());
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

  const handleExport = () => {
    const rows = displayData.map(({ product }) => ({
      Group: product.groupName || 'Direct Message',
      Category: product.Category || '',
      DeviceType: product['Device Type'] || '',
      Condition: product.Condition || '',
      Storage: product['Storage Capacity/Configuration'] || '',
      Price: product['Regular price'] || '',
      DatePosted: product.DatePosted || '',
      Visibility: product.isVisible === false ? 'Hidden' : 'Visible',
    }));
    downloadCsv(`${vendorData?.vendorName || 'Vendor'}-inventory.csv`, rows);
  };

  const handleCopyLink = () => {
    const fullLink = `${window.location.origin}/store/${vendorId}`;
    navigator.clipboard.writeText(fullLink);
    alert(`✅ Link copied to clipboard!\n\nCustomer storefront link:\n${fullLink}`);
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

    setBulkUpdating(true);
    try {
      const vendorRef = doc(db, 'horleyTech_OfflineInventories', vendorId);
      await updateDoc(vendorRef, {
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
      });

      setVendorData((prev) => ({
        ...prev,
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
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

  if (loading) return <div className="p-10 text-center">Loading vendor data...</div>;
  if (!vendorData) return <div className="p-10 text-center font-bold text-red-500">Vendor has no inventory.</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {isAdmin && (
        <Link to="/dashboard" className="text-blue-500 hover:underline mb-4 inline-block">
          &larr; Back to Directory
        </Link>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#1A1C23]">{vendorData.vendorName}&apos;s Inventory</h1>
          <p className="text-gray-500 mt-1">
            Showing {displayData.length} of {products.length} Items
          </p>
        </div>

        <div className="flex gap-3 w-full md:w-auto">
          {isAdmin && (
            <button
              onClick={handleCopyLink}
              className="bg-blue-600 text-white px-5 py-2.5 rounded-[10px] shadow-sm hover:bg-blue-700 font-medium transition-colors flex-1 md:flex-none"
            >
              🔗 Copy Link
            </button>
          )}
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
              <th className="p-4 text-sm font-semibold">Condition</th>
              <th className="p-4 text-sm font-semibold">Storage</th>
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
                <td className="p-4 text-gray-600">{product.Condition}</td>
                <td className="p-4 text-gray-600">{product['Storage Capacity/Configuration']}</td>
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
    </div>
  );
};

export default VendorPage;
