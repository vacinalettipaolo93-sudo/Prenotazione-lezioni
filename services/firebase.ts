import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FIREBASE_CONFIG, ADMIN_UID } from '../constants';
import { type AppSettings } from '../types';

// Inizializza l'app Firebase solo se le chiavi sono valide
const isConfigValid = FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";

const app = isConfigValid ? initializeApp(FIREBASE_CONFIG) : null;

// Esporta i servizi di autenticazione, database e storage
// Saranno null se la configurazione non è valida
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
export const functions = app ? getFunctions(app, 'us-central1') : null;


// Funzione per il login con email e password
export const loginWithEmail = (email, password) => {
  if (!auth) {
    console.error("Login fallito: Firebase non inizializzato. Controlla le tue API keys in constants.ts");
    return Promise.reject(new Error("Firebase not initialized"));
  }
  return signInWithEmailAndPassword(auth, email, password);
};

// Funzione per il login con Google
export const loginWithGoogle = () => {
  if (!auth) {
    console.error("Login con Google fallito: Firebase non inizializzato.");
    return Promise.reject(new Error("Firebase not initialized"));
  }
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
};

// Funzione per il logout
export const logout = () => {
  if (!auth) {
    console.error("Logout fallito: Firebase non inizializzato.");
    return Promise.reject(new Error("Firebase not initialized"));
  }
  return signOut(auth);
};

// Funzioni per le impostazioni dell'app
const getSettingsDocRef = () => {
    if (!db || !ADMIN_UID) throw new Error("Firebase not initialized or Admin UID is not set");
    return doc(db, 'settings', ADMIN_UID);
}

export const getAppSettings = async (): Promise<AppSettings | null> => {
    if (!db) return null;
    try {
        const docRef = getSettingsDocRef();
        const docSnap = await getDoc(docRef);

        const defaultSettings: AppSettings = {
            welcomeTitle: "Benvenuto su Prenota Pro",
            welcomeMessage: "Seleziona lo sport e prenota la tua lezione.",
            bookingNoticeHours: 12, // Default 12 ore di preavviso
            services: [
                { id: 'tennis', name: 'Tennis', emoji: '🎾' },
                { id: 'padel', name: 'Padel', emoji: '🥎' }
            ],
            locations: [
                { id: 'salo', name: 'Salò' },
                { id: 'manerba', name: 'Manerba' },
            ],
            availability: {
                salo: {
                    dayOverrides: {
                        '1': { enabled: true, startTime: '09:00', endTime: '18:00' }, // Lun
                        '2': { enabled: true, startTime: '09:00', endTime: '18:00' }, // Mar
                        '3': { enabled: true, startTime: '09:00', endTime: '18:00' }, // Mer
                    },
                    slotInterval: 60
                },
                manerba: {
                    dayOverrides: {
                        '4': { enabled: true, startTime: '10:00', endTime: '19:00' }, // Gio
                        '5': { enabled: true, startTime: '10:00', endTime: '19:00' }, // Ven
                    },
                    slotInterval: 60
                }
            },
            sportSettings: {
                tennis: {
                    lessonTypes: [{ id: 't-ind', name: 'Individuale' }, { id: 't-coppia', name: 'Coppia' }],
                    durations: [{ id: 't-60', value: 60 }, { id: 't-90', value: 90 }]
                },
                padel: {
                    lessonTypes: [{ id: 'p-ind', name: 'Individuale' }],
                    durations: [{ id: 'p-60', value: 60 }, { id: 'p-90', value: 90 }]
                }
            }
        };

        if (docSnap.exists()) {
            // Unisci le impostazioni salvate con quelle di default per assicurarti
            // che i nuovi campi siano presenti anche se non salvati nel DB
            return { ...defaultSettings, ...docSnap.data() };
        } else {
            // Se non ci sono impostazioni, crea il documento con quelle di default
            await setDoc(docRef, defaultSettings);
            return defaultSettings;
        }
    } catch (error) {
        console.error("Errore nel recuperare o creare le impostazioni:", error);
        return null;
    }
};

export const updateAppSettings = async (settings: Partial<AppSettings>): Promise<void> => {
    if (!db) throw new Error("Firebase not initialized");
    const docRef = getSettingsDocRef();
    // Usiamo merge: true per aggiornare solo i campi forniti
    await setDoc(docRef, settings, { merge: true });
};

export const uploadProfilePhoto = async (file: File): Promise<string> => {
    if (!storage) throw new Error("Firebase Storage not initialized");
    
    // Genera un nome di file univoco
    const filePath = `profile_photos/${ADMIN_UID}/${file.name}_${Date.now()}`;
    const storageRef = ref(storage, filePath);
    
    // Carica il file
    const snapshot = await uploadBytes(storageRef, file);
    
    // Ottieni l'URL di download
    const downloadURL = await getDownloadURL(snapshot.ref);
    
    return downloadURL;
};
