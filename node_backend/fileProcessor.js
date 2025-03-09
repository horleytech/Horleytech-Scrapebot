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

// Helper to compute a group name based on the current month and year
function getGroupName() {
  const now = new Date();
  const month = now.toLocaleString('default', { month: 'long' }).toUpperCase();
  const year = now.getFullYear();
  return `${month}, ${year}`;
}

event.on('process', async (data, filePath /*, title */) => {
  // We now ignore any incoming title and always use the default monthly group
  const groupName = getGroupName();
  console.log('Process event fired.');
  console.log('Using group name:', groupName);
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
      3. Remove any record that doesn't have a value for all the keys; if sim_type does not exist, set it to Null and if lock_status does not exist, set it to FU.
      4. Ensure all product models carry the brand name (e.g. "13 pro max" becomes "iPhone 13 pro max").
      5. Add the product condition (BRAND NEW or USED) to the product name.
      6. If condition is not specified, treat the product as USED.
      7. Ensure that iPhones are represented as iPhone, Samsung as Samsung, etc.
      8. Always return a valid json object without extra markdown.
      9. Stick strictly to the pattern.
      10. iPads should be under tablet device type.
      11. Only iPhones under iphone type, Samsung under samsung, laptops under laptop, watches under watch, etc.
      12. Always specify storage with its unit (e.g. 256GB, 1TB, 128GB).
      13. For laptops/tablets, include available specifications in lock_status.
      14. For MacBooks, always include the model year.
      15. Always add the condition (BRAND NEW or USED) to the product name.
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
      // Send failure email using Nodemailer
      try {
        const mailOptions = {
          from: process.env.GMAIL_USER,
          to: [
            'joshuaajagbe96@gmail.com',
            'horleytech@gmail.com',
            'mike.inaolaji@gmail.com',
          ],
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

  // Check if a group document already exists for this month
  let groupId;
  try {
    const groupQuerySnapshot = await db
      .collection('groups')
      .where('name', '==', groupName)
      .get();
    if (!groupQuerySnapshot.empty) {
      groupId = groupQuerySnapshot.docs[0].id;
      console.log('Found existing group document:', groupId);
    } else {
      const groupDocRef = await db.collection('groups').add({ name: groupName });
      groupId = groupDocRef.id;
      console.log('Created new group document:', groupId);
    }
  } catch (error) {
    console.error('Error checking/creating group document:', error);
  }

  const finalResult = groupAndSortPhones(finalReponseArray);

  // Batch add prices data to Firestore, tagging each with the group name
  const batch = db.batch();
  finalResult.forEach((priceDatum) => {
    const dataToBeAdded = { ...priceDatum, group: groupName };
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

  // Send success email using Nodemailer
  try {
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: [
        'joshuaajagbe96@gmail.com',
        'horleytech@gmail.com',
        'mike.inaolaji@gmail.com',
      ],
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
  console.log({ mailerResponse: 'Success email processed' });
});
