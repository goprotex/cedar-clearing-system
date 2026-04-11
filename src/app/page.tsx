'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { motion, useReducedMotion } from 'motion/react';
import SiteLogo from '@/components/SiteLogo';
import { HeroBackdrop } from '@/components/landing/HeroBackdrop';
import { Reveal, Stagger, StaggerItem } from '@/components/landing/Reveal';

const LANDING_NAV = [
  { href: '/bids', label: 'ESTIMATOR' },
  { href: '/fleet', label: 'FLEET' },
  { href: '/intel', label: 'INTEL' },
  { href: '/archive', label: 'ARCHIVE' },
  { href: '/operations', label: 'OPS' },
];

const easeOut = [0.22, 1, 0.36, 1] as const;

const FEATURES = [
  {
    icon: '🧬',
    title: 'AI Cedar Detection',
    desc: 'Proprietary neural networks provide 90% accuracy in density analysis and biological classification.',
    status: 'READY',
  },
  {
    icon: '🗺️',
    title: 'Tactical Map Engine',
    desc: "Holographic 3D God's Eye view with integrated drawing tools for precision clearing zones.",
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
] as const;

const STEPS = [
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
] as const;

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { email: authEmail, loading: authLoading } = useAuth();
  const reduce = useReducedMotion();

  return (
    <div className="min-h-screen max-w-[100vw] overflow-x-hidden bg-[#131313] text-[#e5e2e1] scan-line">
      <motion.header
        className="fixed top-0 left-0 right-0 z-50 max-w-[100vw] min-w-0 border-b-2 border-[#353534] bg-[#131313]/90 backdrop-blur-md flex justify-between items-center px-4 md:px-6 py-4"
        initial={reduce ? false : { y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: easeOut }}
      >
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
          <motion.div
            whileHover={reduce ? undefined : { scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <SiteLogo />
          </motion.div>
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
        <div className="flex items-center gap-2 sm:gap-3">
          {!authLoading && (
            <Link
              href={authEmail ? '/logout' : '/login'}
              className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest px-3 py-2 border-2 transition-all whitespace-nowrap ${
                authEmail
                  ? 'border-[#353534] text-[#a98a7d] hover:text-white'
                  : 'border-[#13ff43] text-[#13ff43] hover:bg-[#13ff43] hover:text-black'
              }`}
            >
              {authEmail ? 'Log out' : 'Sign in'}
            </Link>
          )}
          <motion.div whileHover={reduce ? undefined : { scale: 1.03 }} whileTap={reduce ? undefined : { scale: 0.98 }}>
            <Link
              href="/bids"
              className="bg-[#FF6B00] text-black px-3 sm:px-6 py-2 font-bold uppercase tracking-widest hover:bg-white transition-all text-xs md:text-sm inline-block"
            >
              LAUNCH
              <span className="hidden sm:inline">_SYSTEM</span>
            </Link>
          </motion.div>
        </div>
      </motion.header>

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
            className="uppercase tracking-tight font-bold text-[#13ff43] hover:bg-[#FF6B00] hover:text-black transition-colors duration-150 px-6 py-3 text-sm border-b border-[#353534]/50"
          >
            SYS_HEALTH
          </Link>
          {!authLoading && (
            <Link
              href={authEmail ? '/logout' : '/login'}
              onClick={() => setMenuOpen(false)}
              className="uppercase tracking-tight font-black text-[#FF6B00] hover:bg-[#FF6B00] hover:text-black transition-colors duration-150 px-6 py-3 text-sm"
            >
              {authEmail ? 'Log out' : 'Sign in'}
            </Link>
          )}
        </nav>
      </div>

      <main className="pt-20">
        <section className="relative min-h-[80vh] flex items-center justify-start px-4 md:px-20 overflow-hidden border-b-4 border-[#5a4136]">
          <HeroBackdrop />
          <div className="absolute inset-0 z-[1] bg-gradient-to-r from-[#131313] via-[#131313]/85 to-transparent" />
          <div className="relative z-10 max-w-4xl border-l-4 border-[#FF6B00] pl-4 md:pl-8 py-12">
            <motion.div
              initial={reduce ? 'visible' : 'hidden'}
              animate="visible"
              variants={{
                hidden: {},
                visible: {
                  transition: { staggerChildren: 0.09, delayChildren: 0.12 },
                },
              }}
            >
              <motion.div
                className="flex items-center gap-4 mb-6 flex-wrap"
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: easeOut } },
                }}
              >
                <span className="bg-[#13ff43] text-[#003907] px-3 py-1 text-xs font-black tracking-widest">
                  SYSTEM_LIVE
                </span>
                <span className="text-[#ffb693] text-xs font-mono">
                  COORD: 30.2672° N, 97.7431° W
                </span>
              </motion.div>
              <motion.h1
                className="text-5xl md:text-8xl font-black uppercase tracking-tighter leading-none mb-8 glow-orange"
                variants={{
                  hidden: { opacity: 0, y: 32 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: easeOut } },
                }}
              >
                The Future of <br />
                <span className="text-[#FF6B00]">Land Clearing</span> <br />
                is Here.
              </motion.h1>
              <motion.p
                className="text-xl md:text-2xl text-[#a98a7d] max-w-xl mb-10 font-light leading-relaxed"
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: easeOut } },
                }}
              >
                AI-driven telemetry and tactical terrain mapping for the modern clearing fleet. Scan,
                analyze, and deploy with industrial precision.
              </motion.p>
              <motion.div
                className="flex flex-wrap gap-4 md:gap-6"
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: easeOut } },
                }}
              >
                <motion.div whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.98 }}>
                  <Link
                    href="/bids"
                    className="bg-[#FF6B00] text-black font-black px-6 py-4 md:px-10 md:py-5 text-base md:text-lg uppercase tracking-widest hover:bg-white transition-colors inline-block shadow-[0_0_40px_-8px_rgba(255,107,0,0.55)]"
                  >
                    Launch Estimator
                  </Link>
                </motion.div>
                <motion.div whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.98 }}>
                  <a
                    href="#features"
                    className="border-2 border-[#5a4136] text-[#ffb693] font-black px-6 py-4 md:px-10 md:py-5 text-base md:text-lg uppercase tracking-widest hover:bg-[#FF6B00] hover:text-black transition-colors inline-block"
                  >
                    View the Tech
                  </a>
                </motion.div>
              </motion.div>
            </motion.div>
          </div>
          <motion.div
            className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 hidden md:flex flex-col items-center gap-2 text-[#5a4136]"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.6 }}
            aria-hidden
          >
            <span className="text-[10px] font-mono tracking-[0.35em] uppercase">Scroll</span>
            <motion.div
              className="w-px h-10 bg-gradient-to-b from-[#FF6B00] to-transparent origin-top"
              animate={reduce ? undefined : { scaleY: [0.4, 1, 0.4] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>
        </section>

        <section className="bg-[#201f1f] py-6 border-b-2 border-[#5a4136] flex flex-wrap justify-around items-center gap-8 px-10">
          <Reveal className="flex items-center gap-4" delay={0}>
            <span className="text-[#FF6B00] font-black text-4xl tabular-nums">25%</span>
            <span className="text-xs uppercase tracking-widest text-[#a98a7d] font-bold leading-tight">
              Increase in <br />
              Bid Accuracy
            </span>
          </Reveal>
          <div className="w-px h-12 bg-[#5a4136] hidden md:block" />
          <Reveal className="flex items-center gap-4" delay={0.08}>
            <span className="text-[#13ff43] font-black text-4xl tabular-nums">90%</span>
            <span className="text-xs uppercase tracking-widest text-[#a98a7d] font-bold leading-tight">
              Detection <br />
              Precision
            </span>
          </Reveal>
          <div className="w-px h-12 bg-[#5a4136] hidden md:block" />
          <Reveal className="flex items-center gap-4" delay={0.16}>
            <span className="text-[#FF6B00] font-black text-4xl tabular-nums">14ms</span>
            <span className="text-xs uppercase tracking-widest text-[#a98a7d] font-bold leading-tight">
              Telemetry <br />
              Latency
            </span>
          </Reveal>
        </section>

        <section id="features" className="p-6 md:p-20 bg-[#131313]">
          <Reveal className="flex items-end justify-between mb-16 flex-wrap gap-6">
            <div>
              <h2 className="text-[#ffb693] text-xs font-mono tracking-[0.5em] uppercase mb-4">
                {'// TACTICAL_MODULES'}
              </h2>
              <h3 className="text-4xl md:text-6xl font-black uppercase tracking-tighter">
                Industrial Grid
              </h3>
            </div>
            <div className="hidden md:block h-px flex-1 mx-10 bg-[#5a4136] min-w-[80px]" />
          </Reveal>
          <Stagger className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 border-2 border-[#353534]" stagger={0.1}>
            {FEATURES.map((feature, i) => (
              <StaggerItem
                key={feature.title}
                className={`p-6 md:p-8 hover:bg-[#2a2a2a] transition-colors group border-b md:border-b-0 border-[#353534] ${
                  i < 3 ? 'lg:border-r lg:border-[#353534]' : ''
                }`}
              >
                <div className="mb-12">
                  <motion.span
                    className="text-5xl block mb-4"
                    whileHover={reduce ? undefined : { scale: 1.08, rotate: [0, -4, 4, 0] }}
                    transition={{ duration: 0.45 }}
                  >
                    {feature.icon}
                  </motion.span>
                  <h4 className="text-2xl font-black uppercase mb-4 leading-none">{feature.title}</h4>
                  <p className="text-[#a98a7d] text-sm leading-relaxed">{feature.desc}</p>
                </div>
                <div className="border-t border-[#353534] pt-4 flex justify-between items-center">
                  <span className="text-[10px] text-[#5a4136] font-mono">
                    MOD_ID: 0x{(992 - i * 200).toString(16)}
                  </span>
                  <span className="text-[#13ff43] text-xs font-bold">{feature.status}</span>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        <section className="px-6 py-24 md:px-20 border-t-2 border-[#353534]">
          <Reveal className="mb-20 text-center">
            <h3 className="text-[#ffb693] text-xs font-mono tracking-[0.5em] uppercase mb-4">
              PROTOCOL_EXECUTION
            </h3>
            <h2 className="text-5xl md:text-7xl font-black uppercase tracking-tighter">How It Works</h2>
          </Reveal>
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-12 items-stretch">
            {STEPS.map((s, i) => (
              <Reveal key={s.step} className="flex-1 flex items-stretch gap-4" delay={i * 0.12}>
                <div className="relative border-l-4 border-[#ffb693] p-8 bg-[#353534]/20 flex-1 overflow-hidden group">
                  <motion.span
                    className="absolute -top-6 -left-6 bg-[#FF6B00] text-black font-black text-4xl p-2 w-16 h-16 flex items-center justify-center"
                    whileHover={reduce ? undefined : { scale: 1.05 }}
                  >
                    {s.step}
                  </motion.span>
                  <h4 className="text-3xl font-black uppercase mb-6 mt-4">{s.title}</h4>
                  <p className="text-[#a98a7d] leading-relaxed">{s.desc}</p>
                  <motion.div
                    className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#FF6B00]/0 via-transparent to-[#13ff43]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    aria-hidden
                  />
                </div>
                {i < 2 && (
                  <div className="hidden md:flex items-center justify-center text-[#5a4136] text-4xl select-none">›</div>
                )}
              </Reveal>
            ))}
          </div>
        </section>

        <Reveal className="bg-[#FF6B00] p-12 md:p-24 m-6 md:m-20 text-black relative overflow-hidden">
          <motion.div
            className="absolute -right-20 -top-20 w-64 h-64 rounded-full bg-black/10 blur-3xl pointer-events-none"
            animate={reduce ? undefined : { scale: [1, 1.15, 1], opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          />
          <div className="max-w-4xl relative z-10">
            <h2 className="text-5xl md:text-8xl font-black uppercase tracking-tighter leading-none mb-8">
              Ready to <br />
              Secure the Perimeter?
            </h2>
            <p className="text-xl md:text-2xl font-bold uppercase mb-12 tracking-tight opacity-80">
              Stop guessing. Start measuring. Deploy Cedar_Hack today.
            </p>
            <motion.div whileHover={reduce ? undefined : { scale: 1.02 }} whileTap={reduce ? undefined : { scale: 0.98 }}>
              <Link
                href="/bids"
                className="bg-black text-white px-8 py-4 md:px-12 md:py-6 text-lg md:text-xl font-black uppercase tracking-widest hover:bg-[#353534] transition-colors inline-block"
              >
                Initialize System
              </Link>
            </motion.div>
          </div>
        </Reveal>
      </main>

      <footer className="w-full border-t-2 border-[#353534] bg-[#131313] flex flex-col md:flex-row justify-between items-center px-10 py-12 gap-8">
        <Reveal>
          <div className="text-lg font-bold text-[#FF6B00] uppercase tracking-widest">CEDAR_HACK_OPS</div>
        </Reveal>
        <Reveal delay={0.06} className="flex flex-wrap justify-center gap-8">
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
        </Reveal>
        <Reveal delay={0.12}>
          <div className="text-xs tracking-widest uppercase text-[#353534]">
            ©2024 CEDAR_HACK_OPERATIONS. ALL RIGHTS RESERVED.
          </div>
        </Reveal>
      </footer>
    </div>
  );
}
