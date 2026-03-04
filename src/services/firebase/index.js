// Import the functions you need from the SDKs you need
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: 'AIzaSyDGs3DF7lz8_7XcUAdveEceO7mHpFV6-Wc',
  authDomain: 'horleytech-2287c.firebaseapp.com',
  projectId: 'horleytech-2287c',
  storageBucket: 'horleytech-2287c.appspot.com',
  messagingSenderId: '402912233417',
  appId: '1:402912233417:web:ce97f1289209509c188a18',
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
