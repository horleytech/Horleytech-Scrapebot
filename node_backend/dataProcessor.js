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
            // Use a richer identity key so distinct listings with same device/price are not dropped.
            const mergedProducts = [...existingProducts, ...vendor.products];
            const seen = new Set();
            const uniqueProducts = [];

            mergedProducts.forEach((product) => {
                const rawKey = String(product?.rawProductString || '').trim().toLowerCase();
                const fallbackKey = [
                    String(product?.['Device Type'] || '').trim().toLowerCase(),
                    String(product?.['Regular price'] || '').trim().toLowerCase(),
                    String(product?.['SIM Type/Model/Processor'] || '').trim().toLowerCase(),
                    String(product?.Condition || '').trim().toLowerCase(),
                ].join('::');
                const dedupeKey = rawKey || fallbackKey;
                if (seen.has(dedupeKey)) return;
                seen.add(dedupeKey);
                uniqueProducts.push(product);
            });

            await setDoc(docRef, {
                vendorId: masterDocId,
                vendorName: vendor.vendorName || vendor.vendorId, // Keep readable name for display
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
