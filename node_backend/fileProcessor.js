import fs from 'fs';
import EventEmitter from 'events';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';

import OpenAI from 'openai';
import sg from '@sendgrid/mail';
import admin from 'firebase-admin';
import { groupAndSortPhones } from './dataProcessor.js';

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

event.on('process', async (data, filePath, title) => {
  console.log('Events Fired  🔥');
  stateCache.set('state', 'pending', 7200);

  // Break the file content into chunks
  const chunks = [];
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    chunks.push(data.substring(i, i + CHUNK_SIZE));
  }

  let finalReponseArray = [];

  let count = 0;

  for (const chunk of chunks) {
    // if (count === 1) {
    //   break;
    // }
    // count++;
    const content = `Extract Model, Storage (GB), Lock Status, SIM Type, Device Type (iPhone, Samsung, Laptop, Watch, Sound, Tablet), and Price from the text below and return the value as a list of JSON objects with each object having the following keys: 'model', 'storage', 'lock_status', 'sim_type', 'device_type', 'price'.
		If a line contains more than one price specification, extract each price as a different JSON object.
		Ensure that data is well represented under each key. Ensure that the price is in numbers (e.g., 20k should be represented as 20,000).
		Remove any record that doesn't have values for all the keys. If 'sim_type' does not exist, set it to null. Set 'lock_status' to 'FU' if it doesn't exist, and replace "Fully unlocked" with 'FU'.
		Ensure all product models include the brand name (e.g., "13 Pro Max" should be "iPhone 13 Pro Max").
		Add the product condition to the product name (e.g., "BRAND NEW iPhone 15 Pro Max" or "USED iPhone Xr"). Classify conditions as either 'BRAND NEW' or 'USED', including variations like "NEW OPENBOX" and "BRAND NEW NO BOX" under 'USED'.
		If the condition is not specified, classify the product as 'USED'. If the description says "brand new <model name> only," it is also 'USED'.
		Ensure uniform representation of product names and models (e.g., "iPhone" for all iPhones, "Samsung" for all Samsung devices).
		Always return a valid JSON object without any extra markdown characters.
		Ensure data is assigned to the correct keys: "unlocked" or "FU" in 'lock_status', and any term with "sim" in 'sim_type'.
		iPads should be classified under the 'tablet' device type.
		Ensure proper categorization: only iPhones under 'iPhone', only Samsung phones under 'Samsung', only laptops (including MacBooks) under 'laptop', only watches under 'watch', and similarly for 'sound' and 'tablet'.
		Standardize storage size units (e.g., 256GB, 1TB, 128GB).
		For laptops and tablets, include all available specifications in 'lock_status'. For MacBooks, always include the model year (e.g., "Used MacBook Pro 2020").
		Ensure condition ('BRAND NEW' or 'USED') is always added to the product name.
		Data might also come in a format like this:
		
		( USED SAMSUNG PHONE
		
		mathematica
		Copy code
		A03S 32GB 90K
		
		A12
		SINGLE 32GB 110K
		DUAL 32GB 115K
		DUAL 128GB 130K
		
		A13 
		DUAL 32GB 120K 
		DUAL 64GB 130K
		)
		
		Extract the data accordingly, ensuring each product entry is complete and correctly categorized.
		
		Data to extract from:
		${chunk}
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
        // console.log({ temp });
        finalReponseArray = finalReponseArray.concat(temp);
        // console.log({ finalReponseArray });
        console.log('CHAT GPT RESPONSE GOTTEN');
      } catch (error) {
        console.log({ error });
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
          to: [
            'joshuaajagbe96@gmail.com',
            'horleytech@gmail.com',
            'mike.inaolaji@gmail.com',
          ],
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

  //   send group title to firebase
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

  const finalResult = groupAndSortPhones(finalReponseArray);
  // console.log(finalResult);

  //   send prices data to firebase: Batch add
  const batch = db.batch();
  finalResult.forEach((priceDatum, index) => {
    const docRef = db.collection('prices').doc(generateRandomIds());
    batch.set(docRef, { ...priceDatum, group: title });
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

  //   Send 'success' email here
  const sgResponse = await sg.send(
    {
      to: [
        'joshuaajagbe96@gmail.com',
        'horleytech@gmail.com',
        'mike.inaolaji@gmail.com',
      ],
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
