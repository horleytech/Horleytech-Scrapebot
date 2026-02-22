import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { processChatFile } from './fileProcessor.js';
import { saveVendorsToFirebase } from './dataProcessor.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3333;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: true, message: 'Scrapebot backend is healthy.' });
});

app.post('/process', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: false, message: 'No file uploaded.' });
  }

  const filePath = req.file.path;

  try {
    const vendorsData = await processChatFile(filePath);
    await saveVendorsToFirebase(vendorsData);

    return res.status(200).json({
      status: true,
      message: `Processing complete. ${vendorsData.length} vendors prepared and saved.`,
      vendors: vendorsData.length,
    });
  } catch (error) {
    console.error('❌ Error processing uploaded file:', error);
    return res.status(500).json({
      status: false,
      message: error.message || 'Failed to process file.',
    });
  } finally {
    fs.promises.unlink(filePath).catch(() => null);
  }
});

app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled backend error:', err);
  res.status(500).json({ status: false, message: 'Unexpected server error.' });
});

app.listen(port, () => {
  console.log(`🚀 Scrapebot backend listening on port ${port}`);
});
