import { google } from 'googleapis';
import type { JWT, OAuth2Client } from 'google-auth-library';

export type CalendarService = ReturnType<typeof google.calendar>;

function getServiceAccountCreds(): any | undefined {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) return undefined;
  try {
    // handle base64 or raw JSON
    const trimmed = raw.trim();
    if (/^[A-Za-z0-9+/=]+\s*$/.test(trimmed) && trimmed.length % 4 === 0) {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      return JSON.parse(decoded);
    }
    return JSON.parse(trimmed);
  } catch (e) {
    console.warn('Could not parse GOOGLE_SERVICE_ACCOUNT JSON from env var', e);
    return undefined;
  }
}

export async function getAuthClient(): Promise<OAuth2Client | JWT> {
  const creds = getServiceAccountCreds();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return auth.getClient();
}

export async function getCalendarService() {
  const client = await getAuthClient();
  return google.calendar({ version: 'v3', auth: client });
}

export async function getAllConnectedCalendars(calendarService: CalendarService): Promise<string[]> {
  const res = await calendarService.calendarList.list();
  const items = res.data.items || [];
  return items.map(i => i.id!).filter(Boolean);
}

export async function ensureCalendarInList(calendarService: CalendarService, calendarId: string) {
  const res = await calendarService.calendarList.list();
  const items = res.data.items || [];
  const present = items.some(i => i.id === calendarId);
  if (present) return { ok: true, inserted: false };
  const insertRes = await calendarService.calendarList.insert({ requestBody: { id: calendarId } });
  return { ok: true, inserted: true, data: insertRes.data };
}

export async function checkBusyFreebusy(calendarService: CalendarService, calendarIds: string[], timeMinISO: string, timeMaxISO: string, timeZone = 'Europe/Rome') {
  const request = {
    resource: {
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      timeZone,
      items: calendarIds.map(id => ({ id })),
    }
  };
  const res = await calendarService.freebusy.query(request);
  const calendars = (res.data as any).calendars || {};
  const busyMap: Record<string, Array<{ start: string; end: string }>> = {};
  let anyBusy = false;
  for (const [cid, val] of Object.entries(calendars)) {
    const busy = (val as any).busy || [];
    busyMap[cid] = busy.map((b: any) => ({ start: b.start, end: b.end }));
    if (busy.length > 0) anyBusy = true;
  }
  return { anyBusy, busyMap };
}

export async function createEvent(calendarService: CalendarService, calendarId: string, booking: {
  summary: string;
  description?: string;
  startISO: string;
  endISO: string;
  timeZone?: string;
  attendees?: Array<{ email: string }>;
}) {
  const body: any = {
    summary: booking.summary,
    description: booking.description || '',
    start: { dateTime: booking.startISO, timeZone: booking.timeZone || 'Europe/Rome' },
    end: { dateTime: booking.endISO, timeZone: booking.timeZone || 'Europe/Rome' },
  };
  if (booking.attendees && booking.attendees.length) body.attendees = booking.attendees;
  const res = await calendarService.events.insert({
    calendarId,
    requestBody: body,
  });
  return res.data;
}