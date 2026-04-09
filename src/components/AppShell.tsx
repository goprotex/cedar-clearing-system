'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/bids', label: 'ACTIVE_BIDS', icon: '📋' },
  { href: '/bids', label: 'ESTIMATOR', icon: '🧮' },
  { href: '/map-radar', label: 'MAP_RADAR', icon: '🛰️' },
  { href: '/fleet', label: 'FLEET_SYNC', icon: '🔗' },
  { href: '/intel', label: 'INTEL', icon: '📊' },
  { href: '/archive', label: 'ARCHIVE', icon: '📦' },
];

const HEADER_NAV = [
  { href: '/bids', label: 'ESTIMATOR' },
  { href: '/fleet', label: 'FLEET' },
  { href: '/intel', label: 'INTEL' },
  { href: '/archive', label: 'ARCHIVE' },
  { href: '/map-radar', label: 'RADAR' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] scan-line">
      <header className="fixed top-0 w-full z-50 border-b-2 border-[#353534] bg-[#131313] flex justify-between items-center h-16 px-4 md:px-6">
        <div className="flex items-center gap-4 md:gap-6">
          <Link href="/" className="text-xl md:text-2xl font-bold text-[#FF6B00] tracking-widest uppercase">
            CEDAR_HACK
          </Link>
          <div className="hidden md:flex gap-6 text-xs font-bold">
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
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-[#a98a7d] font-mono hidden md:inline">
            SYS_STATUS: OPERATIONAL
          </span>
          <Link
            href="/sys-health"
            className={`w-2 h-2 rounded-full ${pathname === '/sys-health' ? 'bg-[#FF6B00]' : 'bg-[#13ff43] animate-pulse'}`}
            title="System Health"
          />
        </div>
      </header>

      <aside className="fixed left-0 top-0 h-full w-64 border-r-2 border-[#353534] bg-[#131313] flex flex-col pt-20 pb-4 px-2 z-40 hidden md:flex">
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

        <div className="mt-auto pt-4 border-t border-[#353534] px-2 space-y-2">
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

      <main className="md:ml-64 pt-20 p-6 min-h-screen">
        {children}
      </main>
    </div>
  );
}
