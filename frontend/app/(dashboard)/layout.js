'use client';

import React, { useState, useEffect, createContext, useContext } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, Building2 } from 'lucide-react';

// Create Search State Context
export const SearchContext = createContext();

export default function DashboardLayout({ children }) {
  const pathname = usePathname();
  const [apiStatus, setApiStatus] = useState('checking'); // 'checking' | 'connected' | 'disconnected'

  // Lifted Home Page Search & Sourcing States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState('idle'); // 'idle' | 'classifying' | 'sourcing' | 'syncing' | 'completed' | 'failed'
  const [classification, setClassification] = useState(null); // { avatar_type, confidence, reasoning, query }
  const [scrapingStep, setScrapingStep] = useState('');
  const [scrapingLogs, setScrapingLogs] = useState([]);
  const [scrapedLeads, setScrapedLeads] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Map pathways to page titles
  const getPageTitle = () => {
    switch (pathname) {
      case '/':
        return 'Home Dashboard';
      case '/recruitment':
        return 'Recruitment Workspace';
      case '/business':
        return 'Business Prospecting';
      default:
        return 'Dashboard';
    }
  };

  useEffect(() => {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
    
    const checkApiHealth = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/health`, {
          signal: AbortSignal.timeout(3000), // timeout after 3 seconds
        });
        if (res.ok) {
          setApiStatus('connected');
        } else {
          setApiStatus('disconnected');
        }
      } catch (err) {
        setApiStatus('disconnected');
      }
    };

    checkApiHealth();
    // Check health every 15 seconds
    const interval = setInterval(checkApiHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { name: 'Home', href: '/', icon: Home },
    { name: 'Recruitment', href: '/recruitment', icon: Users },
    { name: 'Business Prospecting', href: '/business', icon: Building2 },
  ];

  return (
    <SearchContext.Provider value={{
      searchQuery, setSearchQuery,
      searchState, setSearchState,
      classification, setClassification,
      scrapingStep, setScrapingStep,
      scrapingLogs, setScrapingLogs,
      scrapedLeads, setScrapedLeads,
      errorMessage, setErrorMessage,
      elapsedSeconds, setElapsedSeconds
    }}>
      <div className="app-container">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-icon">LS</div>
            <span className="logo-text">Lead Scout</span>
          </div>
          
          <ul className="sidebar-menu">
            {navItems.map((item) => {
              const IconComponent = item.icon;
              const isActive = pathname === item.href;
              
              return (
                <li key={item.href}>
                  <Link 
                    href={item.href}
                    className={`menu-item-link ${isActive ? 'active' : ''}`}
                  >
                    <span className="menu-item-icon">
                      <IconComponent size={20} />
                    </span>
                    <span className="menu-item-text">{item.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Main Wrapper */}
        <div className="main-wrapper">
          {/* Topbar */}
          <header className="topbar">
            <h1 className="page-title">{getPageTitle()}</h1>
            
            <div className="topbar-actions">
              {apiStatus === 'connected' && (
                <span className="api-badge">
                  <span className="api-dot"></span>
                  API Connected
                </span>
              )}
              {apiStatus === 'disconnected' && (
                <span className="api-badge disconnected">
                  <span className="api-dot"></span>
                  API Disconnected
                </span>
              )}
              {apiStatus === 'checking' && (
                <span className="api-badge" style={{ opacity: 0.6 }}>
                  Checking API...
                </span>
              )}
            </div>
          </header>

          {/* Content Body */}
          <main className="content-body">
            {children}
          </main>
        </div>
      </div>
    </SearchContext.Provider>
  );
}
