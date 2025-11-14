/**
 * ARCHITETTURA v3: SERVICE ACCOUNT
 * Questo file implementa il backend Express che ora utilizza un Service Account per
 * un'autenticazione server-to-server permanente con Google Calendar.
 * Questa architettura sostituisce il flusso OAuth2, eliminando la necessità
 * per l'amministratore di connettere/disconnettere il proprio account dall'UI.
 */
// FIX: Import from 'firebase-functions/v1' to ensure compatibility with V1 syntax and types, resolving numerous Express and function signature errors caused by a version mismatch.
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import express, {Request as ExpressRequest, Response as ExpressResponse, NextFunction as ExpressNextFunction} from "express";
import cors from "cors";
import {google} from "googleapis";
import {type DecodedIdToken} from "firebase-admin/auth";

// --- INIZIALIZZAZIONE ---
admin.initializeApp();
const db = admin.firestore();
const app = express();


// --- CONFIGURAZIONE ---

const allowedOrigins = [
    "https://gestionale-prenotazioni-lezioni.vercel.app",
    "https://gestionale-prenotazioni-lezio.web.app",
    "https://gestionale-prenotazioni-lezio.firebaseapp.com",
];

const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Origine non permessa da CORS"));
        }
    },
};

app.options("*", cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json());

interface FunctionsConfig {
    googleapi?: {
        service_account_key?: string;
    };
    admin?: {
        uid?: string;
    };
}

const functionsConfig: FunctionsConfig = functions.config() as FunctionsConfig;
const SERVICE_ACCOUNT_KEY_JSON = functionsConfig.googleapi?.service_account_key;
const ADMIN_UID = functionsConfig.admin?.uid;

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
        return res.status(403).send({error: {message: "Unauthorized: Invalid token."}});
    }
};

const checkServerConfig = (
    req: ExpressRequest,
    res: ExpressResponse,
    next: ExpressNextFunction,
) => {
    if (!SERVICE_ACCOUNT_KEY_JSON || !ADMIN_UID) {
        console.error("CRITICAL ERROR: Service Account Key or Admin UID is not set in Firebase config.");
        return res.status(503).json({error: {message: "Il server non è configurato per le richieste a Google."}});
    }
    return next();
};


// --- HELPERS ---
const getGoogleAuthClient = () => {
    if (!SERVICE_ACCOUNT_KEY_JSON) return null;
    try {
        const serviceAccountCredentials = JSON.parse(SERVICE_ACCOUNT_KEY_JSON);
        const jwtClient = new google.auth.JWT(
            serviceAccountCredentials.client_email,
            undefined,
            serviceAccountCredentials.private_key,
            ["https://www.googleapis.com/auth/calendar"],
        );
        return {jwtClient, email: serviceAccountCredentials.client_email};
    } catch (e) {
        console.error("Failed to parse Service Account Key JSON:", e);
        return null;
    }
};


// --- ENDPOINTS ---

app.post(
    "/checkServerSetup",
    authenticateAdmin,
    (req: ExpressRequest, res: ExpressResponse) => {
        const isConfigured = !!(SERVICE_ACCOUNT_KEY_JSON && ADMIN_UID);
        return res.json({data: {isConfigured}});
    },
);

app.post(
    "/getConnectionStatus",
    [authenticateAdmin, checkServerConfig],
    async (req: ExpressRequest, res: ExpressResponse) => {
        const authClient = getGoogleAuthClient();
        if (!authClient) {
            return res.json({data: {isConnected: false, serviceAccountEmail: null, error: "Chiave di servizio non valida."}});
        }

        try {
            const calendar = google.calendar({version: "v3", auth: authClient.jwtClient});
            const calendarList = await calendar.calendarList.list({maxResults: 5}); // Prova a leggere i calendari

            if (!calendarList.data.items || calendarList.data.items.length === 0) {
                 return res.json({data: {
                    isConnected: true, // La connessione funziona, ma non ci sono calendari
                    serviceAccountEmail: authClient.email,
                    error: "Connesso, ma nessun calendario trovato. Assicurati di aver condiviso i tuoi calendari con l'email dell'account di servizio.",
                    calendars: [],
                }});
            }

            return res.json({data: {
                isConnected: true,
                serviceAccountEmail: authClient.email,
                calendars: calendarList.data.items,
            }});
        } catch (error) {
            console.error("Error checking token status by listing calendars:", error);
            return res.json({data: {
                isConnected: false,
                serviceAccountEmail: authClient.email,
                error: "Autenticazione fallita. Controlla i permessi del Service Account e la condivisione dei calendari.",
            }});
        }
    },
);


app.post(
    "/listGoogleCalendars",
    [authenticateAdmin, checkServerConfig],
    async (req: ExpressRequest, res: ExpressResponse) => {
        const authClient = getGoogleAuthClient();
        if (!authClient) {
            return res.status(503).json({error: {message: "Chiave di servizio non valida."}});
        }
        try {
            const calendar = google.calendar({version: "v3", auth: authClient.jwtClient});
            const calendarList = await calendar.calendarList.list();
            return res.json({data: calendarList.data.items});
        } catch (error) {
            console.error("Error listing calendars:", error);
            return res.status(500).json({error: {message: "Could not retrieve calendar list."}});
        }
    },
);

// --- ENDPOINTS PUBBLICI (che agiscono per conto dell'admin) ---

app.post(
    "/getBusySlotsOnBehalfOfAdmin",
    checkServerConfig,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const {timeMin, timeMax, calendarIds} = req.body.data;
        const authClient = getGoogleAuthClient();
        if (!authClient) {
            return res.status(503).json({error: {message: "Server not configured."}});
        }

        try {
            const calendar = google.calendar({version: "v3", auth: authClient.jwtClient});
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
        const authClient = getGoogleAuthClient();
        if (!authClient) {
            return res.status(503).json({error: {message: "Server not configured."}});
        }

        try {
            const calendar = google.calendar({version: "v3", auth: authClient.jwtClient});
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

export const api = functions
    .region("us-central1")
    .runWith({
        memory: "512MB",
        timeoutSeconds: 60,
    })
    .https.onRequest(app);
