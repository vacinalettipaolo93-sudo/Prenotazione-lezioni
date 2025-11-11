

// Questo file deve essere collocato nella cartella 'functions/src' del
// tuo progetto Firebase. Assicurati di aver installato le dipendenze
// necessarie con `npm install`.

import * as functions from "firebase-functions/v1";
import {initializeApp} from "firebase-admin/app";
import {getFirestore, Firestore} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import {google} from "googleapis";
// FIX: Aliased express types to prevent conflicts with firebase-functions types.
import express, {Request as ExpressRequest, Response as ExpressResponse, NextFunction as ExpressNextFunction} from "express";
import cors from "cors";

// ** GESTIONE ROBUSTA DEGLI ERRORI DI INIZIALIZZAZIONE **
let db: Firestore;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let functionsConfig: any;
try {
  initializeApp();
  db = getFirestore();
  // FIX: Cast to any to bypass the incorrect 'never' type inference, which seems to be a type definition issue.
  functionsConfig = (functions as any).config();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} catch (e: any) {
  console.error("ERRORE CRITICO DI INIZIALIZZAZIONE FIREBASE:", e);
}

const app = express();

// ** FIX CORS DEFINITIVO E ROBUSTO **
const corsOptions = {
  origin: "https://gestionale-prenotazioni-lezioni.vercel.app",
  methods: ["POST", "GET", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json());

// ** FUNZIONI HELPER CON GESTIONE ERRORI INTEGRATA **
const getOauth2Client = () => {
  if (!functionsConfig?.googleapi) {
    throw new Error("Config Google API (googleapi) mancante sul server.");
  }
  /* eslint-disable camelcase */
  const {client_id, client_secret, redirect_uri} = functionsConfig.googleapi;

  if (!client_id || !client_secret || !redirect_uri) {
    const msg = "Credenziali Google API (client_id, etc.) mancanti.";
    throw new Error(msg);
  }

  return new google.auth.OAuth2(client_id, client_secret, redirect_uri);
  /* eslint-enable camelcase */
};

const getAdminUid = () => {
  if (!functionsConfig?.admin?.uid) {
    throw new Error("Config Admin UID (admin.uid) mancante sul server.");
  }
  return functionsConfig.admin.uid;
};

// ** MIDDLEWARE DI AUTENTICAZIONE BLINDATO **
const adminAuthMiddleware = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: ExpressNextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      const err = "Unauthorized: Token mancante o malformato.";
      return res.status(403).json({error: {message: err}});
    }
    const adminUid = getAdminUid();
    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await getAuth().verifyIdToken(idToken);
    if (decodedToken.uid !== adminUid) {
      const err = "Permesso negato: l'utente non è un amministratore.";
      return res.status(403).json({error: {message: err}});
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).user = decodedToken;
    return next();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("Errore di autenticazione nel middleware:", error.message);
    return res.status(403).json({
      error: {message: `Non autorizzato: ${error.message}`},
    });
  }
};

// ** WRAPPER PER GLI ENDPOINT **
const handleApiRequest = (
  handler: (req: ExpressRequest, res: ExpressResponse) => Promise<void>
) => {
  return async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      await handler(req, res);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const path = `[${req.path}]`;
      console.error(`ERRORE NON GESTITO NELL'ENDPOINT ${path}:`, error);
      res.status(500).json({
        error: {message: error.message || "Errore interno del server."},
      });
    }
  };
};

// =================================================================================
// DEFINIZIONE DEGLI ENDPOINT
// =================================================================================

app.post(
  "/getAuthURL",
  adminAuthMiddleware,
  handleApiRequest(async (req, res) => {
    const oauth2Client = getOauth2Client();
    const scopes = ["https://www.googleapis.com/auth/calendar"];
    const url = oauth2Client.generateAuthUrl({
      // eslint-disable-next-line camelcase
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
    });
    res.json({data: {url}});
  })
);

app.get("/oauthcallback", handleApiRequest(async (req, res) => {
  const oauth2Client = getOauth2Client();
  const code = req.query.code as string;
  if (!code) throw new Error("Codice autorizzazione non presente.");

  const {tokens} = await oauth2Client.getToken(code);
  // eslint-disable-next-line camelcase
  if (tokens && tokens.refresh_token) {
    const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
    // eslint-disable-next-line camelcase
    await tokenDocRef.set({refresh_token: tokens.refresh_token});
  }
  const htmlResponse = `
    <html><body style="font-family: sans-serif; text-align: center;
    background-color: #1a202c; color: #e2e8f0; display: flex;
    justify-content: center; align-items: center; height: 100vh;">
    <div>
      <h1 style="color: #48bb78;">Autorizzazione completata!</h1>
      <p>Questa finestra si chiuderà a breve.</p>
      <script>setTimeout(() => window.close(), 2000);</script>
    </div>
    </body></html>`;
  res.send(htmlResponse);
}));

app.post(
  "/checkTokenStatus",
  adminAuthMiddleware,
  handleApiRequest(async (req, res) => {
    const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
    const tokenDoc = await tokenDocRef.get();
    const tokens = tokenDoc.data();

    // eslint-disable-next-line camelcase
    if (tokenDoc.exists && tokens?.refresh_token) {
      try {
        const oauth2Client = getOauth2Client();
        // eslint-disable-next-line camelcase
        oauth2Client.setCredentials({refresh_token: tokens.refresh_token});
        const calendar = google.calendar({version: "v3", auth: oauth2Client});
        const cal = await calendar.calendars.get({calendarId: "primary"});
        res.json({data: {isConnected: true, email: cal.data.id}});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        await tokenDocRef.delete();
        res.json({data: {
          isConnected: false,
          email: null,
          error: "Token non valido. Riconnettersi.",
        }});
      }
    } else {
      res.json({data: {isConnected: false, email: null}});
    }
  })
);

app.post(
  "/disconnectGoogleAccount",
  adminAuthMiddleware,
  handleApiRequest(async (req, res) => {
    const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
    const tokenDoc = await tokenDocRef.get();
    if (tokenDoc.exists && tokenDoc.data()?.refresh_token) {
      try {
        const token = tokenDoc.data()?.refresh_token;
        await getOauth2Client().revokeToken(token);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        console.error("Revoca token fallita, elimino dal DB.", e);
      }
    }
    await tokenDocRef.delete();
    res.json({data: {success: true}});
  })
);

app.post(
  "/listGoogleCalendars",
  adminAuthMiddleware,
  handleApiRequest(async (req, res) => {
    const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
    const tokenDoc = await tokenDocRef.get();
    const tokens = tokenDoc.data();
    // eslint-disable-next-line camelcase
    if (!tokenDoc.exists || !tokens?.refresh_token) {
      res.status(404).json({error: {message: "Token non trovato."}});
      return;
    }
    const oauth2Client = getOauth2Client();
    // eslint-disable-next-line camelcase
    oauth2Client.setCredentials({refresh_token: tokens.refresh_token});
    const calendar = google.calendar({version: "v3", auth: oauth2Client});
    const response = await calendar.calendarList.list({});
    const calendarList = response.data.items?.map((cal) => ({
      id: cal.id,
      summary: cal.summary,
      primary: cal.primary,
    })) || [];
    res.json({data: calendarList});
  })
);

// --- ENDPOINT PUBBLICI ---

app.post(
  "/getBusySlotsOnBehalfOfAdmin",
  handleApiRequest(async (req, res) => {
    const {timeMin, timeMax, calendarIds} = req.body.data;
    if (!timeMin || !timeMax || !calendarIds) {
      const err = "timeMin, timeMax e calendarIds obbligatori.";
      res.status(400).json({error: {message: err}});
      return;
    }

    const oauth2Client = getOauth2Client();
    const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
    const tokenDoc = await tokenDocRef.get();
    const tokens = tokenDoc.data();

    // eslint-disable-next-line camelcase
    if (!tokenDoc.exists || !tokens?.refresh_token) {
      res.json({data: []});
      return;
    }

    // eslint-disable-next-line camelcase
    oauth2Client.setCredentials({refresh_token: tokens.refresh_token});
    const calendar = google.calendar({version: "v3", auth: oauth2Client});
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: calendarIds.map((id: string) => ({id})),
      },
    });

    let busyIntervals: { start: string; end: string }[] = [];
    const calendarsData = response.data.calendars;
    if (calendarsData) {
      for (const id in calendarsData) {
        if (Object.prototype.hasOwnProperty.call(calendarsData, id)) {
          const busyPeriods = calendarsData[id].busy;
          if (busyPeriods) {
            const validPeriods = busyPeriods
              .filter((p) => p.start && p.end)
              .map((p) => ({start: p.start as string, end: p.end as string}));
            busyIntervals = busyIntervals.concat(validPeriods);
          }
        }
      }
    }
    res.json({data: busyIntervals});
  })
);

app.post(
  "/createEventOnBehalfOfAdmin",
  handleApiRequest(async (req, res) => {
    const data = req.body.data;
    const oauth2Client = getOauth2Client();
    const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
    const tokenDoc = await tokenDocRef.get();
    const tokens = tokenDoc.data();

    // eslint-disable-next-line camelcase
    if (!tokenDoc.exists || !tokens?.refresh_token) {
      res.json({data: {
        eventCreated: false,
        eventId: null,
        error: "L'account admin non è collegato a Google Calendar.",
      }});
      return;
    }

    // eslint-disable-next-line camelcase
    oauth2Client.setCredentials({refresh_token: tokens.refresh_token});
    const calendar = google.calendar({version: "v3", auth: oauth2Client});
    const event = {
      summary: `Lezione di ${data.sport} - ${data.clientName}`,
      location: data.location,
      description: `
        <b>Dettagli Cliente:</b>
        - Nome: ${data.clientName}
        - Email: ${data.clientEmail}
        - Telefono: ${data.clientPhone}

        <b>Dettagli Lezione:</b>
        - Sport: ${data.sport}
        - Tipo: ${data.lessonType}
        - Durata: ${data.duration} min

        <b>Note:</b>
        <pre>${data.message || "Nessuna nota."}</pre>
      `.replace(/(\r\n|\n|\r)/gm, "").replace(/\s+/g, " ").trim(),
      start: {
        dateTime: data.startTime,
        timeZone: "Europe/Rome",
      },
      end: {
        dateTime: data.endTime,
        timeZone: "Europe/Rome",
      },
      attendees: [{email: data.clientEmail}],
      reminders: {
        useDefault: false,
        overrides: [
          {method: "email", minutes: 24 * 60},
          {method: "popup", minutes: 120},
        ],
      },
    };

    try {
      const response = await calendar.events.insert({
        calendarId: data.targetCalendarId || "primary",
        requestBody: event,
        sendUpdates: "all",
      });
      res.json({data: {
        eventCreated: true,
        eventId: response.data.id,
      }});
    } catch (err) {
      console.error("Errore creazione evento Google:", err);
      res.json({data: {
        eventCreated: false,
        eventId: null,
        error: "Impossibile creare l'evento su Google Calendar.",
      }});
    }
  })
);

// Esporta l'app Express come una singola Cloud Function.
export const api = functions.https.onRequest(app);
