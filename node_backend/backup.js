import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { google } from 'googleapis';
import admin from 'firebase-admin';

// Replicate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKUP_COLLECTION = 'horleyTech_OfflineInventories';
const BACKUP_HISTORY_COLLECTION = 'horleyTech_Backups';
const AUDIT_COLLECTION = 'horleyTech_AuditLogs';

const ensureAdminInitialized = () => {
  if (!admin.apps.length) {
    try {
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

const getDriveClient = () => {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const serviceAccountPrivateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!serviceAccountEmail || !serviceAccountPrivateKey || !driveFolderId) {
    console.warn('⚠️ Google Drive variables missing in .env. Skipping Drive upload.');
    return null;
  }

  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: serviceAccountPrivateKey,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    // Note: If you ever want to upload to "My Drive" instead of a "Shared Drive",
    // you must use Domain-Wide Delegation and uncomment the line below:
    // subject: 'admin@your-workspace-domain.com' 
  });

  const drive = google.drive({ version: 'v3', auth });

  return { drive, driveFolderId };
};

const uploadFileToDrive = async (filePath, fileName) => {
  const client = getDriveClient();
  if (!client) return;
  const { drive, driveFolderId } = client;

  try {
    console.log(`☁️ Starting Google Drive upload for ${fileName} -> Shared Drive ${driveFolderId}`);

    await drive.files.create({
      // 🔥 Required for uploading to Workspace Shared Drives
      supportsAllDrives: true, 
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
    
    console.log('✅ Google Drive upload finished successfully.');
  } catch (error) {
    const detailedMessage = error?.response?.data
      ? JSON.stringify(error.response.data)
      : (error?.stack || error?.message || String(error));

    console.error(`❌ Google Drive upload failed for ${fileName}: ${detailedMessage}`);
  }
};

const restoreCollectionFromDocuments = async (documents = []) => {
  const firestore = getAdminFirestore();
  const existingSnapshot = await firestore.collection(BACKUP_COLLECTION).get();

  const existingIds = existingSnapshot.docs.map((docSnap) => docSnap.id);
  for (let i = 0; i < existingIds.length; i += 400) {
    const batch = firestore.batch();
    existingIds.slice(i, i + 400).forEach((docId) => {
      batch.delete(firestore.collection(BACKUP_COLLECTION).doc(docId));
    });
    await batch.commit();
  }

  for (let i = 0; i < documents.length; i += 400) {
    const batch = firestore.batch();
    documents.slice(i, i + 400).forEach((vendorDoc) => {
      const { id, ...vendorData } = vendorDoc || {};
      if (!id) return;
      batch.set(firestore.collection(BACKUP_COLLECTION).doc(String(id)), vendorData, { merge: false });
    });
    await batch.commit();
  }
};

export const restoreInventoryFromBackupPayload = async (payload) => {
  const backupDocuments = Array.isArray(payload?.documents) ? payload.documents : null;
  if (!backupDocuments) {
    throw new Error('Invalid backup payload: documents array is required.');
  }

  await restoreCollectionFromDocuments(backupDocuments);
  return { restoredDocuments: backupDocuments.length };
};

export const listBackupsFromDrive = async () => {
  const client = getDriveClient();
  if (!client) return [];
  const { drive, driveFolderId } = client;

  const query = `'${driveFolderId}' in parents and mimeType='application/json' and trashed=false`;
  const response = await drive.files.list({
    q: query,
    orderBy: 'createdTime desc',
    pageSize: 5,
    fields: 'files(id,name,createdTime,size)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files || [];
};

export const downloadAndRestoreFromDrive = async (fileId) => {
  if (!fileId) {
    throw new Error('fileId is required.');
  }

  const client = getDriveClient();
  if (!client) throw new Error('Drive client not configured.');
  const { drive } = client;

  const response = await drive.files.get(
    { 
      fileId, 
      alt: 'media',
      supportsAllDrives: true
    },
    { responseType: 'arraybuffer' }
  );

  const raw = Buffer.from(response.data).toString('utf-8');
  const payload = JSON.parse(raw);

  const restoreResult = await restoreInventoryFromBackupPayload(payload);
  return {
    fileId,
    backupId: payload?.backupId || null,
    ...restoreResult,
  };
};

export const initializeSystemCollections = async () => {
  try {
    const firestore = getAdminFirestore();
    await firestore.collection(AUDIT_COLLECTION).doc('__meta').set({
      initializedAt: new Date().toISOString(),
      note: 'Audit log metadata doc',
    }, { merge: true });

    await firestore.collection(BACKUP_HISTORY_COLLECTION).doc('__meta').set({
      initializedAt: new Date().toISOString(),
      note: 'Backup history metadata doc',
    }, { merge: true });

    console.log('✅ System collections initialized.');
  } catch (error) {
    console.error('❌ Failed to initialize system collections:', error.message);
  }
};

export const runBackup = async () => {
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  const fileName = `offline-inventory-backup-${safeTimestamp}.json`;
  
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

    await uploadFileToDrive(localPath, fileName);

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
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  }
};

export const initializeBackupJob = () => {
  cron.schedule('0 2 * * 0', async () => {
    console.log('🎬 Starting scheduled weekly backup...');
    await runBackup();
  }, {
    timezone: 'Africa/Lagos',
  });

  console.log('🕑 Weekly backup cron initialized (Sundays at 2:00 AM Africa/Lagos).');
};
