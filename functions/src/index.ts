/**
 * This file serves as the entry point for Firebase Functions.
 * It exports 'api', the new Express server, replacing the previous
 * architecture of multiple individual Cloud Functions.
 *
 * All application logic is now contained within 'functions/src/index.ts'.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
// FIX: Use standard ES6 module imports for Express and CORS. The `import = require()` syntax
// was causing type resolution issues and is not compatible when targeting ECMAScript modules.
// FIX: Explicitly import Request, Response, and NextFunction types from express to resolve type inference issues.
// FIX: Aliased Request, Response, and NextFunction types to avoid potential conflicts with global types (e.g., from the DOM library).
import express, {Request as ExpressRequest, Response as ExpressResponse, NextFunction as ExpressNextFunction} from "express";
import cors from "cors";
import {google} from "googleapis";
import {type DecodedIdToken} from "firebase-admin/auth";

// --- INIZIALIZZAZIONE ---
admin.initializeApp();
const db = admin.firestore();
const app = express();


// --- CONFIGURAZIONE ---

// Whitelist of allowed origins for CORS
const allowedOrigins = [
    // The production frontend URL from the user's error logs.
    "https://gestionale-prenotazioni-lezioni.vercel.app",
    // It's also good practice to add Firebase Hosting URLs if used for preview/deployment.
    "https://gestionale-prenotazioni-lezio.web.app",
    "https://gestionale-prenotazioni-lezio.firebaseapp.com",
];

// FIX: Sostituita la configurazione CORS flessibile `cors({ origin: true })` con una whitelist
// di origini più restrittiva e robusta per l'ambiente di produzione.
// Sebbene `origin: true` sia utile per lo sviluppo, può essere inaffidabile in alcuni
// ambienti cloud. Una whitelist esplicita garantisce che solo il frontend autorizzato
// possa comunicare con l'API, risolvendo gli errori di preflight CORS riscontrati.
const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Permetti le richieste senza 'origin' (es. Postman, app mobile) e quelle dalla whitelist.
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`CORS: Richiesta bloccata dall'origine: ${origin}`);
            callback(new Error("Origine non permessa da CORS"));
        }
    },
};

// FIX: Aggiunto un gestore esplicito per le richieste di preflight OPTIONS.
// Questo garantisce che il browser riceva sempre le corrette intestazioni CORS
// in risposta ai suoi controlli di sicurezza, terminando la richiesta con
// successo (204 No Content) prima che possa essere gestita in modo errato da
// altri middleware. È una soluzione definitiva per risolvere il problema CORS.
app.options("*", cors(corsOptions));

// Applica il middleware CORS con la nuova configurazione per tutte le altre richieste.
app.use(cors(corsOptions));
app.use(express.json());

interface FunctionsConfig {
    googleapi?: {
        client_id?: string;
        client_secret?: string;
        redirect_uri?: string;
    };
    admin?: {
        uid?: string;
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const functionsConfig: FunctionsConfig = (functions as any).config();
const GOOGLE_CLIENT_ID = functionsConfig.googleapi?.client_id;
const GOOGLE_CLIENT_SECRET = functionsConfig.googleapi?.client_secret;
const GOOGLE_REDIRECT_URI = functionsConfig.googleapi?.redirect_uri; // Corretto da client_uri
const ADMIN_UID = functionsConfig.admin?.uid;

const oAuth2Client = GOOGLE_CLIENT_ID ? new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
) : null;

// --- MIDDLEWARE ---

const authenticateAdmin = async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: ExpressNextFunction,
) => {
    const {authorization} = req.headers;
    if (!authorization || !authorization.startsWith("Bearer ")) {
        return res.status(401).send({error: {message: "Unauthorized: No token provided."}});
    }

    const token = authorization.split("Bearer ")[1];
    if (!token) {
        return res.status(401).send({error: {message: "Unauthorized: Malformed token."}});
    }

    try {
        const decodedToken: DecodedIdToken = await admin.auth().verifyIdToken(token);
        res.locals.user = decodedToken;
        return next();
    } catch (err) {
        console.error("Error while verifying Firebase ID token:", err);
        return res.status(403).send({error: {message: "Unauthorized: Invalid token."}});
    }
};

const checkServerConfig = (
    req: ExpressRequest,
    res: ExpressResponse,
    next: ExpressNextFunction,
) => {
    // FIX: Consenti alle richieste di preflight OPTIONS di passare senza eseguire i controlli di configurazione.
    // Il middleware CORS gestirà queste richieste e invierà le intestazioni appropriate.
    // Questo impedisce che il controllo di preflight venga bloccato, che era la causa principale dell'errore CORS.
    if (req.method === "OPTIONS") {
        return next();
    }

    if (!oAuth2Client || !ADMIN_UID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
        console.error(
            "CRITICAL ERROR: Google API config or Admin UID is not set. " +
            "Run `firebase functions:config:set`.",
        );
        return res.status(503).json({error: {message: "Il server non è configurato per le richieste a Google."}});
    }
    return next();
};


// --- HELPERS ---
const getAdminSettingsRef = (uid: string) => db.collection("settings").doc(uid);

const setGoogleAuthCredentials = async (adminUid: string) => {
    if (!oAuth2Client) return false;
    const settingsDoc = await getAdminSettingsRef(adminUid).get();
    const settings = settingsDoc.data();
    if (settings && settings.googleRefreshToken) {
        oAuth2Client.setCredentials({
            refresh_token: settings.googleRefreshToken,
        });
        return true;
    }
    return false;
};

// --- ENDPOINTS ---

app.post(
    "/checkServerSetup",
    authenticateAdmin,
    (req: ExpressRequest, res: ExpressResponse) => {
        const isConfigured = !!(oAuth2Client && ADMIN_UID && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
        return res.json({data: {isConfigured}});
    },
);

app.post(
    "/getAuthURL",
    [authenticateAdmin, checkServerConfig],
    (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const user = res.locals.user as DecodedIdToken;
            functions.logger.info("Request received for /getAuthURL", {uid: user.uid});

            if (!oAuth2Client) {
                // Questo check è ridondante a causa del middleware ma è una sicurezza in più
                return res.status(503).json({error: {message: "Il server non è configurato correttamente per le API Google."}});
            }

            const adminUid = user.uid;
            const authUrl = oAuth2Client.generateAuthUrl({
                access_type: "offline",
                prompt: "consent",
                scope: ["https://www.googleapis.com/auth/calendar"],
                state: adminUid,
            });

            functions.logger.info("Google Auth URL generated successfully.", {uid: adminUid});
            return res.json({data: {url: authUrl}});
        } catch (error) {
            const err = error as Error;
            functions.logger.error("An unexpected error occurred in /getAuthURL", {
                errorMessage: err.message,
                errorStack: err.stack,
            });
            return res.status(500).json({error: {message: `Errore interno del server: ${err.message}`}});
        }
    },
);


app.get(
    "/oauthcallback",
    checkServerConfig,
    async (req: ExpressRequest, res: ExpressResponse) => {
        if (!oAuth2Client) {
            return res.status(503).json({error: {message: "Server not configured."}});
        }
        const {code, state} = req.query;
        const adminUid = state as string;

        if (!code) return res.status(400).send("Error: Missing authorization code.");
        if (!adminUid) return res.status(400).send("Error: Missing admin UID in state.");

        try {
            const {tokens} = await oAuth2Client.getToken(code as string);
            const {refresh_token: refreshToken, access_token: accessToken} = tokens;

            if (!refreshToken) {
                throw new Error("Refresh token not received. Please re-authorize.");
            }

            oAuth2Client.setCredentials({access_token: accessToken});
            const people = google.people({version: "v1", auth: oAuth2Client});
            const profile = await people.people.get({
                resourceName: "people/me",
                personFields: "emailAddresses",
            });
            const email = profile.data.emailAddresses?.[0]?.value || null;

            await getAdminSettingsRef(adminUid).set({
                googleRefreshToken: refreshToken,
                googleAccountEmail: email,
            }, {merge: true});

            return res.send("<script>window.close();</script>");
        } catch (error) {
            const err = error as Error;
            console.error("Error during OAuth code exchange:", err);
            return res.status(500).send(`Google authentication error: ${err.message}`);
        }
    });

app.post(
    "/checkTokenStatus",
    authenticateAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const user = res.locals.user as DecodedIdToken;
            const settingsDoc = await getAdminSettingsRef(user.uid).get();
            const settings = settingsDoc.data();
            if (settings?.googleRefreshToken && settings?.googleAccountEmail) {
                return res.json({data: {isConnected: true, email: settings.googleAccountEmail}});
            } else {
                return res.json({data: {isConnected: false, email: null}});
            }
        } catch (error) {
            console.error("Error checking token status:", error);
            return res.status(500).json({error: {message: "Internal server error."}});
        }
    },
);

app.post(
    "/disconnectGoogleAccount",
    authenticateAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const user = res.locals.user as DecodedIdToken;
            await getAdminSettingsRef(user.uid).update({
                googleRefreshToken: admin.firestore.FieldValue.delete(),
                googleAccountEmail: admin.firestore.FieldValue.delete(),
            });
            return res.json({data: {success: true}});
        } catch (error) {
            console.error("Error during disconnect:", error);
            return res.status(500).json({error: {message: "Internal server error."}});
        }
    },
);

app.post(
    "/listGoogleCalendars",
    [authenticateAdmin, checkServerConfig],
    async (req: ExpressRequest, res: ExpressResponse) => {
        if (!oAuth2Client) {
            return res.status(503).json({error: {message: "Server not configured."}});
        }
        try {
            const user = res.locals.user as DecodedIdToken;
            const hasCreds = await setGoogleAuthCredentials(user.uid);
            if (!hasCreds) {
                return res.status(400).json({error: {message: "Google account not connected."}});
            }
            const calendar = google.calendar({version: "v3", auth: oAuth2Client});
            const calendarList = await calendar.calendarList.list();
            return res.json({data: calendarList.data.items});
        } catch (error) {
            console.error("Error listing calendars:", error);
            return res.status(500).json({error: {message: "Could not retrieve calendar list."}});
        }
    },
);

// --- ENDPOINTS PUBBLICI ---

app.post(
    "/getBusySlotsOnBehalfOfAdmin",
    checkServerConfig,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const {timeMin, timeMax, calendarIds} = req.body.data;

        if (!ADMIN_UID || !oAuth2Client) {
            return res.status(503).json({error: {message: "Server not configured."}});
        }

        try {
            const hasCreds = await setGoogleAuthCredentials(ADMIN_UID);
            if (!hasCreds) {
                return res.status(503).json({error: {message: "Admin Google account not connected on server."}});
            }
            const calendar = google.calendar({version: "v3", auth: oAuth2Client});
            const result = await calendar.freebusy.query({
                requestBody: {
                    timeMin,
                    timeMax,
                    timeZone: "Europe/Rome",
                    items: calendarIds.map((id: string) => ({id})),
                },
            });

            const busyIntervals: { start?: string | null; end?: string | null }[] = [];
            const calendarsData = result.data.calendars || {};
            for (const calId in calendarsData) {
                if (calendarsData[calId].busy) {
                    busyIntervals.push(...(calendarsData[calId].busy ?? []));
                }
            }
            return res.json({data: busyIntervals});
        } catch (error) {
            console.error("Error getting busy slots:", error);
            return res.status(500).json({error: {message: "Could not retrieve busy slots."}});
        }
    },
);

app.post(
    "/createEventOnBehalfOfAdmin",
    checkServerConfig,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const {
            clientName, clientEmail, clientPhone, sport, lessonType,
            duration, location, startTime, endTime, message, targetCalendarId,
        } = req.body.data;

        if (!ADMIN_UID || !oAuth2Client) {
            return res.status(503).json({error: {message: "Server not configured."}});
        }

        try {
            const hasCreds = await setGoogleAuthCredentials(ADMIN_UID);
            if (!hasCreds) {
                return res.json({data: {eventCreated: false, eventId: null, error: "Admin not connected to Google."}});
            }

            const calendar = google.calendar({version: "v3", auth: oAuth2Client});
            const description = `
                Prenotazione per: ${clientName}
                Telefono: ${clientPhone}
                Email: ${clientEmail}
                ---
                Dettagli Lezione:
                Sport: ${sport}
                Tipo: ${lessonType}
                Durata: ${duration} min
                Sede: ${location}
                ---
                Note:
                ${message || "Nessuna"}
            `.trim().split("\n").map((line) => line.trim()).join("\n");

            const event = {
                summary: `Lezione ${sport} - ${clientName}`,
                location,
                description,
                start: {dateTime: startTime, timeZone: "Europe/Rome"},
                end: {dateTime: endTime, timeZone: "Europe/Rome"},
                attendees: [{email: clientEmail}],
                reminders: {
                    useDefault: false,
                    overrides: [
                        {method: "email", minutes: 24 * 60},
                        {method: "popup", minutes: 120},
                    ],
                },
            };

            const createdEvent = await calendar.events.insert({
                calendarId: targetCalendarId || "primary",
                requestBody: event,
                sendNotifications: true,
            });

            return res.json({data: {eventCreated: true, eventId: createdEvent.data.id}});
        } catch (error) {
            console.error("Error creating event:", error);
            return res.status(500).json({error: {message: "Could not create calendar event."}});
        }
    },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api = (functions as any)
    .region("us-central1")
    .runWith({
        // Aumenta la memoria per gestire meglio le API di Google
        memory: "512MB", 
        // Aumenta il timeout per le chiamate API più lente
        timeoutSeconds: 60,
    })
    .https.onRequest(app);
