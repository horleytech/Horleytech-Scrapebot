import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { collection, getDocs, doc, writeBatch, query, orderBy, updateDoc } from 'firebase/firestore';
import { IoMdChatboxes } from 'react-icons/io';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import AdminDashboardLayout from '../../components/layouts/DashboardLayout';
import { db } from '../../services/firebase/index.js';
import { BASE_URL } from '../../services/constants/apiConstants.js';

const COLLECTIONS = {
  offline: 'horleyTech_OfflineInventories',
  backups: 'horleyTech_Backups',
};

const CHART_COLORS = ['#16a34a', '#2563eb', '#f59e0b', '#7c3aed', '#ef4444', '#14b8a6', '#f97316'];

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
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);

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
  const [offlineVendors, setOfflineVendors] = useState([]);
  const [backups, setBackups] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [selectedVendorIds, setSelectedVendorIds] = useState([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [manualBackupLoading, setManualBackupLoading] = useState(false);
  const [restoringBackupId, setRestoringBackupId] = useState(null);
  
  // Advanced Tools Toggle State
  const [togglingAdvancedVendorId, setTogglingAdvancedVendorId] = useState(null);

  // Messaging State
  const [allMessages, setAllMessages] = useState([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatVendor, setChatVendor] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

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
          vendorPassword: data.vendorPassword || '',
          storeWhatsappNumber: data.storeWhatsappNumber || '',
          advancedEnabled: Boolean(data.advancedEnabled),
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
      setBackups(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    } catch (error) {
      console.error('Error fetching backups:', error);
    } finally {
      setLoadingBackups(false);
    }
  };

  const fetchAllMessages = async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/messages`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load messages');
      setAllMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (error) {
      console.error('Unable to fetch global messages:', error);
    }
  };

  useEffect(() => {
    if (location.pathname === '/dashboard' || location.pathname === '/dashboard/') {
      fetchInventory();
      fetchBackups();
    }
  }, [location.pathname]);

  useEffect(() => {
    fetchAllMessages();
    const timer = setInterval(fetchAllMessages, 12000);
    return () => clearInterval(timer);
  }, []);

  const filteredOffline = useMemo(
    () => offlineVendors.filter((v) => !searchQuery || v.vendorName?.toLowerCase().includes(searchQuery.toLowerCase())),
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
    const topVendor = [...offlineVendors].sort((a, b) => (b.whatsappClicks || 0) - (a.whatsappClicks || 0))[0]?.vendorName || 'N/A';

    return { totalVendors, totalInventoryValue, totalStoreViews, totalWhatsAppOrders, mostTrackedDevice, topVendor };
  }, [offlineVendors]);

  const insightCharts = useMemo(() => {
    const categoryCount = {};
    const priceDensityMap = {
      '< ₦100k': 0,
      '₦100k - ₦500k': 0,
      '₦500k+': 0,
    };
    const leadMap = {};

    offlineVendors.forEach((vendor) => {
      (vendor.products || []).forEach((product) => {
        const category = product.Category || 'Others';
        categoryCount[category] = (categoryCount[category] || 0) + 1;

        const price = parseNairaValue(product['Regular price']);
        if (price > 0 && price < 100000) priceDensityMap['< ₦100k'] += 1;
        else if (price >= 100000 && price <= 500000) priceDensityMap['₦100k - ₦500k'] += 1;
        else if (price > 500000) priceDensityMap['₦500k+'] += 1;
      });

      const customerLogs = normalizeLogs(vendor.logs).customer || [];
      customerLogs.forEach((log) => {
        if (!log.action?.toLowerCase().includes('clicked whatsapp')) return;
        const date = new Date(log.date);
        if (Number.isNaN(date.getTime())) return;
        const key = date.toISOString().slice(0, 10);
        leadMap[key] = (leadMap[key] || 0) + 1;
      });
    });

    const now = new Date();
    const leadVelocity = Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      return {
        day: date.toLocaleDateString([], { weekday: 'short' }),
        clicks: leadMap[key] || 0,
      };
    });

    return {
      categoryMix: Object.entries(categoryCount).map(([name, value]) => ({ name, value })),
      priceDensity: Object.entries(priceDensityMap).map(([range, count]) => ({ range, count })),
      leadVelocity,
    };
  }, [offlineVendors]);

  const unreadMessages = useMemo(
    () => allMessages.filter((message) => message.sender === 'vendor' && !message.readByAdmin),
    [allMessages]
  );

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

  const toggleAdvancedTools = async (vendor) => {
    const nextValue = !vendor.advancedEnabled;
    setTogglingAdvancedVendorId(vendor.docId);
    try {
      await updateDoc(doc(db, COLLECTIONS.offline, vendor.docId), {
        advancedEnabled: nextValue,
        lastUpdated: new Date().toISOString(),
      });

      setOfflineVendors((prev) =>
        prev.map((item) =>
          item.docId === vendor.docId
            ? { ...item, advancedEnabled: nextValue, lastUpdated: new Date().toISOString() }
            : item
        )
      );
    } catch (error) {
      console.error('Advanced toggle update failed:', error);
      alert('❌ Failed to update advanced tools toggle.');
    } finally {
      setTogglingAdvancedVendorId(null);
    }
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
      fetchInventory();
      setSelectedVendorIds([]);
      alert(`✅ ${status === 'suspended' ? 'Suspended' : 'Activated'} selected vendors successfully.`);
    } catch (error) {
      console.error('Bulk vendor status update failed:', error);
      alert('❌ Could not update selected vendors.');
    } finally {
      setBulkUpdating(false);
    }
  };

  const triggerManualBackup = async () => {
    setManualBackupLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/backup/manual`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Manual backup failed');
      alert(`✅ Manual backup completed. Backup ID: ${data.backupId}`);
      fetchBackups();
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setManualBackupLoading(false);
    }
  };

  const restoreBackup = async (backupId) => {
    if (!window.confirm(`Restore backup ${backupId}? This will overwrite the live offline inventory.`)) return;
    setRestoringBackupId(backupId);
    try {
      const res = await fetch(`${BASE_URL}/api/backup/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Restore failed');
      alert(`✅ Restore complete. Restored ${data.restoredDocuments} records.`);
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
      Value: v.inventoryValue,
      Password: v.vendorPassword
    }));
    downloadCsv('platform-directory.csv', rows);
  };

  const openChatForVendor = async (vendor) => {
    setChatVendor(vendor);
    setChatOpen(true);
    try {
      const response = await fetch(`${BASE_URL}/api/messages/${vendor.vendorId}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load conversation');
      setChatMessages(Array.isArray(data.messages) ? data.messages : []);
      fetchAllMessages(); // Refresh global unread count
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  };

  const sendAdminChat = async () => {
    if (!chatVendor || !chatInput.trim()) return;

    setSendingChat(true);
    try {
      const response = await fetch(`${BASE_URL}/api/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: chatVendor.vendorId,
          sender: 'admin',
          recipient: 'vendor',
          text: chatInput.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Message failed');
      
      setChatInput('');
      setChatMessages((prev) => [...prev, data.message]);
      fetchAllMessages();
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setSendingChat(false);
    }
  };

  return (
    <AdminDashboardLayout notificationCount={unreadMessages.length} onNotificationClick={() => setNotificationOpen(true)}>
      {location.pathname === '/dashboard' || location.pathname === '/dashboard/' ? (
        <div className="p-6">
          {/* Analytics Hub Top Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4 mb-6">
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total Vendors</p>
              <p className="text-2xl font-black text-[#1A1C23] mt-2">{analytics.totalVendors}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Inventory Value</p>
              <p className="text-2xl font-black text-green-600 mt-2">{formatNaira(analytics.totalInventoryValue)}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Store Views</p>
              <p className="text-2xl font-black text-blue-600 mt-2">{analytics.totalStoreViews}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">WA Orders</p>
              <p className="text-2xl font-black text-emerald-600 mt-2">{analytics.totalWhatsAppOrders}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Top Device</p>
              <p className="text-sm font-bold text-[#1A1C23] mt-2 truncate">{analytics.mostTrackedDevice}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Star Vendor</p>
              <p className="text-sm font-bold text-[#1A1C23] mt-2 truncate">{analytics.topVendor}</p>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="mb-6 flex flex-wrap gap-3 items-center justify-between">
            <div className="flex gap-2 bg-gray-100 p-1.5 rounded-xl">
              <button onClick={() => setActiveTab('offline')} className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'offline' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Directory</button>
              <button onClick={() => setActiveTab('analytics')} className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'analytics' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Visual Analytics</button>
              <button onClick={() => setActiveTab('activity')} className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'activity' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Activity Log</button>
              <button onClick={() => setActiveTab('backups')} className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'backups' ? 'bg-white text-[#1A1C23] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Backups</button>
            </div>
          </div>

          {/* Conditional Rendering of Tabs */}
          {activeTab === 'analytics' ? (
            <div className="bg-white shadow-lg rounded-xl overflow-hidden mb-10 p-6 border border-gray-200">
              <h2 className="text-2xl font-black text-[#1A1C23] mb-8">📊 Platform Data Insights</h2>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-8">
                {/* Pie Chart: Category Mix */}
                <div className="h-[380px] border border-gray-100 rounded-2xl p-5 shadow-sm bg-gray-50">
                  <h3 className="font-bold text-gray-700 mb-4 uppercase tracking-widest text-xs">Category Distribution</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <PieChart>
                      <Pie data={insightCharts.categoryMix} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110} label>
                        {insightCharts.categoryMix.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`${value} Items`, 'Stock']} />
                      <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Bar Chart: Price Density */}
                <div className="h-[380px] border border-gray-100 rounded-2xl p-5 shadow-sm bg-gray-50">
                  <h3 className="font-bold text-gray-700 mb-4 uppercase tracking-widest text-xs">Inventory Price Density</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={insightCharts.priceDensity} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="range" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip cursor={{ fill: 'transparent' }} />
                      <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Products in Range" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Line Chart: Lead Velocity */}
              <div className="h-[400px] border border-gray-100 rounded-2xl p-5 shadow-sm bg-gray-50">
                <h3 className="font-bold text-gray-700 mb-4 uppercase tracking-widest text-xs">Lead Velocity (WhatsApp Clicks - Last 7 Days)</h3>
                <ResponsiveContainer width="100%" height="90%">
                  <LineChart data={insightCharts.leadVelocity} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="clicks" stroke="#10b981" strokeWidth={4} dot={{ r: 6, fill: '#10b981' }} activeDot={{ r: 8 }} name="WhatsApp Clicks" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : activeTab === 'backups' ? (
            <div className="bg-white shadow-lg rounded-xl overflow-hidden border border-gray-200">
              <div className="p-5 bg-gray-50 border-b flex justify-between items-center gap-4">
                <h2 className="text-lg font-bold text-[#1A1C23]">Backup Version History ({backups.length})</h2>
                <button onClick={triggerManualBackup} disabled={manualBackupLoading} className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-700 transition-all shadow-md disabled:opacity-50">
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
                      <td className="p-4 text-sm text-gray-600 font-medium">{backup.createdAt ? new Date(backup.createdAt).toLocaleString() : 'N/A'}</td>
                      <td className="p-4 text-sm font-bold text-gray-800">{backup.totalDocuments || 0} Vendors</td>
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
              <div className="p-5 space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar">
                {platformActivityTimeline.map((entry, idx) => (
                  <div key={idx} className="border-l-4 border-blue-500 pl-4 py-3 bg-gray-50 rounded-r-lg shadow-sm">
                    <div className="flex justify-between items-start">
                      <p className="font-bold text-sm text-[#1A1C23] max-w-[80%]">{entry.action}</p>
                      <span className={`text-[9px] px-2 py-1 rounded-md font-black uppercase tracking-wider ${entry.channel === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{entry.channel}</span>
                    </div>
                    <p className="text-[11px] font-bold text-gray-400 mt-2 uppercase tracking-wider">{entry.vendorName} • {formatTimelineDate(entry.date)}</p>
                  </div>
                ))}
                {platformActivityTimeline.length === 0 && <p className="p-10 text-center text-gray-400 font-bold uppercase tracking-widest">No activity logs recorded.</p>}
              </div>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex flex-col xl:flex-row gap-4 mb-6">
                <div className="flex-1 relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                  <input type="text" placeholder="Search for a WhatsApp Vendor..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-12 pr-4 py-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm font-medium" />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => bulkUpdateStatus('suspended')} disabled={!selectedVendorIds.length || bulkUpdating} className="bg-red-600 text-white px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-red-700 disabled:opacity-50 shadow-md transition-all">Suspend</button>
                  <button onClick={() => bulkUpdateStatus('active')} disabled={!selectedVendorIds.length || bulkUpdating} className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 shadow-md transition-all">Activate</button>
                  <button onClick={handleExport} className="bg-gray-800 text-white px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-black shadow-md transition-all">Export</button>
                </div>
              </div>

              {/* Vendor Directory */}
              <div className="bg-white shadow-lg rounded-xl overflow-hidden border border-gray-200">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr className="text-gray-400 text-[11px] font-black uppercase tracking-widest">
                      <th className="p-4 pl-6 w-[50px]"><input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-gray-300 cursor-pointer" /></th>
                      <th className="p-4">Vendor Name</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">View</th>
                      <th className="hidden md:table-cell p-4">Access Details</th>
                      <th className="hidden md:table-cell p-4">Monetization</th>
                      <th className="p-4">Total Inventory</th>
                      <th className="hidden md:table-cell p-4">Action</th>
                      <th className="hidden md:table-cell p-4 pr-6">Contact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredOffline.map(vendor => (
                      <tr key={vendor.docId} className="hover:bg-blue-50/30 transition-colors">
                        <td className="p-4 pl-6"><input type="checkbox" checked={selectedVendorIds.includes(vendor.docId)} onChange={() => toggleVendor(vendor.docId)} className="w-4 h-4 rounded border-gray-300 cursor-pointer" /></td>
                        <td className="p-4 font-bold text-blue-600 hover:text-blue-800"><Link to={vendor.shareableLink} target="_blank" rel="noopener noreferrer">{vendor.vendorName}</Link></td>
                        <td className="p-4">
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${vendor.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{vendor.status}</span>
                        </td>
                        <td className="p-4 text-xs font-bold text-gray-500 space-y-1">
                          <p>👁️ {vendor.viewCount} Views</p>
                          <p className="hidden md:block">🔗 {vendor.whatsappClicks} Clicks</p>
                        </td>
                        <td className="hidden md:table-cell p-4 text-[11px] text-gray-600 space-y-1">
                          <p><span className="font-black uppercase text-[9px] text-gray-400 mr-1">Pass:</span><span className="font-mono">{vendor.vendorPassword || 'N/A'}</span></p>
                          <p><span className="font-black uppercase text-[9px] text-gray-400 mr-1">WA:</span>{vendor.storeWhatsappNumber || 'N/A'}</p>
                        </td>
                        <td className="hidden md:table-cell p-4">
                          <button
                            onClick={() => toggleAdvancedTools(vendor)}
                            disabled={togglingAdvancedVendorId === vendor.docId}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${vendor.advancedEnabled ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'} disabled:opacity-50`}
                          >
                            {togglingAdvancedVendorId === vendor.docId ? '...' : vendor.advancedEnabled ? 'AI Enabled' : 'AI Locked'}
                          </button>
                        </td>
                        <td className="p-4"><span className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full text-[11px] font-bold">{vendor.totalProducts} Items</span></td>
                        <td className="hidden md:table-cell p-4"><Link to={vendor.shareableLink} target="_blank" rel="noopener noreferrer" className="inline-block bg-[#1A1C23] text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-black transition-all shadow-sm">Manage</Link></td>
                        <td className="hidden md:table-cell p-4 pr-6">
                          <button onClick={() => openChatForVendor(vendor)} className="p-2.5 rounded-xl bg-blue-100 text-blue-600 hover:bg-blue-600 hover:text-white transition-all shadow-sm relative group">
                            <IoMdChatboxes className="w-5 h-5" />
                            {allMessages.some(m => m.vendorId === vendor.vendorId && m.sender === 'vendor' && !m.readByAdmin) && (
                              <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredOffline.length === 0 && <div className="p-20 text-center text-gray-400 font-bold uppercase tracking-widest">No vendors found.</div>}
              </div>
            </>
          )}
        </div>
      ) : (
        <Outlet />
      )}

      {/* Global Notification Modal */}
      {notificationOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
              <h3 className="text-xl font-black text-[#1A1C23]">Vendor Messages</h3>
              <button onClick={() => setNotificationOpen(false)} className="text-gray-400 hover:text-red-500 font-bold text-xl transition-colors">✕</button>
            </div>
            <div className="p-6 max-h-[65vh] overflow-y-auto bg-gray-100 space-y-4">
              {unreadMessages.length > 0 ? unreadMessages.map((message) => (
                <div key={message.id} className="border border-blue-100 rounded-xl p-4 bg-white shadow-sm relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>
                  <div className="flex justify-between items-start mb-2">
                    <p className="text-sm font-black text-[#1A1C23]">{message.vendorId}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">{formatTimelineDate(message.timestamp)}</p>
                  </div>
                  <p className="text-sm text-gray-700 font-medium">{message.text}</p>
                  <button 
                    onClick={() => {
                      setNotificationOpen(false);
                      const vendor = offlineVendors.find(v => v.vendorId === message.vendorId);
                      if(vendor) openChatForVendor(vendor);
                    }} 
                    className="mt-3 text-xs font-bold text-blue-600 hover:text-blue-800 uppercase tracking-widest"
                  >
                    Reply to Vendor &rarr;
                  </button>
                </div>
              )) : (
                <div className="text-center py-10">
                  <span className="text-5xl block mb-4 grayscale opacity-50">📭</span>
                  <p className="text-gray-400 font-bold uppercase tracking-widest">Inbox is zero.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin-to-Vendor Chat Modal */}
      {chatOpen && chatVendor && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col h-[70vh] animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-black text-[#1A1C23]">Chat: {chatVendor.vendorName}</h3>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">ID: {chatVendor.vendorId}</p>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-red-500 font-bold text-xl transition-colors">✕</button>
            </div>
            <div className="p-5 flex-1 overflow-y-auto bg-gray-100 space-y-4 custom-scrollbar">
              {chatMessages.length > 0 ? chatMessages.map((message) => {
                const mine = message.sender === 'admin';
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-sm ${mine ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white border border-gray-200 text-[#1A1C23] rounded-bl-none'}`}>
                      <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${mine ? 'text-blue-200' : 'text-gray-400'}`}>{mine ? 'You (Admin)' : chatVendor.vendorName}</p>
                      <p className="text-sm whitespace-pre-wrap font-medium leading-relaxed">{message.text}</p>
                      <p className={`text-[9px] font-bold mt-2 text-right ${mine ? 'text-blue-300' : 'text-gray-400'}`}>{formatTimelineDate(message.timestamp)}</p>
                    </div>
                  </div>
                );
              }) : (
                 <div className="h-full flex flex-col items-center justify-center text-gray-400">
                  <span className="text-4xl mb-3">💬</span>
                  <p className="font-bold text-sm uppercase tracking-widest">Start the conversation</p>
                </div>
              )}
            </div>
            <div className="p-5 border-t bg-white flex gap-3">
              <textarea 
                value={chatInput} 
                onChange={(e) => setChatInput(e.target.value)} 
                className="flex-1 border border-gray-200 rounded-xl p-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none resize-none shadow-sm" 
                placeholder="Type your reply to the vendor..." 
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendAdminChat();
                  }
                }}
              />
              <button 
                onClick={sendAdminChat} 
                disabled={sendingChat || !chatInput.trim()} 
                className="bg-[#1A1C23] text-white px-8 rounded-xl font-black uppercase tracking-wider disabled:opacity-50 hover:bg-black transition-all shadow-md"
              >
                {sendingChat ? '...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminDashboardLayout>
  );
};

export default AdminDashboard;
