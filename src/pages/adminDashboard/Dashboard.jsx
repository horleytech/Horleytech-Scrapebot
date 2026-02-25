import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
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

const AdminDashboard = () => {
  const location = useLocation();

  const [searchQuery, setSearchQuery] = useState('');
  const [sourceTab, setSourceTab] = useState('offline');
  const [offlineVendors, setOfflineVendors] = useState([]);
  const [onlineProducts, setOnlineProducts] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [selectedVendorIds, setSelectedVendorIds] = useState([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);

  useEffect(() => {
    const fetchInventory = async () => {
      setLoadingSearch(true);
      try {
        const querySnapshot = await getDocs(collection(db, COLLECTIONS[sourceTab]));

        if (sourceTab === 'offline') {
          const vendors = [];
          querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            vendors.push({
              docId: docSnap.id,
              vendorId: data.vendorId || docSnap.id,
              vendorName: data.vendorName || data.vendorId || docSnap.id,
              totalProducts: data.products ? data.products.length : 0,
              lastUpdated: data.lastUpdated,
              shareableLink: data.shareableLink || `/vendor/${docSnap.id}`,
              status: data.status || 'active',
              viewCount: data.viewCount || 0,
            });
          });
          setOfflineVendors(vendors);
          setSelectedVendorIds([]);
        } else {
          const globalItems = [];
          querySnapshot.forEach((docSnap) => {
            const vendorData = docSnap.data();
            if (Array.isArray(vendorData.products)) {
              vendorData.products.forEach((product) => {
                globalItems.push({
                  ...product,
                  vendorName: vendorData.vendorName || vendorData.vendorId,
                  vendorLink: vendorData.shareableLink,
                });
              });
            }
          });
          setOnlineProducts(globalItems);
        }
      } catch (error) {
        console.error('Error fetching inventory:', error);
      } finally {
        setLoadingSearch(false);
      }
    };

    if (location.pathname === '/dashboard' || location.pathname === '/dashboard/') {
      fetchInventory();
    }
  }, [sourceTab, location.pathname]);

  const filteredOffline = useMemo(() => {
    return offlineVendors.filter(
      (v) => !searchQuery || v.vendorName?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [offlineVendors, searchQuery]);

  const filteredOnline = useMemo(() => {
    return onlineProducts.filter((product) => {
      if (!searchQuery) return true;
      const term = searchQuery.toLowerCase();
      return (
        product['Device Type']?.toLowerCase().includes(term) ||
        product.Category?.toLowerCase().includes(term) ||
        product.vendorName?.toLowerCase().includes(term)
      );
    });
  }, [onlineProducts, searchQuery]);

  const analytics = useMemo(() => {
    const totalVendors = offlineVendors.length;
    const totalProductsTracked = offlineVendors.reduce(
      (sum, vendor) => sum + (vendor.totalProducts || 0),
      0
    );
    const totalCustomerViews = offlineVendors.reduce(
      (sum, vendor) => sum + (vendor.viewCount || 0),
      0
    );

    return { totalVendors, totalProductsTracked, totalCustomerViews };
  }, [offlineVendors]);

  const allFilteredSelected =
    filteredOffline.length > 0 &&
    filteredOffline.every((vendor) => selectedVendorIds.includes(vendor.docId));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredOffline.map((vendor) => vendor.docId));
      setSelectedVendorIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      const merged = new Set([...selectedVendorIds, ...filteredOffline.map((vendor) => vendor.docId)]);
      setSelectedVendorIds(Array.from(merged));
    }
  };

  const toggleVendor = (docId) => {
    setSelectedVendorIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const bulkUpdateStatus = async (status) => {
    if (!selectedVendorIds.length) {
      alert('Please select at least one vendor first.');
      return;
    }

    setBulkUpdating(true);
    try {
      const batch = writeBatch(db);
      selectedVendorIds.forEach((vendorDocId) => {
        const vendorRef = doc(db, COLLECTIONS.offline, vendorDocId);
        batch.update(vendorRef, {
          status,
          lastUpdated: new Date().toISOString(),
        });
      });
      await batch.commit();

      setOfflineVendors((prev) =>
        prev.map((vendor) =>
          selectedVendorIds.includes(vendor.docId)
            ? { ...vendor, status, lastUpdated: new Date().toISOString() }
            : vendor
        )
      );
      setSelectedVendorIds([]);
      alert(`✅ ${status === 'suspended' ? 'Suspended' : 'Activated'} selected vendors successfully.`);
    } catch (error) {
      console.error('Bulk vendor status update failed:', error);
      alert('❌ Could not update selected vendors. Please try again.');
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleExport = () => {
    if (sourceTab === 'offline') {
      downloadCsv('offline-vendors.csv', filteredOffline);
    } else {
      const rows = filteredOnline.map((product) => ({
        Vendor: product.vendorName || '',
        Source: product.groupName || '',
        DeviceType: product['Device Type'] || '',
        Condition: product.Condition || '',
        Price: product['Regular price'] || '',
        Link: product.Link || '',
      }));
      downloadCsv('online-inventory.csv', rows);
    }
  };

  return (
    <AdminDashboardLayout>
      {location.pathname === '/dashboard' || location.pathname === '/dashboard/' ? (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-sm text-gray-500">Total Vendors</p>
              <p className="text-3xl font-bold text-[#1A1C23] mt-2">{analytics.totalVendors}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-sm text-gray-500">Total Products Tracked</p>
              <p className="text-3xl font-bold text-[#1A1C23] mt-2">{analytics.totalProductsTracked}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-sm text-gray-500">Total Customer Views</p>
              <p className="text-3xl font-bold text-[#1A1C23] mt-2">{analytics.totalCustomerViews}</p>
            </div>
          </div>

          <div className="mb-4 flex gap-3">
            <button
              onClick={() => setSourceTab('offline')}
              className={`px-4 py-2 rounded-lg font-semibold ${sourceTab === 'offline' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
            >
              Offline (WhatsApp Directory)
            </button>
            <button
              onClick={() => setSourceTab('online')}
              className={`px-4 py-2 rounded-lg font-semibold ${sourceTab === 'online' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
            >
              Online (Website Scrapers)
            </button>
          </div>

          <div className="mb-6 flex gap-3">
            <input
              type="text"
              placeholder={
                sourceTab === 'offline'
                  ? '🔍 Search for a WhatsApp Vendor...'
                  : '🔍 Search Scraped Products...'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full p-4 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#1A1C23] text-[15px] shadow-sm"
            />
            <button
              onClick={handleExport}
              className="bg-green-600 text-white px-6 rounded-[10px] font-semibold hover:bg-green-700 transition-colors"
            >
              Export CSV
            </button>
          </div>

          {sourceTab === 'offline' && (
            <div className="mb-4 flex flex-wrap gap-3 items-center">
              <button
                onClick={() => bulkUpdateStatus('suspended')}
                disabled={!selectedVendorIds.length || bulkUpdating}
                className="bg-red-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                Suspend Selected
              </button>
              <button
                onClick={() => bulkUpdateStatus('active')}
                disabled={!selectedVendorIds.length || bulkUpdating}
                className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                Activate Selected
              </button>
              <span className="text-sm text-gray-600">{selectedVendorIds.length} selected</span>
            </div>
          )}

          <div className="bg-white shadow rounded-[10px] overflow-hidden mb-10">
            <div className="p-4 bg-gray-50 border-b border-[#DDDCF9] flex justify-between items-center">
              <h2 className="text-[18px] font-bold text-[#1A1C23]">
                {sourceTab === 'offline'
                  ? `WhatsApp Directory (${filteredOffline.length} Vendors)`
                  : `Scraped Products (${filteredOnline.length} Items)`}
              </h2>
            </div>

            <table className="w-full table rounded-[10px] text-left">
              {sourceTab === 'offline' ? (
                <>
                  <thead className="h-[60px] border-b border-b-[#DDDCF9] bg-white text-[#1A1C23] font-bold">
                    <tr>
                      <th className="p-4 pl-6 w-[50px]">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleSelectAll}
                          aria-label="Select all vendors"
                        />
                      </th>
                      <th className="p-4 pl-6">Vendor Name</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Views</th>
                      <th className="p-4">Total Inventory</th>
                      <th className="p-4">Last Updated</th>
                      <th className="p-4">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOffline.length > 0 ? (
                      filteredOffline.map((vendor) => (
                        <tr key={vendor.docId} className="hover:bg-gray-50 border-b border-gray-100">
                          <td className="p-4 pl-6">
                            <input
                              type="checkbox"
                              checked={selectedVendorIds.includes(vendor.docId)}
                              onChange={() => toggleVendor(vendor.docId)}
                              aria-label={`Select ${vendor.vendorName}`}
                            />
                          </td>
                          <td className="p-4 pl-6 font-bold text-blue-600">{vendor.vendorName}</td>
                          <td className="p-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${vendor.status === 'suspended' ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                              {vendor.status === 'suspended' ? 'Suspended' : 'Active'}
                            </span>
                          </td>
                          <td className="p-4 font-semibold text-[#1A1C23]">{vendor.viewCount || 0}</td>
                          <td className="p-4">
                            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold">
                              {vendor.totalProducts} Items
                            </span>
                          </td>
                          <td className="p-4 text-gray-500">
                            {vendor.lastUpdated
                              ? new Date(vendor.lastUpdated).toLocaleDateString()
                              : 'N/A'}
                          </td>
                          <td className="p-4">
                            <Link
                              to={vendor.shareableLink}
                              className="bg-[#1A1C23] text-white px-4 py-2 rounded-[8px] text-sm hover:bg-gray-800 transition"
                            >
                              View Inventory
                            </Link>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="7" className="p-6 text-center text-gray-500">
                          {loadingSearch ? 'Loading vendors...' : 'No vendors found.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </>
              ) : (
                <>
                  <thead className="h-[60px] border-b border-b-[#DDDCF9] bg-white text-[#1A1C23] font-bold">
                    <tr>
                      <th className="p-4 pl-6">Store</th>
                      <th className="p-4">Device Type</th>
                      <th className="p-4">Condition</th>
                      <th className="p-4">Price</th>
                      <th className="p-4">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOnline.length > 0 ? (
                      filteredOnline.map((product, index) => (
                        <tr key={index} className="hover:bg-gray-50 border-b border-gray-100">
                          <td className="p-4 pl-6 font-bold">{product.vendorName}</td>
                          <td className="p-4 text-sm">{product['Device Type']}</td>
                          <td className="p-4 text-sm text-gray-600">{product.Condition}</td>
                          <td className="p-4 font-semibold text-green-700">{product['Regular price']}</td>
                          <td className="p-4">
                            {product.Link ? (
                              <a
                                href={product.Link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-500 underline text-sm"
                              >
                                View Item
                              </a>
                            ) : (
                              'N/A'
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" className="p-6 text-center text-gray-500">
                          {loadingSearch ? 'Loading products...' : 'No products found.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </>
              )}
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
