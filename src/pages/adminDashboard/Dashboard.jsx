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
import AnalyticsPage from './AnalyticsPage';

const COLLECTIONS = {
  offline: 'horleyTech_OfflineInventories',
  online: 'horleyTech_OnlineInventories',
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
  const [togglingAdvancedVendorId, setTogglingAdvancedVendorId] = useState(null);

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
            vendorPassword: data.vendorPassword || '',
            storeWhatsappNumber: data.storeWhatsappNumber || '',
            advancedEnabled: Boolean(data.advancedEnabled),
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
      setBackups(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    } catch (error) {
      console.error('Error fetching backups:', error);
    } finally {
      setLoadingBackups(false);
    }
  };

  const fetchAllMessages = async () => {
    try {
      const response = await fetch('/api/messages');
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
  }, [sourceTab, location.pathname]);

  useEffect(() => {
    fetchAllMessages();
    const timer = setInterval(fetchAllMessages, 12000);
    return () => clearInterval(timer);
  }, []);

  const filteredOffline = useMemo(
    () => offlineVendors.filter((v) => !searchQuery || v.vendorName?.toLowerCase().includes(searchQuery.toLowerCase())),
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
        if (price < 100000) priceDensityMap['< ₦100k'] += 1;
        else if (price <= 500000) priceDensityMap['₦100k - ₦500k'] += 1;
        else priceDensityMap['₦500k+'] += 1;
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
      const res = await fetch('/api/backup/restore', {
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

  const openChatForVendor = async (vendor) => {
    setChatVendor(vendor);
    setChatOpen(true);

    try {
      const response = await fetch(`/api/messages/${vendor.vendorId}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load conversation');
      setChatMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (error) {
      alert(`❌ ${error.message}`);
    }
  };

  const sendAdminChat = async () => {
    if (!chatVendor || !chatInput.trim()) return;

    setSendingChat(true);
    try {
      const response = await fetch('/api/messages/send', {
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
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm"><p className="text-sm text-gray-500">Total Vendors</p><p className="text-3xl font-bold text-[#1A1C23] mt-2">{analytics.totalVendors}</p></div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm"><p className="text-sm text-gray-500">Total Inventory Value</p><p className="text-3xl font-bold text-[#1A1C23] mt-2">{formatNaira(analytics.totalInventoryValue)}</p></div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm"><p className="text-sm text-gray-500">Total Store Views</p><p className="text-3xl font-bold text-[#1A1C23] mt-2">{analytics.totalStoreViews}</p></div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm"><p className="text-sm text-gray-500">Total WhatsApp Orders Initiated</p><p className="text-3xl font-bold text-[#1A1C23] mt-2">{analytics.totalWhatsAppOrders}</p></div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm"><p className="text-sm text-gray-500">Most Tracked Device</p><p className="text-xl font-bold text-[#1A1C23] mt-2">{analytics.mostTrackedDevice}</p></div>
            <div className="bg-white border border-gray-200 rounded-[12px] p-5 shadow-sm"><p className="text-sm text-gray-500">Top Performing Vendor</p><p className="text-xl font-bold text-[#1A1C23] mt-2">{analytics.topVendor}</p></div>
          </div>

          <div className="mb-4 flex flex-wrap gap-3 items-center justify-between">
            <div className="flex gap-3">
              <button onClick={() => setActiveTab('offline')} className={`px-4 py-2 rounded-lg font-semibold ${activeTab === 'offline' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'}`}>Offline Vendors</button>
              <button onClick={() => setActiveTab('backups')} className={`px-4 py-2 rounded-lg font-semibold ${activeTab === 'backups' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'}`}>Database Backups</button>
              <button onClick={() => setActiveTab('activity')} className={`px-4 py-2 rounded-lg font-semibold ${activeTab === 'activity' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'}`}>Activity Log</button>
            </div>
            <button
              onClick={() => setActiveTab('analytics')}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-indigo-700"
            >
              📊 View Global Platform Analytics
            </button>
          </div>

          {activeTab === 'analytics' ? (
            <AnalyticsPage vendors={offlineVendors} />
          ) : activeTab === 'backups' ? (
            <div className="bg-white shadow rounded-[10px] overflow-hidden mb-10">
              <div className="p-4 bg-gray-50 border-b border-[#DDDCF9] flex flex-wrap justify-between items-center gap-3">
                <h2 className="text-[18px] font-bold text-[#1A1C23]">Backup Version History ({backups.length})</h2>
                <button onClick={triggerManualBackup} disabled={manualBackupLoading} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">{manualBackupLoading ? 'Running Backup...' : 'Trigger Manual Backup'}</button>
              </div>
              <table className="w-full text-left">
                <thead className="h-[60px] border-b border-b-[#DDDCF9] bg-white text-[#1A1C23] font-bold"><tr><th className="p-4 pl-6">Backup ID</th><th className="p-4">Created At</th><th className="p-4">Documents</th><th className="p-4">Action</th></tr></thead>
                <tbody>
                  {backups.length > 0 ? backups.map((backup) => (
                    <tr key={backup.id} className="hover:bg-gray-50 border-b border-gray-100">
                      <td className="p-4 pl-6 text-sm font-semibold text-[#1A1C23]">{backup.id}</td>
                      <td className="p-4 text-sm text-gray-600">{backup.createdAt ? new Date(backup.createdAt).toLocaleString() : 'N/A'}</td>
                      <td className="p-4 text-sm font-semibold">{backup.totalDocuments || 0}</td>
                      <td className="p-4"><button onClick={() => restoreBackup(backup.id)} disabled={restoringBackupId === backup.id} className="bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50">{restoringBackupId === backup.id ? 'Restoring...' : 'Restore This Version'}</button></td>
                    </tr>
                  )) : (
                    <tr><td colSpan="4" className="p-6 text-center text-gray-500">{loadingBackups ? 'Loading backups...' : 'No backups found.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : activeTab === 'activity' ? (
            <>
              <div className="bg-white shadow rounded-[10px] overflow-hidden mb-10">
                <div className="p-4 bg-gray-50 border-b border-[#DDDCF9]"><h2 className="text-[18px] font-bold text-[#1A1C23]">Platform Activity Timeline (Newest 50)</h2></div>
                <div className="p-4">
                  {platformActivityTimeline.length > 0 ? (
                    <div className="space-y-3">
                      {platformActivityTimeline.map((entry, index) => (
                        <div key={`${entry.vendorId}-${entry.date}-${index}`} className="border rounded-lg p-3 bg-gray-50">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold text-[#1A1C23]">{entry.action}</p>
                            <span className={`text-xs px-2 py-1 rounded-full font-bold ${entry.channel === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                              {entry.channel.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{entry.vendorName} ({entry.vendorId})</p>
                          <p className="text-xs text-gray-500 mt-1">{formatTimelineDate(entry.date)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500">No activity logs available yet.</p>
                  )}
                </div>
              </div>

              <div className="bg-white shadow rounded-[10px] overflow-hidden mb-10 p-5">
                <h2 className="text-[20px] font-bold text-[#1A1C23] mb-5">📊 Key Platform Insights</h2>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                  <div className="h-[320px] border rounded-xl p-4">
                    <h3 className="font-semibold mb-3">Category Mix</h3>
                    <ResponsiveContainer width="100%" height="90%">
                      <PieChart>
                        <Pie data={insightCharts.categoryMix} dataKey="value" nameKey="name" outerRadius={110} label>
                          {insightCharts.categoryMix.map((entry, index) => (
                            <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="h-[320px] border rounded-xl p-4">
                    <h3 className="font-semibold mb-3">Price Density</h3>
                    <ResponsiveContainer width="100%" height="90%">
                      <BarChart data={insightCharts.priceDensity}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="range" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="count" fill="#2563eb" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="h-[320px] border rounded-xl p-4">
                  <h3 className="font-semibold mb-3">Lead Velocity (Last 7 Days)</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={insightCharts.leadVelocity}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Line type="monotone" dataKey="clicks" stroke="#16a34a" strokeWidth={3} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-white shadow rounded-[10px] overflow-hidden mb-10">
                <div className="p-4 bg-gray-50 border-b border-[#DDDCF9] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    <button onClick={() => setSourceTab('offline')} className={`px-3 py-2 rounded-md text-sm font-semibold ${sourceTab === 'offline' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'}`}>WhatsApp Directory</button>
                    <button onClick={() => setSourceTab('online')} className={`px-3 py-2 rounded-md text-sm font-semibold ${sourceTab === 'online' ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-300 text-gray-700'}`}>Online Inventory</button>
                  </div>

                  {sourceTab === 'offline' && (
                    <div className="flex gap-2">
                      <button onClick={() => bulkUpdateStatus('suspended')} disabled={bulkUpdating || !selectedVendorIds.length} className="bg-red-600 text-white px-3 py-2 rounded-md text-sm font-semibold disabled:opacity-50">Suspend Selected</button>
                      <button onClick={() => bulkUpdateStatus('active')} disabled={bulkUpdating || !selectedVendorIds.length} className="bg-emerald-600 text-white px-3 py-2 rounded-md text-sm font-semibold disabled:opacity-50">Activate Selected</button>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="border rounded-md px-3 py-2 text-sm" placeholder="Search..." />
                    <button onClick={handleExport} className="bg-[#1A1C23] text-white px-3 py-2 rounded-md text-sm">Export CSV</button>
                  </div>
                </div>

                <div className="p-4 border-b border-[#DDDCF9]">
                  <h2 className="text-[18px] font-bold text-[#1A1C23]">{sourceTab === 'offline' ? `WhatsApp Directory (${filteredOffline.length} Vendors)` : `Scraped Products (${filteredOnline.length} Items)`}</h2>
                </div>

                <table className="w-full table rounded-[10px] text-left">
                  {sourceTab === 'offline' ? (
                    <>
                      <thead className="h-[60px] border-b border-b-[#DDDCF9] bg-white text-[#1A1C23] font-bold">
                        <tr>
                          <th className="p-4 pl-6 w-[50px]"><input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} aria-label="Select all vendors" /></th>
                          <th className="p-4 pl-6">Vendor Name</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Views</th>
                          <th className="p-4">WA Clicks</th>
                          <th className="p-4">Access Detail</th>
                          <th className="p-4">Advanced Tools</th>
                          <th className="p-4">Total Inventory</th>
                          <th className="p-4">Last Updated</th>
                          <th className="p-4">Action</th>
                          <th className="p-4">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOffline.length > 0 ? filteredOffline.map((vendor) => (
                          <tr key={vendor.docId} className="hover:bg-gray-50 border-b border-gray-100">
                            <td className="p-4 pl-6"><input type="checkbox" checked={selectedVendorIds.includes(vendor.docId)} onChange={() => toggleVendor(vendor.docId)} aria-label={`Select ${vendor.vendorName}`} /></td>
                            <td className="p-4 pl-6 font-bold text-blue-600">{vendor.vendorName}</td>
                            <td className="p-4"><span className={`px-3 py-1 rounded-full text-xs font-bold ${vendor.status === 'suspended' ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>{vendor.status === 'suspended' ? 'Suspended' : 'Active'}</span></td>
                            <td className="p-4 font-semibold text-[#1A1C23]">{vendor.viewCount || 0}</td>
                            <td className="p-4 font-semibold text-[#1A1C23]">{vendor.whatsappClicks || 0}</td>
                            <td className="p-4 text-xs text-gray-700">
                              <p><span className="font-semibold">Password:</span> {vendor.vendorPassword || 'Not set'}</p>
                              <p><span className="font-semibold">Primary WA:</span> {vendor.storeWhatsappNumber || 'Not set'}</p>
                            </td>
                            <td className="p-4">
                              <button
                                onClick={() => toggleAdvancedTools(vendor)}
                                disabled={togglingAdvancedVendorId === vendor.docId}
                                className={`px-3 py-1.5 rounded-full text-xs font-bold ${vendor.advancedEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'} disabled:opacity-50`}
                              >
                                {togglingAdvancedVendorId === vendor.docId
                                  ? 'Updating...'
                                  : vendor.advancedEnabled
                                    ? 'Enabled'
                                    : 'Disabled'}
                              </button>
                            </td>
                            <td className="p-4"><span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold">{vendor.totalProducts} Items</span></td>
                            <td className="p-4 text-gray-500">{vendor.lastUpdated ? new Date(vendor.lastUpdated).toLocaleDateString() : 'N/A'}</td>
                            <td className="p-4"><Link to={vendor.shareableLink} className="bg-[#1A1C23] text-white px-4 py-2 rounded-[8px] text-sm hover:bg-gray-800 transition">View Inventory</Link></td>
                            <td className="p-4">
                              <button onClick={() => openChatForVendor(vendor)} className="p-2 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200" title="Message Vendor">
                                <IoMdChatboxes className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan="11" className="p-6 text-center text-gray-500">{loadingSearch ? 'Loading vendors...' : 'No vendors found.'}</td></tr>
                        )}
                      </tbody>
                    </>
                  ) : (
                    <>
                      <thead className="h-[60px] border-b border-b-[#DDDCF9] bg-white text-[#1A1C23] font-bold"><tr><th className="p-4 pl-6">Store</th><th className="p-4">Device Type</th><th className="p-4">Condition</th><th className="p-4">Price</th><th className="p-4">Link</th></tr></thead>
                      <tbody>
                        {filteredOnline.length > 0 ? filteredOnline.map((product, index) => (
                          <tr key={index} className="hover:bg-gray-50 border-b border-gray-100">
                            <td className="p-4 pl-6 font-bold">{product.vendorName}</td>
                            <td className="p-4 text-sm">{product['Device Type']}</td>
                            <td className="p-4 text-sm text-gray-600">{product.Condition}</td>
                            <td className="p-4 font-semibold text-green-700">{product['Regular price']}</td>
                            <td className="p-4">{product.Link ? <a href={product.Link} target="_blank" rel="noreferrer" className="text-blue-500 underline text-sm">View Item</a> : 'N/A'}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan="5" className="p-6 text-center text-gray-500">{loadingSearch ? 'Loading products...' : 'No products found.'}</td></tr>
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

      {notificationOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl border border-gray-200">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="text-lg font-bold">Vendor Notification Hub</h3>
              <button onClick={() => setNotificationOpen(false)} className="text-gray-500 hover:text-black">✕</button>
            </div>
            <div className="p-4 max-h-[65vh] overflow-y-auto space-y-3">
              {unreadMessages.length > 0 ? unreadMessages.map((message) => (
                <div key={message.id} className="border rounded-lg p-3 bg-red-50">
                  <p className="text-sm font-semibold text-[#1A1C23]">{message.vendorId}</p>
                  <p className="text-sm text-gray-700 mt-1">{message.text}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatTimelineDate(message.timestamp)}</p>
                </div>
              )) : <p className="text-sm text-gray-500">No new vendor messages.</p>}
            </div>
          </div>
        </div>
      )}

      {chatOpen && chatVendor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl border border-gray-200">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="text-lg font-bold">Chat with {chatVendor.vendorName}</h3>
              <button onClick={() => setChatOpen(false)} className="text-gray-500 hover:text-black">✕</button>
            </div>
            <div className="p-4 max-h-[55vh] overflow-y-auto space-y-3 bg-gray-50">
              {chatMessages.map((message) => {
                const mine = message.sender === 'admin';
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-xl px-4 py-2 ${mine ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-200 text-[#1A1C23]'}`}>
                      <p className="text-xs opacity-80 mb-1 font-semibold">{message.sender === 'admin' ? 'Admin' : chatVendor.vendorName}</p>
                      <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                      <p className="text-[11px] opacity-70 mt-1">{formatTimelineDate(message.timestamp)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-4 border-t flex gap-2">
              <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} className="flex-1 border rounded-lg p-3 min-h-[64px]" placeholder="Type your reply..." />
              <button onClick={sendAdminChat} disabled={sendingChat || !chatInput.trim()} className="bg-indigo-600 text-white px-4 py-2 rounded-lg h-fit disabled:opacity-50">{sendingChat ? 'Sending...' : 'Send'}</button>
            </div>
          </div>
        </div>
      )}
    </AdminDashboardLayout>
  );
};

export default AdminDashboard;
