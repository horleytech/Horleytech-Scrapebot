import fs from 'fs';
import EventEmitter from 'events';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';
import OpenAI from 'openai';
import sg from '@sendgrid/mail';
import admin from 'firebase-admin';
import { groupAndSortPhones } from './dataProcessor.js';
import { convertString } from './cleaner.js';

dotenv.config();

export const stateCache = new NodeCache();
export const event = new EventEmitter();

const CHUNK_SIZE = 20_000;
const CACHE_TIMEOUT = 7_200;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
sg.setApiKey(process.env.SENDGRID_API_KEY);

// Initializing firebase-admin
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CONFIG)),
});

const db = admin.firestore();

const emailPayload = {
  to: '',
  subject: '',
  text: '',
  html: '',
  from: '',
};

function generateRandomIds() {
  return `Horley${Math.floor(1000000 + Math.random() * 9000000)}`;
}

const processTextData = (chunk) => {
  // 1. Extract details: Model, Storage (GB), Lock Status, SIM Type, Device Type, and Price.
  // 2. Group Lock Status into LOCKED and FACTORY UNLOCKED categories.
  // 3. Include "BRAND NEW" or "USED" in product names based on the description.
  // 4. Ensure proper formatting for each extracted product (e.g., "iPhone 13 pro max").
  // 5. Correctly categorize device types (iphone, samsung, laptop, watch, sound, tablet).
  // 6. Prices should be in numerical form and storage units specified (e.g., GB, TB).
  // 7. Remove incomplete data entries except when sim_type is missing; set sim_type to Null and lock_status to "FU" if unspecified.
  // 8. Ensure consistency in data and return a valid JSON array of objects.

  // Example product structure in the extracted data:
  // {
  //   "model": "iPhone 13 pro max",
  //   "storage": "128GB",
  //   "lock_status": "FACTORY UNLOCKED",
  //   "sim_type": "Dual SIM",
  //   "device_type": "iphone",
  //   "price": 100000
  // }

  // Detailed data extraction and transformation logic:
  const content = `
    Extract Model, Storage (GB), Lock Status (merge into LOCKED or FACTORY UNLOCKED), SIM Type, Device Type (iphone, samsung, laptop, watch, sound, tablet), and Price from the text below.
    Merge data entries based on Model, Storage (GB), Lock Status, and SIM Type.
    Return as a list of JSON objects with keys: 'model', 'storage', 'lock_status', 'sim_type', 'device_type', 'price'.

    ${chunk}

    Perform the following transformation:
    1. If a line contains more than one price, extract each as a different JSON object.
    2. Ensure data is well-represented under each key; price should be in numbers (e.g., 20k as 20,000).
    3. Remove records without values for all keys. If sim_type does not exist, set it to Null; set lock_status to "FU" if unspecified.
    4. Ensure all product models include the brand name (e.g., "iPhone 13 pro max").
    5. Add "BRAND NEW" or "USED" based on the descriptions. Use discretion for terms not explicitly listed.
    6. Handle different data formats, extracting relevant data correctly. Include the condition ("BRAND NEW" or "USED") in the product name.
    7. For missing conditions, assume the product is "USED" or as described.
    8. Maintain consistency in product naming and categorization (e.g., all iPhones as "iPhone", all Samsungs as "Samsung").
    9. Always return a valid JSON array without markdown characters.
    10. Ensure the data fits the specified format without deviation. Keys like "lock_status" should have correct values ("unlocked", "FU"), "sim_type" should contain the word "sim".
    11. iPads should be categorized as tablets.
    12. Device types should be properly classified (e.g., only iphones under 'iphone', etc.).
    13. Ensure consistent naming for all model names.
    14. Specify storage units (e.g., 256GB, 1TB, 128GB).
    15. For laptops and tablets, add all product specifications to Lock Status.
    16. For MacBooks, include the model year in the model name (e.g., "Used MacBook Pro 2020").
    17. Highlight all available specifications under lock status for tablets and laptops.
    18. Always add the condition (BRAND NEW or USED) to the product name (e.g., "BRAND NEW iPhone 15 pro max", "USED iPhone Xr").
    19. Device types can be either iphone, samsung, laptop, watch, sound, tablet (all in lowercase).
    20. Ensure the returned array is perfect for parsing with JavaScript's JSON.parse() function. Omit incomplete data.
  `;

  // Call OpenAI API or other text processing function here with `content`
  // For example: 
  // const processedData = openaiAPI.process(content);
  // return processedData;
};

event.on('process', async (data, filePath, title) => {
  console.log('Events Fired 🔥');
  stateCache.set('state', 'pending', CACHE_TIMEOUT);

  // Break the file content into chunks
  const chunks = [];
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    chunks.push(data.substring(i, i + CHUNK_SIZE));
  }

  let finalResponseArray = [];

  for (const chunk of chunks) {
    const content = processTextData(chunk);

    console.log('Chunking request');
    try {
      const response = await openai.chat.completions.create({
        messages: [{ role: 'system', content }],
        model: 'gpt-4o',
      });
      console.log({ response: response.choices[0].message.content });

      try {
        const temp = JSON.parse(response.choices[0].message.content);
        finalResponseArray = finalResponseArray.concat(temp);
        console.log('CHAT GPT RESPONSE GOTTEN');
      } catch (error) {
        console.log({ error });
        const cleanedData = convertString(response.choices[0].message.content);
        const temp = JSON.parse(cleanedData);
        finalResponseArray = finalResponseArray.concat(temp);
        continue;
      }
    } catch (error) {
      console.error('Error processing chunk:', error);
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error('Error deleting file:', err);
        } else {
          console.log('Deleted File');
        }
      });

      // Send 'failed' email here
      const sgResponse = await sg.send(
        {
          to: ['horleytech@gmail.com'],
          subject: 'File Processing Failed',
          html: `
            <h1>Failed File Processed</h1>
            <p>Sorry, your file could not be processed at the moment. 😥</p>
            <p>Please try again later.</p>
          `,
          from: process.env.MAILER_FROM_OPTION,
        },
        false
      );
      console.log({ sgResponse });
      stateCache.set('state', 'completed', CACHE_TIMEOUT);
      return;
    }
  }

  // Send group title to Firebase
  const groupPayload = {
    name: title,
  };

  db.collection('groups')
    .add(groupPayload)
    .then((docRef) => {
      console.log('Group Document written with ID: ', docRef.id);
    })
    .catch((error) => {
      console.error('Error adding group document: ', error);
    });

  const finalResult = groupAndSortPhones(finalResponseArray);

  // Send prices data to Firebase: Batch add
  const batch = db.batch();
  finalResult.forEach((priceDatum, index) => {
    const dataToBeAdded = { ...priceDatum, group: title };
    const docRef = db.collection('prices').doc(generateRandomIds());
    console.log({ dataToBeAdded });
    batch.set(docRef, dataToBeAdded);
  });

  batch
    .commit()
    .then(() => {
      console.log('Batch Prices Write Succeeded.');
    })
    .catch((error) => {
      console.log('Batch Prices Write Failed: ', error);
    });

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('Error deleting file:', err);
    } else {
      console.log('Deleted File');
    }
  });

  // Send 'success' email here
  const sgResponse = await sg.send(
    {
      to: ['horleytech@gmail.com'],
      subject: 'File Processing Successful',
      html: `
        <h1>File Processed</h1>
        <p>We are excited to inform you that your txt file has been processed.</p>
        <p>Kindly check our website to visualize the data.</p>
        <p>Cheers 🥂</p>
      `,
      from: process.env.MAILER_FROM_OPTION,
    },
    false
  );

  stateCache.set('state', 'completed', CACHE_TIMEOUT);
  console.log({ sgResponse });
});
