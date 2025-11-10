// ATTENZIONE: È FONDAMENTALE sostituire questi valori con le tue credenziali reali.
// L'applicazione non funzionerà correttamente finché non avrai inserito le chiavi API corrette.

// ATTENZIONE: Questo è l'ultimo passo!
// L'UID Firebase del tuo utente amministratore. Per trovarlo:
// 1. Accedi all'app come amministratore con le tue credenziali.
// 2. Vai alla tua console Firebase -> Authentication.
// 3. Troverai il tuo utente (es. vacinaletti93@hotmail.it) con il suo "User UID". Copialo e incollalo qui.
// FIX: Explicitly type ADMIN_UID as a string to fix a comparison type error in BookingCalendar.tsx.
export const ADMIN_UID: string = "QYqqr8fpLdarhvt7JfY8NhUsOq23"; 

// Configurazione di Firebase: trovala nelle impostazioni del tuo progetto Firebase.
// Vai su https://console.firebase.google.com/ -> Seleziona il tuo progetto -> Impostazioni progetto (icona ingranaggio)
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBs_cE6smOR1qvSpoc24kDY4uTRtQclPdQ",
  authDomain: "gestionale-prenotazioni-lezio.firebaseapp.com",
  projectId: "gestionale-prenotazioni-lezio",
  storageBucket: "gestionale-prenotazioni-lezio.appspot.com",
  messagingSenderId: "437487120297",
  appId: "1:437487120297:web:30895af62079b5301a1eb8"
};

// Configurazione API di Google Calendar: crea un progetto su console.cloud.google.com,
// abilita l'API di Google Calendar e crea le credenziali OAuth 2.0.
// Vai su https://console.cloud.google.com/ -> Seleziona il tuo progetto -> API e servizi -> Credenziali
export const GOOGLE_API_CONFIG = {
  // La tua chiave API per accedere alle API pubbliche di Google.
  API_KEY: "AIzaSyBs_cE6smOR1qvSpoc24kDY4uTRtQclPdQ",
  // Il tuo Client ID per l'autenticazione OAuth 2.0.
  CLIENT_ID: "437487120297-nt028l5ddba28bngpcs1nrhleho6k51h.apps.googleusercontent.com",
  // Gli "scope" definiscono le autorizzazioni che la tua app richiede.
  // Qui chiediamo l'accesso completo ai calendari dell'utente.
  SCOPES: "https://www.googleapis.com/auth/calendar"
};