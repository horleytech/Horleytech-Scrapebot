import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { useSelector } from 'react-redux';
import AdminDashboardLayout from '../../components/layouts/DashboardLayout';
import { db } from '../../services/firebase/index.js';

const COLLECTIONS = {
  offline: 'horleyTech_OfflineInventories',
  online: 'horleyTech_OnlineInventories',
};

const toCsv = (rows) => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const csvRows = rows.map((row) =>
    headers
      .map((header) => `"${String(row[header] ?? '').replaceAll('"', '""')}"`)
      .join(',')
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

const AdminDashboard = () => {
  const location = useLocation();
  const isOnlineMode = useSelector((state) => state.mode.isOnline);

  const [searchQuery, setSearchQuery] = useState('');
  const [sourceTab, setSourceTab] = useState('offline');
  const [allProducts, setAllProducts] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);

  useEffect(() => {
    const fetchInventory = async () => {
      setLoadingSearch(true);
      try {
        const querySnapshot = await getDocs(collection(db, COLLECTIONS[sourceTab]));
        const globalItems = [];

        querySnapshot.forEach((docSnap) => {
          const vendorData = docSnap.data();
          if (!Array.isArray(vendorData.products)) return;
          vendorData.products.forEach((product) => {
            globalItems.push({
              ...product,
              vendorName: vendorData.vendorId,
              vendorLink: `/vendor/${encodeURIComponent(vendorData.vendorId)}`,
            });
          });
        });

        setAllProducts(globalItems);
      } catch (error) {
        console.error('Error fetching global inventory:', error);
      } finally {
        setLoadingSearch(false);
      }
    };

    if (!isOnlineMode && (location.pathname === '/dashboard' || location.pathname === '/dashboard/')) {
      fetchInventory();
    }
  }, [isOnlineMode, sourceTab, location.pathname]);

  const searchResults = useMemo(() => {
    return allProducts.filter((product) => {
      if (!searchQuery) return true;
      const term = searchQuery.toLowerCase();
      return (
        product['Device Type']?.toLowerCase().includes(term) ||
        product.Category?.toLowerCase().includes(term) ||
        product.vendorName?.toLowerCase().includes(term) ||
        product.groupName?.toLowerCase().includes(term)
      );
    });
  }, [allProducts, searchQuery]);

  const exportRows = searchResults.map((product) => ({
    Vendor: product.vendorName || '',
    Group: product.groupName || 'Direct Message',
    Category: product.Category || '',
    DeviceType: product['Device Type'] || '',
    Condition: product.Condition || '',
    Storage: product['Storage Capacity/Configuration'] || '',
    Price: product['Regular price'] || '',
    DatePosted: product.DatePosted || '',
    Link: product.Link || '',
  }));

  return (
    <AdminDashboardLayout>
      {isOnlineMode ? (
        <Outlet />
      ) : location.pathname === '/dashboard' || location.pathname === '/dashboard/' ? (
        <div>
          <div className="mb-4 flex gap-3">
            <button
              onClick={() => setSourceTab('offline')}
              className={`px-4 py-2 rounded-lg font-semibold ${
                sourceTab === 'offline' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'
              }`}
            >
              Offline (WhatsApp/TXT)
            </button>
            <button
              onClick={() => setSourceTab('online')}
              className={`px-4 py-2 rounded-lg font-semibold ${
                sourceTab === 'online' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'
              }`}
            >
              Online (Scrapers)
            </button>
          </div>

          <div className="mb-6 flex gap-3">
            <input
              type="text"
              placeholder="🔍 Search by model, vendor, category, or group"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full p-4 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#1A1C23] text-[15px] shadow-sm"
            />
            <button
              onClick={() => downloadCsv(`${sourceTab}-inventory.csv`, exportRows)}
              className="bg-green-600 text-white px-4 rounded-[10px] font-semibold hover:bg-green-700"
            >
              Export CSV
            </button>
          </div>

          <div className="bg-white shadow rounded-[10px] overflow-x-auto mb-10">
            <div className="p-4 bg-gray-50 border-b border-[#DDDCF9] flex justify-between items-center">
              <h2 className="text-[18px] font-bold text-[#1A1C23]">
                {sourceTab === 'offline' ? 'Offline' : 'Online'} Inventory ({searchResults.length} items)
              </h2>
            </div>

            <table className="w-full table rounded-[10px]">
              <thead className="h-[60px] border-b border-b-[#DDDCF9] bg-white">
                <tr className="text-[#1A1C23] font-bold text-left">
                  <th className="p-3 pl-6 border-b border-[#DDDCF9]">Vendor</th>
                  <th className="p-3 border-b border-[#DDDCF9]">Source / Group</th>
                  <th className="p-3 border-b border-[#DDDCF9]">Device Type</th>
                  <th className="p-3 border-b border-[#DDDCF9]">Condition</th>
                  <th className="p-3 border-b border-[#DDDCF9]">Storage</th>
                  <th className="p-3 border-b border-[#DDDCF9]">Price</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.length > 0 ? (
                  searchResults.map((product, index) => (
                    <tr key={index} className="hover:bg-gray-50 border-b border-gray-100 text-[15px] font-medium text-[#1A1C23]">
                      <td className="p-3 pl-6 font-bold text-blue-600">
                        <Link to={product.vendorLink} className="hover:underline">
                          {product.vendorName}
                        </Link>
                      </td>
                      <td className="p-3 text-gray-600">
                        <span className="bg-gray-100 px-2 py-1 rounded text-xs">{product.groupName || 'Direct Message'}</span>
                      </td>
                      <td className="p-3">{product['Device Type']}</td>
                      <td className="p-3">{product.Condition}</td>
                      <td className="p-3">{product['Storage Capacity/Configuration']}</td>
                      <td className="p-3 font-semibold text-green-700">{product['Regular price']}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" className="p-6 text-center text-gray-500 font-medium text-[15px]">
                      {loadingSearch ? 'Loading inventory...' : 'No products found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <Outlet />
      )}
    </AdminDashboardLayout>
  );
};

export default AdminDashboard;
