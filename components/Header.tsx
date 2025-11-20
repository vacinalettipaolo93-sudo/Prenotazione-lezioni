import React from 'react';
import { type AppUser } from '../types';
import { logout } from '../services/firebase';

interface HeaderProps {
  user: AppUser;
  appLogoUrl?: string;
}

const Header: React.FC<HeaderProps> = ({ user, appLogoUrl }) => {
  return (
    <header className="bg-gray-800 border-b border-gray-700 p-4">
      <div className="container mx-auto flex justify-between items-center">
        <div className="flex items-center gap-3">
          {appLogoUrl ? (
            <img src={appLogoUrl} alt="Logo App" className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <span className="text-2xl" role="img" aria-label="tennis ball">🎾</span>
          )}
          <h1 className="text-xl md:text-2xl font-bold text-white">Prenota Pro</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-right">
            <span className="hidden sm:inline font-medium text-gray-300">{user.displayName || user.email}</span>
            {user.photoURL && (
              <img
                src={user.photoURL}
                alt="User Avatar"
                className="w-10 h-10 rounded-full border-2 border-emerald-400"
              />
            )}
          </div>
          <button
            onClick={logout}
            className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
