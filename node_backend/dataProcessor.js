import { db } from '../src/services/firebase/index.js'; // Adjust path to your firebase config
import { doc, setDoc, getDoc } from 'firebase/firestore';

export const saveVendorsToFirebase = async (vendorsData) => {
  console.log("🔥 Initiating Firebase Database Update...");

  for (const vendor of vendorsData) {
    try {
      // 1. Point to the specific Vendor's document inside 'horleyTech_Inventories'
      const vendorRef = doc(db, "horleyTech_Inventories", vendor.vendorId);
      
      // 2. Check if the vendor already exists in Firebase
      const vendorSnap = await getDoc(vendorRef);

      if (vendorSnap.exists()) {
        // If they exist, merge the NEW products with their OLD products
        const existingData = vendorSnap.data();
        const updatedProducts = [...existingData.products, ...vendor.products];

        await setDoc(vendorRef, {
          ...existingData,
          lastUpdated: vendor.lastUpdated,
          products: updatedProducts 
        }, { merge: true }); // Merge keeps existing fields safe
        
      } else {
        // If it is a new vendor, create their profile from scratch
        await setDoc(vendorRef, {
          vendorId: vendor.vendorId,
          lastUpdated: vendor.lastUpdated,
          shareableLink: vendor.shareableLink,
          products: vendor.products
        });
      }
      
      console.log(`☁️ Successfully saved ${vendor.vendorId} to Firebase.`);
    } catch (error) {
      console.error(`❌ Failed to save ${vendor.vendorId} to Firebase:`, error);
    }
  }
  console.log("🎉 All data successfully securely stored by Vendor in Firebase!");
};
