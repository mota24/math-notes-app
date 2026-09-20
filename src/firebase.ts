import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCSnqte3h5U224vLL_9jWX1tolKvTphBH0",
  authDomain: "math-notes-pwa.firebaseapp.com",
  projectId: "math-notes-pwa",
  storageBucket: "math-notes-pwa.firebasestorage.app",
  messagingSenderId: "519312910632",
  appId: "1:519312910632:web:a5f4f416820b75d552c81d"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
// Permission pour créer et lire les fichiers PDF/JSON générés par l'application
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');

export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);