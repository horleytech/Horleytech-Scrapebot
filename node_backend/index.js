import fs from 'fs';
import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import OpenAI from 'openai';
import morgan from 'morgan';
import { fileURLToPath } from 'url';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Get __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const setMaxToken = 17500;

const upload = multer({ dest: './uploads' });

const app = express();

app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 8000;

// const options = {
//   key: fs.readFileSync(
//     '/etc/letsencrypt/live/backend.horleytech.com/privkey.pem'
//   ),
//   cert: fs.readFileSync(
//     '/etc/letsencrypt/live/backend.horleytech.com/fullchain.pem'
//   ),
// };

app.get('/', (req, res) => {
  res.json({ message: 'Server Running' });
});

let fileContent = '';

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

    // Store the content in a variable
    fileContent = data;

    if (fileContent.length > setMaxToken) {
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error('Error deleting file:', err);
        } else {
          console.log('Deleted File');
        }
      });
      return res.json({ status: false, message: 'Maximum token exceeded' });
    }

    const content = `Extract Model, Storage (GB), Lock Status, SIM Type, Device Type(iphone, samsung, laptop, watch, sound) and Price from the text below and return the value as a list of json object with each object like 'model':'value', 'storage':'value', 'lock_status':'value', 'sim_type':'value', 'device_type':'value': 'price':'value'. If a line contains more than one price specification, extract each price as different json object.
                ${fileContent}`;

    const response = await openai.chat.completions.create({
      messages: [{ role: 'system', content }],
      model: 'gpt-3.5-turbo',
    });

    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Error deleting file:', err);
      } else {
        console.log('Deleted File');
      }
    });

    const apiResponse = response.choices[0].message.content;

    res.json(apiResponse);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
