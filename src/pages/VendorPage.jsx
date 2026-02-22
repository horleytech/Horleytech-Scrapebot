import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase/index.js'; 
import { useSelector } from 'react-redux';

// CSV Helpers
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

  // Check if the person viewing this page is the logged-in admin
  const isAdmin = useSelector((state) => state.auth?.isAuthenticated);

  useEffect(() => {
    const fetchVendorData = async () => {
      try {
        const docRef = doc(db, 'horleyTech_OfflineInventories', vendorId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) setVendorData(docSnap.data());
      } catch (err) {
        console.error("Error fetching vendor:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchVendorData();
  }, [vendorId]);

  const products = vendorData?.products || [];

  // DYNAMIC FILTERS: Extract unique values from the current vendor products
  const uniqueGroups = useMemo(() => ['All', ...new Set(products.map((p) => p.groupName || 'Direct Message'))], [products]);
  const uniqueCategories = useMemo(() => ['All', ...new Set(products.map((p) => p.Category).filter(Boolean))], [products]);

  const filteredProducts = () => {
    if (!products.length) return [];
    const now = new Date();
    
    return products.filter(product => {
      let passesDate = true;
      if (dateFilter !== 'All' && product.DatePosted) {
        const postDate = new Date(product.DatePosted);
        const diffDays = Math.ceil(Math.abs(now - postDate) / (1000 * 60 * 60 * 24));
        if (dateFilter === 'This Week') passesDate = diffDays <= 7;
        if (dateFilter === 'This Month') passesDate = diffDays <= 30;
      }

      let passesCategory = categoryFilter === 'All' || product.Category === categoryFilter;
      let passesGroup = groupFilter === 'All' || (product.groupName || 'Direct Message') === groupFilter;

      return passesDate && passesCategory && passesGroup;
    });
  };

  const displayData = filteredProducts();

  const handleExport = () => {
    const rows = displayData.map((product) => ({
      Group: product.groupName || 'Direct Message',
      Category: product.Category || '',
      DeviceType: product['Device Type'] || '',
      Condition: product.Condition || '',
      Storage: product['Storage Capacity/Configuration'] || '',
      Price: product['Regular price'] || '',
      DatePosted: product.DatePosted || ''
    }));
    downloadCsv(`${vendorData?.vendorName || 'Vendor'}-inventory.csv`, rows);
  };

  // Copy Shareable Link
  const handleCopyLink = () => {
    const fullLink = `${window.location.origin}/vendor/${vendorId}`;
    navigator.clipboard.writeText(fullLink);
    alert(`✅ Link copied to clipboard!\n\nYou can now share this specific inventory with customers:\n${fullLink}`);
  };

  if (loading) return <div className="p-10 text-center">Loading vendor data...</div>;
  if (!vendorData) return <div className="p-10 text-center font-bold text-red-500">Vendor has no inventory.</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* ONLY SHOW THIS "BACK" BUTTON TO THE ADMIN */}
      {isAdmin && (
        <Link to="/dashboard" className="text-blue-500 hover:underline mb-4 inline-block">
          &larr; Back to Directory
        </Link>
      )}
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#1A1C23]">{vendorData.vendorName}'s Inventory</h1>
          <p className="text-gray-500 mt-1">Showing {displayData.length} of {products.length} Items</p>
        </div>
        
        {/* Buttons Section */}
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

      {/* Dynamic Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 bg-gray-50 p-5 rounded-[10px] border border-gray-200">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">WhatsApp Group</label>
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="w-full p-2.5 border rounded-[8px]">
            {uniqueGroups.map(group => <option key={group} value={group}>{group}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">Timeframe</label>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full p-2.5 border rounded-[8px]">
            <option value="All">All Time</option>
            <option value="This Week">Last 7 Days</option>
            <option value="This Month">Last 30 Days</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">Category</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-full p-2.5 border rounded-[8px]">
            {uniqueCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto bg-white shadow rounded-[10px] border border-gray-100">
        <table className="min-w-full text-left">
          <thead className="bg-[#1A1C23] text-white">
            <tr>
              <th className="p-4 text-sm font-semibold">Group</th>
              <th className="p-4 text-sm font-semibold">Device</th>
              <th className="p-4 text-sm font-semibold">Condition</th>
              <th className="p-4 text-sm font-semibold">Storage</th>
              <th className="p-4 text-sm font-semibold">Price</th>
              <th className="p-4 text-sm font-semibold">Date Extracted</th>
            </tr>
          </thead>
          <tbody>
            {displayData.map((product, index) => (
              <tr key={index} className="border-b hover:bg-gray-50">
                <td className="p-4 text-xs"><span className="bg-gray-100 px-2 py-1 rounded">{product.groupName || 'Direct Message'}</span></td>
                <td className="p-4 font-medium">{product['Device Type']}</td>
                <td className="p-4 text-gray-600">{product.Condition}</td>
                <td className="p-4 text-gray-600">{product['Storage Capacity/Configuration']}</td>
                <td className="p-4 font-bold text-green-600">{product['Regular price']}</td>
                <td className="p-4 text-sm text-gray-500">{product.DatePosted || 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default VendorPage;
