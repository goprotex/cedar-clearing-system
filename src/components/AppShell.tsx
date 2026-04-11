'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

const NAV_ITEMS = [
  { href: '/bids', label: 'ACTIVE_BIDS', icon: '📋' },
  { href: '/clients', label: 'CLIENTS', icon: '📇' },
  { href: '/bids', label: 'ESTIMATOR', icon: '🧮' },
  { href: '/monitor', label: 'SCOUT_MONITOR', icon: '🧭' },
  { href: '/dashboard', label: 'TEAM', icon: '👥' },
  { href: '/operations', label: 'OPERATIONS', icon: '📟' },
  { href: '/schedule', label: 'SCHEDULE', icon: '📅' },
  { href: '/fleet', label: 'FLEET_SYNC', icon: '🔗' },
  { href: '/intel', label: 'INTEL', icon: '📊' },
  { href: '/archive', label: 'ARCHIVE', icon: '📦' },
  { href: '/settings', label: 'SETTINGS', icon: '⚙️' },
];

const HEADER_NAV = [
  { href: '/clients', label: 'CLIENTS' },
  { href: '/bids', label: 'ESTIMATOR' },
  { href: '/monitor', label: 'MONITOR' },
  { href: '/dashboard', label: 'TEAM' },
  { href: '/fleet', label: 'FLEET' },
  { href: '/intel', label: 'INTEL' },
  { href: '/archive', label: 'ARCHIVE' },
  { href: '/operations', label: 'OPS' },
  { href: '/schedule', label: 'SCHEDULE' },
  { href: '/settings', label: 'SETTINGS' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { email: authEmail, loading: authLoading } = useAuth();

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  return (
    <div className="min-h-[100dvh] min-h-screen bg-[#131313] text-[#e5e2e1] scan-line">
      <header className="fixed top-0 left-0 right-0 z-50 border-b-2 border-[#353534] bg-[#131313] flex justify-between items-center min-h-16 py-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]">
        <div className="flex items-center gap-4 md:gap-6">
          <button
            className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-[5px]"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            <span className={`block w-5 h-[2px] bg-[#FF6B00] transition-all duration-300 ${mobileMenuOpen ? 'rotate-45 translate-y-[7px]' : ''}`} />
            <span className={`block w-5 h-[2px] bg-[#FF6B00] transition-all duration-300 ${mobileMenuOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-[2px] bg-[#FF6B00] transition-all duration-300 ${mobileMenuOpen ? '-rotate-45 -translate-y-[7px]' : ''}`} />
          </button>
          <Link href="/" className="text-xl md:text-2xl font-bold text-[#FF6B00] tracking-widest uppercase">
            CEDAR_HACK
          </Link>
          <div className="hidden sm:flex flex-wrap gap-3 md:gap-6 text-xs font-bold items-center">
            {HEADER_NAV.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`uppercase px-1 transition-colors duration-75 ${
                    isActive
                      ? 'text-[#FFB693] border-b-2 border-[#FF6B00]'
                      : 'text-[#E5E2E1] hover:bg-[#FF6B00] hover:text-black'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <span className="text-[10px] text-[#a98a7d] font-mono hidden lg:inline">
            SYS_STATUS: OPERATIONAL
          </span>
          <div className="flex items-center gap-2">
            {authLoading ? (
              <span className="text-[10px] font-mono text-[#5a4136]">…</span>
            ) : authEmail ? (
              <>
                <span className="hidden sm:inline text-[10px] text-[#a98a7d] font-mono truncate max-w-[160px]" title={authEmail}>
                  {authEmail}
                </span>
                <Link
                  href="/logout"
                  className="text-[10px] font-mono border border-[#353534] px-2 py-1.5 text-[#a98a7d] hover:text-white hover:bg-[#353534] whitespace-nowrap"
                >
                  Log out
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                className="text-[10px] font-black uppercase tracking-wider bg-[#FF6B00] text-black px-3 py-1.5 hover:bg-white whitespace-nowrap"
              >
                Sign in
              </Link>
            )}
          </div>
          <Link
            href="/sys-health"
            className={`w-2 h-2 rounded-full ${pathname === '/sys-health' ? 'bg-[#FF6B00]' : 'bg-[#13ff43] animate-pulse'}`}
            title="System Health"
          />
        </div>
      </header>

      {/* Mobile drawer overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile slide-out drawer */}
      <aside
        className={`fixed left-0 top-0 h-full w-[min(100vw-2.5rem,18rem)] max-w-[85vw] border-r-2 border-[#353534] bg-[#131313] flex flex-col pt-[calc(5rem+env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] px-2 z-40 transition-transform duration-300 md:hidden ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 mb-6">
          <div className="text-lg font-black text-[#FF6B00]">SECTOR_OPS</div>
          <div className="text-[10px] text-[#e5e2e1] opacity-50 tracking-widest">ENTITY_REGISTRY</div>
        </div>

        <div className="px-4 mb-3 md:hidden">
          {authLoading ? null : authEmail ? (
            <div className="text-[10px] font-mono text-[#a98a7d] truncate mb-2" title={authEmail}>{authEmail}</div>
          ) : null}
          <Link
            href={authEmail ? '/logout' : '/login'}
            onClick={() => setMobileMenuOpen(false)}
            className={`block text-center text-xs font-black uppercase tracking-widest py-2 border-2 ${
              authEmail ? 'border-[#353534] text-[#a98a7d]' : 'border-[#FF6B00] bg-[#FF6B00] text-black'
            }`}
          >
            {authEmail ? 'Log out' : 'Sign in'}
          </Link>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 p-3 text-xs font-bold uppercase tracking-tight transition-all ${
                  isActive
                    ? 'bg-[#FF6B00] text-black font-black skew-x-1'
                    : 'text-[#E5E2E1] opacity-70 hover:opacity-100 hover:bg-[#353534] hover:text-[#13FF43]'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-4 border-t border-[#353534] px-2 space-y-2">
          <Link
            href="/sys-health"
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center gap-3 p-2 text-[10px] uppercase font-bold transition-all ${
              pathname === '/sys-health'
                ? 'text-[#13FF43]'
                : 'text-[#E5E2E1] opacity-50 hover:opacity-100'
            }`}
          >
            <span>⚙️</span>
            <span>SYS_HEALTH</span>
          </Link>
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 border-r-2 border-[#353534] bg-[#131313] flex-col pt-[calc(5rem+env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-[max(0.5rem,env(safe-area-inset-left,0px))] pr-2 z-40 hidden md:flex">
        <div className="px-4 mb-8">
          <div className="text-lg font-black text-[#FF6B00]">SECTOR_OPS</div>
          <div className="text-[10px] text-[#e5e2e1] opacity-50 tracking-widest">ENTITY_REGISTRY</div>
        </div>

        <nav className="flex-1 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 p-3 text-xs font-bold uppercase tracking-tight transition-all ${
                  isActive
                    ? 'bg-[#FF6B00] text-black font-black skew-x-1'
                    : 'text-[#E5E2E1] opacity-70 hover:opacity-100 hover:bg-[#353534] hover:text-[#13FF43]'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-4 border-t border-[#353534] px-2 space-y-3">
          <div className="px-2">
            {authLoading ? (
              <span className="text-[10px] font-mono text-[#5a4136]">Auth…</span>
            ) : authEmail ? (
              <>
                <div className="text-[9px] font-mono text-[#5a4136] truncate mb-1" title={authEmail}>{authEmail}</div>
                <Link
                  href="/logout"
                  className="block text-center text-[10px] font-black uppercase tracking-widest border border-[#353534] py-2 text-[#a98a7d] hover:text-white hover:bg-[#353534]"
                >
                  Log out
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                className="block text-center text-[10px] font-black uppercase tracking-widest bg-[#FF6B00] text-black py-2 hover:bg-white"
              >
                Sign in
              </Link>
            )}
          </div>
          <Link
            href="/sys-health"
            className={`flex items-center gap-3 p-2 text-[10px] uppercase font-bold transition-all ${
              pathname === '/sys-health'
                ? 'text-[#13FF43]'
                : 'text-[#E5E2E1] opacity-50 hover:opacity-100'
            }`}
          >
            <span>⚙️</span>
            <span>SYS_HEALTH</span>
          </Link>
        </div>
      </aside>

      <main className="w-full min-w-0 max-w-[100vw] md:ml-64 pt-[calc(5rem+env(safe-area-inset-top,0px))] px-4 sm:px-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] min-h-[100dvh] min-h-screen">
        {children}
      </main>
    </div>
  );
}
