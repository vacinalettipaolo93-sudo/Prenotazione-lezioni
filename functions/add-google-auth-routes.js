// Inserisci questo codice nel tuo router Express (functions/index.js o dove dichiari `app`/`router`)
// IMPORTS necessari (adatta se usi ESM/TS)
const { google } = require('googleapis');

// Assumi che tu abbia qualcosa come:
// const express = require('express');
// const app = express();
// const router = express.Router();
// ... e poi export di `app` o `functions.https.onRequest(app)`

// GET /getGoogleAuthUrl
// Restituisce un URL per avviare il flusso OAuth nel browser
router.get('/getGoogleAuthUrl', async (req, res) => {
  try {
    // Leggi credenziali: preferisci functions.config() in produzione
    const cfg = (typeof process !== 'undefined' && process.env.NODE_ENV) ? (process.env) : {};
    // Se usi Firebase functions config:
    // const fcfg = (typeof functions !== 'undefined' && functions.config && functions.config().calendar) ? functions.config().calendar : {};
    const clientId = process.env.CALENDAR_CLIENT_ID || (fcfg && fcfg.client_id) || '';
    const clientSecret = process.env.CALENDAR_CLIENT_SECRET || (fcfg && fcfg.client_secret) || '';
    const redirectUri = process.env.CALENDAR_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob'; // o il tuo redirect

    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'server_misconfigured', message: 'Calendar client_id/client_secret non configurati' });
    }

    const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const url = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
      prompt: 'consent'
    });

    return res.json({ data: { url } });
  } catch (err) {
    console.error('getGoogleAuthUrl error', err);
    return res.status(500).json({ error: 'server_error', message: err.message || String(err) });
  }
});

// POST /checkServerSetup
// Esegue controlli lato server (es. verificare le credenziali del Service Account già caricate)
router.post('/checkServerSetup', async (req, res) => {
  try {
    // Esempio minimo: controlla se le config calnedar.* sono presenti
    const fcfg = (typeof functions !== 'undefined' && functions.config && functions.config().calendar) ? functions.config().calendar : null;
    if (fcfg && fcfg.client_id && (fcfg.refresh_token || fcfg.service_account_key)) {
      return res.json({ ok: true, isConfigured: true });
    }
    // Se usi Service Account JSON in env, verifica la presenza:
    if (process.env.SERVICE_ACCOUNT_JSON || process.env.CALENDAR_CLIENT_ID) {
      return res.json({ ok: true, isConfigured: true });
    }
    return res.json({ ok: true, isConfigured: false });
  } catch (err) {
    console.error('checkServerSetup error', err);
    return res.status(500).json({ error: 'server_error', message: err.message || String(err) });
  }
});
