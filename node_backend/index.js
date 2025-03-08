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

dotenv.config();

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

  // Get the file path after the file is uploaded
  const filePath = path.join(__dirname, '../', req.file.path);
  console.log({ reqFilePath: req.file.path });
  console.log({ __dirname, filePath });

  // Check if processing is already pending
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

  // Read the content of the file
  fs.readFile(filePath, 'utf8', async (err, data) => {
    if (err) {
      console.log({ err });
      return res.status(500).send('Error reading file.');
    }

    console.log({ title: req.body.title });
    event.emit('process', data, filePath, req.body.title);

    res.json({
      message:
        'File Uploaded. File Processing. You will receive an email notification on status.',
      status: true,
    });
  });
});

// Bind to all network interfaces
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
