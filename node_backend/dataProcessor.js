import { db } from '../src/services/firebase/index.js';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export const saveVendorsToFirebase = async (vendorsData) => {
    for (const vendor of vendorsData) {
        if (!vendor.vendorId || vendor.vendorId === "Unknown") continue;

        // 1. REGEX NORMALIZATION (Your Grouping Idea!)
        // Strips spaces/symbols so "Horleytech LINE" and "horleytech-line" group together
        const masterDocId = vendor.vendorId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        
        // We now save to the offline collection
        const docRef = doc(db, 'horleyTech_OfflineInventories', masterDocId);

        try {
            const docSnap = await getDoc(docRef);
            let existingProducts = [];

            // 2. FETCH OLD DATA FIRST
            if (docSnap.exists()) {
                existingProducts = docSnap.data().products || [];
            }

            // 3. MERGE & REMOVE DUPLICATES
            const mergedProducts = [...existingProducts, ...vendor.products];
            const uniqueProducts = mergedProducts.filter((product, index, self) =>
                index === self.findIndex((t) => (
                    t['Device Type'] === product['Device Type'] && 
                    t['Regular price'] === product['Regular price']
                ))
            );

            // 4. SAVE BACK TO FIREBASE
            await setDoc(docRef, {
                vendorId: masterDocId,             // Used for URLs
                vendorName: vendor.vendorId,       // Kept original for Display (e.g., Horleytech LINE)
                lastUpdated: new Date().toISOString(),
                shareableLink: `/vendor/${masterDocId}`,
                products: uniqueProducts
            });

            console.log(`☁️ Successfully Grouped & Merged ID: ${masterDocId}`);
        } catch (err) {
            console.error(`❌ Error saving vendor ${vendor.vendorId}:`, err);
        }
    }
};
