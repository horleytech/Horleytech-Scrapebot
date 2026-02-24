import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
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
          setVendorData(docSnap.data());
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
    return products.filter((product) => product?.isVisible !== false);
  }, [vendorData]);

  const buildWhatsappLink = (product) => {
    const message = `Hi, I am interested in the ${product['Device Type'] || 'device'} (${product.Condition || 'N/A'}, ${product['Storage Capacity/Configuration'] || 'N/A'}) for ${product['Regular price'] || 'N/A'} listed on your store.`;
    return `https://wa.me/${vendorId}?text=${encodeURIComponent(message)}`;
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

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 md:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-[#1A1C23]">{vendorData.vendorName || vendorId} Storefront</h1>
          <p className="text-gray-500 mt-2">Showing {visibleProducts.length} available items.</p>
        </div>

        <div className="overflow-x-auto bg-white rounded-2xl shadow border border-gray-100">
          <table className="min-w-full text-left">
            <thead className="bg-[#1A1C23] text-white">
              <tr>
                <th className="px-5 py-4 text-sm font-semibold">Device</th>
                <th className="px-5 py-4 text-sm font-semibold">Condition</th>
                <th className="px-5 py-4 text-sm font-semibold">Storage</th>
                <th className="px-5 py-4 text-sm font-semibold">Price</th>
                <th className="px-5 py-4 text-sm font-semibold">Order</th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.length > 0 ? (
                visibleProducts.map((product, index) => (
                  <tr key={`${product['Device Type']}-${index}`} className="border-b border-gray-100 hover:bg-green-50/30">
                    <td className="px-5 py-4 font-medium text-[#1A1C23]">{product['Device Type'] || 'N/A'}</td>
                    <td className="px-5 py-4 text-gray-600">{product.Condition || 'N/A'}</td>
                    <td className="px-5 py-4 text-gray-600">{product['Storage Capacity/Configuration'] || 'N/A'}</td>
                    <td className="px-5 py-4 font-bold text-green-700">{product['Regular price'] || 'N/A'}</td>
                    <td className="px-5 py-4">
                      <a
                        href={buildWhatsappLink(product)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition-colors"
                      >
                        Order via WhatsApp
                      </a>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="px-5 py-10 text-center text-gray-500">
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
