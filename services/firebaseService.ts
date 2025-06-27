import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut as firebaseSignOut,
  sendPasswordResetEmail, 
  onAuthStateChanged,
  User as FirebaseUser,
  Auth,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  onSnapshot,
  enableIndexedDbPersistence,
  Firestore
} from 'firebase/firestore';

import { User } from '../types';

type Unsubscribe = () => void;

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyA2GE7bNDH_fDY0a9Sw1Pbc3HCx-0PvxYA",
  authDomain: "eisenhower-matrix-c4095.firebaseapp.com",
  projectId: "eisenhower-matrix-c4095",
  storageBucket: "eisenhower-matrix-c4095.appspot.com",
  messagingSenderId: "927990248986",
  appId: "1:927990248986:web:5561532262547b11cfc3a3",
  measurementId: "G-C1PZJ60GX4"
};

// Initialize Firebase App
let app: FirebaseApp;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApps()[0];
}

// Auth can be initialized synchronously
const auth: Auth = getAuth(app);

// Firestore initialization with persistence is async.
// We'll use a promise to ensure persistence is enabled before any Firestore operation.
let firestorePromise: Promise<Firestore> | null = null;

const getDb = (): Promise<Firestore> => {
    if (firestorePromise) {
        return firestorePromise;
    }

    firestorePromise = new Promise(async (resolve) => {
        const db = getFirestore(app);
        try {
            await enableIndexedDbPersistence(db);
            console.log("Firestore offline persistence has been enabled.");
        } catch (err: any) {
            if (err.code === 'failed-precondition') {
              console.warn("Firestore persistence failed: Multiple tabs open. Offline capabilities will be limited.");
            } else if (err.code === 'unimplemented') {
              console.warn("Firestore persistence is not supported in this browser. Offline capabilities disabled.");
            } else {
              console.error("An error occurred while enabling Firestore persistence:", err);
            }
        }
        resolve(db);
    });

    return firestorePromise;
};


// Auth functions
const signUp = async (email: string, password: string): Promise<FirebaseUser> => {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  return userCredential.user;
};

const signIn = async (email: string, password: string): Promise<FirebaseUser> => {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
};

const signInWithGoogle = async (): Promise<FirebaseUser> => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    return result.user;
};

const signOut = (): Promise<void> => {
  return firebaseSignOut(auth);
};

const resetPassword = (email: string): Promise<void> => {
  return sendPasswordResetEmail(auth, email);
};

const onAuthUserChanged = (callback: (user: User | null) => void): Unsubscribe => {
  return onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      const { uid, email, displayName } = firebaseUser;
      callback({ uid, email, displayName });
    } else {
      callback(null);
    }
  });
};

// Firestore functions
const saveDataToFirestore = async <T,>(userId: string, collectionName: string, data: T): Promise<void> => {
  const db = await getDb();
  const docRef = doc(db, 'users', userId, 'data', collectionName);
  const cleanData = JSON.parse(JSON.stringify(data)); 
  return setDoc(docRef, { content: cleanData });
};

const listenToDocument = <T,>(
  userId: string, 
  collectionName: string, 
  callback: (data: T | null) => void,
  defaultValue: T 
): Unsubscribe => {
  let unsubscribe: Unsubscribe = () => {};
  
  const setupListener = async () => {
    const db = await getDb();
    const docRef = doc(db, 'users', userId, 'data', collectionName);
    unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data().content as T;
        callback(data || defaultValue);
      } else {
        callback(defaultValue);
      }
    }, (error) => {
      console.error(`Error fetching ${collectionName}:`, error);
      callback(defaultValue);
    });
  };

  setupListener();

  // Return a function that can be called to unsubscribe.
  // The actual unsubscribe function from onSnapshot will be called when it becomes available.
  return () => {
    unsubscribe();
  };
};

export {
  signUp,
  signIn,
  signOut,
  resetPassword,
  onAuthUserChanged,
  saveDataToFirestore,
  listenToDocument,
  signInWithGoogle
};