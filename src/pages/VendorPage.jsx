import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase/index.js'; 

const VendorPage = () => {
  const { vendorId } = useParams();
  const [vendorData, setVendorData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [dateFilter, setDateFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [groupFilter, setGroupFilter] = useState('All'); // NEW GROUP FILTER

  useEffect(() => {
    const fetchVendorData = async () => {
      try {
        const docRef = doc(db, 'horleyTech_Inventories', vendorId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          setVendorData(docSnap.data());
        } else {
          setError('Vendor not found or has no inventory.');
        }
      } catch (err) {
        console.error("Error fetching vendor:", err);
        setError('Failed to load vendor data.');
      } finally {
        setLoading(false);
      }
    };

    fetchVendorData();
  }, [vendorId]);

  // Dynamically extract all unique groups this vendor posts in
  const uniqueGroups = vendorData && vendorData.products 
    ? ['All', ...new Set(vendorData.products.map(p => p.groupName || 'Direct Message'))] 
    : ['All'];

  // --- Filtering Logic ---
  const filterProducts = () => {
    if (!vendorData || !vendorData.products) return [];

    const now = new Date();
    return vendorData.products.filter(product => {
      // 1. Date Filter
      let passesDate = true;
      if (dateFilter !== 'All' && product.DatePosted) {
        const postDate = new Date(product.DatePosted);
        const diffTime = Math.abs(now - postDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (dateFilter === 'This Week') passesDate = diffDays <= 7;
        if (dateFilter === 'This Month') passesDate = diffDays <= 30;
        if (dateFilter === 'This Year') passesDate = diffDays <= 365;
      }

      // 2. Category Filter
      let passesCategory = true;
      if (categoryFilter !== 'All') {
        passesCategory = product.Category?.toLowerCase().includes(categoryFilter.toLowerCase());
      }

      // 3. Group Filter
      let passesGroup = true;
      if (groupFilter !== 'All') {
        const pGroup = product.groupName || 'Direct Message';
        passesGroup = pGroup === groupFilter;
      }

      return passesDate && passesCategory && passesGroup;
    });
  };

  const filteredProducts = filterProducts();

  // --- Copy to CSV Format ---
  const copyToClipboard = () => {
    const headers = "Group/Source,Category,Device Type,Condition,SIM Type/Model/Processor,Storage Capacity/Configuration,Regular price\n";
    const rows = filteredProducts.map(p => 
      `"${p.groupName || 'Direct Message'}","${p.Category || ''}","${p['Device Type'] || ''}","${p.Condition || ''}","${p['SIM Type/Model/Processor'] || ''}","${p['Storage Capacity/Configuration'] || ''}","${p['Regular price'] || ''}"`
    ).join("\n");
    
    navigator.clipboard.writeText(headers + rows);
    alert("Copied to clipboard in CSV format!");
  };

  if (loading) return <div className="p-10 text-center text-lg flex justify-center items-center h-screen"><span className="animate-pulse">Loading vendor data...</span></div>;
  if (error) return <div className="p-10 text-center text-red-500 font-bold">{error}</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Link to="/dashboard" className="text-blue-500 hover:underline mb-4 inline-block">&larr; Back to Dashboard</Link>
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#1A1C23]">{vendorData.vendorId}'s Inventory</h1>
          <p className="text-gray-500 mt-1">Last updated: {new Date(vendorData.lastUpdated).toLocaleString()}</p>
        </div>
        <button 
          onClick={copyToClipboard}
          className="bg-[#1A1C23] text-white px-5 py-2.5 rounded-[10px] shadow-sm hover:bg-gray-800 font-medium transition-colors"
        >
          Copy Filtered Data (CSV)
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 bg-gray-50 p-5 rounded-[10px] border border-gray-200">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">WhatsApp Group</label>
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-[8px] focus:ring-2 focus:ring-blue-500 outline-none">
            {uniqueGroups.map(group => (
              <option key={group} value={group}>{group === 'All' ? 'All Groups & Messages' : group}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">Timeframe</label>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-[8px] focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="All">All Time</option>
            <option value="This Week">Last 7 Days</option>
            <option value="This Month">Last 30 Days</option>
            <option value="This Year">This Year</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">Category</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-[8px] focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="All">All Categories</option>
            <option value="iPhone">iPhone</option>
            <option value="Samsung">Samsung</option>
            <option value="Others">Others</option>
          </select>
        </div>
      </div>

      {/* Data Table */}
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
                  <td className="p-4">
                    <span className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-[6px] text-xs font-medium">
                      {product.groupName || 'Direct Message'}
                    </span>
                  </td>
                  <td className="p-4 text-sm font-medium">{product.Category}</td>
                  <td className="p-4 text-sm text-gray-800">{product['Device Type']}</td>
                  <td className="p-4 text-sm text-gray-600">{product.Condition}</td>
                  <td className="p-4 text-sm text-gray-600">{product['Storage Capacity/Configuration']}</td>
                  <td className="p-4 text-sm font-bold text-green-600">{product['Regular price']}</td>
                  <td className="p-4 text-sm text-gray-400">{product.DatePosted}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="7" className="p-10 text-center text-gray-500">No items match your selected filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default VendorPage;
