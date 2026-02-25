import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { google } from 'googleapis';
import admin from 'firebase-admin';

const BACKUP_COLLECTION = 'horleyTech_OfflineInventories';
const BACKUP_HISTORY_COLLECTION = 'horleyTech_Backups';

const ensureAdminInitialized = () => {
  if (!admin.apps.length) {
    try {
      // 1. Read the service account file synchronously
      const serviceAccountPath = path.join(process.cwd(), 'node_backend', 'serviceAccountKey.json');
      
      if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(`Missing service account file at: ${serviceAccountPath}`);
      }

      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

      // 2. Initialize Firebase with full privileges
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      console.log('✅ Firebase Admin Initialized Successfully.');
    } catch (error) {
      console.error('❌ Failed to initialize Firebase Admin:', error.message);
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
    console.warn('⚠️ Google Drive variables missing. Skipping Drive upload.');
    return;
  }

  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: serviceAccountPrivateKey,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  const drive = google.drive({ version: 'v3', auth });

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
};

export const runBackup = async () => {
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  const fileName = `offline-inventory-backup-${safeTimestamp}.json`;
  const backupDir = path.join(process.cwd(), 'node_backend', 'backups');
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

    await uploadFileToDrive(localPath, fileName);

    // Save history record to Firebase for the Dashboard to display
    await firestore.collection(BACKUP_HISTORY_COLLECTION).doc(safeTimestamp).set(payload);

    console.log(`✅ Backup uploaded and saved to Firebase: ${fileName}`);

    return {
      success: true,
      backupId: safeTimestamp,
      totalDocuments: payload.totalDocuments,
    };
  } catch (error) {
    console.error('❌ Backup job failed:', error.message);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  }
};

export const initializeBackupJob = () => {
  cron.schedule('0 2 * * *', async () => {
    await runBackup();
  }, {
    timezone: 'Africa/Lagos',
  });

  console.log('🕑 Daily backup cron initialized (2:00 AM Africa/Lagos).');
};
