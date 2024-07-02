import fs from 'fs';
import EventEmitter from 'events';
import dotenv from 'dotenv';

import OpenAI from 'openai';
import sg from '@sendgrid/mail';
import admin from 'firebase-admin';

dotenv.config();

export const event = new EventEmitter();

const CHUNK_SIZE = 20_000;

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
  // Break the file content into chunks
  const chunks = [];
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    chunks.push(data.substring(i, i + CHUNK_SIZE));
  }

  let finalResponse = '';
  let finalReponseArray = [];

  for (const chunk of chunks) {
    const content = `Extract Model, Storage (GB), Lock Status, SIM Type, Device Type(iphone, samsung, laptop, watch, sound) and Price from the text below and return the value as a list of json object with each object like 'model':'value', 'storage':'value', 'lock_status':'value', 'sim_type':'value', 'device_type':'value': 'price':'value'. If a line contains more than one price specification, extract each price as different json object.
                  Ensure that data is well represented under each key. Ensure that price is in numbers (e.g. 20k should be represented as 20,000). Please return just a valid json object, no extra markdown character. Don't add these characters "\`\`\`json"
                  ${chunk}`;
    console.log('Chunking request');
    try {
      const response = await openai.chat.completions.create({
        messages: [{ role: 'system', content }],
        model: 'gpt-3.5-turbo',
      });
      const temp = JSON.parse(response.choices[0].message.content);
      // console.log({ temp });
      finalReponseArray = finalReponseArray.concat(temp);
      console.log({ finalReponseArray });
      // for (const datum of temp) {
      //   finalResponse += JSON.stringify(datum) + ',';
      // }
      // //   finalResponse += temp.join('');
      // console.log({ finalResponse });
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
          to: 'horleytech@gmail.com',
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

  //   send prices data to firebase: Batch add
  const batch = db.batch();
  finalReponseArray.forEach((priceDatum, index) => {
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
      to: 'joshuaajagbe96@gmail.com',
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
  console.log({ sgResponse });
});
