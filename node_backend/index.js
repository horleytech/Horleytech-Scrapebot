import fs from 'fs';
import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';

import morgan from 'morgan';
import compression from 'compression';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { event, stateCache } from './fileProcessor.js';

// Load .env from the parent directory (~/Horleytech-Scrapebot/.env)
dotenv.config({ path: '../.env' });

// Get __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({ dest: './uploads' });

const app = express();

app.use(cors());
app.use(compression());
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

  // Compute the filePath immediately so it can be used later
  const filePath = path.join(__dirname, '../', req.file.path);

  const value = stateCache.get('state');
  if (value === 'pending') {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Error deleting file:', err);
      } else {
        console.log('Deleted File');
      }
    });
    return res.json({
      status: false,
      message: 'Process pending. Try again later.',
    });
  }

  console.log({ reqFilePath: req.file.path });
  console.log({ __dirname, filePath });

  fs.readFile(filePath, 'utf8', async (err, data) => {
    if (err) {
      console.log({ err });
      return res.status(500).send('Error reading file.');
    }

    console.log({ title: req.body.title });

    event.emit('process', data, filePath, req.body.title);

    res.json({
      message:
        'File Uploaded. File Processing. You will Receive an email Notification on Status',
      status: true,
    });
  });
});

// Bind to all interfaces
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
