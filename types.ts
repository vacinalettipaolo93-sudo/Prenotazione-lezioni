import { type User as FirebaseUser } from 'firebase/auth';

export type AppUser = FirebaseUser;

export interface Booking {
  id?: string;
  ownerUid: string;
  clientName: string; // Nome e Cognome
  clientEmail: string;
  clientPhone: string; // Nuovo campo
  sport: string; // Precedentemente 'service'
  lessonType: string; // Nuovo campo
  duration: number; // Nuovo campo (in minuti)
  location: string; // Nuovo campo
  startTime: Date;
  endTime: Date;
  message?: string; // Campo opzionale per note aggiuntive
  targetCalendarId?: string; // ID del calendario Google di destinazione
  status?: 'pending' | 'confirmed' | 'cancelled'; // Nuovo campo
  gcalEventId?: string; // Nuovo campo
}

export interface CalendarEvent {
  summary: string;
  // FIX: Add optional description and attendees to align with Google Calendar API Event resource.
  description?: string;
  attendees?: { email: string }[];
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
}

export interface Service {
  id: string;
  name: string;
  emoji: string;
}

export interface GoogleCalendar {
  id: string;
  summary:string;
  primary?: boolean;
}

// Nuove interfacce per le impostazioni delle lezioni
export interface LessonType {
  id: string;
  name: string;
}

export interface DurationOption {
  id: string;
  value: number; // in minuti
}

export interface LocationOption {
  id: string;
  name: string;
}

export interface DayAvailability {
  enabled: boolean;
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
}

export interface AvailabilityRule {
  // Un record dove la chiave è l'indice del giorno (0-6)
  dayOverrides: Record<string, DayAvailability>; 
  slotInterval: number;  // in minuti
}

export interface AppSettings {
  profilePhotoUrl?: string;
  welcomeTitle?: string;
  welcomeMessage?: string;
  services?: Service[];
  selectedCalendarIds?: string[];
  locationCalendarMapping?: Record<string, string>; // Mappa locationId -> calendarId

  // Nuovi campi per la configurazione delle prenotazioni
  locations?: LocationOption[];
  availability?: Record<string, AvailabilityRule>; // La chiave è l'id della sede (LocationOption.id)
  bookingNoticeHours?: number; // Tempo minimo di preavviso in ore

  // Impostazioni specifiche per ogni sport (servizio)
  sportSettings?: Record<string, {
    lessonTypes: LessonType[];
    durations: DurationOption[];
  }>;
}