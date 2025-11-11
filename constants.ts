// ATTENZIONE: Questi valori DEVONO essere definiti nel tuo file .env.local
// NON INSERIRE MAI LE CHIAVI DI PRODUZIONE DIRETTAMENTE NEL CODICE.

// --- VALORI DI ESEMPIO PER L'AMBIENTE DI SVILUPPO ---
// Per far funzionare l'app in questo ambiente, usiamo i valori di esempio
// come fallback. In un progetto reale, questi verrebbero caricati da un file .env.
const EXAMPLE_CONSTANTS = {
  ADMIN_UID: "QYqqr8fpLdarhvt7JfY8NhUsOq23",
  FIREBASE_API_KEY: "AIzaSyBs_cE6smOR1qvSpoc24kDY4uTRtQclPdQ",
  FIREBASE_AUTH_DOMAIN: "gestionale-prenotazioni-lezio.firebaseapp.com",
  FIREBASE_PROJECT_ID: "gestionale-prenotazioni-lezio",
  FIREBASE_STORAGE_BUCKET: "gestionale-prenotazioni-lezio.appspot.com",
  FIREBASE_MESSAGING_SENDER_ID: "437487120297",
  FIREBASE_APP_ID: "1:437487120297:web:30895af62079b5301a1eb8",
  GOOGLE_API_KEY: "AIzaSyBs_cE6smOR1qvSpoc24kDY4uTRtQclPdQ",
  GOOGLE_CLIENT_ID: "437487120297-nt028l5ddba28bngpcs1nrhleho6k51h.apps.googleusercontent.com",
};


// L'app non usa Vite, quindi `import.meta.env` non è disponibile. 
// Usiamo un controllo per accedere in modo sicuro a `process.env` in un ambiente
// non-Node (browser) dove potrebbe non essere definito, prevenendo un crash.
const env = (typeof process !== 'undefined' && process.env) ? process.env : {};

export const ADMIN_UID: string = env.VITE_FIREBASE_ADMIN_UID || EXAMPLE_CONSTANTS.ADMIN_UID;

export const FIREBASE_CONFIG = {
  apiKey: env.VITE_FIREBASE_API_KEY || EXAMPLE_CONSTANTS.FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || EXAMPLE_CONSTANTS.FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || EXAMPLE_CONSTANTS.FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || EXAMPLE_CONSTANTS.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || EXAMPLE_CONSTANTS.FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID || EXAMPLE_CONSTANTS.FIREBASE_APP_ID
};

export const GOOGLE_API_CONFIG = {
  API_KEY: env.VITE_GOOGLE_API_KEY || EXAMPLE_CONSTANTS.GOOGLE_API_KEY,
  CLIENT_ID: env.VITE_GOOGLE_CLIENT_ID || EXAMPLE_CONSTANTS.GOOGLE_CLIENT_ID,
  SCOPES: "https://www.googleapis.com/auth/calendar"
};

// Controllo per avvisare lo sviluppatore se le variabili d'ambiente mancano
if (!ADMIN_UID || !FIREBASE_CONFIG.apiKey || !GOOGLE_API_CONFIG.CLIENT_ID) {
    console.warn(
        "ATTENZIONE: Una o più variabili d'ambiente non sono state trovate. " +
        "Assicurati di aver creato e configurato correttamente il file .env.local " +
        "con tutte le credenziali necessarie."
    );
}