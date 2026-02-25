import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // Required for absolute pathing
import cron from 'node-cron';
import { google } from 'googleapis';
import admin from 'firebase-admin';

// Replicate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKUP_COLLECTION = 'horleyTech_OfflineInventories';
const BACKUP_HISTORY_COLLECTION = 'horleyTech_Backups';

const ensureAdminInitialized = () => {
  if (!admin.apps.length) {
    try {
      /**
       * PERFECT PATH LOGIC:
       * Since backup.js and firebase-credentials.json are in the same folder,
       * we look for the file relative to this script, not the terminal path.
       */
      const serviceAccountPath = path.join(__dirname, 'firebase-credentials.json');

      if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(`Credential file missing at: ${serviceAccountPath}`);
      }

      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      console.log('✅ Firebase Admin Initialized Successfully via local JSON.');
    } catch (error) {
      console.error('❌ Firebase Init Error:', error.message);
      throw error;
    }
  }
};

export const getAdminFirestore = () => {
  ensureAdminInitialized();
  return admin.firestore();
};

const uploadFileToDrive = async (filePath, fileName) => {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const serviceAccountPrivateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!serviceAccountEmail || !serviceAccountPrivateKey || !driveFolderId) {
    console.warn('⚠️ Google Drive variables missing in .env. Skipping Drive upload.');
    return;
  }

  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: serviceAccountPrivateKey,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  const drive = google.drive({ version: 'v3', auth });

  try {
    await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [driveFolderId],
        mimeType: 'application/json',
      },
      media: {
        mimeType: 'application/json',
        body: fs.createReadStream(filePath),
      },
      fields: 'id, name',
    });
  } catch (err) {
    console.error('❌ Google Drive Upload Error:', err.message);
  }
};

export const runBackup = async () => {
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  const fileName = `offline-inventory-backup-${safeTimestamp}.json`;
  
  // Save local backups in a folder relative to this script
  const backupDir = path.join(__dirname, 'backups');
  const localPath = path.join(backupDir, fileName);

  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const firestore = getAdminFirestore();
    const snapshot = await firestore.collection(BACKUP_COLLECTION).get();

    const payload = {
      createdAt: timestamp,
      backupId: safeTimestamp,
      collection: BACKUP_COLLECTION,
      totalDocuments: snapshot.size,
      documents: snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })),
    };

    fs.writeFileSync(localPath, JSON.stringify(payload, null, 2));

    // Async upload to Drive
    await uploadFileToDrive(localPath, fileName);

    // Save history record to Firebase
    await firestore.collection(BACKUP_HISTORY_COLLECTION).doc(safeTimestamp).set(payload);

    console.log(`✅ Backup Successful: ${fileName}`);

    return {
      success: true,
      backupId: safeTimestamp,
      totalDocuments: payload.totalDocuments,
    };
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    // Cleanup local temp file
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  }
};

export const initializeBackupJob = () => {
  cron.schedule('0 2 * * *', async () => {
    console.log('🎬 Starting scheduled daily backup...');
    await runBackup();
  }, {
    timezone: 'Africa/Lagos',
  });

  console.log('🕑 Daily backup cron initialized (2:00 AM Africa/Lagos).');
};
