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
    const content = `Extract Model, Storage (GB), Lock Status, SIM Type, Device Type (iphone, samsung, laptop, watch, sound, tablet), and Price from the text below and return the value as a list of JSON objects with each object having the following keys: 'model', 'storage', 'lock_status', 'sim_type', 'device_type', 'price'.

                    Perform the following transformations:
                    1. If a line contains more than one price specification, extract each price as a different JSON object.
                    2. Ensure that data is well represented under each key. Ensure that the price is in numbers (e.g., 20k should be represented as 20,000).
                    3. Remove any record that doesn't have a value for all the keys. If sim_type does not exist, make it Null. If lock_status does not exist, make it FU. Fully unlocked should be replaced with FU.
                    4. Ensure all product models carry the brand name. For example, "13 pro max" should be "iPhone 13 pro max".
                    5. Look for the condition of the product and add it to the product name. Conditions should either be BRAND NEW or USED. Note that "NEW OPENBOX", "USED", "UK USED", "BRAND NEW NO BOX" should all be classified as USED, while "BRAND NEW", "NEW SEALED" should be classified as BRAND NEW.
                    6. If the condition specified is out of the list specified above, then classify them under BRAND NEW or USED using your discretion.
                    7. If the condition is not specified, classify it as a USED product. If the description says "brand new <model name> only," classify it as USED.
                    8. Ensure that iPhones are represented as "iPhone" and Samsungs as "Samsung". Make sure all product names and models are uniform.
                    9. Always return a valid JSON object. Do not include extra markdown characters.
                    10. Ensure to always stick to the pattern without any deviation. Your response should not be in markdown. Send it to me as a direct string. Ensure to pass the right data to the right object key. Any value that has the word "unlocked" or "FU" must be in the lock_status key. Any value that contains the word "sim" must be in the sim_type key.
                    11. iPads should be categorized under the tablet device type.
                    12. Ensure that only iPhones are under the iPhone type, only Samsung phones are under the Samsung type, only laptops (including MacBooks) are under the laptop type, only watches are under the watch type, and the same applies for sound and tablet categories.
                    13. For all model names, ensure consistent usage even if they look different from the provided data.
                    14. For storage size, always specify the storage unit, e.g., 256GB, 1TB, 128GB.
                    15. For laptops and tablets, add all the product specifications available for a product to Lock Status.
                    16. Ensure that the condition (BRAND NEW or USED) is ALWAYS added to the product name.
                    17. Your final response should be a direct string without any markdown formatting.
                    
                    Input Text: ${chunk}`;
    
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
