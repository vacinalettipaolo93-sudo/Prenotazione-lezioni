
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
// FIX: Explicitly import Request, Response, and NextFunction from express
// to ensure correct type resolution and fix property access errors by aliasing them.
import express, { Request as ExpressRequest, Response as ExpressResponse, NextFunction as ExpressNextFunction } from "express";
import cors from "cors";
import { google } from "googleapis";
import { type DecodedIdToken } from "firebase-admin/auth";

// --- INIZIALIZZAZIONE ---
admin.initializeApp();
const db = admin.firestore();
const app = express();

// --- CONFIGURAZIONE ---

// Lista delle origini autorizzate a chiamare questa API
const allowedOrigins = [
  "https://gestionale-prenotazioni-lezioni.vercel.app",
  // Aggiungi qui l'URL del tuo emulatore locale se necessario
  // es: "http://localhost:5173",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};

app.use(cors(corsOptions));
app.use(express.json());

// Recupera le credenziali di Google dalle variabili d'ambiente di Firebase
// Esegui questi comandi per configurarle:
// firebase functions:config:set googleapi.client_id="YOUR_CLIENT_ID"
// firebase functions:config:set googleapi.client_secret="YOUR_CLIENT_SECRET"
// firebase functions:config:set googleapi.redirect_uri="YOUR_REDIRECT_URI"
// firebase functions:config:set admin.uid="YOUR_ADMIN_UID"
const GOOGLE_CLIENT_ID = (functions as any).config().googleapi?.client_id;
const GOOGLE_CLIENT_SECRET = (functions as any).config().googleapi?.client_secret;
const GOOGLE_REDIRECT_URI = (functions as any).config().googleapi?.redirect_uri;
const ADMIN_UID = (functions as any).config().admin?.uid;

const oAuth2Client = GOOGLE_CLIENT_ID ? new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
) : null;

// --- MIDDLEWARE ---

/**
 * Verifica il token ID di Firebase per l'autenticazione dell'admin.
 * @param {express.Request} req L'oggetto richiesta di Express.
 * @param {express.Response} res L'oggetto risposta di Express.
 * @param {express.NextFunction} next La funzione middleware successiva.
 * @return {void | express.Response}
 */
// FIX: Use explicitly imported types from Express for request, response, and next function.
const authenticateAdmin = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: ExpressNextFunction,
) => {
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
    const decodedToken: DecodedIdToken = await admin.auth().verifyIdToken(token);
    res.locals.user = decodedToken;
    return next();
  } catch (err) {
    console.error("Error while verifying Firebase ID token:", err);
    const message = "Unauthorized: Invalid token.";
    return res.status(403).send({ error: { message } });
  }
};

/**
 * Controlla se il server ha la configurazione necessaria per le API di Google.
 * @param {express.Request} req L'oggetto richiesta di Express.
 * @param {express.Response} res L'oggetto risposta di Express.
 * @param {express.NextFunction} next La funzione middleware successiva.
 * @return {void | express.Response}
 */
// FIX: Use explicitly imported types from Express for request, response, and next function.
const checkServerConfig = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: ExpressNextFunction,
) => {
  if (!oAuth2Client || !ADMIN_UID) {
    console.error(
      "ERRORE CRITICO: La configurazione delle API di Google o l'Admin UID " +
      "non sono impostate. Esegui `firebase functions:config:set`.",
    );
    const message = "Il server non è configurato per le richieste a Google.";
    return res.status(503).json({ error: { message } });
  }
  return next();
};


// --- HELPERS ---

/**
 * Recupera il riferimento al documento delle impostazioni dell'admin.
 * @param {string} uid L'UID dell'utente admin.
 * @return {admin.firestore.DocumentReference} Il riferimento al documento.
 */
const getAdminSettingsRef = (uid: string) => db.collection("settings").doc(uid);

/**
 * Imposta le credenziali di Google OAuth2 usando il refresh token salvato.
 * @param {string} adminUid L'UID dell'utente admin.
 * @return {Promise<boolean>} True se le credenziali sono state impostate.
 */
const setGoogleAuthCredentials = async (adminUid: string) => {
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
// Tutti gli endpoint usano il middleware per controllare la configurazione.
app.use(checkServerConfig);

/**
 * [ADMIN] Genera l'URL per il consenso OAuth2 di Google.
 */
app.post(
  "/getAuthURL",
  authenticateAdmin,
  // FIX: Use explicitly imported types from Express for request and response.
  (req: ExpressRequest, res: ExpressResponse) => {
    const adminUid = res.locals.user.uid;
    const authUrl = oAuth2Client!.generateAuthUrl({
      access_type: "offline", // Richiede un refresh_token
      prompt: "consent", // Mostra sempre la schermata di consenso
      scope: ["https://www.googleapis.com/auth/calendar"],
      state: adminUid, // Passa l'UID dell'admin per identificarlo nel callback
    });
    res.json({ data: { url: authUrl } });
  },
);

/**
 * [PUBBLICO] Callback per il flusso OAuth2 di Google.
 */
// FIX: Use explicitly imported types from Express for request and response.
app.get("/oauthcallback", async (req: ExpressRequest, res: ExpressResponse) => {
  const { code, state } = req.query;
  const adminUid = state as string;

  if (!code) {
    return res.status(400).send("Errore: Codice di autorizzazione mancante.");
  }
  if (!adminUid) {
    return res.status(400).send("Errore: UID admin mancante nello stato.");
  }

  try {
    const { tokens } = await oAuth2Client!.getToken(code as string);
    const {
      refresh_token: refreshToken,
      access_token: accessToken,
    } = tokens;

    if (!refreshToken) {
      throw new Error(
        "Refresh token non ricevuto. Riprova il processo di autorizzazione.",
      );
    }

    oAuth2Client!.setCredentials({ access_token: accessToken });
    const people = google.people({ version: "v1", auth: oAuth2Client });
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
  } catch (error) {
    const err = error as Error;
    console.error("Errore durante lo scambio del codice OAuth:", err);
    return res.status(500)
      .send(`Errore di autenticazione con Google: ${err.message}`);
  }
});

/**
 * [ADMIN] Controlla se l'admin ha un refresh_token valido salvato.
 */
app.post(
  "/checkTokenStatus",
  authenticateAdmin,
  // FIX: Use explicitly imported types from Express for request and response.
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const settingsDoc = await getAdminSettingsRef(res.locals.user.uid).get();
      const settings = settingsDoc.data();
      if (settings?.googleRefreshToken && settings?.googleAccountEmail) {
        return res.json({
          data: { isConnected: true, email: settings.googleAccountEmail },
        });
      } else {
        return res.json({ data: { isConnected: false, email: null } });
      }
    } catch (error) {
      console.error("Errore controllo status token:", error);
      return res.status(500).json({ error: { message: "Internal server error." } });
    }
  },
);

/**
 * [ADMIN] Disconnette l'account Google dell'admin.
 */
app.post(
  "/disconnectGoogleAccount",
  authenticateAdmin,
  // FIX: Use explicitly imported types from Express for request and response.
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      await getAdminSettingsRef(res.locals.user.uid).update({
        googleRefreshToken: admin.firestore.FieldValue.delete(),
        googleAccountEmail: admin.firestore.FieldValue.delete(),
      });
      return res.json({ data: { success: true } });
    } catch (error) {
      console.error("Errore durante la disconnessione:", error);
      return res.status(500).json({ error: { message: "Internal server error." } });
    }
  },
);

/**
 * [ADMIN] Elenca i calendari Google dell'admin.
 */
app.post(
  "/listGoogleCalendars",
  authenticateAdmin,
  // FIX: Use explicitly imported types from Express for request and response.
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const hasCredentials = await setGoogleAuthCredentials(res.locals.user.uid);
      if (!hasCredentials) {
        const message = "Account Google non connesso.";
        return res.status(400).json({ error: { message } });
      }
      const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
      const calendarList = await calendar.calendarList.list();
      return res.json({ data: calendarList.data.items });
    } catch (error) {
      console.error("Errore nel listare i calendari:", error);
      const message = "Impossibile recuperare la lista dei calendari.";
      return res.status(500).json({ error: { message } });
    }
  },
);

// --- ENDPOINTS PUBBLICI ---
// Questi endpoint agiscono per conto dell'admin.

/**
 * [PUBBLICO] Recupera gli slot occupati dai calendari dell'admin.
 */
app.post(
  "/getBusySlotsOnBehalfOfAdmin",
  // FIX: Use explicitly imported types from Express for request and response.
  async (req: ExpressRequest, res: ExpressResponse) => {
    const { timeMin, timeMax, calendarIds } = req.body.data;

    if (!ADMIN_UID) {
      const message = "Admin UID non configurato sul server.";
      return res.status(500).json({ error: { message } });
    }

    try {
      const hasCredentials = await setGoogleAuthCredentials(ADMIN_UID);
      if (!hasCredentials) {
        // Se non connesso, restituisce un array vuoto (non è un errore).
        return res.json({ data: [] });
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
        if (Object.prototype.hasOwnProperty.call(calendarsData, calId)) {
          calendarsData[calId].busy?.forEach((interval) => {
            if (interval.start && interval.end) {
              busyIntervals.push({ start: interval.start, end: interval.end });
            }
          });
        }
      }
      return res.json({ data: busyIntervals });
    } catch (error) {
      console.error("Errore nel recuperare gli slot occupati:", error);
      const message = "Impossibile recuperare le disponibilità.";
      return res.status(500).json({ error: { message } });
    }
  },
);

/**
 * [PUBBLICO] Crea un evento nel calendario dell'admin.
 */
app.post(
  "/createEventOnBehalfOfAdmin",
  // FIX: Use explicitly imported types from Express for request and response.
  async (req: ExpressRequest, res: ExpressResponse) => {
    const eventData = req.body.data;
    if (!ADMIN_UID) {
      const message = "Admin UID non configurato sul server.";
      return res.status(500).json({ error: { message } });
    }

    try {
      const hasCredentials = await setGoogleAuthCredentials(ADMIN_UID);
      if (!hasCredentials) {
        const message = "L'account Google dell'admin non è connesso.";
        return res.status(400).json({ error: { message } });
      }

      const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

      const event = {
        summary: `Lezione: ${eventData.sport} - ${eventData.clientName}`,
        location: eventData.location,
        description: "Dettagli Prenotazione:\n\n" +
          `Cliente: ${eventData.clientName}\n` +
          `Email: ${eventData.clientEmail}\n` +
          `Telefono: ${eventData.clientPhone}\n\n` +
          `Tipo Lezione: ${eventData.lessonType}\n` +
          `Durata: ${eventData.duration} min\n` +
          `Note: ${eventData.message || "Nessuna"}`,
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

      return res.json({
        data: { eventCreated: true, eventId: createdEvent.data.id },
      });
    } catch (error) {
      console.error("Errore nella creazione dell'evento:", error);
      const message = "Impossibile creare l'evento sul calendario.";
      return res.status(500).json({ error: { message } });
    }
  },
);


// Esporta l'app Express come una singola Cloud Function.
export const api = functions.https.onRequest(app);
