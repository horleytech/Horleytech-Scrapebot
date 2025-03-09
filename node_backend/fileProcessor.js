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
event.on('process', async (data, filePath, title) => {
  console.log('Events Fired 🔥');
  console.log('Title received:', title); // Verify that the title is received
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
      Extract Model, Storage (GB), Lock Status, SIM Type, Device Type(iphone, samsung, laptop, watch, sound, tablet) and Price from the text below and return the value as a list of json object with each object having the following keys 'model','storage','lock_status','sim_type','device_type','price'. 
      ${chunk}
      Perform the following transformation.
      1. If a line contains more than one price specification, extract each price as different json object.
      2. Ensure that data is well represented under each key. Ensure that price is in numbers (e.g. 20k should be represented as 20,000). 
      3. Remove any record that doesnt have value for all the keys, but if sim_type does not exist, make it Null and make lock_status that does not exist with FU. Fully unlocked should be replaced with FU 
      4. Make sure all product models carry the brand name. e.g. 13 pro max is not a valid model, but iPhone 13 pro max is valid
      5. Look out for the condition of the product and add it to the product name. For example, if the product is specified as BRAND NEW, add BRAND NEW to the product name. e.g. BRAND NEW iPhone 15 pro max. Conditions should either be BRAND NEW OR USED. 
      6. If condition specified is out of the list specified above, then group them under BRAND NEW or USED using your discretion.
      7. If condition is not specified, it is a USED product or if the description says "brand new <model name> only" its also used.
      8. Ensure that iPhones are represented as iPhone, Samsung as Samsung—make sure all product names and models are uniform.
      9. Always return a valid json object, no extra markdown characters.
      10. Stick to the pattern without deviation. Your response should not be in markdown. Send it as a direct string.
      11. iPads should be under tablet device type.
      12. Ensure that only iPhones are under iphone type, only Samsung phones under samsung, only laptops (including MacBooks) under laptop, only watches under watch, same for sound and tablet.
      13. For all model names, ensure you consistently use the same name even if they appear differently.
      14. For storage size, always specify the unit (e.g. 256GB, 1TB, 128GB).
      15. For laptops and tablets, include all available specifications in Lock Status.
      16. For MacBooks, always include the model year (e.g. Used MacBook Pro 2020).
      17. For tablets and laptops, ensure all available specifications are in lock status.
      18. Always add condition (BRAND NEW or USED) to the product name (e.g. BRAND NEW iPhone 15 pro max, USED iPhone Xr).
      
      PLEASE NOTE THAT DATA MIGHT COME IN THIS FORMAT TOO:
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

    console.log('Chunking request');
    try {
      const response = await openai.chat.completions.create({
        messages: [{ role: 'system', content }],
        model: 'gpt-4o',
      });
      console.log({ response: response.choices[0].message.content });
      try {
        const temp = JSON.parse(response.choices[0].message.content);
        finalReponseArray = finalReponseArray.concat(temp);
        console.log('CHAT GPT RESPONSE GOTTEN');
      } catch (error) {
        console.log({ error });
        const cleanedData = convertString(response.choices[0].message.content);
        console.log({ cleanedData });
        const temp = JSON.parse(cleanedData);
        finalReponseArray = finalReponseArray.concat(temp);
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
      // Send failure email
      try {
        const mailOptions = {
          from: process.env.GMAIL_USER,
          to: ['horleytech@gmail.com'],
          subject: 'File Processing Failed',
          html: `
            <h1>Failed File Processed</h1>
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

  // Write the group to Firestore using the received title
  const groupPayload = { name: title };
  db.collection('groups')
    .add(groupPayload)
    .then((docRef) => {
      console.log('Group Document written with ID: ', docRef.id);
    })
    .catch((error) => {
      console.error('Error adding group document: ', error);
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
      console.log('Batch Prices Write Failed: ', error);
    });

  // Delete the uploaded file
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('Error deleting file:', err);
    } else {
      console.log('Deleted File');
    }
  });

  // Send success email
  try {
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: ['horleytech@gmail.com'],
      subject: 'File Processing Successful',
      html: `
        <h1>File Processed</h1>
        <p>We are excited to inform you that your txt file has been processed.</p>
        <p>Kindly check our website to visualize the data.</p>
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
