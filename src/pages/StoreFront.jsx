import { useEffect, useMemo, useState } from 'react';
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

// Helper to push a rolling log
const appendRollingLog = (logs, channel, entry) => {
  const normalized = normalizeLogs(logs);
  return {
    ...normalized,
    [channel]: [...normalized[channel], entry].slice(-MAX_LOG_ITEMS),
  };
};

// Utility to generate theme shades dynamically
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
    const configuredStaffNumbers = (vendorData?.whatsappNumbers || [])
      .map((number) => String(number || '').trim())
      .filter(Boolean);

    // 1. Pick random staff number if they exist
    if (configuredStaffNumbers.length > 0) {
      const randomIndex = Math.floor(Math.random() * configuredStaffNumbers.length);
      return configuredStaffNumbers[randomIndex];
    }

    // 2. Fallback to Primary Store Number
    const primaryNumber = String(vendorData?.storeWhatsappNumber || '').trim();
    if (primaryNumber) {
      return primaryNumber;
    }

    // 3. Final fallback to vendorId
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
  const storeLayout = vendorData.storeLayout || 'classic';
  const isDarkLayout = storeLayout === 'dark';

  const pageClassName = isDarkLayout
    ? 'min-h-screen py-8 px-4 md:px-8 bg-[#121212] text-gray-100'
    : 'min-h-screen bg-gray-50 py-8 px-4 md:px-8';

  const renderClassicTable = () => (
    <div className={`overflow-x-auto rounded-2xl shadow-xl border ${isDarkLayout ? 'bg-[#181818] border-[#2b2b2b]' : 'bg-white border-gray-100'}`}>
      <table className="min-w-full text-left border-collapse">
        <thead className="text-white uppercase tracking-wider" style={{ backgroundColor: themeColor }}>
          <tr>
            <th className="px-6 py-5 text-xs font-black first:rounded-tl-2xl">Device</th>
            <th className="px-6 py-5 text-xs font-black">Condition</th>
            <th className="px-6 py-5 text-xs font-black">Specification</th>
            <th className="px-6 py-5 text-xs font-black">Storage</th>
            <th className="px-6 py-5 text-xs font-black">Price</th>
            <th className="px-6 py-5 text-xs font-black last:rounded-tr-2xl">Order</th>
          </tr>
        </thead>
        <tbody className={isDarkLayout ? 'divide-y divide-[#2b2b2b]' : 'divide-y divide-gray-100'}>
          {visibleProducts.length > 0 ? (
            visibleProducts.map((product, index) => (
              <tr
                key={index}
                className="transition-colors group"
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = isDarkLayout ? '#1f1f1f' : `${lighterTheme}1A`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    {product.productImageBase64 && (
                      <img
                        src={product.productImageBase64}
                        alt=""
                        className={`w-12 h-12 rounded-lg object-cover shadow-sm border ${isDarkLayout ? 'bg-[#202020] border-[#333]' : 'bg-gray-100 border-gray-200'}`}
                      />
                    )}
                    <span className={`font-bold text-sm ${isDarkLayout ? 'text-gray-100' : 'text-[#1A1C23]'}`}>{product['Device Type'] || 'N/A'}</span>
                  </div>
                </td>
                <td className="px-6 py-5 text-sm">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                    product.Condition?.toLowerCase().includes('new')
                      ? 'bg-blue-50 text-blue-600'
                      : 'bg-orange-50 text-orange-600'
                  }`}>
                    {product.Condition || 'N/A'}
                  </span>
                </td>
                <td className={`px-6 py-5 text-sm italic font-medium ${isDarkLayout ? 'text-gray-400' : 'text-gray-600'}`}>
                  {product['SIM Type/Model/Processor'] || 'N/A'}
                </td>
                <td className={`px-6 py-5 text-sm font-bold ${isDarkLayout ? 'text-gray-300' : 'text-gray-500'}`}>
                  {product['Storage Capacity/Configuration'] || 'N/A'}
                </td>
                <td className="px-6 py-5 font-black text-lg" style={{ color: themeColor }}>
                  {product['Regular price'] || 'N/A'}
                </td>
                <td className="px-6 py-5">
                  <button
                    onClick={() => handleWhatsAppClick(product)}
                    style={{ backgroundColor: themeColor, boxShadow: isDarkLayout ? `0 0 0 1px ${themeColor}, 0 0 12px ${themeColor}66` : 'none' }}
                    className="inline-flex items-center text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase shadow-sm hover:brightness-90 transition-all active:scale-95 whitespace-nowrap"
                  >
                    Order via WhatsApp
                  </button>
                </td>
              </tr>
            ))
          ) : null}
        </tbody>
      </table>
    </div>
  );

  const renderGridLayout = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {visibleProducts.map((product, index) => (
        <div key={index} className={`rounded-2xl overflow-hidden border shadow-sm ${isDarkLayout ? 'bg-[#1a1a1a] border-[#2b2b2b]' : 'bg-white border-gray-100'}`}>
          {product.productImageBase64 ? (
            <img src={product.productImageBase64} alt={product['Device Type'] || 'Product'} className="w-full h-48 object-cover" />
          ) : (
            <div className={`w-full h-48 flex items-center justify-center text-sm font-bold ${isDarkLayout ? 'bg-[#202020] text-gray-500' : 'bg-gray-100 text-gray-400'}`}>No Image</div>
          )}
          <div className="p-4 space-y-2">
            <h3 className={`font-black text-lg ${isDarkLayout ? 'text-gray-100' : 'text-[#1A1C23]'}`}>{product['Device Type'] || 'N/A'}</h3>
            <p className={`text-xs uppercase font-bold ${isDarkLayout ? 'text-gray-400' : 'text-gray-500'}`}>{product.Condition || 'N/A'}</p>
            <p className={`text-sm ${isDarkLayout ? 'text-gray-300' : 'text-gray-600'}`}>{product['SIM Type/Model/Processor'] || 'N/A'}</p>
            <p className={`text-sm font-semibold ${isDarkLayout ? 'text-gray-300' : 'text-gray-600'}`}>{product['Storage Capacity/Configuration'] || 'N/A'}</p>
            <div className="flex items-center justify-between pt-2">
              <span className="font-black text-lg" style={{ color: themeColor }}>{product['Regular price'] || 'N/A'}</span>
              <button
                onClick={() => handleWhatsAppClick(product)}
                style={{ backgroundColor: themeColor, boxShadow: isDarkLayout ? `0 0 10px ${themeColor}66` : 'none' }}
                className="text-white text-xs font-black uppercase px-3 py-2 rounded-lg hover:brightness-90"
              >
                Order
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderListLayout = (variant) => (
    <div className={`rounded-2xl overflow-hidden border ${isDarkLayout ? 'bg-[#181818] border-[#2b2b2b]' : 'bg-white border-gray-100'}`}>
      {visibleProducts.map((product, index) => (
        <div key={index} className={`flex items-center justify-between gap-4 border-b last:border-b-0 ${isDarkLayout ? 'border-[#2b2b2b]' : 'border-gray-200'} ${variant === 'compact' ? 'px-4 py-3 text-xs' : 'px-6 py-6 text-sm'}`}>
          <div className="min-w-0">
            <p className={`font-black truncate ${variant === 'compact' ? 'text-sm' : 'text-base'} ${isDarkLayout ? 'text-gray-100' : 'text-[#1A1C23]'}`}>{product['Device Type'] || 'N/A'}</p>
            <p className={`${isDarkLayout ? 'text-gray-400' : 'text-gray-500'} ${variant === 'compact' ? 'mt-0.5' : 'mt-1'}`}>{product.Condition || 'N/A'} • {product['Storage Capacity/Configuration'] || 'N/A'}</p>
            {variant !== 'compact' && (
              <p className={`mt-1 italic ${isDarkLayout ? 'text-gray-500' : 'text-gray-500'}`}>{product['SIM Type/Model/Processor'] || 'N/A'}</p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`font-black ${variant === 'compact' ? 'text-sm' : 'text-lg'}`} style={{ color: themeColor }}>
              {product['Regular price'] || 'N/A'}
            </span>
            <button
              onClick={() => handleWhatsAppClick(product)}
              style={{ backgroundColor: themeColor, boxShadow: isDarkLayout ? `0 0 10px ${themeColor}66` : 'none' }}
              className={`${variant === 'compact' ? 'px-3 py-1.5 text-[10px]' : 'px-4 py-2 text-xs'} text-white rounded-lg uppercase font-black hover:brightness-90`}
            >
              Order
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  const renderProductsByLayout = () => {
    if (visibleProducts.length === 0) {
      return (
        <div className={`rounded-2xl border py-20 text-center ${isDarkLayout ? 'bg-[#181818] border-[#2b2b2b]' : 'bg-white border-gray-100'}`}>
          <span className="text-5xl mb-4 grayscale block">📦</span>
          <p className={`font-bold text-xl uppercase tracking-widest ${isDarkLayout ? 'text-gray-500' : 'text-gray-400'}`}>No matching products found.</p>
        </div>
      );
    }

    if (storeLayout === 'grid') return renderGridLayout();
    if (storeLayout === 'minimal') return renderListLayout('minimal');
    if (storeLayout === 'compact') return renderListLayout('compact');
    if (storeLayout === 'dark') return renderClassicTable();
    return renderClassicTable();
  };

  return (
    <div className={pageClassName}>
      <div className="max-w-7xl mx-auto">
        {/* Header with Chrome-style Gradient and Description */}
        <div
          className="mb-6 p-6 rounded-2xl text-white shadow-xl transition-all"
          style={{
            background: storeLayout === 'dark'
              ? `linear-gradient(135deg, ${themeColor}, #000000)`
              : `linear-gradient(135deg, ${themeColor}, #1A1C23)`,
            boxShadow: storeLayout === 'dark' ? `0 0 20px ${themeColor}55` : undefined,
          }}
        >
          <div className="flex flex-col md:flex-row items-center gap-6">
            {vendorData.logoBase64 ? (
              <img
                src={vendorData.logoBase64}
                alt="Store logo"
                className="w-24 h-24 rounded-full border-4 border-white/20 object-cover bg-white shadow-lg"
              />
            ) : (
              <div className="w-24 h-24 rounded-full border-4 border-white/20 bg-white/10 flex items-center justify-center text-4xl font-black">
                {vendorData.vendorName ? vendorData.vendorName[0].toUpperCase() : 'V'}
              </div>
            )}
            <div className="text-center md:text-left flex-1">
              <h1 className="text-4xl font-black tracking-tight">{vendorData.vendorName || vendorId}</h1>
              {vendorData.storeDescription && (
                <p className="text-white/80 mt-2 text-sm max-w-2xl leading-relaxed italic">
                  {vendorData.storeDescription}
                </p>
              )}
              <div className="flex flex-wrap justify-center md:justify-start gap-4 mt-4">
                {vendorData.address && <span className="text-xs font-bold bg-black/20 px-3 py-1.5 rounded-full">📍 {vendorData.address}</span>}
                <span className="text-xs font-bold bg-black/20 px-3 py-1.5 rounded-full">📦 {visibleProducts.length} items available</span>
                <span className="text-xs font-bold bg-black/20 px-3 py-1.5 rounded-full">🧩 Curated storefront</span>
              </div>
            </div>
          </div>
        </div>

        {renderProductsByLayout()}
      </div>
    </div>
  );
};

export default StoreFront;
