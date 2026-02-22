import { db } from '../src/services/firebase/index.js';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export const saveVendorsToFirebase = async (vendorsData) => {
    for (const vendor of vendorsData) {
        if (!vendor.vendorId || vendor.vendorId === "Unknown") continue;

        // REGEX NORMALIZATION: Strips spaces so "Horleytech LINE" and "horleytech-line" merge into "horleytechline"
        const masterDocId = vendor.vendorId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        
        const docRef = doc(db, 'horleyTech_OfflineInventories', masterDocId);

        try {
            const docSnap = await getDoc(docRef);
            let existingProducts = [];

            if (docSnap.exists()) {
                existingProducts = docSnap.data().products || [];
            }

            // Merge & Remove Duplicates
            const mergedProducts = [...existingProducts, ...vendor.products];
            const uniqueProducts = mergedProducts.filter((product, index, self) =>
                index === self.findIndex((t) => (
                    t['Device Type'] === product['Device Type'] && 
                    t['Regular price'] === product['Regular price']
                ))
            );

            await setDoc(docRef, {
                vendorId: masterDocId,
                vendorName: vendor.vendorId, // Keep original name for display
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
