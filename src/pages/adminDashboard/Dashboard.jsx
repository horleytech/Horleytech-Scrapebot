import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, Navigate, Link } from 'react-router-dom';
import AdminDashboardLayout from '../../components/layouts/DashboardLayout';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase/index.js'; // Adjust path if needed
import { useSelector } from 'react-redux'; // ADDED: To check online/offline status

const AdminDashboard = () => {
  const location = useLocation();
  
  // 🚀 REDUX STATE: Check if we are in Online (Jumia/Slot) or Offline (WhatsApp) mode
  const isOnline = useSelector((state) => state.mode.isOnline);

  // --- WHATSAPP GLOBAL SEARCH STATE ---
  const [searchQuery, setSearchQuery] = useState('');
  const [allProducts, setAllProducts] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);

  // --- FETCH ALL WHATSAPP VENDORS ON LOAD ---
  useEffect(() => {
    const fetchGlobalInventory = async () => {
      setLoadingSearch(true);
      try {
        const querySnapshot = await getDocs(collection(db, "horleyTech_Inventories"));
        let globalItems = [];

        querySnapshot.forEach((doc) => {
          const vendorData = doc.data();
          if (vendorData.products) {
            const taggedProducts = vendorData.products.map(product => ({
              ...product,
              vendorName: vendorData.vendorId,
              vendorLink: vendorData.shareableLink
            }));
            globalItems = [...globalItems, ...taggedProducts];
          }
        });
        setAllProducts(globalItems);
      } catch (error) {
        console.error("Error fetching global inventory:", error);
      } finally {
        setLoadingSearch(false);
      }
    };

    // Only fetch Firebase WhatsApp data if we are in Offline mode to save reads
    if (!isOnline) {
      fetchGlobalInventory();
    }
  }, [isOnline]);

  // Default Redirect for normal tabs
  if (location.pathname === '/dashboard') {
    return <Navigate to="iphones" />;
  }

  // --- FILTER LOGIC FOR WHATSAPP DATA ---
  const searchResults = allProducts.filter(product => {
    if (!searchQuery) return true; // Show all WhatsApp items if search is empty
    const term = searchQuery.toLowerCase();
    return (
      product['Device Type']?.toLowerCase().includes(term) ||
      product.Category?.toLowerCase().includes(term) ||
      product.vendorName?.toLowerCase().includes(term)
    );
  });

  return (
    <AdminDashboardLayout>
      {/* IF ONLINE: Render the normal iPhone/Samsung tabs that load Jumia/Slot data.
        IF OFFLINE: Show our new WhatsApp Global Inventory & Search System!
      */}
      {isOnline ? (
        
        <Outlet />
        
      ) : (
        
        <div>
          {/* THE GLOBAL SEARCH BAR */}
          <div className="mb-6">
            <input
              type="text"
              placeholder="🔍 WhatsApp Inventory: Type a phone model, vendor, or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full p-4 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#1A1C23] text-[15px] shadow-sm"
            />
          </div>

          {/* THE NEW WHATSAPP RESULTS TABLE */}
          <div className="bg-white shadow rounded-[10px] overflow-x-auto mb-10">
            <div className="p-4 bg-gray-50 border-b border-[#DDDCF9] flex justify-between items-center">
              <h2 className="text-[18px] font-bold text-[#1A1C23]">
                WhatsApp Global Inventory ({searchResults.length} items)
              </h2>
            </div>
            
            <table className="w-full table rounded-[10px]">
              <thead className="h-[60px] border-b border-b-[#DDDCF9] bg-white">
                <tr className="text-[#1A1C23] font-bold text-left">
                  <th className="p-3 pl-6 border-b border-[#DDDCF9]">Vendor</th>
                  <th className="p-3 border-b border-[#DDDCF9]">Device Type</th>
                  <th className="p-3 border-b border-[#DDDCF9]">Condition</th>
                  <th className="p-3 border-b border-[#DDDCF9]">Storage</th>
                  <th className="p-3 border-b border-[#DDDCF9]">Price</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.length > 0 ? (
                  searchResults.map((product, index) => (
                    <tr key={index} className="hover:bg-gray-50 border-b border-gray-100 text-[15px] font-medium text-[#1A1C23]">
                      <td className="p-3 pl-6 font-bold text-blue-600">
                        {/* Clicking takes you to the VendorPage.jsx we created earlier */}
                        <Link to={product.vendorLink} className="hover:underline">
                          {product.vendorName}
                        </Link>
                      </td>
                      <td className="p-3">{product['Device Type']}</td>
                      <td className="p-3">{product.Condition}</td>
                      <td className="p-3">{product['Storage Capacity/Configuration']}</td>
                      <td className="p-3 font-semibold text-green-700">{product['Regular price']}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="p-6 text-center text-gray-500 font-medium text-[15px]">
                      {loadingSearch ? "Loading global inventory..." : "No WhatsApp products found."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminDashboardLayout>
  );
};

export default AdminDashboard;
