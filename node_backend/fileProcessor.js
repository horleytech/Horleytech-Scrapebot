import fs from 'fs';
import EventEmitter from 'events';
import dotenv from 'dotenv';
import NodeCache from 'node-cache';

import OpenAI from 'openai';
import admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import { groupAndSortPhones } from './dataProcessor.js';
import { convertString } from './cleaner.js';

dotenv.config();

export const stateCache = new NodeCache();

export const event = new EventEmitter();

const CHUNK_SIZE = 20_000;
const CACHE_TIMEOUT = 7_200;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialize Nodemailer transporter using Gmail SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,      // your Gmail address
    pass: process.env.GMAIL_PASS,      // your app password
  },
});

// Initializing firebase-admin
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CONFIG)),
});

const db = admin.firestore();

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

  for (const chunk of chunks) {
    const content = `
    		    Extract Model, Storage (GB), Lock Status (Merge the Lock Statuses into two main categories: LOCKED (including descriptions like "LOCKED," "CHIP UNLOCKED," "LOCKED ESIM," "WIFI ONLY," "ESIM LOCKED WIFI ONLY," or similar terms indicating a restriction; use discretion for variations indicating a locked status) and FACTORY UNLOCKED (including descriptions like "ESIM FACTORY UNLOCKED," "FACTORY UNLOCKED PHYSICAL SIM," "It has 'FU' on it," "FACTORY UNLOCKED ESIM," "UNLOCKED," "FACTORY UNLOCK," "It has 'WARRANTY' on it," or similar terms indicating no restrictions; use discretion for variations indicating a factory unlocked status); retain the original Lock Status description if it cannot be categorized under these two headings), SIM Type, Device Type(iphone, samsung, laptop, watch, sound, tablet) and Price from the text below, Merge the data entries based on the same Model, Storage (GB), Lock Status, and SIM Type and return the value as a list of json object with each object having the following keys 'model','storage','lock_status','sim_type’,’device_type’,’price'. 
                    ${chunk}
                    Perform the following transformation.
                    1. If a line contains more than one price specification, extract each price as different json object.
                    2. Ensure that data is well represented under each key. Ensure that price is in numbers (e.g. 20k should be represented as 20,000). 
                    3. Remove any record that doesnt have value for all the keys, but if sim_type does not exist, make it Null and make lock_status that does not exist with FU. Fully unlocked should be replaced with FU 
                    4. Make sure  all product model carries the brand name. e.g. 13 pro max is not a valid model, but iPhone 13 pro max is valid
                    5. Look out for the condition of the product and add it to the product name: you will add "BRAND NEW" or "USED" based on the descriptions given: BRAND NEW: Includes terms like "BRAND NEW" and "NEW SEALED". USED: Has no description or Includes terms like "NEW <model name> ONLY", "NEW <model name> ONLY", "NEW OPENBOX," "USED," "UK USED," "US USED" "LONDON USED" " FORIEGN USED" and "BRAND NEW NO BOX."When processing the product data, append the corresponding condition to the product name. For example, if the product description mentions "NEW SEALED," you would label it as "BRAND NEW" and format it as "BRAND NEW [Product Name]." Similarly, if the description includes "UK USED," it would be labeled as "USED" and formatted as "USED [Product Name]."                     
                    6. If condition specifed is out of the list specifed above, then group them under BRAND NEW or USED using your discretion
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
   		      ) or
	   
  		  (	  All Colors , IWatch , Strap and Charger 🔌
			S4  44MM GPS ONLY - ₦170,000
			S4  44MM GPS LTE - ₦175,000
			S5  44MM GPS ONLY - ₦215,000
			S5  44MM GPS LTE - ₦220,000
			SE  2ND GEN 40MM GPS ONLY - ₦215,000
			SE  2ND GEN 40MM GPS LTE - ₦220,000
			SE  2ND GEN 44MM GPS ONLY - 240,000
			SE  2ND GEN 44MM GPS LTE - ₦245,000
		        )	 or
	
   		  (	  Baseus 20000mAh
			15W
			Type-C input & Output
			FastCharge⚡
			18k
			.
			Baseus 20000mAh
			20W
			Type-C input & Output
			FastCharge⚡
			20k
   		      )	
	    		    ENSURE THAT CONDITION (BRAND NEW or USED) IS ALWAYS ADDED TO EVERY EXTRACTED PRODUCT NAME. e.g. BRAND NEW iPhone 15 pro max, USED iPhone Xr, USED Samsung A23. If a condition is not specified, specify that the product is "USED" e.g. (USED Macbook Pro 2023)
                    7. Don't forget f condition is not specifed, it is a USED product or if the description says "brand new <model name> only" its also used
                    8. Ensure that iphones are represented as iPhone, samsung are represente as Samsung, basically make sure that all product name and models are uniform
                    9. Always return a valid json object, no extra markdown character. Don't add these characters "\\\json".
                    10. Ensure to always stick to the pattern without any deviation. Your response should not be in markdown. Send it to me as a direct string. Ensure to pass the right data to the right object key. Any value that has the word "unlocked" or “FU”,  must be in the lock_status key. Any value that contains the word "sim" must be in the sim_type key.
                    11. iPads should be be under tablet device type
                    12. Ensure that only iphones are under iphone type, only samsung phones are under samsung, only laptops (including macbooks) are under laptop, only watches are under watch, same for sound and tablet
                    13. For all model names, ensure that you consitently use the same name even if they look different from the provided data 
                    14. For storage size, always specify the storage unit. e.g. 256GB, 1TB, 128GB.  
                    15. For laptop and tablets, add all the product specifications available for a product to Lock Status                    
                    16. For macbooks, always ensure that model year is included under model name. e.g. Used Macbook Pro 2020
                    17. For tablets and laptops, always ensure that all the availabe specifications are highlighted under lock status
		    18. Don't forget to ensure that condition (BRAND NEW or USED) is ALWAYS added to the product name e.g. BRAND NEW iPhone 15 pro max, USED iPhone Xr   		    
		    19. device_type can either be iphone, samsung, laptop, watch, sound, tablet (all in lower case).
        		    20. Please ensure you return a perfect array of objects. I want to be able to parse it with the javascript JSON.parse() function. So, if the file has incomplete data that can lead to an incomplete object, omit it please and ensure only perfect array of objects is returned. This is extremely important.
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
      // Send 'failed' email using Nodemailer
      try {
        const mailOptions = {
          from: process.env.MAILER_FROM_OPTION,
          to: 'horleytech@gmail.com',
          subject: 'File Processing Failed',
          html: `
				<h1>Failed File Processed</h1>
				<p>Sorry, your file could not be processed at the moment. 😥</p>
				<p>Please try again later.</p>
		  `,
        };
        const emailResponse = await transporter.sendMail(mailOptions);
        console.log({ emailResponse });
      } catch (mailError) {
        console.error('Error sending failure email:', mailError);
      }
      stateCache.set('state', 'completed', CACHE_TIMEOUT);
      return;
    }
  }

  // Send group title to firebase
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

  // Send prices data to firebase: Batch add
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

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('Error deleting file:', err);
    } else {
      console.log('Deleted File');
    }
  });

  // Send 'success' email using Nodemailer
  try {
    const mailOptions = {
      from: process.env.MAILER_FROM_OPTION,
      to: 'horleytech@gmail.com',
      subject: 'File Processing Successful',
      html: `
		<h1>File Processed</h1>
		<p>We are excited to inform you that your txt file has been processed.</p>
		<p>Kindly check our website to visualize the data.</p>
		<p>Cheers 🥂</p>
		`,
      text: 'File Processed. Please check the website for details.',
    };
    const emailResponse = await transporter.sendMail(mailOptions);
    console.log({ emailResponse });
  } catch (mailError) {
    console.error('Error sending success email:', mailError);
  }

  stateCache.set('state', 'completed', CACHE_TIMEOUT);
});
