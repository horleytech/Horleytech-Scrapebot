import fs from 'fs';
import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import OpenAI from 'openai';
import morgan from 'morgan';
import cors from 'cors';
import { fileURLToPath } from 'url';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Get __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHUNK_SIZE = 20_000;

const upload = multer({ dest: './uploads' });

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 8000;

app.get('/', (req, res) => {
  res.json({ message: 'Server Running' });
});

app.post('/process', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  // Read the content of the file
  const filePath = path.join(__dirname, '../', req.file.path);
  console.log({ reqFilePath: req.file.path });
  console.log({ __dirname, __filename, filePath });

  fs.readFile(filePath, 'utf8', async (err, data) => {
    if (err) {
      console.log({ err });
      return res.status(500).send('Error reading file.');
    }

    // Break the file content into chunks
    const chunks = [];
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      chunks.push(data.substring(i, i + CHUNK_SIZE));
    }

    let finalResponse = '';

    for (const chunk of chunks) {
      const content = `Extract Model, Storage (GB), Lock Status, SIM Type, Device Type(iphone, samsung, laptop, watch, sound) and Price from the text below and return the value as a list of json object with each object like 'model':'value', 'storage':'value', 'lock_status':'value', 'sim_type':'value', 'device_type':'value': 'price':'value'. If a line contains more than one price specification, extract each price as different json object.
                  Ensure that data is well represented under each key. Ensure that price is in numbers (e.g. 20k should be represented as 20,000). Please return just a valid json object, no extra markdown character. Don't add these characters "\`\`\`json"
                  ${chunk}`;

      try {
        const response = await openai.chat.completions.create({
          messages: [{ role: 'system', content }],
          model: 'gpt-3.5-turbo',
        });
        const temp = JSON.parse(response.choices[0].message.content);
        console.log({ temp });
        for (const datum of temp) {
          finalResponse += JSON.stringify(datum);
        }
        //   finalResponse += temp.join('');
        console.log({ finalResponse });
      } catch (error) {
        console.error('Error processing chunk:', error);
        return res.status(500).send('Error processing file.');
      }
    }

    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Error deleting file:', err);
      } else {
        console.log('Deleted File');
      }
    });

    res.json(finalResponse);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
