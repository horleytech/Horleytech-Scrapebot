import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase/index.js'; // Adjust path if your firebase config is elsewhere

const VendorPage = () => {
  const { vendorId } = useParams(); // Grabs the ID from the URL
  const [vendorData, setVendorData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [dateFilter, setDateFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');

  useEffect(() => {
    const fetchVendorData = async () => {
      try {
        // 🔒 SECURE FETCH: We only ask Firebase for this ONE specific document
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

      return passesDate && passesCategory;
    });
  };

  const filteredProducts = filterProducts();

  // --- Copy to CSV Format ---
  const copyToClipboard = () => {
    const headers = "Category,Device Type,Condition,SIM Type/Model/Processor,Storage Capacity/Configuration,Regular price\n";
    const rows = filteredProducts.map(p => 
      `"${p.Category || ''}","${p['Device Type'] || ''}","${p.Condition || ''}","${p['SIM Type/Model/Processor'] || ''}","${p['Storage Capacity/Configuration'] || ''}","${p['Regular price'] || ''}"`
    ).join("\n");
    
    navigator.clipboard.writeText(headers + rows);
    alert("Copied to clipboard in CSV format!");
  };

  if (loading) return <div className="p-10 text-center text-lg">Loading vendor data...</div>;
  if (error) return <div className="p-10 text-center text-red-500">{error}</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Link to="/" className="text-blue-500 hover:underline mb-4 inline-block">&larr; Back to Dashboard</Link>
      
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-3xl font-bold">{vendorData.vendorId}'s Inventory</h1>
          <p className="text-gray-500">Last updated: {new Date(vendorData.lastUpdated).toLocaleDateString()}</p>
        </div>
        <button 
          onClick={copyToClipboard}
          className="bg-green-600 text-white px-4 py-2 rounded shadow hover:bg-green-700"
        >
          Copy Filtered Data
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6 bg-gray-100 p-4 rounded-lg">
        <div>
          <label className="block text-sm font-medium mb-1">Timeframe</label>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="p-2 border rounded">
            <option value="All">All Time</option>
            <option value="This Week">Last 7 Days</option>
            <option value="This Month">Last 30 Days</option>
            <option value="This Year">This Year</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Category</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="p-2 border rounded">
            <option value="All">All Categories</option>
            <option value="iPhone">iPhone</option>
            <option value="Samsung">Samsung</option>
            <option value="Others">Others</option>
          </select>
        </div>
      </div>

      {/* Data Table */}
      <div className="overflow-x-auto bg-white shadow rounded-lg">
        <table className="min-w-full text-left border-collapse">
          <thead className="bg-gray-800 text-white">
            <tr>
              <th className="p-3 border">Category</th>
              <th className="p-3 border">Device Type</th>
              <th className="p-3 border">Condition</th>
              <th className="p-3 border">SIM/Processor</th>
              <th className="p-3 border">Storage</th>
              <th className="p-3 border">Regular Price</th>
              <th className="p-3 border">Date Posted</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.length > 0 ? (
              filteredProducts.map((product, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="p-3 border">{product.Category}</td>
                  <td className="p-3 border">{product['Device Type']}</td>
                  <td className="p-3 border">{product.Condition}</td>
                  <td className="p-3 border">{product['SIM Type/Model/Processor']}</td>
                  <td className="p-3 border">{product['Storage Capacity/Configuration']}</td>
                  <td className="p-3 border font-semibold text-green-700">{product['Regular price']}</td>
                  <td className="p-3 border text-sm text-gray-500">{product.DatePosted}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="7" className="p-6 text-center text-gray-500">No products match your filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default VendorPage;
