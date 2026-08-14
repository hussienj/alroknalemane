
declare const firebase: any;

const firebaseConfig = {
  apiKey: "AIzaSyCFww0lJEOjXVcv9UXfRMYIr8yIHNOgFgI",
  authDomain: "alrokn-d400d.firebaseapp.com",
  databaseURL: "https://alrokn-d400d-default-rtdb.firebaseio.com",
  projectId: "alrokn-d400d",
  storageBucket: "alrokn-d400d.firebasestorage.app",
  messagingSenderId: "954626822417",
  appId: "1:954626822417:web:c341b1c5cccaa3f1d4fcb0",
  measurementId: "G-YZ8W3GPYSF"
};

// Use a more robust check for global firebase object
const getFirebase = () => {
    if (typeof window !== 'undefined' && (window as any).firebase) {
        return (window as any).firebase;
    }
    if (typeof firebase !== 'undefined') {
        return firebase;
    }
    return null;
};

const fb = getFirebase();

if (!fb) {
    console.error("Firebase library not found. Please check script imports in index.html.");
} else if (!fb.apps.length) {
    fb.initializeApp(firebaseConfig);
}

export const app = fb ? fb.app() : null;
export const db = fb ? fb.database() : { ref: () => ({ on: () => {}, off: () => {}, get: () => Promise.resolve({ exists: () => false, val: () => null }), set: () => Promise.resolve() }) };
export const auth = fb ? fb.auth() : { onAuthStateChanged: (cb: any) => cb(null), signInAnonymously: () => Promise.reject("Firebase not loaded") };
export const storage = fb ? fb.storage() : null;

export { fb as firebase };
