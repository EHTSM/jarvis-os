"use strict";
import { initializeApp }                                  from "firebase/app";
import { getAuth, createUserWithEmailAndPassword,
         signInWithEmailAndPassword, signOut as fbSignOut,
         sendPasswordResetEmail, updateProfile,
         onAuthStateChanged }                             from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc,
         updateDoc, collection, addDoc,
         getDocs, query, orderBy, limit,
         serverTimestamp }                                from "firebase/firestore";

// ── Firebase config (loaded from .env) ───────────────────────────
const firebaseConfig = {
  apiKey:            process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain:        process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.REACT_APP_FIREBASE_APP_ID
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// ── Auth helpers ──────────────────────────────────────────────────
export async function signUp(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  await setDoc(doc(db, "users", cred.user.uid), {
    email,
    displayName,
    plan:      "free",
    createdAt: serverTimestamp()
  });
  return cred.user;
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signOut() {
  await fbSignOut(auth);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

// ── User profile ──────────────────────────────────────────────────
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function updateUserProfile(uid, data) {
  await updateDoc(doc(db, "users", uid), data);
}

// ── Chat history (per user, last 50 messages) ─────────────────────
export async function saveChatMessage(uid, role, text) {
  await addDoc(collection(db, "users", uid, "messages"), {
    role,
    text,
    ts: serverTimestamp()
  });
}

export async function getChatHistory(uid, count = 30) {
  const q    = query(
    collection(db, "users", uid, "messages"),
    orderBy("ts", "desc"),
    limit(count)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .reverse();
}

// ── Saved tasks ───────────────────────────────────────────────────
export async function saveTask(uid, task) {
  await addDoc(collection(db, "users", uid, "tasks"), {
    ...task,
    createdAt: serverTimestamp()
  });
}

export async function getTasks(uid) {
  const q    = query(
    collection(db, "users", uid, "tasks"),
    orderBy("createdAt", "desc"),
    limit(20)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
