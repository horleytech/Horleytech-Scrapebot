import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { collection, getDocs, doc, writeBatch, query, orderBy } from 'firebase/firestore';
import AdminDashboardLayout from '../../components/layouts/DashboardLayout';
import { db } from '../../services/firebase/index.js';

const COLLECTIONS = {
  offline: 'horleyTech_OfflineInventories',
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

  const [activeTab, setActiveTab] = useState('offline'); // 'offline', 'backups', or 'activity'
  const [searchQuery, setSearchQuery] = useState('');
  const [offlineVendors, setOfflineVendors] = useState([]);
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
      const querySnapshot = await getDocs(collection(db, COLLECTIONS.offline));
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
  }, [location.pathname]);

  const filteredOffline = useMemo(
    () =>
      offlineVendors.filter(
        (v) => !searchQuery || v.vendorName?.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [offlineVendors, searchQuery]
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
    return allEntries.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 50);
  }, [offlineVendors]);

  const analytics = useMemo(() => {
    const totalVendors = offlineVendors.length;
    const totalInventoryValue = offlineVendors.reduce((sum, v) => sum + (v.inventoryValue || 0), 0);
    const totalStoreViews = offlineVendors.reduce((sum, v) => sum + (v.viewCount || 0), 0);
    const totalWhatsAppOrders = offlineVendors.reduce((sum, v) => sum + (v.whatsappClicks || 0), 0);

    const deviceFrequency = {};
    offlineVendors.forEach((vendor) => {
      (vendor.products || []).forEach((product) => {
        const key = product['Device Type'] || 'Unknown';
        deviceFrequency[key] = (deviceFrequency[key] || 0) + 1;
      });
    });

    const mostTrackedDevice = Object.entries(deviceFrequency).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    const topVendor = [...offlineVendors].sort((a, b) => (b.whatsappClicks || 0) - (a.whatsappClicks || 0))[0]?.vendorName || 'N/A';

    return { totalVendors, totalInventoryValue, totalStoreViews, totalWhatsAppOrders, mostTrackedDevice, topVendor };
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
        batch.update(vendorRef, { status, lastUpdated: new Date().toISOString() });
      });
      await batch.commit();
      fetchInventory();
      setSelectedVendorIds([]);
      alert(`✅ Vendors updated to ${status}.`);
    } catch (error) {
      console.error('Update failed:', error);
    } finally {
      setBulkUpdating(false);
    }
  };

  const triggerManualBackup = async () => {
    setManualBackupLoading(true);
    try {
      const res = await fetch('/api/backup/manual');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Manual backup failed');
      alert(`✅ Backup completed: ${data.backupId}`);
      fetchBackups();
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setManualBackupLoading(false);
    }
  };

  const restoreBackup = async (backupId) => {
    if (!window.confirm(`Restore backup ${backupId}? This overwrites live data.`)) return;
    setRestoringBackupId(backupId);
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Restore failed');
      alert(`✅ Restore complete. ${data.restoredDocuments} vendors restored.`);
      fetchInventory();
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setRestoringBackupId(null);
    }
  };

  const handleExport = () => {
    const rows = filteredOffline.map(v => ({
      Vendor: v.vendorName,
      Status: v.status,
      Views: v.viewCount,
      Orders: v.whatsappClicks,
      Products: v.totalProducts,
      Value: v.inventoryValue
    }));
    downloadCsv('whatsapp-directory.csv', rows);
  };

  return (
    <AdminDashboardLayout>
      {location.pathname === '/dashboard' || location.pathname === '/dashboard/' ? (
        <div className="p-6">
          {/* Analytics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase">Total Vendors</p>
              <p className="text-2xl font-black text-[#1A1C23] mt-2">{analytics.totalVendors}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase">Inventory Value</p>
              <p className="text-2xl font-black text-green-600 mt-2">{formatNaira(analytics.totalInventoryValue)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase">Store Views</p>
              <p className="text-2xl font-black text-blue-600 mt-2">{analytics.totalStoreViews}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase">WA Orders</p>
              <p className="text-2xl font-black text-emerald-600 mt-2">{analytics.totalWhatsAppOrders}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase">Top Device</p>
              <p className="text-sm font-bold text-[#1A1C23] mt-2 truncate">{analytics.mostTrackedDevice}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase">Star Vendor</p>
              <p className="text-sm font-bold text-[#1A1C23] mt-2 truncate">{analytics.topVendor}</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="mb-6 flex gap-3 bg-gray-100 p-1.5 rounded-xl w-fit">
            {['offline', 'backups', 'activity'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === tab ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {tab === 'offline' ? 'WhatsApp Directory' : tab === 'backups' ? 'Database Backups' : 'Platform Activity'}
              </button>
            ))}
          </div>

          {activeTab === 'backups' ? (
            <div className="bg-white shadow-lg rounded-xl overflow-hidden border border-gray-200">
              <div className="p-5 bg-gray-50 border-b flex justify-between items-center">
                <h2 className="text-lg font-bold text-[#1A1C23]">Version History ({backups.length})</h2>
                <button onClick={triggerManualBackup} disabled={manualBackupLoading} className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-all shadow-md disabled:opacity-50">
                  {manualBackupLoading ? 'Backing up...' : 'Trigger Manual Backup'}
                </button>
              </div>
              <table className="w-full text-left">
                <thead className="bg-white text-gray-400 text-[11px] font-black uppercase tracking-widest border-b">
                  <tr>
                    <th className="p-4 pl-6">Backup ID</th>
                    <th className="p-4">Created At</th>
                    <th className="p-4">Total Docs</th>
                    <th className="p-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {backups.map(backup => (
                    <tr key={backup.id} className="hover:bg-gray-50">
                      <td className="p-4 pl-6 text-sm font-mono text-blue-600">{backup.id}</td>
                      <td className="p-4 text-sm text-gray-600">{backup.createdAt ? new Date(backup.createdAt).toLocaleString() : 'N/A'}</td>
                      <td className="p-4 text-sm font-bold">{backup.totalDocuments || 0} Vendors</td>
                      <td className="p-4">
                        <button onClick={() => restoreBackup(backup.id)} disabled={restoringBackupId === backup.id} className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-xs font-black uppercase hover:bg-red-600 hover:text-white transition-all disabled:opacity-50">
                          {restoringBackupId === backup.id ? 'Restoring...' : 'Restore Version'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : activeTab === 'activity' ? (
            <div className="bg-white shadow-lg rounded-xl overflow-hidden border border-gray-200">
              <div className="p-5 bg-gray-50 border-b">
                <h2 className="text-lg font-bold text-[#1A1C23]">Global Platform Activity (Newest 50)</h2>
              </div>
              <div className="p-5 space-y-4 max-h-[600px] overflow-y-auto">
                {platformActivityTimeline.map((entry, idx) => (
                  <div key={idx} className="border-l-4 border-blue-500 pl-4 py-2 bg-gray-50 rounded-r-lg">
                    <div className="flex justify-between">
                      <p className="font-bold text-sm text-[#1A1C23]">{entry.action}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase ${entry.channel === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{entry.channel}</span>
                    </div>
                    <p className="text-[11px] font-bold text-gray-500 mt-1 uppercase tracking-wider">{entry.vendorName} • {formatTimelineDate(entry.date)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col xl:flex-row gap-4 mb-6">
                <input type="text" placeholder="🔍 Search for a WhatsApp Vendor..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-1 p-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm" />
                <div className="flex gap-3">
                  <button onClick={() => bulkUpdateStatus('suspended')} disabled={!selectedVendorIds.length || bulkUpdating} className="bg-red-600 text-white px-6 py-2 rounded-xl text-xs font-black uppercase hover:bg-red-700 disabled:opacity-50 shadow-md">Suspend</button>
                  <button onClick={() => bulkUpdateStatus('active')} disabled={!selectedVendorIds.length || bulkUpdating} className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-xs font-black uppercase hover:bg-emerald-700 disabled:opacity-50 shadow-md">Activate</button>
                  <button onClick={handleExport} className="bg-gray-800 text-white px-6 py-2 rounded-xl text-xs font-black uppercase hover:bg-black shadow-md">Export</button>
                </div>
              </div>
              <div className="bg-white shadow-lg rounded-xl overflow-hidden border border-gray-200">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr className="text-gray-400 text-[11px] font-black uppercase tracking-widest">
                      <th className="p-4 pl-6 w-[50px]"><input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded" /></th>
                      <th className="p-4">Vendor Name</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Views</th>
                      <th className="p-4">WA Clicks</th>
                      <th className="p-4">Total Inventory</th>
                      <th className="p-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredOffline.map(vendor => (
                      <tr key={vendor.docId} className="hover:bg-blue-50/30 transition-colors">
                        <td className="p-4 pl-6"><input type="checkbox" checked={selectedVendorIds.includes(vendor.docId)} onChange={() => toggleVendor(vendor.docId)} className="w-4 h-4 rounded" /></td>
                        <td className="p-4 font-bold text-blue-600 hover:underline"><Link to={vendor.shareableLink}>{vendor.vendorName}</Link></td>
                        <td className="p-4"><span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${vendor.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{vendor.status}</span></td>
                        <td className="p-4 font-bold text-gray-700">{vendor.viewCount}</td>
                        <td className="p-4 font-bold text-emerald-600">{vendor.whatsappClicks}</td>
                        <td className="p-4"><span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-[11px] font-bold">{vendor.totalProducts} Items</span></td>
                        <td className="p-4"><Link to={vendor.shareableLink} className="bg-[#1A1C23] text-white px-4 py-2 rounded-lg text-[11px] font-black uppercase hover:bg-black transition-all">Manage</Link></td>
                      </tr>
                    ))}
                  </tbody>
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