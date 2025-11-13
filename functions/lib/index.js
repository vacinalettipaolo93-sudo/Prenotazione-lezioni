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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
/**
 * This file serves as the entry point for Firebase Functions.
 * It exports 'api', the new Express server, replacing the previous
 * architecture of multiple individual Cloud Functions.
 *
 * All application logic is now contained within 'functions/src/index.ts'.
 */
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
// FIX: Switched to require-style import for Express to resolve type conflicts
// that were causing compilation errors throughout the file. The Request,
// Response,
// and NextFunction types will now be accessed through the `express` namespace
// (e.g., `express.Request`).
const express = require("express");
const cors_1 = __importDefault(require("cors"));
const googleapis_1 = require("googleapis");
// --- INIZIALIZZAZIONE ---
admin.initializeApp();
const db = admin.firestore();
const app = express();
// --- CONFIGURAZIONE ---
const allowedOrigins = [
    "https://gestionale-prenotazioni-lezioni.vercel.app",
    // Aggiungiamo gli URL di hosting di Firebase per il testing locale/remoto
    `https://${process.env.GCLOUD_PROJECT}.firebaseapp.com`,
    `https://${process.env.GCLOUD_PROJECT}.web.app`,
];
const corsOptions = {
    origin: (origin, callback) => {
        // Permetti richieste senza 'origin' (es. da Postman o test server-side)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error("Not allowed by CORS"));
        }
    },
};
app.use((0, cors_1.default)(corsOptions));
app.use(express.json());
// FIX: Use type assertion for functions.config() due to broken type
// definitions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const functionsConfig = functions.config();
const GOOGLE_CLIENT_ID = functionsConfig.googleapi?.client_id;
const GOOGLE_CLIENT_SECRET = functionsConfig.googleapi?.client_secret;
const GOOGLE_REDIRECT_URI = functionsConfig.googleapi?.redirect_uri;
const ADMIN_UID = functionsConfig.admin?.uid;
const oAuth2Client = GOOGLE_CLIENT_ID ? new googleapis_1.google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI) : null;
// --- MIDDLEWARE ---
const authenticateAdmin = async (req, res, next) => {
    const { authorization } = req.headers;
    if (!authorization || !authorization.startsWith("Bearer ")) {
        const message = "Unauthorized: No token provided.";
        return res.status(401).send({ error: { message } });
    }
    const split = authorization.split("Bearer ");
    if (split.length !== 2) {
        const message = "Unauthorized: Malformed token.";
        return res.status(401).send({ error: { message } });
    }
    const token = split[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        res.locals.user = decodedToken;
        return next();
    }
    catch (err) {
        console.error("Error while verifying Firebase ID token:", err);
        const message = "Unauthorized: Invalid token.";
        return res.status(403).send({ error: { message } });
    }
};
const checkServerConfig = (req, res, next) => {
    if (!oAuth2Client || !ADMIN_UID) {
        console.error("CRITICAL ERROR: Google API config or Admin UID is not set. " +
            "Run `firebase functions:config:set`.");
        const message = "Server is not configured for Google requests.";
        return res.status(503).json({ error: { message } });
    }
    return next();
};
// --- HELPERS ---
const getAdminSettingsRef = (uid) => db.collection("settings").doc(uid);
const setGoogleAuthCredentials = async (adminUid) => {
    if (!oAuth2Client) {
        return false;
    }
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
app.use(checkServerConfig);
app.post("/getAuthURL", authenticateAdmin, (req, res) => {
    // FIX TS7030 & TS2769: Add explicit check to satisfy TypeScript compiler
    if (!oAuth2Client) {
        return res.status(503).json({ error: { message: "Server not configured." } });
    }
    const adminUid = res.locals.user.uid;
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: ["https://www.googleapis.com/auth/calendar"],
        state: adminUid,
    });
    return res.json({ data: { url: authUrl } });
});
app.get("/oauthcallback", async (req, res) => {
    if (!oAuth2Client) {
        const message = "Server not configured.";
        return res.status(503).json({ error: { message } });
    }
    const { code, state } = req.query;
    const adminUid = state;
    if (!code) {
        return res.status(400).send("Error: Missing authorization code.");
    }
    if (!adminUid) {
        return res.status(400).send("Error: Missing admin UID in state.");
    }
    try {
        const { tokens } = await oAuth2Client.getToken(code);
        const { refresh_token: refreshToken, access_token: accessToken, } = tokens;
        if (!refreshToken) {
            throw new Error("Refresh token not received. Please re-authorize.");
        }
        oAuth2Client.setCredentials({ access_token: accessToken });
        const people = googleapis_1.google.people({ version: "v1", auth: oAuth2Client });
        const profile = await people.people.get({
            resourceName: "people/me",
            personFields: "emailAddresses",
        });
        const email = profile.data.emailAddresses?.[0]?.value || null;
        await getAdminSettingsRef(adminUid).set({
            googleRefreshToken: refreshToken,
            googleAccountEmail: email,
        }, { merge: true });
        return res.send("<script>window.close();</script>");
    }
    catch (error) {
        const err = error;
        console.error("Error during OAuth code exchange:", err);
        const msg = `Google authentication error: ${err.message}`;
        return res.status(500).send(msg);
    }
});
app.post("/checkTokenStatus", authenticateAdmin, async (req, res) => {
    try {
        const settingsDoc = await getAdminSettingsRef(res.locals.user.uid).get();
        const settings = settingsDoc.data();
        if (settings?.googleRefreshToken && settings?.googleAccountEmail) {
            return res.json({
                data: { isConnected: true, email: settings.googleAccountEmail },
            });
        }
        else {
            return res.json({ data: { isConnected: false, email: null } });
        }
    }
    catch (error) {
        console.error("Error checking token status:", error);
        const message = "Internal server error.";
        return res.status(500).json({ error: { message } });
    }
});
app.post("/disconnectGoogleAccount", authenticateAdmin, async (req, res) => {
    try {
        await getAdminSettingsRef(res.locals.user.uid).update({
            googleRefreshToken: admin.firestore.FieldValue.delete(),
            googleAccountEmail: admin.firestore.FieldValue.delete(),
        });
        return res.json({ data: { success: true } });
    }
    catch (error) {
        console.error("Error during disconnect:", error);
        const message = "Internal server error.";
        return res.status(500).json({ error: { message } });
    }
});
app.post("/listGoogleCalendars", authenticateAdmin, async (req, res) => {
    // FIX TS2769: Add explicit check to satisfy TypeScript compiler
    if (!oAuth2Client) {
        return res.status(503).json({ error: { message: "Server not configured." } });
    }
    try {
        const hasCreds = await setGoogleAuthCredentials(res.locals.user.uid);
        if (!hasCreds) {
            const message = "Google account not connected.";
            return res.status(400).json({ error: { message } });
        }
        const calendar = googleapis_1.google.calendar({ version: "v3", auth: oAuth2Client });
        const calendarList = await calendar.calendarList.list();
        return res.json({ data: calendarList.data.items });
    }
    catch (error) {
        console.error("Error listing calendars:", error);
        const message = "Could not retrieve calendar list.";
        return res.status(500).json({ error: { message } });
    }
});
// --- ENDPOINTS PUBBLICI ---
app.post("/getBusySlotsOnBehalfOfAdmin", async (req, res) => {
    const { timeMin, timeMax, calendarIds } = req.body.data;
    if (!ADMIN_UID) {
        const message = "Admin UID not configured on server.";
        return res.status(500).json({ error: { message } });
    }
    // FIX TS2769: Add explicit check to satisfy TypeScript compiler
    if (!oAuth2Client) {
        return res.status(503).json({ error: { message: "Server not configured." } });
    }
    try {
        const hasCreds = await setGoogleAuthCredentials(ADMIN_UID);
        if (!hasCreds) {
            const message = "Admin Google account not connected on server.";
            return res.status(503).json({ error: { message } });
        }
        const calendar = googleapis_1.google.calendar({ version: "v3", auth: oAuth2Client });
        const result = await calendar.freebusy.query({
            requestBody: {
                timeMin,
                timeMax,
                timeZone: "Europe/Rome",
                items: calendarIds.map((id) => ({ id })),
            },
        });
        const busyIntervals = [];
        const calendarsData = result.data.calendars || {};
        for (const calId in calendarsData) {
            if (calendarsData[calId].busy) {
                busyIntervals.push(...calendarsData[calId].busy);
            }
        }
        return res.json({ data: busyIntervals });
    }
    catch (error) {
        console.error("Error getting busy slots:", error);
        const message = "Could not retrieve busy slots.";
        return res.status(500).json({ error: { message } });
    }
});
app.post("/createEventOnBehalfOfAdmin", async (req, res) => {
    const { clientName, clientEmail, clientPhone, sport, lessonType, duration, location, startTime, endTime, message, targetCalendarId, } = req.body.data;
    if (!ADMIN_UID) {
        const msg = "Admin UID not configured on server.";
        return res.status(500).json({ error: { message: msg } });
    }
    // FIX TS2769: Add explicit check to satisfy TypeScript compiler
    if (!oAuth2Client) {
        return res.status(503).json({ error: { message: "Server not configured." } });
    }
    try {
        const hasCreds = await setGoogleAuthCredentials(ADMIN_UID);
        if (!hasCreds) {
            const err = "Admin not connected to Google.";
            return res.json({
                data: { eventCreated: false, eventId: null, error: err },
            });
        }
        const calendar = googleapis_1.google.calendar({ version: "v3", auth: oAuth2Client });
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
            start: {
                dateTime: startTime,
                timeZone: "Europe/Rome",
            },
            end: {
                dateTime: endTime,
                timeZone: "Europe/Rome",
            },
            attendees: [{ email: clientEmail }],
            reminders: {
                useDefault: false,
                overrides: [
                    { method: "email", minutes: 24 * 60 },
                    { method: "popup", minutes: 120 },
                ],
            },
        };
        const createdEvent = await calendar.events.insert({
            calendarId: targetCalendarId || "primary",
            requestBody: event,
            sendNotifications: true,
        });
        return res.json({
            data: { eventCreated: true, eventId: createdEvent.data.id },
        });
    }
    catch (error) {
        console.error("Error creating event:", error);
        const msg = "Could not create calendar event.";
        return res.status(500).json({ error: { message: msg } });
    }
});
// FIX: Use type assertion for functions, similar to functions.config().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
exports.api = functions
    .region("us-central1")
    .https.onRequest(app);
//# sourceMappingURL=index.js.map