// Questo file deve essere collocato nella cartella 'functions/src' del
// tuo progetto Firebase. Assicurati di aver installato le dipendenze
// necessarie con `npm install`.

import * as functions from "firebase-functions/v1";
import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import {google} from "googleapis";
// @google/genai-api-fix: Resolve type conflicts by changing the import style and using fully qualified type names for Express.
import express from "express";
import cors from "cors";

initializeApp();
const db = getFirestore();
const app = express();

// FIX: Sostituita la policy CORS restrittiva con una più flessibile per lo sviluppo.
// La nuova configurazione permette dinamicamente all'origine della richiesta in arrivo
// di accedere, risolvendo gli errori CORS riscontrati durante il deploy su ambienti diversi.
app.use(cors({origin: true}));

app.use(express.json());

const getOauth2Client = () => {
  const GOOGLEAPI_CLIENT_ID = process.env.GOOGLEAPI_CLIENT_ID;
  const GOOGLEAPI_CLIENT_SECRET = process.env.GOOGLEAPI_CLIENT_SECRET;
  const GOOGLEAPI_REDIRECT_URI = process.env.GOOGLEAPI_REDIRECT_URI;

  if (
    !GOOGLEAPI_CLIENT_ID ||
    !GOOGLEAPI_CLIENT_SECRET ||
    !GOOGLEAPI_REDIRECT_URI
  ) {
    console.error("Variabili d'ambiente Google API non definite!");
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Configurazione API Google mancante."
    );
  }

  return new google.auth.OAuth2(
    GOOGLEAPI_CLIENT_ID,
    GOOGLEAPI_CLIENT_SECRET,
    GOOGLEAPI_REDIRECT_URI
  );
};

const getAdminUid = () => {
  const ADMIN_UID = process.env.ADMIN_UID;
  if (!ADMIN_UID) {
    console.error("ADMIN_UID non è configurato nelle variabili d'ambiente!");
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Configurazione Admin UID mancante."
    );
  }
  return ADMIN_UID;
};

// @google/genai-api-fix: Use explicit express types to avoid conflicts with Firebase functions types.
const adminAuthMiddleware = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(403).json({error: {message: "Unauthorized"}});
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    if (decodedToken.uid !== getAdminUid()) {
      return res.status(403).json({error: {message: "Permission denied."}});
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).user = decodedToken;
    next();
    return;
  } catch (error) {
    console.error("Errore durante la verifica del token:", error);
    res.status(403).json({error: {message: "Unauthorized"}});
    return;
  }
};

// @google/genai-api-fix: Use explicit express types to avoid conflicts with Firebase functions types.
app.post(
  "/getBusySlotsOnBehalfOfAdmin",
  async (req: express.Request, res: express.Response) => {
    try {
      const {timeMin, timeMax, calendarIds} = req.body.data;
      if (!timeMin || !timeMax || !calendarIds) {
        return res.status(400).json({
          error: {message: "timeMin, timeMax e calendarIds obbligatori."},
        });
      }

      const oauth2Client = getOauth2Client();
      const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
      const tokenDoc = await tokenDocRef.get();
      const tokens = tokenDoc.data();

      if (!tokenDoc.exists || !tokens?.refresh_token) {
        return res.json({data: []});
      }

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
                .map((p) => ({
                  start: p.start as string,
                  end: p.end as string,
                }));
              busyIntervals = busyIntervals.concat(validPeriods);
            }
          }
        }
      }
      return res.json({data: busyIntervals});
    } catch (error) {
      console.error("Errore recupero slot:", error);
      return res.status(500).json({error: {message: "Errore interno."}});
    }
  }
);

// @google/genai-api-fix: Use explicit express types to avoid conflicts with Firebase functions types.
app.post(
  "/createEventOnBehalfOfAdmin",
  async (req: express.Request, res: express.Response) => {
    try {
      const data = req.body.data;
      const oauth2Client = getOauth2Client();
      const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
      const tokenDoc = await tokenDocRef.get();
      const tokens = tokenDoc.data();

      if (!tokenDoc.exists || !tokens?.refresh_token) {
        return res.json({data: {eventCreated: false, eventId: null}});
      }

      oauth2Client.setCredentials({refresh_token: tokens.refresh_token});
      const calendar = google.calendar({version: "v3", auth: oauth2Client});
      const eventDescription =
`Dettagli Prenotazione:
- Cliente: ${data.clientName} - Email: ${data.clientEmail}
- Tel: ${data.clientPhone}
- Sport: ${data.sport} - Tipo: ${data.lessonType}
- Durata: ${data.duration} min
- Sede: ${data.location}
- Note: ${data.message || "N/A"}`.trim();

      const eventResource = {
        summary: `Lezione di ${data.sport} con ${data.clientName}`,
        description: eventDescription,
        start: {dateTime: data.startTime, timeZone: "Europe/Rome"},
        end: {dateTime: data.endTime, timeZone: "Europe/Rome"},
        attendees: [{email: data.clientEmail}],
      };

      const response = await calendar.events.insert({
        calendarId: data.targetCalendarId,
        requestBody: eventResource,
        sendNotifications: true,
      });

      return res.json({data: {eventCreated: true, eventId: response.data.id}});
    } catch (error) {
      console.error("Errore creazione evento:", error);
      return res.status(500).json({
        data: {
          eventCreated: false,
          eventId: null,
          error: "Impossibile creare evento su calendario admin.",
        },
      });
    }
  }
);

// @google/genai-api-fix: Use explicit express types to avoid conflicts with Firebase functions types.
app.post(
  "/getAuthURL",
  adminAuthMiddleware,
  async (req: express.Request, res: express.Response) => {
    const oauth2Client = getOauth2Client();
    const scopes = ["https://www.googleapis.com/auth/calendar"];
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
    });
    return res.json({data: {url}});
  }
);

// @google/genai-api-fix: Use explicit express types to avoid conflicts with Firebase functions types.
app.get("/oauthcallback",
  async (req: express.Request, res: express.Response) => {
    try {
      const oauth2Client = getOauth2Client();
      const code = req.query.code as string;
      if (!code) {
        throw new Error("Codice autorizzazione non presente.");
      }

      const {tokens} = await oauth2Client.getToken(code);
      if (tokens && tokens.refresh_token) {
        const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
        await tokenDocRef.set({
          refresh_token: tokens.refresh_token,
        });
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
    } catch (error) {
      console.error("Errore scambio codice autorizzazione:", error);
      res.status(500).send("Errore autorizzazione. Controlla i log.");
    }
  }
);

// @google/genai-api-fix: Use explicit express types to avoid conflicts with Firebase functions types.
app.post(
  "/checkTokenStatus",
  adminAuthMiddleware,
  async (req: express.Request, res: express.Response) => {
    const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
    const tokenDoc = await tokenDocRef.get();
    const tokens = tokenDoc.data();

    if (tokenDoc.exists && tokens?.refresh_token) {
      try {
        const oauth2Client = getOauth2Client();
        oauth2Client.setCredentials({refresh_token: tokens.refresh_token});
        const calendar = google.calendar({version: "v3", auth: oauth2Client});
        const cal = await calendar.calendars.get({calendarId: "primary"});
        return res.json({data: {isConnected: true, email: cal.data.id}});
      } catch (error) {
        await tokenDocRef.delete();
        return res.json({data: {
          isConnected: false,
          email: null,
          error: "Token non valido. Riconnettersi.",
        }});
      }
    }
    return res.json({data: {isConnected: false, email: null}});
  }
);

// @google/genai-api-fix: Use explicit express types to avoid conflicts with Firebase functions types.
app.post(
  "/disconnectGoogleAccount",
  adminAuthMiddleware,
  async (req: express.Request, res: express.Response) => {
    const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
    const tokenDoc = await tokenDocRef.get();
    if (tokenDoc.exists && tokenDoc.data()?.refresh_token) {
      try {
        const token = tokenDoc.data()?.refresh_token;
        await getOauth2Client().revokeToken(token);
      } catch (e) {
        console.error("Revoca token fallita, elimino dal DB.", e);
      }
    }
    await tokenDocRef.delete();
    return res.json({data: {success: true}});
  }
);

// @google/genai-api-fix: Use explicit express types to avoid conflicts with Firebase functions types.
app.post(
  "/listGoogleCalendars",
  adminAuthMiddleware,
  async (req: express.Request, res: express.Response) => {
    const tokenDocRef = db.collection("admin_tokens").doc(getAdminUid());
    const tokenDoc = await tokenDocRef.get();
    const tokens = tokenDoc.data();
    if (!tokenDoc.exists || !tokens?.refresh_token) {
      return res.status(404).json({error: {message: "Token non trovato."}});
    }
    const oauth2Client = getOauth2Client();
    oauth2Client.setCredentials({refresh_token: tokens.refresh_token});
    const calendar = google.calendar({version: "v3", auth: oauth2Client});
    const response = await calendar.calendarList.list({});
    const calendarList = response.data.items?.map((cal) => ({
      id: cal.id,
      summary: cal.summary,
      primary: cal.primary,
    })) || [];
    return res.json({data: calendarList});
  }
);

export const api = functions.region("us-central1").https.onRequest(app);