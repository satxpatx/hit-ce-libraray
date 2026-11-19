import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    return true;
  }
}

export async function signInWithGoogleFirebase() {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;
  const idToken = await user.getIdToken();

  // Sync non-PII profile + isolated PII document if verified
  if (user.emailVerified && user.email) {
    const profilePath = `users/${user.uid}`;
    const privatePath = `users/${user.uid}/private/info`;
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          uid: user.uid,
          fullName: (user.displayName || user.email.split('@')[0]).slice(0, 150),
          role: user.email === 'patrasatyabrata8@gmail.com' ? 'SUPER_ADMIN' : 'STUDENT',
          department: 'Department of Civil Engineering',
          status: 'ACTIVE',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      // Non-blocking if existing profile already has elevated role
      console.warn('Firestore profile sync note:', error);
    }

    try {
      await setDoc(
        doc(db, 'users', user.uid, 'private', 'info'),
        {
          uid: user.uid,
          email: user.email.slice(0, 200),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }
    void profilePath;
  }

  return { user, idToken };
}

export async function signOutFirebase() {
  try {
    await firebaseSignOut(auth);
  } catch {
    // Ignore if not signed into Firebase
  }
}

export async function syncBookToFirestore(book: {
  id: number | string;
  bookCode: string;
  isbn?: string | null;
  title: string;
  author: string;
  publisher?: string | null;
  category: string;
  subject?: string | null;
  publicationYear?: number | null;
  totalCopies: number;
  availableCopies: number;
  archived: boolean;
}) {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  const docId = `book_${book.id}`;
  const path = `books/${docId}`;
  try {
    await setDoc(
      doc(db, 'books', docId),
      {
        bookCode: String(book.bookCode).slice(0, 64),
        ...(book.isbn ? { isbn: String(book.isbn).slice(0, 32) } : {}),
        title: String(book.title).slice(0, 250),
        author: String(book.author).slice(0, 200),
        ...(book.publisher ? { publisher: String(book.publisher).slice(0, 200) } : {}),
        category: String(book.category).slice(0, 120),
        ...(book.subject ? { subject: String(book.subject).slice(0, 120) } : {}),
        ...(book.publicationYear ? { publicationYear: Number(book.publicationYear) } : {}),
        totalCopies: Math.max(0, Number(book.totalCopies || 0)),
        availableCopies: Math.max(0, Number(book.availableCopies || 0)),
        archived: Boolean(book.archived),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
