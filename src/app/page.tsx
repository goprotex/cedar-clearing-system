'use client';

import { useState } from 'react';
import Link from 'next/link';

const LANDING_NAV = [
  { href: '/bids', label: 'ESTIMATOR' },
  { href: '/fleet', label: 'FLEET' },
  { href: '/intel', label: 'INTEL' },
  { href: '/archive', label: 'ARCHIVE' },
  { href: '/map-radar', label: 'RADAR' },
];

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] scan-line">
      {/* TopAppBar */}
      <header className="fixed top-0 w-full z-50 border-b-2 border-[#353534] bg-[#131313] flex justify-between items-center px-4 md:px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-[5px]"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
          >
            <span className={`block w-5 h-[2px] bg-[#FF6B00] transition-all duration-300 ${menuOpen ? 'rotate-45 translate-y-[7px]' : ''}`} />
            <span className={`block w-5 h-[2px] bg-[#FF6B00] transition-all duration-300 ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-[2px] bg-[#FF6B00] transition-all duration-300 ${menuOpen ? '-rotate-45 -translate-y-[7px]' : ''}`} />
          </button>
          <div className="text-xl md:text-2xl font-black text-[#FF6B00] tracking-tighter uppercase">
            CEDAR_HACK
          </div>
        </div>
        <nav className="hidden md:flex gap-8 items-center">
          {LANDING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="uppercase tracking-tight font-bold text-[#e5e2e1] hover:bg-[#FF6B00] hover:text-black transition-colors duration-150 px-2 py-1"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/bids"
          className="bg-[#FF6B00] text-black px-4 md:px-6 py-2 font-bold uppercase tracking-widest hover:bg-white transition-all text-xs md:text-sm"
        >
          LAUNCH
          <span className="hidden sm:inline">_SYSTEM</span>
        </Link>
      </header>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div
        className={`fixed top-[65px] left-0 w-full bg-[#131313] border-b-2 border-[#353534] z-45 md:hidden transition-all duration-300 overflow-hidden ${
          menuOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'
        }`}
        style={{ zIndex: 45 }}
      >
        <nav className="flex flex-col py-2">
          {LANDING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className="uppercase tracking-tight font-bold text-[#e5e2e1] hover:bg-[#FF6B00] hover:text-black transition-colors duration-150 px-6 py-3 text-sm border-b border-[#353534]/50"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/sys-health"
            onClick={() => setMenuOpen(false)}
            className="uppercase tracking-tight font-bold text-[#13ff43] hover:bg-[#FF6B00] hover:text-black transition-colors duration-150 px-6 py-3 text-sm"
          >
            SYS_HEALTH
          </Link>
        </nav>
      </div>

      <main className="pt-20">
        {/* Hero Section */}
        <section className="relative min-h-[80vh] flex items-center justify-start px-4 md:px-20 overflow-hidden border-b-4 border-[#5a4136]">
          <div className="absolute inset-0 z-0 bg-gradient-to-r from-[#131313] via-[#131313]/80 to-transparent" />
          <div className="relative z-10 max-w-4xl border-l-4 border-[#FF6B00] pl-4 md:pl-8 py-12">
            <div className="flex items-center gap-4 mb-6">
              <span className="bg-[#13ff43] text-[#003907] px-3 py-1 text-xs font-black tracking-widest">
                SYSTEM_LIVE
              </span>
              <span className="text-[#ffb693] text-xs font-mono">
                COORD: 30.2672° N, 97.7431° W
              </span>
            </div>
            <h1 className="text-5xl md:text-8xl font-black uppercase tracking-tighter leading-none mb-8 glow-orange">
              The Future of <br />
              <span className="text-[#FF6B00]">Land Clearing</span> <br />
              is Here.
            </h1>
            <p className="text-xl md:text-2xl text-[#a98a7d] max-w-xl mb-10 font-light leading-relaxed">
              AI-driven telemetry and tactical terrain mapping for the modern
              clearing fleet. Scan, analyze, and deploy with industrial
              precision.
            </p>
            <div className="flex flex-wrap gap-4 md:gap-6">
              <Link
                href="/bids"
                className="bg-[#FF6B00] text-black font-black px-6 py-4 md:px-10 md:py-5 text-base md:text-lg uppercase tracking-widest hover:bg-white transition-all"
              >
                Launch Estimator
              </Link>
              <a
                href="#features"
                className="border-2 border-[#5a4136] text-[#ffb693] font-black px-6 py-4 md:px-10 md:py-5 text-base md:text-lg uppercase tracking-widest hover:bg-[#FF6B00] hover:text-black transition-all"
              >
                View the Tech
              </a>
            </div>
          </div>
        </section>

        {/* Social Proof Bar */}
        <section className="bg-[#201f1f] py-6 border-b-2 border-[#5a4136] flex flex-wrap justify-around items-center gap-8 px-10">
          <div className="flex items-center gap-4">
            <span className="text-[#FF6B00] font-black text-4xl">25%</span>
            <span className="text-xs uppercase tracking-widest text-[#a98a7d] font-bold leading-tight">
              Increase in <br />
              Bid Accuracy
            </span>
          </div>
          <div className="w-px h-12 bg-[#5a4136] hidden md:block" />
          <div className="flex items-center gap-4">
            <span className="text-[#13ff43] font-black text-4xl">90%</span>
            <span className="text-xs uppercase tracking-widest text-[#a98a7d] font-bold leading-tight">
              Detection <br />
              Precision
            </span>
          </div>
          <div className="w-px h-12 bg-[#5a4136] hidden md:block" />
          <div className="flex items-center gap-4">
            <span className="text-[#FF6B00] font-black text-4xl">14ms</span>
            <span className="text-xs uppercase tracking-widest text-[#a98a7d] font-bold leading-tight">
              Telemetry <br />
              Latency
            </span>
          </div>
        </section>

        {/* Key Features Section */}
        <section id="features" className="p-6 md:p-20 bg-[#131313]">
          <div className="flex items-end justify-between mb-16">
            <div>
              <h2 className="text-[#ffb693] text-xs font-mono tracking-[0.5em] uppercase mb-4">
                {'// TACTICAL_MODULES'}
              </h2>
              <h3 className="text-4xl md:text-6xl font-black uppercase tracking-tighter">
                Industrial Grid
              </h3>
            </div>
            <div className="hidden md:block h-px flex-1 mx-10 bg-[#5a4136]" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 border-2 border-[#353534]">
            {[
              {
                icon: '🧬',
                title: 'AI Cedar Detection',
                desc: 'Proprietary neural networks provide 90% accuracy in density analysis and biological classification.',
                status: 'READY',
              },
              {
                icon: '🗺️',
                title: 'Tactical Map Engine',
                desc: "Holographic 3D 'God\\'s Eye' view with integrated drawing tools for precision clearing zones.",
                status: 'ACTIVE',
              },
              {
                icon: '🚜',
                title: 'Fleet Telematics',
                desc: 'Real-time machine tracking with auto-progress calculation and fuel consumption metrics.',
                status: 'SYNCED',
              },
              {
                icon: '📊',
                title: 'Data-Driven Bidding',
                desc: 'Leverage historical telemetry to generate bids with surgical precision, minimizing margin error.',
                status: 'READY',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className={`p-6 md:p-8 hover:bg-[#2a2a2a] transition-colors group border-b md:border-b-0 border-[#353534] ${
                  i < 3 ? 'lg:border-r lg:border-[#353534]' : ''
                }`}
              >
                <div className="mb-12">
                  <span className="text-5xl block mb-4 group-hover:scale-110 transition-transform">
                    {feature.icon}
                  </span>
                  <h4 className="text-2xl font-black uppercase mb-4 leading-none">
                    {feature.title}
                  </h4>
                  <p className="text-[#a98a7d] text-sm leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
                <div className="border-t border-[#353534] pt-4 flex justify-between items-center">
                  <span className="text-[10px] text-[#5a4136] font-mono">
                    MOD_ID: 0x{(992 - i * 200).toString(16)}
                  </span>
                  <span className="text-[#13ff43] text-xs font-bold">
                    {feature.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* How It Works Section */}
        <section className="px-6 py-24 md:px-20 border-t-2 border-[#353534]">
          <div className="mb-20 text-center">
            <h3 className="text-[#ffb693] text-xs font-mono tracking-[0.5em] uppercase mb-4">
              PROTOCOL_EXECUTION
            </h3>
            <h2 className="text-5xl md:text-7xl font-black uppercase tracking-tighter">
              How It Works
            </h2>
          </div>
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-12 items-stretch">
            {[
              {
                step: '01',
                title: 'SCAN',
                desc: 'Deploy drone or satellite scans. Our AI instantly converts visual data into a tactical density heatmap of your project site.',
              },
              {
                step: '02',
                title: 'PLAN',
                desc: 'Draw clearing zones on the 3D map. Calculate exact machine hours and fuel requirements based on actual vegetation density.',
              },
              {
                step: '03',
                title: 'CLEAR',
                desc: 'Sync to equipment telematics. Monitor progress in real-time and provide automated reports to clients from the field.',
              },
            ].map((s, i) => (
              <div key={i} className="flex-1 flex items-stretch gap-4">
                <div className="relative border-l-4 border-[#ffb693] p-8 bg-[#353534]/20 flex-1">
                  <span className="absolute -top-6 -left-6 bg-[#FF6B00] text-black font-black text-4xl p-2 w-16 h-16 flex items-center justify-center">
                    {s.step}
                  </span>
                  <h4 className="text-3xl font-black uppercase mb-6 mt-4">
                    {s.title}
                  </h4>
                  <p className="text-[#a98a7d] leading-relaxed">{s.desc}</p>
                </div>
                {i < 2 && (
                  <div className="hidden md:flex items-center justify-center text-[#5a4136] text-4xl">
                    ›
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* CTA Section */}
        <section className="bg-[#FF6B00] p-12 md:p-24 m-6 md:m-20 text-black">
          <div className="max-w-4xl">
            <h2 className="text-5xl md:text-8xl font-black uppercase tracking-tighter leading-none mb-8">
              Ready to <br />
              Secure the Perimeter?
            </h2>
            <p className="text-xl md:text-2xl font-bold uppercase mb-12 tracking-tight opacity-80">
              Stop guessing. Start measuring. Deploy Cedar_Hack today.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/bids"
                className="bg-black text-white px-8 py-4 md:px-12 md:py-6 text-lg md:text-xl font-black uppercase tracking-widest hover:bg-[#353534] transition-all"
              >
                Initialize System
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full border-t-2 border-[#353534] bg-[#131313] flex flex-col md:flex-row justify-between items-center px-10 py-12 gap-8">
        <div className="text-lg font-bold text-[#FF6B00] uppercase tracking-widest">
          CEDAR_HACK_OPS
        </div>
        <div className="flex flex-wrap justify-center gap-8">
          <Link
            href="/bids"
            className="text-xs tracking-widest uppercase text-[#353534] hover:text-[#ffb693] transition-opacity duration-300"
          >
            TERMINAL_ACCESS
          </Link>
          <Link
            href="/fleet"
            className="text-xs tracking-widest uppercase text-[#353534] hover:text-[#ffb693] transition-opacity duration-300"
          >
            FLEET
          </Link>
          <Link
            href="/intel"
            className="text-xs tracking-widest uppercase text-[#353534] hover:text-[#ffb693] transition-opacity duration-300"
          >
            INTEL
          </Link>
          <Link
            href="/sys-health"
            className="text-xs tracking-widest uppercase text-[#13ff43] hover:text-[#ffb693] transition-opacity duration-300"
          >
            SYSTEM_STATUS
          </Link>
        </div>
        <div className="text-xs tracking-widest uppercase text-[#353534]">
          ©2024 CEDAR_HACK_OPERATIONS. ALL RIGHTS RESERVED.
        </div>
      </footer>
    </div>
  );
}
