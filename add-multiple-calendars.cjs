// add-multiple-calendars.cjs
// Usage: node add-multiple-calendars.cjs calendars.txt

const fs = require('fs');
const { google } = require('googleapis');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node add-multiple-calendars.cjs <calendars.txt>');
    process.exit(1);
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const creds = require('./service-account.json'); // assicurati che esista
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const client = await auth.getClient();
  const calendar = google.calendar({ version: 'v3', auth: client });

  for (const calId of lines) {
    try {
      process.stdout.write(`Adding ${calId} ... `);
      const res = await calendar.calendarList.insert({ requestBody: { id: calId }});
      console.log('OK:', res.data.id || res.data.summary || '(no id returned)');
    } catch (err) {
      if (err && err.response && err.response.data) {
        console.error('ERROR:', JSON.stringify(err.response.data));
      } else {
        console.error('ERROR:', err && err.message ? err.message : err);
      }
    }
  }
  console.log('Done.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});