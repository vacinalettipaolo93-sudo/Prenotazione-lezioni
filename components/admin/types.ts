
import { type AppSettings } from '../../types';

export type Tab = 'bookings' | 'settings' | 'personalization' | 'integrations';

export interface TabProps {
    settings: AppSettings;
    onSettingsChange: () => void;
}
