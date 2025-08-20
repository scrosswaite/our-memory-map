// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAfwrSpBjzGPXcIJ3MLvluCWZBrc2V3XFc",
  authDomain: "memory-map-f53da.firebaseapp.com",
  projectId: "memory-map-f53da",
  storageBucket: "memory-map-f53da.firebasestorage.app",
  messagingSenderId: "145598244276",
  appId: "1:145598244276:web:971c6bba7e2c8dca1ffee1",
  measurementId: "G-TTZM0KFTCZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Firestore and get a reference to the service.
// We export this so we can use it in other components.
export const db = getFirestore(app);
export const storage = getStorage(app);