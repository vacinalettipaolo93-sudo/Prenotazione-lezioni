
import React from 'react';
import { type Tab } from './types';

interface TabButtonProps {
    name: string;
    tab: Tab;
    activeTab: Tab;
    setActiveTab: (tab: Tab) => void;
}

const TabButton: React.FC<TabButtonProps> = ({ name, tab, activeTab, setActiveTab }) => (
    <button
        onClick={() => setActiveTab(tab)}
        className={`${
        activeTab === tab
            ? 'border-emerald-400 text-emerald-400'
            : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'
        } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg transition-colors`}
    >
        {name}
    </button>
);

export default TabButton;
