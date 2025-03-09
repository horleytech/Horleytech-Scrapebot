import fs from 'fs';
import EventEmitter from 'events';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';

import OpenAI from 'openai';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';
import { groupAndSortPhones } from './dataProcessor.js';
import { convertString } from './cleaner.js';

dotenv.config();

export const stateCache = new NodeCache();
export const event = new EventEmitter();

const CHUNK_SIZE = 20_000;
const CACHE_TIMEOUT = 7_200;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Create Nodemailer transporter using Gmail credentials
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// Initialize firebase-admin with properly formatted credentials
admin.initializeApp({
  credential: admin.credential.cert(
    (() => {
      const config = JSON.parse(process.env.FIREBASE_CONFIG);
      if (config.private_key) {
        config.private_key = config.private_key.replace(/\\n/g, '\n');
      }
      return config;
    })()
  ),
});

const db = admin.firestore();

function generateRandomIds() {
  return `Horley${Math.floor(1000000 + Math.random() * 9000000)}`;
}

// Single event handler for processing the file.
// The title is passed along with data and filePath.
event.on('process', async (data, filePath, title) => {
  console.log('Process event fired.');
  console.log('Title received in event handler:', title);
  stateCache.set('state', 'pending', CACHE_TIMEOUT);

  // Break the file content into chunks
  const chunks = [];
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    chunks.push(data.substring(i, i + CHUNK_SIZE));
  }

  let finalReponseArray = [];

  // Process each chunk using OpenAI
  for (const chunk of chunks) {
    const content = `
      Extract Model, Storage (GB), Lock Status, SIM Type, Device Type (iphone, samsung, laptop, watch, sound, tablet) and Price from the text below and return the value as a list of json objects with each object having the following keys: 'model','storage','lock_status','sim_type','device_type','price'. 
      ${chunk}
      Perform the following transformation.
      1. If a line contains more than one price specification, extract each price as a different json object.
      2. Ensure that data is well represented under each key. Ensure that price is in numbers (e.g. 20k should be represented as 20,000). 
      3. Remove any record that doesn't have a value for all the keys, but if sim_type does not exist, set it to Null and if lock_status does not exist, set it to FU (Fully unlocked should be replaced with FU). 
      4. Make sure all product models carry the brand name (e.g. "13 pro max" is not valid, but "iPhone 13 pro max" is).
      5. Add the product condition (BRAND NEW or USED) to the product name. For example, if specified as BRAND NEW, add BRAND NEW to the product name.
      6. If condition is not specified or ambiguous, use your discretion to group them as BRAND NEW or USED.
      7. Ensure that iPhones are represented as iPhone, Samsung as Samsung, etc.
      8. Always return a valid json object, without extra markdown formatting.
      9. Stick strictly to the pattern without deviation.
      10. iPads should be under tablet device type.
      11. Only iPhones under iphone type, only Samsung phones under samsung, laptops under laptop, watches under watch, and similarly for sound and tablet.
      12. For all model names, ensure consistency in naming.
      13. Always specify storage with a unit (e.g. 256GB, 1TB, 128GB).
      14. For laptops and tablets, include all available specifications in lock_status.
      15. For MacBooks, always include the model year.
      16. Always add the condition (BRAND NEW or USED) to the product name.
      
      PLEASE NOTE: Data might also come in this format:
      (   USED SAMSUNG PHONE

        A03S 32GB 90K
        
        A12
        SINGLE 32GB 110K
        DUAL 32GB 115K
        DUAL 128GB 130K
        
        A13 
        DUAL 32GB 120K 
        DUAL 64GB 130K
      )
      This is how to extract the data.
    `;

    console.log('Sending chunk to OpenAI.');
    try {
      const response = await openai.chat.completions.create({
        messages: [{ role: 'system', content }],
        model: 'gpt-4o',
      });
      console.log({ response: response.choices[0].message.content });
      try {
        const temp = JSON.parse(response.choices[0].message.content);
        finalReponseArray = finalReponseArray.concat(temp);
        console.log('OpenAI response parsed successfully.');
      } catch (error) {
        console.log('Error parsing JSON, attempting cleanup.', { error });
        const cleanedData = convertString(response.choices[0].message.content);
        console.log({ cleanedData });
        const temp = JSON.parse(cleanedData);
        finalReponseArray = finalReponseArray.concat(temp);
        continue;
      }
    } catch (error) {
      console.error('Error processing chunk:', error);
      fs.unlink(filePath, (err) => {
        if (err) console.error('Error deleting file:', err);
        else console.log('Deleted File');
      });
      // Send failure email
      try {
        const mailOptions = {
          from: process.env.GMAIL_USER,
          to: ['joshuaajagbe96@gmail.com', 'horleytech@gmail.com', 'mike.inaolaji@gmail.com'],
          subject: 'File Processing Failed',
          html: `
            <h1>File Processing Failed</h1>
            <p>Sorry, your file could not be processed at the moment. 😥</p>
            <p>Please try again later.</p>
          `,
        };
        const mailerResponse = await transporter.sendMail(mailOptions);
        console.log({ mailerResponse });
      } catch (mailError) {
        console.error('Error sending failure email:', mailError);
      }
      stateCache.set('state', 'completed', CACHE_TIMEOUT);
      return;
    }
  }

  // Write group document to Firestore using the received title
  const groupPayload = { name: title };
  db.collection('groups')
    .add(groupPayload)
    .then((docRef) => {
      console.log('Group Document written with ID:', docRef.id);
    })
    .catch((error) => {
      console.error('Error adding group document:', error);
    });

  const finalResult = groupAndSortPhones(finalReponseArray);

  // Batch add prices data to Firestore
  const batch = db.batch();
  finalResult.forEach((priceDatum) => {
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
      console.error('Batch Prices Write Failed:', error);
    });

  // Delete the uploaded file
  fs.unlink(filePath, (err) => {
    if (err) console.error('Error deleting file:', err);
    else console.log('Deleted File');
  });

  // Send success email
  try {
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: ['joshuaajagbe96@gmail.com', 'horleytech@gmail.com', 'mike.inaolaji@gmail.com'],
      subject: 'File Processing Successful',
      html: `
        <h1>File Processed Successfully</h1>
        <p>Your txt file has been processed. Please check our website to visualize the data.</p>
        <p>Cheers 🥂</p>
      `,
    };
    const mailerResponse = await transporter.sendMail(mailOptions);
    console.log({ mailerResponse });
  } catch (mailError) {
    console.error('Error sending success email:', mailError);
  }

  stateCache.set('state', 'completed', CACHE_TIMEOUT);
  console.log({ mailerResponse: "Success email processed" });
});
