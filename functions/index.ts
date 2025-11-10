"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEventOnBehalfOfAdmin = exports.listGoogleCalendars = exports.disconnectGoogleAccount = exports.checkTokenStatus = exports.getBusySlotsOnBehalfOfAdmin = exports.oauthcallback = exports.getAuthURL = void 0;
// Questo file deve essere collocato nella cartella 'functions/src' del
// tuo progetto Firebase. Assicurati di aver installato le dipendenze
// necessarie con `npm install`.
const functions = __importStar(require("firebase-functions/v1"));
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const googleapis_1 = require("googleapis");
const cors_1 = __importDefault(require("cors"));
const corsHandler = (0, cors_1.default)({ origin: true });
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
// Helper to get config and initialize the OAuth2 client at RUNTIME.
const getOauth2Client = () => {
    const GOOGLEAPI_CLIENT_ID = process.env.GOOGLEAPI_CLIENT_ID;
    const GOOGLEAPI_CLIENT_SECRET = process.env.GOOGLEAPI_CLIENT_SECRET;
    const GOOGLEAPI_REDIRECT_URI = process.env.GOOGLEAPI_REDIRECT_URI;
    if (!GOOGLEAPI_CLIENT_ID ||
        !GOOGLEAPI_CLIENT_SECRET ||
        !GOOGLEAPI_REDIRECT_URI) {
        console.error("Variabili d'ambiente Google API non definite!");
        throw new functions.https.HttpsError("failed-precondition", "Configurazione API Google mancante. Assicurati di aver creato e " +
            "configurato il file .env appropriato nella cartella /functions.");
    }
    return new googleapis_1.google.auth.OAuth2(GOOGLEAPI_CLIENT_ID, GOOGLEAPI_CLIENT_SECRET, GOOGLEAPI_REDIRECT_URI);
};
// Helper to safely get the Admin UID at RUNTIME.
const getAdminUid = () => {
    const ADMIN_UID = process.env.ADMIN_UID;
    if (!ADMIN_UID) {
        console.error("ADMIN_UID non è configurato nelle variabili d'ambiente!");
        throw new functions.https.HttpsError("failed-precondition", "Configurazione Admin UID mancante. Assicurati di aver creato e " +
            "configurato il file .env appropriato nella cartella /functions.");
    }
    return ADMIN_UID;
};
/**
 * 1. Avvia il flusso di autorizzazione OAuth2 per l'admin.
 */
exports.getAuthURL = functions.region("us-central1").https.onCall(async (data, context) => {
    try {
        const ADMIN_UID = getAdminUid();
        if (context.auth?.uid !== ADMIN_UID) {
            throw new functions.https.HttpsError("permission-denied", "Solo l'amministratore può eseguire questa operazione.");
        }
        const oauth2Client = getOauth2Client();
        const scopes = ["https://www.googleapis.com/auth/calendar"];
        const url = oauth2Client.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            scope: scopes,
        });
        return { url };
    }
    catch (error) {
        console.error("FATAL ERROR in getAuthURL. Probabile configurazione mancante.", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", "Errore in getAuthURL. Controlla i log della funzione.");
    }
});
/**
 * 2. Funzione di callback che Google chiama dopo il consenso dell'admin.
 */
exports.oauthcallback = functions.region("us-central1").https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        try {
            const ADMIN_UID = getAdminUid();
            const oauth2Client = getOauth2Client();
            const code = req.query.code;
            if (!code) {
                throw new Error("Codice di autorizzazione non presente.");
            }
            const { tokens } = await oauth2Client.getToken(code);
            if (tokens && tokens.refresh_token) {
                const adminDocRef = db.collection("admin_tokens").doc(ADMIN_UID);
                await adminDocRef.set({
                    refresh_token: tokens.refresh_token,
                });
            }
            const htmlResponse = `
          <html>
            <body style="font-family: sans-serif; display: flex;
                         justify-content: center; align-items: center;
                         height: 100vh; background-color: #1a202c;
                         color: #e2e8f0;">
              <div style="text-align: center;">
                <h1 style="color: #48bb78;">Autorizzazione completata!</h1>
                <p>Questa finestra si chiuderà tra poco.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </div>
            </body>
          </html>`;
            res.send(htmlResponse);
        }
        catch (error) {
            console.error("Errore scambio codice autorizzazione:", error);
            res.status(500)
                .send("Errore autorizzazione. Controlla i log.");
        }
    });
});
exports.getBusySlotsOnBehalfOfAdmin = functions
    .region("us-central1")
    .https.onCall(async (data) => {
    try {
        const { timeMin, timeMax, calendarIds } = data;
        if (!timeMin || !timeMax || !calendarIds) {
            throw new functions.https.HttpsError("invalid-argument", "timeMin, timeMax e calendarIds sono obbligatori.");
        }
        const ADMIN_UID = getAdminUid();
        const oauth2Client = getOauth2Client();
        const tokenDoc = await db.collection("admin_tokens")
            .doc(ADMIN_UID).get();
        const tokens = tokenDoc.data();
        if (!tokenDoc.exists || !tokens?.refresh_token) {
            return [];
        }
        oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
        const calendar = googleapis_1.google.calendar({ version: "v3", auth: oauth2Client });
        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin,
                timeMax,
                items: calendarIds.map((id) => ({ id })),
            },
        });
        let busyIntervals = [];
        const calendarsData = response.data.calendars;
        if (calendarsData) {
            for (const id in calendarsData) {
                if (Object.prototype.hasOwnProperty.call(calendarsData, id)) {
                    const busyPeriods = calendarsData[id].busy;
                    if (busyPeriods) {
                        const validPeriods = busyPeriods
                            .filter((p) => p.start && p.end)
                            .map((p) => ({
                            start: p.start,
                            end: p.end,
                        }));
                        busyIntervals = busyIntervals.concat(validPeriods);
                    }
                }
            }
        }
        return busyIntervals;
    }
    catch (error) {
        console.error("Errore recupero slot calendario:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        const err = error;
        if (err.response?.status === 401) {
            throw new functions.https.HttpsError("unauthenticated", "Token non valido. Riconnettersi dalla dashboard.");
        }
        throw new functions.https.HttpsError("internal", "Impossibile recuperare disponibilità. Controlla i log.");
    }
});
/**
 * 4. Controlla se il token dell'admin esiste ed è valido.
 */
exports.checkTokenStatus = functions.region("us-central1").https.onCall(async (data, context) => {
    try {
        const ADMIN_UID = getAdminUid();
        if (context.auth?.uid !== ADMIN_UID) {
            throw new functions.https.HttpsError("permission-denied", "Accesso non autorizzato.");
        }
        const tokenDoc = await db.collection("admin_tokens")
            .doc(ADMIN_UID).get();
        const tokens = tokenDoc.data();
        const isConnected = tokenDoc.exists && !!tokens?.refresh_token;
        if (isConnected) {
            try {
                const oauth2Client = getOauth2Client();
                oauth2Client.setCredentials({
                    refresh_token: tokens.refresh_token,
                });
                const calendar = googleapis_1.google.calendar({
                    version: "v3",
                    auth: oauth2Client,
                });
                const primaryCalendar = await calendar.calendars.get({
                    calendarId: "primary",
                });
                return { isConnected: true, email: primaryCalendar.data.id };
            }
            catch (error) {
                console.error("Token non valido, eliminazione in corso:", error);
                await db.collection("admin_tokens").doc(ADMIN_UID).delete();
                return {
                    isConnected: false,
                    email: null,
                    error: "Token non valido o revocato. Riconnettersi.",
                };
            }
        }
        return { isConnected: false, email: null };
    }
    catch (error) {
        console.error("FATAL in checkTokenStatus. Configurazione mancante.", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", "Errore in checkTokenStatus. Controlla i log.");
    }
});
/**
 * 5. Disconnette l'account Google dell'admin.
 */
exports.disconnectGoogleAccount = functions.region("us-central1")
    .https.onCall(async (data, context) => {
    try {
        const ADMIN_UID = getAdminUid();
        if (context.auth?.uid !== ADMIN_UID) {
            throw new functions.https.HttpsError("permission-denied", "Accesso non autorizzato.");
        }
        const tokenDoc = await db.collection("admin_tokens")
            .doc(ADMIN_UID).get();
        const tokens = tokenDoc.data();
        if (tokenDoc.exists && tokens?.refresh_token) {
            try {
                const oauth2Client = getOauth2Client();
                await oauth2Client.revokeToken(tokens.refresh_token);
            }
            catch (e) {
                console.error("Revoca token fallita, elimino dal DB.", e);
            }
        }
        await db.collection("admin_tokens").doc(ADMIN_UID).delete();
        return { success: true };
    }
    catch (error) {
        console.error("FATAL in disconnectGoogleAccount. Configurazione mancante.", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", "Errore in disconnectGoogleAccount. Controlla i log.");
    }
});
/**
 * 6. Recupera la lista dei calendari Google dell'admin.
 */
exports.listGoogleCalendars = functions.region("us-central1").https.onCall(async (data, context) => {
    try {
        const ADMIN_UID = getAdminUid();
        if (context.auth?.uid !== ADMIN_UID) {
            throw new functions.https.HttpsError("permission-denied", "Accesso non autorizzato.");
        }
        const oauth2Client = getOauth2Client();
        const tokenDoc = await db.collection("admin_tokens")
            .doc(ADMIN_UID).get();
        const tokens = tokenDoc.data();
        if (!tokenDoc.exists || !tokens?.refresh_token) {
            throw new functions.https.HttpsError("not-found", "Token admin non trovato. Riconnettersi.");
        }
        oauth2Client.setCredentials({
            refresh_token: tokens.refresh_token,
        });
        const calendar = googleapis_1.google.calendar({ version: "v3", auth: oauth2Client });
        const response = await calendar.calendarList.list({});
        return response.data.items?.map((cal) => ({
            id: cal.id,
            summary: cal.summary,
            primary: cal.primary,
        })) || [];
    }
    catch (error) {
        console.error("Errore nel listare i calendari:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", "Impossibile recuperare la lista dei calendari.");
    }
});
exports.createEventOnBehalfOfAdmin = functions.region("us-central1")
    .https.onCall(async (data) => {
    try {
        const ADMIN_UID = getAdminUid();
        const oauth2Client = getOauth2Client();
        const tokenDoc = await db.collection("admin_tokens")
            .doc(ADMIN_UID).get();
        const tokens = tokenDoc.data();
        if (!tokenDoc.exists || !tokens?.refresh_token) {
            console.log("Admin non connesso. Salto creazione evento GCal.");
            return { eventCreated: false, eventId: null };
        }
        oauth2Client.setCredentials({
            refresh_token: tokens.refresh_token,
        });
        const calendar = googleapis_1.google.calendar({ version: "v3", auth: oauth2Client });
        const eventDescription = `
Dettagli Prenotazione:
- Cliente: ${data.clientName}
- Email: ${data.clientEmail}
- Telefono: ${data.clientPhone}
- Sport: ${data.sport}
- Tipo Lezione: ${data.lessonType}
- Durata: ${data.duration} minuti
- Sede: ${data.location}

Note aggiuntive:
${data.message || "Nessuna nota fornita."}
      `.trim();
        const eventResource = {
            summary: `Lezione di ${data.sport} con ${data.clientName}`,
            description: eventDescription,
            start: { dateTime: data.startTime, timeZone: "Europe/Rome" },
            end: { dateTime: data.endTime, timeZone: "Europe/Rome" },
            attendees: [{ email: data.clientEmail }],
        };
        const response = await calendar.events.insert({
            calendarId: data.targetCalendarId,
            requestBody: eventResource,
            sendNotifications: true,
        });
        return { eventCreated: true, eventId: response.data.id };
    }
    catch (error) {
        console.error("Errore creazione evento GCal:", error);
        // Non rilanciare l'errore, ma restituiscilo nel payload
        // per salvare comunque la prenotazione su Firebase.
        return {
            eventCreated: false,
            eventId: null,
            error: "Impossibile creare evento su calendario admin.",
        };
    }
});
