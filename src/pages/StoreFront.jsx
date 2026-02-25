import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../services/firebase/index.js';

const MAX_LOG_ITEMS = 200;

// Helper to ensure log structure exists
const normalizeLogs = (logs) => ({
  admin: Array.isArray(logs?.admin) ? logs.admin : [],
  vendor: Array.isArray(logs?.vendor) ? logs.vendor : [],
  customer: Array.isArray(logs?.customer) ? logs.customer : [],
});

// Helper to push a log to a specific channel while maintaining a rolling limit of 200
const appendRollingLog = (logs, channel, entry) => {
  const normalized = normalizeLogs(logs);
  return {
    ...normalized,
    [channel]: [...normalized[channel], entry].slice(-MAX_LOG_ITEMS),
  };
};

const StoreFront = () => {
  const { vendorId } = useParams();
  const [vendorData, setVendorData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStore = async () => {
      try {
        const docRef = doc(db, 'horleyTech_OfflineInventories', vendorId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          // Increment view count immediately on visit
          await updateDoc(docRef, { viewCount: increment(1) });
          const updatedSnap = await getDoc(docRef);
          setVendorData(updatedSnap.data());
        } else {
          setVendorData(null);
        }
      } catch (error) {
        console.error('Error loading storefront:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStore();
  }, [vendorId]);

  const visibleProducts = useMemo(() => {
    const products = vendorData?.products || [];
    const allowedGroups = Array.isArray(vendorData?.storefrontAllowedGroups)
      ? vendorData.storefrontAllowedGroups
      : null;

    return products.filter((product) => {
      // Must be visible
      const isVisible = product?.isVisible !== false;
      if (!isVisible) return false;

      // Filter by allowed groups if set in vendor settings
      if (allowedGroups && allowedGroups.length > 0) {
        const productGroup = product?.groupName || 'Direct Message';
        return allowedGroups.includes(productGroup);
      }

      return true;
    });
  }, [vendorData]);

  const pickStaffNumber = () => {
    const configuredNumbers = (vendorData?.whatsappNumbers || [])
      .map((number) => String(number || '').trim())
      .filter((num) => num !== '');

    if (!configuredNumbers.length) {
      return vendorId; // Fallback to vendorId if no staff numbers configured
    }

    const randomIndex = Math.floor(Math.random() * configuredNumbers.length);
    return configuredNumbers[randomIndex];
  };

  const handleWhatsAppClick = async (product) => {
    const vendorRef = doc(db, 'horleyTech_OfflineInventories', vendorId);
    const previousLogs = normalizeLogs(vendorData?.logs);
    const logEntry = {
      action: `Customer clicked WhatsApp Order for ${product['Device Type'] || 'Unknown Device'}`,
      date: new Date().toISOString(),
    };

    try {
      // Update Click Counter and append a Rolling Activity Log (Version 2.0)
      const nextLogs = appendRollingLog(previousLogs, 'customer', logEntry);
      await updateDoc(vendorRef, {
        whatsappClicks: increment(1),
        logs: nextLogs,
      });

      // Update local state to reflect the click and the log instantly
      setVendorData((prev) => ({
        ...prev,
        whatsappClicks: (prev?.whatsappClicks || 0) + 1,
        logs: nextLogs,
      }));
    } catch (error) {
      console.error('Failed to update WhatsApp clicks/logs:', error);
    }

    const number = pickStaffNumber();
    const message = `Hi, I am interested in the ${product['Device Type'] || 'device'} (${product.Condition || 'N/A'}, ${product['Storage Capacity/Configuration'] || 'N/A'}) for ${product['Regular price'] || 'N/A'} listed on your store.`;
    const link = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50">
        <p className="text-gray-600 text-lg">Loading store...</p>
      </div>
    );
  }

  if (!vendorData) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
        <div className="max-w-lg w-full bg-white border border-red-100 rounded-2xl p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-[#1A1C23] mb-2">Store not found</h1>
          <p className="text-gray-600">This store link is invalid or no inventory has been published yet.</p>
        </div>
      </div>
    );
  }

  if (vendorData.status === 'suspended') {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-100 px-4">
        <div className="max-w-lg w-full bg-white border border-gray-200 rounded-2xl p-10 text-center shadow-md">
          <h1 className="text-3xl font-bold text-[#1A1C23] mb-3">Store is currently unavailable</h1>
          <p className="text-gray-600">Please check back later or contact the vendor directly for updates.</p>
        </div>
      </div>
    );
  }

  const themeColor = vendorData.themeColor || '#16a34a';

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 md:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 p-5 rounded-2xl text-white shadow-lg transition-all" style={{ backgroundColor: themeColor }}>
          <div className="flex items-center gap-4">
            {vendorData.logoBase64 ? (
              <img
                src={vendorData.logoBase64}
                alt="Store logo"
                className="w-16 h-16 rounded-full border-2 border-white object-cover bg-white"
              />
            ) : (
              <div className="w-16 h-16 rounded-full border-2 border-white bg-white/20 flex items-center justify-center text-2xl font-bold">
                {vendorData.vendorName ? vendorData.vendorName[0].toUpperCase() : 'V'}
              </div>
            )}
            <div>
              <h1 className="text-3xl font-bold">{vendorData.vendorName || vendorId}</h1>
              {vendorData.address && <p className="text-white/90 mt-1">📍 {vendorData.address}</p>}
              <p className="text-white/90 mt-1 text-sm">Showing {visibleProducts.length} available items.</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto bg-white rounded-2xl shadow-xl border border-gray-100">
          <table className="min-w-full text-left border-collapse">
            <thead className="text-white" style={{ backgroundColor: themeColor }}>
              <tr>
                <th className="px-5 py-4 text-sm font-semibold first:rounded-tl-2xl">Group</th>
                <th className="px-5 py-4 text-sm font-semibold">Device</th>
                <th className="px-5 py-4 text-sm font-semibold">Condition</th>
                <th className="px-5 py-4 text-sm font-semibold">Specification</th>
                <th className="px-5 py-4 text-sm font-semibold">Storage</th>
                <th className="px-5 py-4 text-sm font-semibold">Price</th>
                <th className="px-5 py-4 text-sm font-semibold last:rounded-tr-2xl">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleProducts.length > 0 ? (
                visibleProducts.map((product, index) => (
                  <tr key={`${product['Device Type']}-${index}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4 text-xs font-medium text-gray-500">{product.groupName || 'Direct Message'}</td>
                    <td className="px-5 py-4 font-bold text-[#1A1C23]">{product['Device Type'] || 'N/A'}</td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        product.Condition?.toLowerCase().includes('new') 
                          ? 'bg-blue-50 text-blue-600' 
                          : 'bg-orange-50 text-orange-600'
                      }`}>
                        {product.Condition || 'N/A'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-600 text-sm">
                      {product['SIM Type/Model/Processor'] || 'N/A'}
                    </td>
                    <td className="px-5 py-4 text-gray-600 text-sm font-medium">
                      {product['Storage Capacity/Configuration'] || 'N/A'}
                    </td>
                    <td className="px-5 py-4 font-black text-lg" style={{ color: themeColor }}>
                      {product['Regular price'] || 'N/A'}
                    </td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => handleWhatsAppClick(product)}
                        style={{ backgroundColor: themeColor }}
                        className="inline-flex items-center text-white px-5 py-2.5 rounded-xl font-bold shadow-sm hover:brightness-90 transition-all active:scale-95 whitespace-nowrap"
                      >
                        Order via WhatsApp
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center">
                      <span className="text-4xl mb-3">📦</span>
                      <p className="text-gray-500 font-medium text-lg">No products match your current filters.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default StoreFront;