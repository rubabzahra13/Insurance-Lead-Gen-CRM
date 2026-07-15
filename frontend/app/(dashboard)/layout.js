'use client';

import React, { createContext } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, Building2 } from 'lucide-react';
import { WORKSPACE_LABELS } from '../../lib/avatar-labels';
import { BRAND } from '../../lib/brand';
import { IndividualSegmentProvider } from '../../context/IndividualSegmentContext';
import IndividualAudienceTabs from '../../components/IndividualAudienceTabs';

export const SearchContext = createContext(null);

export default function DashboardLayout({ children }) {
  const pathname = usePathname();

  const getPageTitle = () => {
    switch (pathname) {
      case '/':
        return 'Overview';
      case '/recruitment':
        return WORKSPACE_LABELS.individuals.title;
      case '/business':
        return WORKSPACE_LABELS.businesses.title;
      default:
        return 'Dashboard';
    }
  };

  const navItems = [
    { name: 'Dashboard', href: '/', icon: Home, shortName: 'Home' },
    { name: WORKSPACE_LABELS.individuals.nav, href: '/recruitment', icon: Users, shortName: 'Ind. Leads' },
    { name: WORKSPACE_LABELS.businesses.nav, href: '/business', icon: Building2, shortName: 'Bus. Leads' },
  ];

  return (
    <IndividualSegmentProvider>
    <SearchContext.Provider value={null}>
      <div className="app-container">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-icon">{BRAND.logoInitials}</div>
            <span className="logo-text">{BRAND.name}</span>
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

        <div className="main-wrapper">
          <header className="topbar">
            <h1 className="page-title">{getPageTitle()}</h1>
            <IndividualAudienceTabs />
          </header>

          <main className="content-body">
            {children}
          </main>
        </div>

        <nav className="mobile-bottom-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const IconComponent = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`mobile-bottom-nav__link ${isActive ? 'active' : ''}`}
              >
                <IconComponent size={20} />
                <span>{item.shortName}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </SearchContext.Provider>
    </IndividualSegmentProvider>
  );
}
