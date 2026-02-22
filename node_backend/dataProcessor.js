import { db } from '../src/services/firebase/index.js';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const OFFLINE_COLLECTION = 'horleyTech_OfflineInventories';

export const saveVendorsToFirebase = async (vendorsData, collectionName = OFFLINE_COLLECTION) => {
  console.log(`🔥 Initiating Firebase update for ${collectionName}...`);

  for (const vendor of vendorsData) {
    try {
      const vendorRef = doc(db, collectionName, vendor.vendorId);
      const vendorSnap = await getDoc(vendorRef);

      const existingData = vendorSnap.exists() ? vendorSnap.data() : {};
      const existingProducts = Array.isArray(existingData.products) ? existingData.products : [];
      const incomingProducts = Array.isArray(vendor.products) ? vendor.products : [];
      const mergedProducts = [...existingProducts, ...incomingProducts];

      await setDoc(
        vendorRef,
        {
          vendorId: vendor.vendorId,
          shareableLink: `/vendor/${encodeURIComponent(vendor.vendorId)}`,
          lastUpdated: vendor.lastUpdated || new Date().toISOString(),
          products: mergedProducts,
        },
        { merge: true }
      );

      console.log(`☁️ Saved ${vendor.vendorId} (${incomingProducts.length} new items).`);
    } catch (error) {
      console.error(`❌ Failed to save ${vendor.vendorId} to Firebase:`, error);
    }
  }

  console.log('🎉 Firebase save operation completed.');
};
