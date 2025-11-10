// ATTENZIONE: Questi valori DEVONO essere definiti nel tuo file .env.local
// NON INSERIRE MAI LE CHIAVI DI PRODUZIONE DIRETTAMENTE NEL CODICE.

// Crea un file chiamato .env.local nella cartella principale del progetto
// e aggiungi le seguenti righe, sostituendo i valori con le tue credenziali:
//
// VITE_FIREBASE_ADMIN_UID="QYqqr8fpLdarhvt7JfY8NhUsOq23"
// VITE_FIREBASE_API_KEY="AIzaSyBs_cE6smOR1qvSpoc24kDY4uTRtQclPdQ"
// VITE_FIREBASE_AUTH_DOMAIN="gestionale-prenotazioni-lezio.firebaseapp.com"
// VITE_FIREBASE_PROJECT_ID="gestionale-prenotazioni-lezio"
// VITE_FIREBASE_STORAGE_BUCKET="gestionale-prenotazioni-lezio.appspot.com"
// VITE_FIREBASE_MESSAGING_SENDER_ID="437487120297"
// VITE_FIREBASE_APP_ID="1:437487120297:web:30895af62079b5301a1eb8"
// VITE_GOOGLE_API_KEY="AIzaSyBs_cE6smOR1qvSpoc24kDY4uTRtQclPdQ"
// VITE_GOOGLE_CLIENT_ID="437487120297-nt028l5ddba28bngpcs1nrhleho6k51h.apps.googleusercontent.com"
//

// --- AVVISO DI SICUREZZA ---
// Le chiavi che erano presenti in questo file sono state esposte nella cronologia di Git.
// È FONDAMENTALE revocarle e crearne di nuove:
// 1. Vai su Google Cloud Console e rigenera la tua API Key.
// 2. Vai su Firebase Console -> Impostazioni Progetto e rigenera la chiave API web.
// 3. Aggiorna i valori nel tuo file .env.local con le NUOVE credenziali.

// @google/genai-api-fix: Cast `import.meta` to `any` to fix "Property 'env' does not exist on type 'ImportMeta'" error.
export const ADMIN_UID: string = (import.meta as any).env.VITE_FIREBASE_ADMIN_UID || "";

export const FIREBASE_CONFIG = {
  // @google/genai-api-fix: Cast `import.meta` to `any` to fix "Property 'env' does not exist on type 'ImportMeta'" error.
  apiKey: (import.meta as any).env.VITE_FIREBASE_API_KEY,
  // @google/genai-api-fix: Cast `import.meta` to `any` to fix "Property 'env' does not exist on type 'ImportMeta'" error.
  authDomain: (import.meta as any).env.VITE_FIREBASE_AUTH_DOMAIN,
  // @google/genai-api-fix: Cast `import.meta` to `any` to fix "Property 'env' does not exist on type 'ImportMeta'" error.
  projectId: (import.meta as any).env.VITE_FIREBASE_PROJECT_ID,
  // @google/genai-api-fix: Cast `import.meta` to `any` to fix "Property 'env' does not exist on type 'ImportMeta'" error.
  storageBucket: (import.meta as any).env.VITE_FIREBASE_STORAGE_BUCKET,
  // @google/genai-api-fix: Cast `import.meta` to `any` to fix "Property 'env' does not exist on type 'ImportMeta'" error.
  messagingSenderId: (import.meta as any).env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  // @google/genai-api-fix: Cast `import.meta` to `any` to fix "Property 'env' does not exist on type 'ImportMeta'" error.
  appId: (import.meta as any).env.VITE_FIREBASE_APP_ID
};

export const GOOGLE_API_CONFIG = {
  // @google/genai-api-fix: Cast `import.meta` to `any` to fix "Property 'env' does not exist on type 'ImportMeta'" error.
  API_KEY: (import.meta as any).env.VITE_GOOGLE_API_KEY,
  // @google/genai-api-fix: Cast `import.meta` to `any` to fix "Property 'env' does not exist on type 'ImportMeta'" error.
  CLIENT_ID: (import.meta as any).env.VITE_GOOGLE_CLIENT_ID,
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