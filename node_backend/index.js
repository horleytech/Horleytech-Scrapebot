import OpenAI from 'openai';
import { saveVendorsToFirebase } from './dataProcessor.js';

// Initialize OpenAI for real-time extraction
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ==========================================================
// 🚀 THE "AUTO LISTEN" WEBHOOK (REAL-TIME EXTRACTION)
// ==========================================================
app.post('/api/webhook/whatsapp', async (req, res) => {
    // Note: Configure your AutoResponder app to send a JSON payload with 'sender' and 'message'
    const sender = req.body?.sender;
    const message = req.body?.message || req.body?.senderMessage; // Fallback to your old AutoResponder key

    if (!sender || !message) {
        return res.status(400).json({ error: "Missing sender or message in request body." });
    }

    console.log(`📡 [AUTO LISTEN] New message received from ${sender}`);

    // Immediately send a 200 OK back to the Android app so it doesn't timeout!
    res.status(200).json({ status: "Message received, processing in background..." });

    try {
        const systemPrompt = `
        You are an expert product data extractor.
        Extract all mobile phones, tablets, laptops, games, and gadgets from this single WhatsApp message.
        
        Format the output as a JSON array of objects with EXACTLY these keys:
        - "Category": e.g., 'iPhone 14 Series'. If it does NOT fit a standard category, use 'Others'.
        - "Device Type": e.g., 'iPhone 14 Pro Max'.
        - "Condition": e.g., 'Brand New', 'UK Used'.
        - "SIM Type/Model/Processor": e.g., 'Physical SIM', 'ESIM'.
        - "Storage Capacity/Configuration": e.g., '256GB'.
        - "Regular price": The numeric price. CRITICAL: If no price is stated but it's in stock, use 'Available'.
        - "DatePosted": Use today's date: "${new Date().toISOString().split('T')[0]}".

        If no products are found in this message, return an empty array [].
        Only return the valid JSON array. Do not include markdown formatting.
        `;

        // 1. Send the single message to AI
        const aiResponse = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
            ],
            temperature: 0,
        });

        const rawJson = aiResponse.choices[0].message.content.trim();
        const cleanJson = rawJson.replace(/^```json/g, '').replace(/```$/g, '').trim();
        const extractedProducts = JSON.parse(cleanJson);

        // 2. If the AI found products, save them to Firebase!
        if (extractedProducts.length > 0) {
            console.log(`✅ AI Extracted ${extractedProducts.length} items from ${sender}`);
            
            // Format the data exactly like our Phase 1 Firebase structure expects
            const vendorData = [{
                vendorId: sender,
                lastUpdated: new Date().toISOString(),
                shareableLink: `/vendor/${encodeURIComponent(sender.replace(/\s+/g, '-'))}`,
                products: extractedProducts
            }];

            // Call the exact same Firebase function we updated in Step 1!
            await saveVendorsToFirebase(vendorData);
            console.log(`🗂️ Background save complete for ${sender}.`);
            
        } else {
            console.log(`🤷‍♂️ No products found in message from ${sender}. Ignored.`);
        }

    } catch (error) {
        console.error(`❌ Webhook Processing Error for ${sender}:`, error);
    }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
