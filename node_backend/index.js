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
import https from 'https';
import http from 'http'; // For redirecting HTTP to HTTPS

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

const HTTPS_PORT = 443;
const HTTP_PORT = 80; // For redirecting HTTP to HTTPS

// Load SSL certificate and key
const sslOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/backend.horleytech.com/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/backend.horleytech.com/fullchain.pem'),
};

// Route Definitions
app.get('/', (req, res) => {
  res.json({ message: 'Server Running with HTTPS' });
});

app.post('/process', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const value = stateCache.get('state');
  if (value === 'pending') {
    const filePath = path.join(__dirname, '../', req.file.path);
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

  const filePath = path.join(__dirname, '../', req.file.path);
  console.log({ reqFilePath: req.file.path });
  console.log({ __dirname, __filename, filePath });

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

// Start HTTPS server
https.createServer(sslOptions, app).listen(HTTPS_PORT, () => {
  console.log(`✅ HTTPS Server running on port ${HTTPS_PORT}`);
});

// Redirect HTTP to HTTPS
http.createServer((req, res) => {
  res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
  res.end();
}).listen(HTTP_PORT, () => {
  console.log(`🔀 Redirecting HTTP to HTTPS on port ${HTTP_PORT}`);
});
