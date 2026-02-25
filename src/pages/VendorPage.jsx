import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase/index.js';
import { useSelector } from 'react-redux';

const MAX_LOG_ITEMS = 200;
const THEME_PRESETS = ['#16a34a', '#1d4ed8', '#7c3aed', '#ea580c'];

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

const normalizeLogs = (logs) => ({
  admin: Array.isArray(logs?.admin) ? logs.admin : [],
  vendor: Array.isArray(logs?.vendor) ? logs.vendor : [],
  customer: Array.isArray(logs?.customer) ? logs.customer : [],
});

const appendRollingLog = (logs, channel, entry) => {
  const normalized = normalizeLogs(logs);
  return {
    ...normalized,
    [channel]: [...normalized[channel], entry].slice(-MAX_LOG_ITEMS),
  };
};

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

const buildSpecificationParts = (product) => ({
  specification: product['SIM Type/Model/Processor'] || '',
  storage: product['Storage Capacity/Configuration'] || '',
});

const parseEditFromValues = (specification, storage) => ({
  'SIM Type/Model/Processor': specification,
  'Storage Capacity/Configuration': storage,
});

const VendorLogin = ({ vendorName, onSubmit, passwordValue, setPasswordValue, error }) => {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-md p-6">
        <h2 className="text-2xl font-bold text-[#1A1C23] mb-2">Vendor Access Required</h2>
        <p className="text-sm text-gray-600 mb-5">
          Enter the vendor password to access {vendorName || 'this store'} dashboard.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Vendor Access Password</label>
            <input
              type="password"
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              className="w-full p-3 border rounded-[8px]"
              placeholder="Enter password"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            className="w-full bg-[#1A1C23] text-white py-2.5 rounded-[10px] hover:bg-gray-800"
          >
            Unlock Dashboard
          </button>
        </form>
      </div>
    </div>
  );
};

const VendorPage = () => {
  const { vendorId } = useParams();
  const isAdmin = useSelector((state) => state.auth?.isAuthenticated);
  const logChannel = isAdmin ? 'admin' : 'vendor';

  const [vendorData, setVendorData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticatedVendor, setIsAuthenticatedVendor] = useState(false);
  const [vendorPasswordEntry, setVendorPasswordEntry] = useState('');
  const [vendorLoginError, setVendorLoginError] = useState('');

  const [mainTab, setMainTab] = useState('settings');
  const [dateFilter, setDateFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [groupFilter, setGroupFilter] = useState('All');
  const [selectedProductIndexes, setSelectedProductIndexes] = useState([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const [savingSettings, setSavingSettings] = useState(false);
  const [runningAutoFix, setRunningAutoFix] = useState(false);
  const [vendorNameInput, setVendorNameInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [storeDescriptionInput, setStoreDescriptionInput] = useState('');
  const [themeColorInput, setThemeColorInput] = useState('#16a34a');
  const [logoBase64, setLogoBase64] = useState('');
  const [whatsappNumbersInput, setWhatsappNumbersInput] = useState(['', '', '']);
  const [storeWhatsappNumberInput, setStoreWhatsappNumberInput] = useState('');
  const [vendorPasswordInput, setVendorPasswordInput] = useState('');
  const [allowedGroups, setAllowedGroups] = useState([]);

  const [timelineTab, setTimelineTab] = useState('vendor');
  const [supportMessages, setSupportMessages] = useState([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportInput, setSupportInput] = useState('');
  const [sendingSupportMessage, setSendingSupportMessage] = useState(false);

  const [editingIndex, setEditingIndex] = useState(null);
  const [editDeviceType, setEditDeviceType] = useState('');
  const [editSpecification, setEditSpecification] = useState('');
  const [editStorage, setEditStorage] = useState('');
  const [editCondition, setEditCondition] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const vendorRef = useMemo(() => doc(db, 'horleyTech_OfflineInventories', vendorId), [vendorId]);

  useEffect(() => {
    const fetchVendorData = async () => {
      try {
        const docSnap = await getDoc(vendorRef);
        if (docSnap.exists()) {
          const payload = docSnap.data();
          const existingNumbers = Array.isArray(payload.whatsappNumbers) ? payload.whatsappNumbers : [];
          const existingAllowedGroups = Array.isArray(payload.storefrontAllowedGroups)
            ? payload.storefrontAllowedGroups
            : [];

          setVendorData({
            ...payload,
            logs: normalizeLogs(payload.logs),
          });
          setVendorNameInput(payload.vendorName || '');
          setAddressInput(payload.address || '');
          setStoreDescriptionInput(payload.storeDescription || '');
          setThemeColorInput(payload.themeColor || '#16a34a');
          setLogoBase64(payload.logoBase64 || '');
          setAllowedGroups(existingAllowedGroups);
          setStoreWhatsappNumberInput(payload.storeWhatsappNumber || '');
          setVendorPasswordInput(payload.vendorPassword || '');
          setWhatsappNumbersInput([
            existingNumbers[0] || '',
            existingNumbers[1] || '',
            existingNumbers[2] || '',
          ]);
        } else {
          setVendorData(null);
        }
      } catch (err) {
        console.error('Error fetching vendor:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchVendorData();
  }, [vendorRef]);

  const products = vendorData?.products || [];

  const uniqueGroups = useMemo(
    () => ['All', ...new Set(products.map((p) => p.groupName || 'Direct Message'))],
    [products]
  );

  const sourceGroups = useMemo(
    () => [...new Set(products.map((p) => p.groupName || 'Direct Message'))],
    [products]
  );

  const uniqueCategories = useMemo(
    () => ['All', ...new Set(products.map((p) => p.Category).filter(Boolean))],
    [products]
  );

  useEffect(() => {
    if (!loading && sourceGroups.length > 0 && allowedGroups.length === 0) {
      setAllowedGroups(sourceGroups);
    }
  }, [loading, sourceGroups, allowedGroups.length]);

  const displayData = useMemo(() => {
    if (!products.length) return [];
    const now = new Date();

    return products
      .map((product, index) => ({ product, index }))
      .filter(({ product }) => {
        let passesDate = true;
        if (dateFilter !== 'All' && product.DatePosted) {
          const postDate = new Date(product.DatePosted);
          const diffDays = Math.ceil(Math.abs(now - postDate) / (1000 * 60 * 60 * 24));
          if (dateFilter === 'This Week') passesDate = diffDays <= 7;
          if (dateFilter === 'This Month') passesDate = diffDays <= 30;
        }

        const passesCategory = categoryFilter === 'All' || product.Category === categoryFilter;
        const passesGroup = groupFilter === 'All' || (product.groupName || 'Direct Message') === groupFilter;

        return passesDate && passesCategory && passesGroup;
      });
  }, [products, dateFilter, categoryFilter, groupFilter]);

  const allVisibleRowsSelected =
    displayData.length > 0 && displayData.every(({ index }) => selectedProductIndexes.includes(index));

  const requiresVendorAuth = Boolean(vendorData?.vendorPassword) && !isAdmin && !isAuthenticatedVendor;

  const handleVendorPasswordSubmit = () => {
    if (!vendorData?.vendorPassword) {
      setIsAuthenticatedVendor(true);
      return;
    }

    if (vendorPasswordEntry === vendorData.vendorPassword) {
      setIsAuthenticatedVendor(true);
      setVendorLoginError('');
    } else {
      setVendorLoginError('Incorrect password. Please try again.');
    }
  };

  const handleExport = () => {
    const rows = displayData.map(({ product }) => ({
      Group: product.groupName || 'Direct Message',
      Device: product['Device Type'] || '',
      Condition: product.Condition || '',
      Specification: product['SIM Type/Model/Processor'] || '',
      Storage: product['Storage Capacity/Configuration'] || '',
      Price: product['Regular price'] || '',
      Status: product.isVisible === false ? 'Hidden' : 'Visible',
      Extracted: product.DatePosted || '',
    }));
    downloadCsv(`${vendorData?.vendorName || 'Vendor'}-inventory.csv`, rows);
  };

  const handleCopyLink = async (link) => {
    await navigator.clipboard.writeText(link);
    alert(`✅ Link copied to clipboard!\n\n${link}`);
  };

  const toggleSelectAll = () => {
    if (allVisibleRowsSelected) {
      const visibleSet = new Set(displayData.map(({ index }) => index));
      setSelectedProductIndexes((prev) => prev.filter((idx) => !visibleSet.has(idx)));
    } else {
      const merged = new Set([...selectedProductIndexes, ...displayData.map(({ index }) => index)]);
      setSelectedProductIndexes(Array.from(merged));
    }
  };

  const toggleProductSelection = (index) => {
    setSelectedProductIndexes((prev) =>
      prev.includes(index) ? prev.filter((idx) => idx !== index) : [...prev, index]
    );
  };

  const toggleAllowedGroup = (group) => {
    setAllowedGroups((prev) =>
      prev.includes(group) ? prev.filter((entry) => entry !== group) : [...prev, group]
    );
  };

  const compressImageToBase64 = (file, size = 150) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size, size);

          const scale = Math.min(size / img.width, size / img.height);
          const drawWidth = img.width * scale;
          const drawHeight = img.height * scale;
          const x = (size - drawWidth) / 2;
          const y = (size - drawHeight) / 2;
          ctx.drawImage(img, x, y, drawWidth, drawHeight);

          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = reject;
        img.src = event.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleLogoChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const base64 = await compressImageToBase64(file, 150);
      setLogoBase64(base64);
    } catch (error) {
      console.error('Logo compression failed:', error);
      alert('❌ Could not process image. Try another file.');
    }
  };

  const pushLogToCurrentVendorData = (previousVendorData, action) => {
    const entry = { action, date: new Date().toISOString() };
    return appendRollingLog(previousVendorData?.logs, logChannel, entry);
  };

  const updateSelectedVisibility = async (isVisible) => {
    if (!selectedProductIndexes.length) {
      alert('Please select one or more products first.');
      return;
    }

    const nextProducts = products.map((product, index) =>
      selectedProductIndexes.includes(index) ? { ...product, isVisible } : product
    );

    const nextLogs = pushLogToCurrentVendorData(
      vendorData,
      `${isVisible ? 'Show Selected' : 'Hide Selected'} (${selectedProductIndexes.length} products)`
    );

    setBulkUpdating(true);
    try {
      await updateDoc(vendorRef, {
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
        logs: nextLogs,
      });

      setVendorData((prev) => ({
        ...prev,
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
        logs: nextLogs,
      }));
      setSelectedProductIndexes([]);
      alert(`✅ Selected products are now ${isVisible ? 'visible' : 'hidden'}.`);
    } catch (error) {
      console.error('Error updating product visibility:', error);
      alert('❌ Could not update product visibility.');
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleProductImageUpload = async (index, file) => {
    if (!file) return;

    try {
      const thumbBase64 = await compressImageToBase64(file, 180);
      const nextProducts = products.map((product, pIndex) =>
        pIndex === index ? { ...product, productImageBase64: thumbBase64 } : product
      );

      const nextLogs = pushLogToCurrentVendorData(vendorData, 'Updated Product Image');

      await updateDoc(vendorRef, {
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
        logs: nextLogs,
      });

      setVendorData((prev) => ({
        ...prev,
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
        logs: nextLogs,
      }));

      alert('✅ Product image updated.');
    } catch (error) {
      console.error('Product image update failed:', error);
      alert('❌ Could not update product image.');
    }
  };

  const runAiAutoFix = async () => {
    if (!products.length) {
      alert('No products available for AI cleanup.');
      return;
    }

    setRunningAutoFix(true);
    try {
      const response = await fetch('/api/ai/fix-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products }),
      });

      const data = await response.json();
      if (!response.ok || !Array.isArray(data.products)) {
        throw new Error(data.error || 'AI fix failed');
      }

      const nextLogs = pushLogToCurrentVendorData(vendorData, 'Used AI Auto-Fix');

      await updateDoc(vendorRef, {
        products: data.products,
        lastUpdated: new Date().toISOString(),
        logs: nextLogs,
      });

      setVendorData((prev) => ({
        ...prev,
        products: data.products,
        lastUpdated: new Date().toISOString(),
        logs: nextLogs,
      }));

      alert('✅ AI Auto-Fix completed successfully.');
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setRunningAutoFix(false);
    }
  };

  const buildDeepComparisonActions = (previousVendorData, nextState) => {
    const actions = [];

    if ((previousVendorData.vendorName || '') !== nextState.vendorName) {
      actions.push(`Changed Store Name to '${nextState.vendorName}'`);
    }
    if ((previousVendorData.address || '') !== nextState.address) {
      actions.push(`Updated Store Address to '${nextState.address || 'N/A'}'`);
    }
    if ((previousVendorData.storeDescription || '') !== nextState.storeDescription) {
      actions.push('Updated Store Description');
    }
    if ((previousVendorData.themeColor || '#16a34a') !== nextState.themeColor) {
      actions.push(`Updated Store Theme Color to '${nextState.themeColor}'`);
    }
    if ((previousVendorData.logoBase64 || '') !== nextState.logoBase64) {
      actions.push('Updated Store Logo');
    }

    const prevNumbers = JSON.stringify(previousVendorData.whatsappNumbers || []);
    const nextNumbers = JSON.stringify(nextState.whatsappNumbers);
    if (prevNumbers !== nextNumbers) {
      actions.push(`Updated Staff WhatsApp Numbers to '${nextState.whatsappNumbers.join(', ') || 'None'}'`);
    }

    if ((previousVendorData.storeWhatsappNumber || '') !== nextState.storeWhatsappNumber) {
      actions.push('Updated Primary Store Number');
    }

    if ((previousVendorData.vendorPassword || '') !== nextState.vendorPassword) {
      actions.push('Updated Store Access Password');
      actions.push('Updated Store Password');
    }

    const prevGroups = JSON.stringify(previousVendorData.storefrontAllowedGroups || []);
    const nextGroups = JSON.stringify(nextState.storefrontAllowedGroups);
    if (prevGroups !== nextGroups) {
      actions.push(`Updated Storefront Allowed Groups to '${nextState.storefrontAllowedGroups.join(', ') || 'None'}'`);
    }

    if (!actions.length) {
      actions.push('Saved Settings (No Field Changes Detected)');
    }

    return actions;
  };

  const handleSaveSettings = async () => {
    const cleanedNumbers = whatsappNumbersInput
      .map((number) => number.trim())
      .filter(Boolean)
      .slice(0, 3);

    const cleanedAllowedGroups = allowedGroups.filter(Boolean);

    const nextState = {
      vendorName: vendorNameInput.trim() || vendorData?.vendorName || vendorId,
      address: addressInput.trim(),
      storeDescription: storeDescriptionInput.slice(0, 1000),
      themeColor: themeColorInput || '#16a34a',
      logoBase64: logoBase64 || '',
      whatsappNumbers: cleanedNumbers,
      storeWhatsappNumber: storeWhatsappNumberInput.trim(),
      vendorPassword: vendorPasswordInput,
      storefrontAllowedGroups: cleanedAllowedGroups,
    };

    const actions = buildDeepComparisonActions(vendorData || {}, nextState);
    let nextLogs = normalizeLogs(vendorData?.logs);
    actions.forEach((action) => {
      nextLogs = appendRollingLog(nextLogs, logChannel, { action, date: new Date().toISOString() });
    });

    setSavingSettings(true);
    try {
      await updateDoc(vendorRef, {
        ...nextState,
        lastUpdated: new Date().toISOString(),
        logs: nextLogs,
      });

      setVendorData((prev) => ({
        ...prev,
        ...nextState,
        lastUpdated: new Date().toISOString(),
        logs: nextLogs,
      }));

      setWhatsappNumbersInput([
        cleanedNumbers[0] || '',
        cleanedNumbers[1] || '',
        cleanedNumbers[2] || '',
      ]);

      alert('✅ Store settings saved successfully.');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('❌ Could not save store settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const openEditModal = (index, product) => {
    const { specification, storage } = buildSpecificationParts(product);
    setEditingIndex(index);
    setEditDeviceType(product['Device Type'] || '');
    setEditSpecification(specification);
    setEditStorage(storage);
    setEditCondition(product.Condition || '');
    setEditPrice(product['Regular price'] || '');
  };

  const closeEditModal = () => {
    setEditingIndex(null);
    setEditDeviceType('');
    setEditSpecification('');
    setEditStorage('');
    setEditCondition('');
    setEditPrice('');
  };

  const saveInlineEdit = async () => {
    if (editingIndex === null || editingIndex === undefined) return;

    const oldProduct = products[editingIndex] || {};

    const nextProducts = products.map((product, index) => {
      if (index !== editingIndex) return product;
      const parsed = parseEditFromValues(editSpecification.trim(), editStorage.trim());
      return {
        ...product,
        'Device Type': editDeviceType.trim(),
        Condition: editCondition.trim(),
        'Regular price': editPrice.trim(),
        ...parsed,
      };
    });

    const nextLogs = appendRollingLog(vendorData?.logs, logChannel, {
      action: `Edited product details for ${oldProduct['Device Type'] || 'Unknown Device'}`,
      date: new Date().toISOString(),
    });

    setSavingEdit(true);
    try {
      await updateDoc(vendorRef, {
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
        logs: nextLogs,
      });

      setVendorData((prev) => ({
        ...prev,
        products: nextProducts,
        lastUpdated: new Date().toISOString(),
        logs: nextLogs,
      }));

      closeEditModal();
      alert('✅ Product updated successfully.');
    } catch (error) {
      console.error('Failed to save inline edit:', error);
      alert('❌ Could not save product changes.');
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) return <div className="p-10 text-center">Loading vendor data...</div>;
  if (!vendorData) return <div className="p-10 text-center font-bold text-red-500">Vendor has no inventory.</div>;

  if (requiresVendorAuth) {
    return (
      <VendorLogin
        vendorName={vendorData.vendorName}
        onSubmit={handleVendorPasswordSubmit}
        passwordValue={vendorPasswordEntry}
        setPasswordValue={setVendorPasswordEntry}
        error={vendorLoginError}
      />
    );
  }

  const vendorBackendLink = `${window.location.origin}/vendor/${vendorId}`;
  const customerStoreLink = `${window.location.origin}/store/${vendorId}`;
  const timelineLogs = normalizeLogs(vendorData.logs);
  const timelineEntries = {
    vendor: [...timelineLogs.vendor].sort((a, b) => new Date(b.date) - new Date(a.date)),
    customer: [...timelineLogs.customer].sort((a, b) => new Date(b.date) - new Date(a.date)),
    admin: [...timelineLogs.admin].sort((a, b) => new Date(b.date) - new Date(a.date)),
  };

  const fetchSupportMessages = async () => {
    setSupportLoading(true);
    try {
      const response = await fetch(`/api/messages/${vendorId}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Unable to fetch messages');
      }
      setSupportMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (error) {
      console.error('Failed to fetch support messages:', error);
    } finally {
      setSupportLoading(false);
    }
  };

  useEffect(() => {
    if (!vendorData || mainTab !== 'support') return;
    fetchSupportMessages();
    const timer = setInterval(fetchSupportMessages, 12000);
    return () => clearInterval(timer);
  }, [vendorData, mainTab]);

  const sendSupportMessage = async () => {
    if (!supportInput.trim()) return;

    setSendingSupportMessage(true);
    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId,
          sender: isAdmin ? 'admin' : 'vendor',
          recipient: isAdmin ? 'vendor' : 'admin',
          text: supportInput.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to send message');
      }

      setSupportInput('');
      setSupportMessages((prev) => [...prev, data.message]);
    } catch (error) {
      alert(`❌ ${error.message}`);
    } finally {
      setSendingSupportMessage(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {isAdmin && (
        <Link to="/dashboard" className="text-blue-500 hover:underline mb-4 inline-block">
          &larr; Back to Directory
        </Link>
      )}

      <div className="bg-white border border-gray-200 rounded-[12px] p-5 mb-6 shadow-sm">
        <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Share Links</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-[10px] p-4 bg-gray-50">
            <p className="text-xs text-gray-500 mb-2">Vendor Backend Link</p>
            <p className="text-sm break-all text-[#1A1C23] mb-3">{vendorBackendLink}</p>
            <button onClick={() => handleCopyLink(vendorBackendLink)} className="bg-blue-600 text-white px-4 py-2 rounded-[8px] text-sm hover:bg-blue-700">Copy Backend Link</button>
          </div>
          <div className="border rounded-[10px] p-4 bg-gray-50">
            <p className="text-xs text-gray-500 mb-2">Customer Store Link</p>
            <p className="text-sm break-all text-[#1A1C23] mb-3">{customerStoreLink}</p>
            <button onClick={() => handleCopyLink(customerStoreLink)} className="bg-green-600 text-white px-4 py-2 rounded-[8px] text-sm hover:bg-green-700">Copy Store Link</button>
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <button onClick={() => setMainTab('settings')} className={`px-4 py-2 rounded-lg font-semibold ${mainTab === 'settings' ? 'bg-[#1A1C23] text-white' : 'bg-gray-100 text-gray-700'}`}>Store Settings</button>
        <button onClick={() => setMainTab('inventory')} className={`px-4 py-2 rounded-lg font-semibold ${mainTab === 'inventory' ? 'bg-[#1A1C23] text-white' : 'bg-gray-100 text-gray-700'}`}>Inventory</button>
        <button onClick={() => setMainTab('advanced')} className={`px-4 py-2 rounded-lg font-semibold ${mainTab === 'advanced' ? 'bg-[#1A1C23] text-white' : 'bg-gray-100 text-gray-700'}`}>Advanced Tools</button>
        <button onClick={() => setMainTab('support')} className={`px-4 py-2 rounded-lg font-semibold ${mainTab === 'support' ? 'bg-[#1A1C23] text-white' : 'bg-gray-100 text-gray-700'}`}>Support Chat</button>
        <button onClick={() => setMainTab('timeline')} className={`px-4 py-2 rounded-lg font-semibold ${mainTab === 'timeline' ? 'bg-[#1A1C23] text-white' : 'bg-gray-100 text-gray-700'}`}>Store Timeline</button>
      </div>

      {mainTab === 'settings' && (
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 mb-6 shadow-sm">
          <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Store Settings</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Vendor Name</label>
              <input type="text" value={vendorNameInput} onChange={(e) => setVendorNameInput(e.target.value)} className="w-full p-3 border rounded-[8px]" placeholder="Enter store name" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Store Address</label>
              <input type="text" value={addressInput} onChange={(e) => setAddressInput(e.target.value)} className="w-full p-3 border rounded-[8px]" placeholder="Enter physical address" />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-bold text-gray-700 mb-2">Store Description (max 1000 chars)</label>
            <textarea
              value={storeDescriptionInput}
              onChange={(e) => setStoreDescriptionInput(e.target.value.slice(0, 1000))}
              className="w-full p-3 border rounded-[8px] min-h-[120px]"
              placeholder="Describe your store..."
            />
            <p className="text-xs text-gray-500 mt-1">{storeDescriptionInput.length}/1000</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Store Theme Color</label>
              <div className="flex items-center gap-3 mb-2">
                <input type="color" value={themeColorInput} onChange={(e) => setThemeColorInput(e.target.value)} className="w-14 h-10 border rounded" />
                <span className="text-sm font-semibold text-gray-600">{themeColorInput}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {THEME_PRESETS.map((preset) => (
                  <button key={preset} onClick={() => setThemeColorInput(preset)} className="w-8 h-8 rounded-full border-2 border-white shadow" style={{ backgroundColor: preset }} aria-label={`Theme ${preset}`} />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Store Logo (Base64, compressed 150x150)</label>
              <input type="file" accept="image/*" onChange={handleLogoChange} className="w-full p-2.5 border rounded-[8px]" />
              {logoBase64 && <img src={logoBase64} alt="Store logo preview" className="w-16 h-16 rounded-full mt-3 border object-cover" />}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Primary Store WhatsApp Number</label>
              <input type="text" value={storeWhatsappNumberInput} onChange={(e) => setStoreWhatsappNumberInput(e.target.value)} className="w-full p-3 border rounded-[8px]" placeholder="e.g. 2348012345678" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Store Access Password</label>
              <input type="password" value={vendorPasswordInput} onChange={(e) => setVendorPasswordInput(e.target.value)} className="w-full p-3 border rounded-[8px]" placeholder="Set vendor dashboard password" />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-bold text-gray-700 mb-2">Staff WhatsApp Numbers (max 3)</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {whatsappNumbersInput.map((value, index) => (
                <input key={`whatsapp-${index}`} type="text" value={value} onChange={(e) => {
                  const next = [...whatsappNumbersInput];
                  next[index] = e.target.value;
                  setWhatsappNumbersInput(next);
                }} className="w-full p-3 border rounded-[8px]" placeholder={`Staff WhatsApp ${index + 1}`} />
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-bold text-gray-700 mb-2">Storefront Allowed Source Groups</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {sourceGroups.map((group) => (
                <label key={group} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={allowedGroups.includes(group)} onChange={() => toggleAllowedGroup(group)} />
                  {group}
                </label>
              ))}
            </div>
          </div>

          <button onClick={handleSaveSettings} disabled={savingSettings} className="bg-[#1A1C23] text-white px-5 py-2.5 rounded-[10px] hover:bg-gray-800 disabled:opacity-50">{savingSettings ? 'Saving...' : 'Save Settings'}</button>
        </div>
      )}

      {mainTab === 'inventory' && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
            <div>
              <h1 className="text-3xl font-bold text-[#1A1C23]">{vendorData.vendorName}&apos;s Inventory</h1>
              <p className="text-gray-500 mt-1">Showing {displayData.length} of {products.length} Items</p>
            </div>
            <button onClick={handleExport} className="bg-green-600 text-white px-5 py-2.5 rounded-[10px] shadow-sm hover:bg-green-700 font-medium transition-colors">Export CSV</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 bg-gray-50 p-5 rounded-[10px] border border-gray-200">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">WhatsApp Group</label>
              <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="w-full p-2.5 border rounded-[8px]">
                {uniqueGroups.map((group) => <option key={group} value={group}>{group}</option>)}
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

          <div className="mb-4 flex flex-wrap gap-3 items-center">
            <button onClick={() => updateSelectedVisibility(false)} disabled={!selectedProductIndexes.length || bulkUpdating} className="bg-red-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50">Hide Selected</button>
            <button onClick={() => updateSelectedVisibility(true)} disabled={!selectedProductIndexes.length || bulkUpdating} className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-50">Show Selected</button>
            <span className="text-sm text-gray-600">{selectedProductIndexes.length} selected</span>
          </div>

          <div className="overflow-x-auto bg-white shadow rounded-[10px] border border-gray-100">
            <table className="min-w-full text-left">
              <thead className="bg-[#1A1C23] text-white">
                <tr>
                  <th className="p-4 text-sm font-semibold w-[45px]"><input type="checkbox" checked={allVisibleRowsSelected} onChange={toggleSelectAll} aria-label="Select all products" /></th>
                  <th className="p-4 text-sm font-semibold">Group</th>
                  <th className="p-4 text-sm font-semibold">Device</th>
                  <th className="p-4 text-sm font-semibold">Condition</th>
                  <th className="p-4 text-sm font-semibold">Specification</th>
                  <th className="p-4 text-sm font-semibold">Storage</th>
                  <th className="p-4 text-sm font-semibold">Price</th>
                  <th className="p-4 text-sm font-semibold">Status</th>
                  <th className="p-4 text-sm font-semibold">Extracted</th>
                  <th className="p-4 text-sm font-semibold">Image</th>
                  <th className="p-4 text-sm font-semibold">Edit</th>
                </tr>
              </thead>
              <tbody>
                {displayData.map(({ product, index }) => (
                  <tr key={`${product['Device Type']}-${index}`} className={`border-b hover:bg-gray-50 ${product.isVisible === false ? 'bg-gray-100 text-gray-400 line-through' : ''}`}>
                    <td className="p-4"><input type="checkbox" checked={selectedProductIndexes.includes(index)} onChange={() => toggleProductSelection(index)} aria-label={`Select product ${product['Device Type'] || index}`} /></td>
                    <td className="p-4 text-xs"><span className="bg-gray-100 px-2 py-1 rounded">{product.groupName || 'Direct Message'}</span></td>
                    <td className="p-4 font-medium">{product['Device Type'] || 'N/A'}</td>
                    <td className="p-4 text-gray-600">{product.Condition || 'N/A'}</td>
                    <td className="p-4 text-gray-600">{product['SIM Type/Model/Processor'] || 'N/A'}</td>
                    <td className="p-4 text-gray-600">{product['Storage Capacity/Configuration'] || 'N/A'}</td>
                    <td className="p-4 font-bold text-green-600">{product['Regular price'] || 'N/A'}</td>
                    <td className="p-4"><span className={`px-2 py-1 rounded text-xs font-bold ${product.isVisible === false ? 'bg-gray-300 text-gray-700' : 'bg-emerald-100 text-emerald-800'}`}>{product.isVisible === false ? 'Hidden' : 'Visible'}</span></td>
                    <td className="p-4 text-sm text-gray-500">{product.DatePosted || 'N/A'}</td>
                    <td className="p-4">
                      {product.productImageBase64 ? <img src={product.productImageBase64} alt="Product" className="w-10 h-10 object-cover rounded mb-2 border" /> : null}
                      <input id={`product-image-${index}`} type="file" accept="image/*" className="hidden" onChange={(e) => handleProductImageUpload(index, e.target.files?.[0])} />
                      <label htmlFor={`product-image-${index}`} className="cursor-pointer bg-purple-600 text-white px-3 py-1.5 rounded-md text-xs hover:bg-purple-700">🖼️ Upload</label>
                    </td>
                    <td className="p-4"><button onClick={() => openEditModal(index, product)} className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-xs hover:bg-blue-700">✏️ Edit</button></td>
                  </tr>
                ))}
                {displayData.length === 0 && (
                  <tr><td colSpan="11" className="p-6 text-center text-gray-500">No products found for the selected filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {mainTab === 'advanced' && (
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 mb-6 shadow-sm relative overflow-hidden">
          <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Advanced Tools</h2>
          <div className={`${vendorData.advancedEnabled ? '' : 'blur-sm pointer-events-none select-none'}`}>
            <p className="text-sm text-gray-600 mb-4">Run AI cleanup to standardize all device specs and naming.</p>
            <button
              onClick={runAiAutoFix}
              disabled={runningAutoFix}
              className="bg-indigo-600 text-white px-5 py-2.5 rounded-[10px] font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              {runningAutoFix ? 'AI Fixing...' : '✨ AI Auto-Fix All Specifications'}
            </button>
          </div>

          {!vendorData.advancedEnabled && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-white/90 border border-amber-200 rounded-xl px-6 py-4 text-center shadow-md">
                <p className="text-amber-700 font-bold">Feature Locked: Contact Admin to Activate</p>
              </div>
            </div>
          )}
        </div>
      )}

      {mainTab === 'support' && (
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-[#1A1C23]">Admin-Vendor Messaging Hub</h2>
            <button onClick={fetchSupportMessages} className="text-sm bg-gray-100 px-3 py-1.5 rounded-lg hover:bg-gray-200">Refresh</button>
          </div>

          <div className="border rounded-xl h-[420px] overflow-y-auto p-4 bg-gray-50 space-y-3 mb-4">
            {supportLoading ? (
              <p className="text-sm text-gray-500">Loading conversation...</p>
            ) : supportMessages.length > 0 ? (
              supportMessages.map((message) => {
                const mine = isAdmin ? message.sender === 'admin' : message.sender === 'vendor';
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-xl px-4 py-2 ${mine ? 'bg-[#1A1C23] text-white' : 'bg-white border border-gray-200 text-[#1A1C23]'}`}>
                      <p className="text-xs opacity-80 mb-1 font-semibold">{message.sender === 'admin' ? 'Admin' : 'Vendor'}</p>
                      <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                      <p className="text-[11px] opacity-70 mt-1">{formatTimelineDate(message.timestamp)}</p>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-gray-500">No messages yet. Start a conversation with the admin team.</p>
            )}
          </div>

          <div className="flex gap-2">
            <textarea
              value={supportInput}
              onChange={(e) => setSupportInput(e.target.value)}
              className="flex-1 border rounded-lg p-3 min-h-[70px]"
              placeholder="Type your message to admin support..."
            />
            <button
              onClick={sendSupportMessage}
              disabled={sendingSupportMessage || !supportInput.trim()}
              className="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-50 h-fit"
            >
              {sendingSupportMessage ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {mainTab === 'timeline' && (
        <div className="bg-white border border-gray-200 rounded-[12px] p-5 mt-2 shadow-sm">
          <h2 className="text-xl font-bold text-[#1A1C23] mb-4">Store Timeline</h2>
          <div className="mb-4 flex gap-3">
            <button onClick={() => setTimelineTab('vendor')} className={`px-4 py-2 rounded-lg font-semibold ${timelineTab === 'vendor' ? 'bg-[#1A1C23] text-white' : 'bg-gray-100 text-gray-700'}`}>Vendor Logs</button>
            <button onClick={() => setTimelineTab('customer')} className={`px-4 py-2 rounded-lg font-semibold ${timelineTab === 'customer' ? 'bg-[#1A1C23] text-white' : 'bg-gray-100 text-gray-700'}`}>Customer Logs</button>
            {isAdmin && <button onClick={() => setTimelineTab('admin')} className={`px-4 py-2 rounded-lg font-semibold ${timelineTab === 'admin' ? 'bg-[#1A1C23] text-white' : 'bg-gray-100 text-gray-700'}`}>Admin Logs</button>}
          </div>

          {(timelineEntries[timelineTab] || []).length > 0 ? (
            <div className="space-y-3">
              {(timelineEntries[timelineTab] || []).map((log, idx) => (
                <div key={`${log.date}-${idx}`} className="border rounded-[8px] p-3 bg-gray-50">
                  <p className="font-semibold text-[#1A1C23]">{log.action}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatTimelineDate(log.date)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No timeline entries in this category yet.</p>
          )}
        </div>
      )}

      {editingIndex !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-xl rounded-xl shadow-xl p-6">
            <h3 className="text-xl font-bold text-[#1A1C23] mb-4">Edit Product</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Device Type</label>
                <input type="text" value={editDeviceType} onChange={(e) => setEditDeviceType(e.target.value)} className="w-full p-3 border rounded-[8px]" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Specification</label>
                <input type="text" value={editSpecification} onChange={(e) => setEditSpecification(e.target.value)} className="w-full p-3 border rounded-[8px]" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Storage Capacity/Configuration</label>
                <input type="text" value={editStorage} onChange={(e) => setEditStorage(e.target.value)} className="w-full p-3 border rounded-[8px]" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Condition</label>
                <input type="text" value={editCondition} onChange={(e) => setEditCondition(e.target.value)} className="w-full p-3 border rounded-[8px]" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Regular Price</label>
                <input type="text" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="w-full p-3 border rounded-[8px]" />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={closeEditModal} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
              <button onClick={saveInlineEdit} disabled={savingEdit} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{savingEdit ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorPage;
