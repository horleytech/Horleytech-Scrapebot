import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { collection, getDocs, doc, writeBatch, query, orderBy } from 'firebase/firestore';
import AdminDashboardLayout from '../../components/layouts/DashboardLayout';
import { db } from '../../services/firebase/index.js';

const COLLECTIONS = {
  offline: 'horleyTech_OfflineInventories',
  online: 'horleyTech_OnlineInventories',
  backups: 'horleyTech_Backups',
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

const parseNairaValue = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;

  const cleaned = String(value).replace(/[^0-9.]/g, '');
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatNaira = (amount) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(
    amount
  );

const normalizeLogs = (logs) => ({
  admin: Array.isArray(logs?.admin) ? logs.admin : [],
  vendor: Array.isArray(logs?.vendor) ? logs.vendor : [],
  customer: Array.isArray(logs?.customer) ? logs.customer : [],
});

const formatTimelineDate = (isoDate) => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today - target) / (1000 * 60 * 60 * 24));

  const timeText = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (diffDays === 0) return `Today at ${timeText}`;
  if (diffDays === 1) return `Yesterday at ${timeText}`;

  return date.toLocaleString();
};

const AdminDashboard = () => {
  const location = useLocation();

  const [activeTab, setActiveTab] = useState('offline');
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceTab, setSourceTab] = useState('offline');
  const [offlineVendors, setOfflineVendors] = useState([]);
  const [onlineProducts, setOnlineProducts] = useState([]);
  const [backups, setBackups] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [selectedVendorIds, setSelectedVendorIds] = useState([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [manualBackupLoading, setManualBackupLoading] = useState(false);
  const [restoringBackupId, setRestoringBackupId] = useState(null);

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
            inventoryValue: Array.isArray(data.products)
              ? data.products.reduce((sum, p) => sum + parseNairaValue(p['Regular price']), 0)
              : 0,
            lastUpdated: data.lastUpdated,
            shareableLink: data.shareableLink || `/vendor/${docSnap.id}`,
            status: data.status || 'active',
            viewCount: data.viewCount || 0,
            whatsappClicks: data.whatsappClicks || 0,
            products: data.products || [],
            logs: normalizeLogs(data.logs),
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

  const fetchBackups = async () => {
    setLoadingBackups(true);
    try {
      const backupQuery = query(collection(db, COLLECTIONS.backups), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(backupQuery);

      const list = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      setBackups(list);
    } catch (error) {
      console.error('Error fetching backups:', error);
    } finally {
      setLoadingBackups(false);
    }
  };

  useEffect(() => {
    if (location.pathname === '/dashboard' || location.pathname === '/dashboard/') {
      fetchInventory();
      fetchBackups();
    }
  }, [sourceTab, location.pathname]);

  const filteredOffline = useMemo(
    () =>
      offlineVendors.filter(
        (v) => !searchQuery || v.vendorName?.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [offlineVendors, searchQuery]
  );

  const filteredOnline = useMemo(
    () =>
      onlineProducts.filter((product) => {
        if (!searchQuery) return true;
        const term = searchQuery.toLowerCase();
        return (
          product['Device Type']?.toLowerCase().includes(term) ||
          product.Category?.toLowerCase().includes(term) ||
          product.vendorName?.toLowerCase().includes(term)
        );
      }),
    [onlineProducts, searchQuery]
  );

  const platformActivityTimeline = useMemo(() => {
    const allEntries = [];

    offlineVendors.forEach((vendor) => {
      const logs = normalizeLogs(vendor.logs);
      [...logs.admin, ...logs.vendor].forEach((entry) => {
        allEntries.push({
          ...entry,
          vendorId: vendor.vendorId,
          vendorName: vendor.vendorName,
          channel: logs.admin.includes(entry) ? 'admin' : 'vendor',
        });
      });
    });

    return allEntries
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 50);
  }, [offlineVendors]);

  const analytics = useMemo(() => {
    const totalVendors = offlineVendors.length;
    const totalInventoryValue = offlineVendors.reduce((sum, vendor) => sum + (vendor.inventoryValue || 0), 0);
    const totalStoreViews = offlineVendors.reduce((sum, vendor) => sum + (vendor.viewCount || 0), 0);
    const totalWhatsAppOrders = offlineVendors.reduce((sum, vendor) => sum + (vendor.whatsappClicks || 0), 0);

    const deviceFrequency = {};
    offlineVendors.forEach((vendor) => {
      (vendor.products || []).forEach((product) => {
        const key = product['Device Type'] || 'Unknown';
        deviceFrequency[key] = (deviceFrequency[key] || 0) + 1;
      });
    });

    const mostTrackedDevice = Object.entries(deviceFrequency).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    const topVendor =
      [...offlineVendors].sort((a, b) => (b.whatsappClicks || 0) - (a.whatsappClicks || 0))[0]?.vendorName || 'N/A';

    return {
      totalVendors,
      totalInventoryValue,
      totalStoreViews,
      totalWhatsAppOrders,
      mostTrackedDevice,
      topVendor,
    };
  }, [offlineVendors]);

  const allFilteredSelected =
    filteredOffline.length > 0 && filteredOffline.every((vendor) => selectedVendorIds.includes(vendor.docId));

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

  const triggerManualBackup = async () => {
    setManualBackupLoading(true);
    try {
      const res = await fetch('/api/backup/manual');
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Manual backup failed');
      }

      alert(`✅ Manual backup completed. Backup ID: ${data.backupId}`);
      fetchBackups();
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setManualBackupLoading(false);
    }
  };

  const restoreBackup = async (backupId) => {
    if (!window.confirm(`Restore backup ${backupId}? This will overwrite the live offline inventory.`)) {
      return;
    }

    setRestoringBackupId(backupId);
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Restore failed');
      }

      alert(`✅ Restore complete. Restored ${data.restoredDocuments} records.`);
      fetchInventory();
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setRestoringBackupId(null);
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-sm text-gray-500">Total Vendors</p>
              <p className="text-3xl font-bold text-[#1A1C23] mt-2">{analytics.totalVendors}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-sm text-gray-500">Total Inventory Value</p>
              <p className="text-3xl font-bold text-[#1A1C23] mt-2">{formatNaira(analytics.totalInventoryValue)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-sm text-gray-500">Total Store Views</p>
              <p className="text-3xl font-bold text-[#1A1C23] mt-2">{analytics.totalStoreViews}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-sm text-gray-500">Total WhatsApp Orders Initiated</p>
              <p className="text-3xl font-bold text-[#1A1C23] mt-2">{analytics.totalWhatsAppOrders}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-sm text-gray-500">Most Tracked Device</p>
              <p className="text-xl font-bold text-[#1A1C23] mt-2">{analytics.mostTrackedDevice}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-sm text-gray-500">Top Performing Vendor</p>
              <p className="text-xl font-bold text-[#1A1C23] mt-2">{analytics.topVendor}</p>
            </div>
          </div>

          <div className="mb-4 flex gap-3">
            <button
              onClick={() => setActiveTab('offline')}
              className={`px-4 py-2 rounded-lg font-semibold ${activeTab === 'offline' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
            >
              Offline Vendors
            </button>
            <button
              onClick={() => setActiveTab('backups')}
              className={`px-4 py-2 rounded-lg font-semibold ${activeTab === 'backups' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
            >
              Database Backups
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={`px-4 py-2 rounded-lg font-semibold ${activeTab === 'activity' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'}`}
            >
              Activity Log
            </button>
          </div>

          {activeTab === 'backups' ? (
            <div className="bg-white shadow rounded-[10px] overflow-hidden mb-10">
              <div className="p-4 bg-gray-50 border-b border-[#DDDCF9] flex flex-wrap justify-between items-center gap-3">
                <h2 className="text-[18px] font-bold text-[#1A1C23]">Backup Version History ({backups.length})</h2>
                <button
                  onClick={triggerManualBackup}
                  disabled={manualBackupLoading}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {manualBackupLoading ? 'Running Backup...' : 'Trigger Manual Backup'}
                </button>
              </div>

              <table className="w-full text-left">
                <thead className="h-[60px] border-b border-b-[#DDDCF9] bg-white text-[#1A1C23] font-bold">
                  <tr>
                    <th className="p-4 pl-6">Backup ID</th>
                    <th className="p-4">Created At</th>
                    <th className="p-4">Documents</th>
                    <th className="p-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.length > 0 ? (
                    backups.map((backup) => (
                      <tr key={backup.id} className="hover:bg-gray-50 border-b border-gray-100">
                        <td className="p-4 pl-6 text-sm font-semibold text-[#1A1C23]">{backup.id}</td>
                        <td className="p-4 text-sm text-gray-600">
                          {backup.createdAt ? new Date(backup.createdAt).toLocaleString() : 'N/A'}
                        </td>
                        <td className="p-4 text-sm font-semibold">{backup.totalDocuments || 0}</td>
                        <td className="p-4">
                          <button
                            onClick={() => restoreBackup(backup.id)}
                            disabled={restoringBackupId === backup.id}
                            className="bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
                          >
                            {restoringBackupId === backup.id ? 'Restoring...' : 'Restore This Version'}
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="4" className="p-6 text-center text-gray-500">
                        {loadingBackups ? 'Loading backups...' : 'No backups found.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : activeTab === 'activity' ? (
            <div className="bg-white shadow rounded-[10px] overflow-hidden mb-10">
              <div className="p-4 bg-gray-50 border-b border-[#DDDCF9]">
                <h2 className="text-[18px] font-bold text-[#1A1C23]">Platform Activity Timeline (Newest 50)</h2>
              </div>

              <div className="p-4 space-y-3">
                {platformActivityTimeline.length > 0 ? (
                  platformActivityTimeline.map((entry, index) => (
                    <div key={`${entry.vendorId}-${entry.date}-${index}`} className="border rounded-[8px] p-3 bg-gray-50">
                      <div className="flex flex-wrap justify-between gap-2">
                        <p className="font-semibold text-[#1A1C23]">{entry.action}</p>
                        <span className={`text-xs px-2 py-1 rounded-full font-bold ${entry.channel === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                          {entry.channel}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">{entry.vendorName} ({entry.vendorId})</p>
                      <p className="text-xs text-gray-500 mt-1">{formatTimelineDate(entry.date)}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500">No admin/vendor activity logs available yet.</p>
                )}
              </div>
            </div>
          ) : (
            <>
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
                          <th className="p-4">WA Clicks</th>
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
                              <td className="p-4 font-semibold text-[#1A1C23]">{vendor.whatsappClicks || 0}</td>
                              <td className="p-4">
                                <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold">
                                  {vendor.totalProducts} Items
                                </span>
                              </td>
                              <td className="p-4 text-gray-500">
                                {vendor.lastUpdated ? new Date(vendor.lastUpdated).toLocaleDateString() : 'N/A'}
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
                            <td colSpan="8" className="p-6 text-center text-gray-500">
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
            </>
          )}
        </div>
      ) : (
        <Outlet />
      )}
    </AdminDashboardLayout>
  );
};

export default AdminDashboard;
