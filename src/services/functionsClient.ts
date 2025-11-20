// Client helper per chiamare le Cloud Functions dal frontend
// Posiziona questo file in: src/services/functionsClient.ts

type BusySlot = { startISO: string; endISO: string };
type GetBusySlotsResponse = { slots: BusySlot[] } | { error?: string; message?: string };
type CreateBookingResponse = { success: boolean; bookingId?: string; calendarEvent?: any; error?: string; message?: string };

const API_BASE = (import.meta as any).env?.VITE_FUNCTIONS_BASE_URL || '';

async function postJSON<T = any>(path: string, body: any, opts: { idToken?: string } = {}): Promise<T> {
  if (!API_BASE) throw new Error('VITE_FUNCTIONS_BASE_URL non configurata');
  const url = `${API_BASE.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const headers: Record<string,string> = { 'Content-Type': 'application/json' };
  if (opts.idToken) headers['Authorization'] = `Bearer ${opts.idToken}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { raw: text }; }

  if (!resp.ok) {
    const msg = json?.message || json?.error || `HTTP ${resp.status}`;
    const err: any = new Error(`Chiamata API a ${path} fallita: ${msg}`);
    err.status = resp.status;
    err.body = json;
    throw err;
  }
  return json as T;
}

/**
 * Recupera gli slot disponibili (o "busy slots" a seconda dell'implementazione)
 * Si aspetta che la funzione restituisca { slots: [{ startISO, endISO }, ...] }
 *
 * @param locationId id della sede (es. "GAVARDO")
 * @param timeMin ISO string (start window)
 * @param timeMax ISO string (end window)
 * @param slotDurationMinutes durata slot (es. 30)
 * @param slotStepMinutes passo per generazione (opzionale)
 */
export async function fetchBusySlotsForWindow(
  locationId: string,
  timeMin: string,
  timeMax: string,
  slotDurationMinutes: number,
  slotStepMinutes?: number
): Promise<BusySlot[]> {
  if (!locationId) throw new Error('locationId richiesto');
  const body = {
    locationId,
    data: { timeMin, timeMax },
    slotDurationMinutes,
    ...(slotStepMinutes ? { slotStepMinutes } : {})
  };

  const res = await postJSON<GetBusySlotsResponse>('getBusySlotsOnBehalfOfAdmin', body);
  if (!res || (res as any).slots === undefined) {
    throw new Error('Risposta API slots non valida');
  }
  return (res as GetBusySlotsResponse).slots;
}

/**
 * Crea una prenotazione.
 * payload minimo atteso:
 * {
 *   locationId: string,
 *   dateISO: string,         // start ISO
 *   durationMinutes: number,
 *   clientName: string,
 *   clientEmail?: string,
 *   ...other optional fields
 * }
 */
export async function createBooking(payload: any): Promise<CreateBookingResponse> {
  if (!payload || !payload.locationId || !payload.dateISO || !payload.clientName) {
    throw new Error('locationId, dateISO e clientName sono richiesti nel payload');
  }
  const res = await postJSON<CreateBookingResponse>('createBooking', payload);
  return res;
}

export default {
  fetchBusySlotsForWindow,
  createBooking,
};
