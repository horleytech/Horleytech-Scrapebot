import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../services/firebase/index.js';

const MAX_LOG_ITEMS = 200;

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

const lightenHex = (hex, amount = 0.18) => {
  if (!hex || typeof hex !== 'string') return '#22c55e';
  const safeHex = hex.replace('#', '').trim();
  const normalized = safeHex.length === 3
    ? safeHex.split('').map((char) => `${char}${char}`).join('')
    : safeHex;

  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return '#22c55e';

  const base = Number.parseInt(normalized, 16);
  const r = (base >> 16) & 255;
  const g = (base >> 8) & 255;
  const b = base & 255;

  const nextR = Math.min(255, Math.round(r + (255 - r) * amount));
  const nextG = Math.min(255, Math.round(g + (255 - g) * amount));
  const nextB = Math.min(255, Math.round(b + (255 - b) * amount));

  return `#${[nextR, nextG, nextB].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
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
      const isVisible = product?.isVisible !== false;
      if (!isVisible) return false;

      if (allowedGroups && allowedGroups.length > 0) {
        const productGroup = product?.groupName || 'Direct Message';
        return allowedGroups.includes(productGroup);
      }

      return true;
    });
  }, [vendorData]);

  const pickStaffNumber = () => {
    const configuredStaffNumbers = (vendorData?.whatsappNumbers || [])
      .map((number) => String(number || '').trim())
      .filter(Boolean);

    if (configuredStaffNumbers.length > 0) {
      const randomIndex = Math.floor(Math.random() * configuredStaffNumbers.length);
      return configuredStaffNumbers[randomIndex];
    }

    const primaryNumber = String(vendorData?.storeWhatsappNumber || '').trim();
    if (primaryNumber) {
      return primaryNumber;
    }

    return vendorId;
  };

  const handleWhatsAppClick = async (product) => {
    const vendorRef = doc(db, 'horleyTech_OfflineInventories', vendorId);
    const previousLogs = normalizeLogs(vendorData?.logs);
    const logEntry = {
      action: `Customer clicked WhatsApp Order for ${product['Device Type'] || 'Unknown Device'}`,
      date: new Date().toISOString(),
    };

    try {
      const nextLogs = appendRollingLog(previousLogs, 'customer', logEntry);
      await updateDoc(vendorRef, {
        whatsappClicks: increment(1),
        logs: nextLogs,
      });

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
  const lighterTheme = lightenHex(themeColor, 0.22);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 md:px-8">
      <div className="max-w-7xl mx-auto">
        <div
          className="mb-6 p-5 rounded-2xl text-white"
          style={{
            background: `linear-gradient(130deg, ${themeColor} 0%, ${lighterTheme} 60%, ${themeColor} 100%)`,
          }}
        >
          <div className="flex items-center gap-4">
            {vendorData.logoBase64 ? (
              <img
                src={vendorData.logoBase64}
                alt="Store logo"
                className="w-16 h-16 rounded-full border-2 border-white object-cover bg-white"
              />
            ) : (
              <div className="w-16 h-16 rounded-full border-2 border-white bg-white/20" />
            )}
            <div>
              <h1 className="text-3xl font-bold">{vendorData.vendorName || vendorId} Storefront</h1>
              {vendorData.address && <p className="text-white/90 mt-1">📍 {vendorData.address}</p>}
              {vendorData.storeDescription && <p className="text-white/90 mt-1 max-w-4xl">{vendorData.storeDescription}</p>}
              <p className="text-white/90 mt-1">Showing {visibleProducts.length} available items.</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto bg-white rounded-2xl shadow border border-gray-100">
          <table className="min-w-full text-left">
            <thead className="text-white" style={{ backgroundColor: themeColor }}>
              <tr>
                <th className="px-5 py-4 text-sm font-semibold">Device</th>
                <th className="px-5 py-4 text-sm font-semibold">Condition</th>
                <th className="px-5 py-4 text-sm font-semibold">Specification</th>
                <th className="px-5 py-4 text-sm font-semibold">Storage</th>
                <th className="px-5 py-4 text-sm font-semibold">Price</th>
                <th className="px-5 py-4 text-sm font-semibold">Order</th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.length > 0 ? (
                visibleProducts.map((product, index) => (
                  <tr
                    key={`${product['Device Type']}-${index}`}
                    className="border-b border-gray-100"
                    style={{ transition: 'background-color 150ms ease-in-out' }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.backgroundColor = `${lighterTheme}1A`;
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <td className="px-5 py-4 font-medium text-[#1A1C23]">
                      <div className="flex items-center gap-3">
                        {product.productImageBase64 ? (
                          <img
                            src={product.productImageBase64}
                            alt={product['Device Type'] || 'Product'}
                            className="w-10 h-10 rounded-md object-cover border border-gray-200"
                          />
                        ) : null}
                        <span>{product['Device Type'] || 'N/A'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-600">{product.Condition || 'N/A'}</td>
                    <td className="px-5 py-4 text-gray-600">
                      {(product['Storage Capacity/Configuration'] || 'N/A')} | {(product['SIM Type/Model/Processor'] || 'N/A')}
                    </td>
                    <td className="px-5 py-4 text-gray-600">{product['Storage Capacity/Configuration'] || 'N/A'}</td>
                    <td className="px-5 py-4 font-bold text-green-700">{product['Regular price'] || 'N/A'}</td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => handleWhatsAppClick(product)}
                        style={{ backgroundColor: themeColor }}
                        className="inline-flex items-center text-white px-4 py-2 rounded-lg font-semibold hover:opacity-90 transition-colors"
                      >
                        Order via WhatsApp
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="px-5 py-10 text-center text-gray-500">
                    No products are currently available for this store.
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
