
import React, { useState, useEffect, useCallback } from 'react';
import { type AppUser, type AppSettings } from '../types';
import Header from './Header';
import Spinner from './Spinner';
import { getAppSettings } from '../services/firebase';
import BookingsList from './BookingsList';
import TabButton from './admin/TabButton';
import BookingSettingsTab from './admin/BookingSettingsTab';
import PersonalizationTab from './admin/PersonalizationTab';
import IntegrationsTab from './admin/IntegrationsTab';
import { type Tab } from './admin/types';

interface AdminDashboardProps {
  user: AppUser;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user }) => {
  const [activeTab, setActiveTab] = useState<Tab>('bookings');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    const appSettings = await getAppSettings();
    setSettings(appSettings);
  }, []);

  useEffect(() => {
    setLoading(true);
    refreshSettings().finally(() => setLoading(false));
  }, [refreshSettings]);

  const renderTabContent = () => {
    if (loading && activeTab !== 'bookings') {
      return <div className="flex justify-center py-10"><Spinner /></div>;
    }
    if (!settings && activeTab !== 'bookings') {
      return <p className="text-center text-red-400">Impossibile caricare.</p>;
    }

    switch (activeTab) {
      case 'bookings':
        return <BookingsList />;
      case 'settings':
        return settings ? <BookingSettingsTab settings={settings} onSettingsChange={refreshSettings} /> : null;
      case 'personalization':
        return settings ? <PersonalizationTab settings={settings} onSettingsChange={refreshSettings} /> : null;
      case 'integrations':
        return settings ? <IntegrationsTab settings={settings} onSettingsChange={refreshSettings} /> : null;
      default:
        return <BookingsList />;
    }
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <Header user={user} appLogoUrl={settings?.profilePhotoUrl} />
      <main className="container mx-auto p-4 md:p-8">
        <div className="mb-8 border-b border-gray-700">
          <nav className="-mb-px flex space-x-6" aria-label="Tabs">
            <TabButton name="Prenotazioni" tab="bookings" activeTab={activeTab} setActiveTab={setActiveTab} />
            <TabButton name="Impostazioni Prenotazioni" tab="settings" activeTab={activeTab} setActiveTab={setActiveTab} />
            <TabButton name="Personalizzazione" tab="personalization" activeTab={activeTab} setActiveTab={setActiveTab} />
            <TabButton name="Integrazioni" tab="integrations" activeTab={activeTab} setActiveTab={setActiveTab} />
          </nav>
        </div>
        <div>{renderTabContent()}</div>
      </main>
    </div>
  );
};

export default AdminDashboard;
