import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase/index.js';

const downloadCsv = (filename, rows) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csvRows = rows.map((row) => headers.map((h) => `"${String(row[h] ?? '').replaceAll('"', '""')}"`).join(','));
  const blob = new Blob([`${headers.join(',')}\n${csvRows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
};

const VendorPage = () => {
  const { vendorId } = useParams();
  const decodedVendorId = decodeURIComponent(vendorId || '');

  const [vendorData, setVendorData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [groupFilter, setGroupFilter] = useState('All');

  useEffect(() => {
    const fetchVendorData = async () => {
      setLoading(true);
      try {
        const collectionsToTry = ['horleyTech_OfflineInventories', 'horleyTech_OnlineInventories'];
        let foundData = null;

        for (const collectionName of collectionsToTry) {
          const docSnap = await getDoc(doc(db, collectionName, decodedVendorId));
          if (docSnap.exists()) {
            foundData = docSnap.data();
            break;
          }
        }

        if (foundData) setVendorData(foundData);
        else setError('Vendor not found or has no inventory.');
      } catch (err) {
        console.error('Error fetching vendor:', err);
        setError('Failed to load vendor data.');
      } finally {
        setLoading(false);
      }
    };

    fetchVendorData();
  }, [decodedVendorId]);

  const uniqueGroups = useMemo(() => {
    if (!vendorData?.products) return ['All'];
    return ['All', ...new Set(vendorData.products.map((p) => p.groupName || 'Direct Message'))];
  }, [vendorData]);

  const filteredProducts = useMemo(() => {
    if (!vendorData?.products) return [];
    const now = new Date();

    return vendorData.products.filter((product) => {
      let passesDate = true;
      if (dateFilter !== 'All' && product.DatePosted) {
        const postDate = new Date(product.DatePosted);
        const diffDays = Math.ceil(Math.abs(now - postDate) / (1000 * 60 * 60 * 24));
        if (dateFilter === 'This Week') passesDate = diffDays <= 7;
        if (dateFilter === 'This Month') passesDate = diffDays <= 30;
        if (dateFilter === 'This Year') passesDate = diffDays <= 365;
      }

      const passesCategory =
        categoryFilter === 'All' || product.Category?.toLowerCase().includes(categoryFilter.toLowerCase());

      const pGroup = product.groupName || 'Direct Message';
      const passesGroup = groupFilter === 'All' || pGroup === groupFilter;

      return passesDate && passesCategory && passesGroup;
    });
  }, [vendorData, dateFilter, categoryFilter, groupFilter]);

  if (loading) return <div className="p-10 text-center text-lg">Loading vendor data...</div>;
  if (error) return <div className="p-10 text-center text-red-500 font-bold">{error}</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Link to="/dashboard" className="text-blue-500 hover:underline mb-4 inline-block">
        &larr; Back to Dashboard
      </Link>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#1A1C23]">{vendorData.vendorId}&apos;s Inventory</h1>
          <p className="text-gray-500 mt-1">Last updated: {new Date(vendorData.lastUpdated).toLocaleString()}</p>
        </div>
        <button
          onClick={() =>
            downloadCsv(
              `${vendorData.vendorId}-inventory.csv`,
              filteredProducts.map((p) => ({
                Group: p.groupName || 'Direct Message',
                Category: p.Category || '',
                DeviceType: p['Device Type'] || '',
                Condition: p.Condition || '',
                Storage: p['Storage Capacity/Configuration'] || '',
                Price: p['Regular price'] || '',
                DatePosted: p.DatePosted || '',
                Link: p.Link || '',
              }))
            )
          }
          className="bg-[#1A1C23] text-white px-5 py-2.5 rounded-[10px] shadow-sm hover:bg-gray-800 font-medium"
        >
          Export to CSV
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 bg-gray-50 p-5 rounded-[10px] border border-gray-200">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">WhatsApp Group</label>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="w-full p-2.5 border border-gray-300 rounded-[8px]"
          >
            {uniqueGroups.map((group) => (
              <option key={group} value={group}>
                {group === 'All' ? 'All Groups & Messages' : group}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">Timeframe</label>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-[8px]">
            <option value="All">All Time</option>
            <option value="This Week">Last 7 Days</option>
            <option value="This Month">Last 30 Days</option>
            <option value="This Year">This Year</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">Category</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-[8px]">
            <option value="All">All Categories</option>
            <option value="iPhone">iPhone</option>
            <option value="Samsung">Samsung</option>
            <option value="Others">Others</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto bg-white shadow rounded-[10px] border border-gray-100">
        <table className="min-w-full text-left border-collapse">
          <thead className="bg-[#1A1C23] text-white">
            <tr>
              <th className="p-4 font-semibold text-sm">Source/Group</th>
              <th className="p-4 font-semibold text-sm">Category</th>
              <th className="p-4 font-semibold text-sm">Device Type</th>
              <th className="p-4 font-semibold text-sm">Condition</th>
              <th className="p-4 font-semibold text-sm">Storage</th>
              <th className="p-4 font-semibold text-sm">Regular Price</th>
              <th className="p-4 font-semibold text-sm">Date Extracted</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.length > 0 ? (
              filteredProducts.map((product, index) => (
                <tr key={index} className="hover:bg-gray-50 border-b border-gray-100">
                  <td className="p-4 text-sm">{product.groupName || 'Direct Message'}</td>
                  <td className="p-4 text-sm font-medium">{product.Category}</td>
                  <td className="p-4 text-sm">{product['Device Type']}</td>
                  <td className="p-4 text-sm">{product.Condition}</td>
                  <td className="p-4 text-sm">{product['Storage Capacity/Configuration']}</td>
                  <td className="p-4 text-sm font-bold text-green-600">{product['Regular price']}</td>
                  <td className="p-4 text-sm text-gray-500">{product.DatePosted}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="7" className="p-10 text-center text-gray-500">
                  No items match your selected filters.
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
