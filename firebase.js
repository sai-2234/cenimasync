// ============================================================
// SoulSync — Firebase Configuration
// Uses Firebase v10 modular SDK via CDN (see soulsync.html)
// ============================================================

// Import Firebase modules from the CDN (loaded as ES modules)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    onAuthStateChanged,
    signOut,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    addDoc,
    query,
    where,
    orderBy,
    limit,
    startAfter,
    onSnapshot,
    serverTimestamp,
    arrayUnion,
    arrayRemove,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    getStorage,
    ref as storageRef,
    uploadBytesResumable,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ------------------------------------------------------------
// Firebase project configuration
// ------------------------------------------------------------
const firebaseConfig = {
    apiKey: "AIzaSyAevwazFXvJqzwndOSfX84BPgwl3lRzric",
    authDomain: "soulsync-5ef7f.firebaseapp.com",
    databaseURL: "https://soulsync-5ef7f-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "soulsync-5ef7f",
    storageBucket: "soulsync-5ef7f.firebasestorage.app",
    messagingSenderId: "531148363077",
    appId: "1:531148363077:web:742a28c3ce5791849dda2c",
    measurementId: "G-BWRF1QM8YK"
};

// ------------------------------------------------------------
// Initialize Firebase services
// ------------------------------------------------------------
const app = initializeApp(firebaseConfig);

// Analytics is optional and can fail in some environments (e.g., file://)
let analytics = null;
try { analytics = getAnalytics(app); } catch (e) { /* silently ignore */ }

const auth      = getAuth(app);
const db        = getFirestore(app);
const storage   = getStorage(app);

// ------------------------------------------------------------
// Export everything the rest of the app needs
// ------------------------------------------------------------
export {
    app, analytics, auth, db, storage,
    // auth methods
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    onAuthStateChanged,
    signOut,
    updateProfile,
    // firestore methods
    collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
    addDoc, query, where, orderBy, limit, startAfter, onSnapshot,
    serverTimestamp, arrayUnion, arrayRemove, writeBatch,
    // storage methods
    storageRef, uploadBytesResumable, getDownloadURL
};
