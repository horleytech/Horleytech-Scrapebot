import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../services/firebase/index.js';

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
    const configuredNumbers = (vendorData?.whatsappNumbers || [])
      .map((number) => String(number || '').trim())
      .filter((number) => number);

    if (!configuredNumbers.length) {
      return vendorId;
    }

    const randomIndex = Math.floor(Math.random() * configuredNumbers.length);
    return configuredNumbers[randomIndex];
  };

  const handleWhatsAppClick = async (product) => {
    try {
      const vendorRef = doc(db, 'horleyTech_OfflineInventories', vendorId);
      await updateDoc(vendorRef, { whatsappClicks: increment(1) });
    } catch (error) {
      console.error('Failed to update WhatsApp clicks:', error);
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
        <div className="mb-6 p-5 rounded-2xl text-white" style={{ backgroundColor: themeColor }}>
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
              <p className="text-white/90 mt-1">Showing {visibleProducts.length} available items.</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto bg-white rounded-2xl shadow border border-gray-100">
          <table className="min-w-full text-left">
            <thead className="text-white" style={{ backgroundColor: themeColor }}>
              <tr>
                <th className="px-5 py-4 text-sm font-semibold">Group</th>
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
                  <tr key={`${product['Device Type']}-${index}`} className="border-b border-gray-100 hover:bg-green-50/30">
                    <td className="px-5 py-4 text-xs">{product.groupName || 'Direct Message'}</td>
                    <td className="px-5 py-4 font-medium text-[#1A1C23]">{product['Device Type'] || 'N/A'}</td>
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
                  <td colSpan="7" className="px-5 py-10 text-center text-gray-500">
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
