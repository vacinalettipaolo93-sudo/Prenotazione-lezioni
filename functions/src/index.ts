import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import express = require("express");
import cors = require("cors");
import { google } from "googleapis";
import { type DecodedIdToken } from "firebase-admin/auth";

// --- INIZIALIZZAZIONE ---
admin.initializeApp();
const db = admin.firestore();
const app = express();

// --- CONFIGURAZIONE ---
// Utilizza CORS per permettere le chiamate dal frontend
app.use(cors({ origin: true }));
app.use(express.json());

// Recupera le credenziali di Google dalle variabili d'ambiente di Firebase
// Esegui questi comandi per configurarle:
// firebase functions:config:set google.client_id="YOUR_CLIENT_ID"
// firebase functions:config:set google.client_secret="YOUR_CLIENT_SECRET"
// firebase functions:config:set admin.uid="YOUR_ADMIN_UID"
const GOOGLE_CLIENT_ID = functions.config().google.client_id;
const GOOGLE_CLIENT_SECRET = functions.config().google.client_secret;
const ADMIN_UID = functions.config().admin.uid;


// L'URL di questa funzione deve essere aggiunto come Redirect URI autorizzato
// nella tua console Google Cloud.
// Sarà simile a: https://us-central1-YOUR-PROJECT-ID.cloudfunctions.net/api/oauthcallback
const REDIRECT_URL = `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/api/oauthcallback`;

const oAuth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    REDIRECT_URL
);

// --- MIDDLEWARE DI AUTENTICAZIONE ADMIN ---
const authenticateAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const { authorization } = req.headers;

    if (!authorization || !authorization.startsWith("Bearer ")) {
        return res.status(401).send({ error: { message: "Unauthorized: No token provided." } });
    }

    const split = authorization.split("Bearer ");
    if (split.length !== 2) {
        return res.status(401).send({ error: { message: "Unauthorized: Malformed token." } });
    }

    const token = split[1];
    try {
        const decodedToken: DecodedIdToken = await admin.auth().verifyIdToken(token);
        // Salva le informazioni dell'utente nella richiesta per un uso successivo
        res.locals.user = decodedToken;
        return next();
    } catch (err) {
        console.error("Error while verifying Firebase ID token:", err);
        return res.status(403).send({ error: { message: "Unauthorized: Invalid token." } });
    }
};


// --- HELPERS ---

/**
 * Recupera il documento delle impostazioni dell'admin
 */
const getAdminSettingsRef = (uid: string) => db.collection("settings").doc(uid);

/**
 * Imposta le credenziali di Google OAuth2 per l'utente admin corrente
 */
const setGoogleAuthCredentials = async (adminUid: string) => {
    const settingsDoc = await getAdminSettingsRef(adminUid).get();
    const settings = settingsDoc.data();
    if (settings && settings.googleRefreshToken) {
        oAuth2Client.setCredentials({ refresh_token: settings.googleRefreshToken });
        return true;
    }
    return false;
};

// --- ENDPOINTS ---

/**
 * Genera l'URL per il consenso OAuth2 di Google.
 * L'admin lo userà per collegare il proprio account.
 */
app.post("/getAuthURL", authenticateAdmin, (req, res) => {
    const adminUid = res.locals.user.uid;
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: "offline", // Richiede un refresh_token
        prompt: "consent",      // Mostra sempre la schermata di consenso
        scope: ["https://www.googleapis.com/auth/calendar"],
        // Passiamo l'UID dell'admin per identificarlo nel callback
        state: adminUid,
    });
    res.json({ data: { url: authUrl } });
});


/**
 * Callback di Google OAuth2.
 * Riceve il codice di autorizzazione, lo scambia con i token e salva
 * il refresh_token nel documento delle impostazioni dell'admin.
 */
app.get("/oauthcallback", async (req, res) => {
    const { code, state } = req.query;
    const adminUid = state as string;

    if (!code) {
        return res.status(400).send("Errore: Codice di autorizzazione mancante.");
    }
    if (!adminUid) {
        return res.status(400).send("Errore: UID admin mancante nello stato.");
    }

    try {
        const { tokens } = await oAuth2Client.getToken(code as string);
        const { refresh_token, access_token } = tokens;

        if (!refresh_token) {
            throw new Error("Refresh token non ricevuto da Google. Riprova il processo di autorizzazione.");
        }

        // Recupera l'email dell'utente per visualizzarla nel frontend
        oAuth2Client.setCredentials({ access_token });
        const people = google.people({ version: "v1", auth: oAuth2Client });
        const profile = await people.people.get({
            resourceName: "people/me",
            personFields: "emailAddresses",
        });
        const email = profile.data.emailAddresses?.[0]?.value || null;


        await getAdminSettingsRef(adminUid).set({
            googleRefreshToken: refresh_token,
            googleAccountEmail: email,
        }, { merge: true });

        // Invia una semplice pagina HTML per chiudere il popup
        res.send("<script>window.close();</script>");
    } catch (error: any) {
        console.error("Errore durante lo scambio del codice OAuth:", error);
        res.status(500).send(`Errore di autenticazione con Google: ${error.message}`);
    }
});


/**
 * Controlla se l'admin ha un refresh_token valido salvato.
 */
app.post("/checkTokenStatus", authenticateAdmin, async (req, res) => {
    try {
        const settingsDoc = await getAdminSettingsRef(res.locals.user.uid).get();
        const settings = settingsDoc.data();
        if (settings && settings.googleRefreshToken && settings.googleAccountEmail) {
            res.json({ data: { isConnected: true, email: settings.googleAccountEmail } });
        } else {
            res.json({ data: { isConnected: false, email: null } });
        }
    } catch (error: any) {
        console.error("Errore controllo status token:", error);
        res.status(500).json({ error: { message: "Errore interno del server." } });
    }
});


/**
 * Disconnette l'account Google dell'admin rimuovendo il refresh_token.
 */
app.post("/disconnectGoogleAccount", authenticateAdmin, async (req, res) => {
    try {
        await getAdminSettingsRef(res.locals.user.uid).update({
            googleRefreshToken: admin.firestore.FieldValue.delete(),
            googleAccountEmail: admin.firestore.FieldValue.delete(),
        });
        res.json({ data: { success: true } });
    } catch (error) {
        console.error("Errore durante la disconnessione:", error);
        res.status(500).json({ error: { message: "Errore interno del server." } });
    }
});


/**
 * Elenca i calendari Google dell'admin.
 */
app.post("/listGoogleCalendars", authenticateAdmin, async (req, res) => {
    try {
        const hasCredentials = await setGoogleAuthCredentials(res.locals.user.uid);
        if (!hasCredentials) {
            return res.status(400).json({ error: { message: "Account Google non connesso." } });
        }
        const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
        const calendarList = await calendar.calendarList.list();
        res.json({ data: calendarList.data.items });
    } catch (error) {
        console.error("Errore nel listare i calendari:", error);
        res.status(500).json({ error: { message: "Impossibile recuperare la lista dei calendari." } });
    }
});


// --- ENDPOINTS PUBBLICI ---
// Questi endpoint agiscono per conto dell'admin, quindi devono prima
// caricare le credenziali dell'admin per poter operare.

/**
 * Recupera gli slot occupati (free/busy) dai calendari dell'admin.
 */
app.post("/getBusySlotsOnBehalfOfAdmin", async (req, res) => {
    const { timeMin, timeMax, calendarIds } = req.body.data;
    const adminUid = ADMIN_UID;
    
    if (!adminUid) {
         return res.status(500).json({ error: { message: "Admin UID non configurato nelle funzioni." } });
    }

    try {
        const hasCredentials = await setGoogleAuthCredentials(adminUid);
        if (!hasCredentials) {
            console.warn("Tentativo di getBusySlots senza credenziali Google configurate per l'admin.");
            return res.json({ data: [] }); // Restituisce un array vuoto se non connesso
        }

        const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin,
                timeMax,
                items: calendarIds.map((id: string) => ({ id })),
            },
        });

        const busyIntervals: { start: string, end: string }[] = [];
        const calendarsData = response.data.calendars || {};
        for (const calId in calendarsData) {
            if (calendarsData[calId].busy) {
                calendarsData[calId].busy?.forEach(interval => {
                    if (interval.start && interval.end) {
                        busyIntervals.push({ start: interval.start, end: interval.end });
                    }
                });
            }
        }
        res.json({ data: busyIntervals });

    } catch (error) {
        console.error("Errore nel recuperare gli slot occupati:", error);
        res.status(500).json({ error: { message: "Impossibile recuperare le disponibilità." } });
    }
});


/**
 * Crea un evento nel calendario dell'admin.
 */
app.post("/createEventOnBehalfOfAdmin", async (req, res) => {
    const eventData = req.body.data;
    const adminUid = ADMIN_UID;

    if (!adminUid) {
         return res.status(500).json({ error: { message: "Admin UID non configurato nelle funzioni." } });
    }

    try {
        const hasCredentials = await setGoogleAuthCredentials(adminUid);
        if (!hasCredentials) {
             return res.status(400).json({ error: { message: "Account Google dell'admin non connesso." } });
        }
        
        const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
        
        const event: any = {
            summary: `Lezione: ${eventData.sport} - ${eventData.clientName}`,
            location: eventData.location,
            description: `Dettagli Prenotazione:\n\n` +
                         `Cliente: ${eventData.clientName}\n` +
                         `Email: ${eventData.clientEmail}\n` +
                         `Telefono: ${eventData.clientPhone}\n\n` +
                         `Tipo Lezione: ${eventData.lessonType}\n` +
                         `Durata: ${eventData.duration} min\n` +
                         `Note: ${eventData.message || 'Nessuna'}`,
            start: { dateTime: eventData.startTime, timeZone: "Europe/Rome" },
            end: { dateTime: eventData.endTime, timeZone: "Europe/Rome" },
            attendees: [{ email: eventData.clientEmail }],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: "email", minutes: 24 * 60 },
                    { method: "popup", minutes: 60 },
                ],
            },
        };

        const createdEvent = await calendar.events.insert({
            calendarId: eventData.targetCalendarId || "primary",
            requestBody: event,
            sendUpdates: "all",
        });

        res.json({ data: { eventCreated: true, eventId: createdEvent.data.id } });

    } catch (error) {
        console.error("Errore nella creazione dell'evento:", error);
        res.status(500).json({ error: { message: "Impossibile creare l'evento sul calendario." } });
    }
});


// Esporta l'app Express come una singola Cloud Function.
export const api = functions.https.onRequest(app);
