'use client';

import dynamic from 'next/dynamic';

const OperatorClient = dynamic(() => import('./OperatorClient'), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-screen bg-[#131313] flex items-center justify-center text-[#e5e2e1]">
      <div className="text-center">
        <div className="text-[#FF6B00] text-2xl font-black uppercase tracking-widest mb-2">LOADING_MAP</div>
        <div className="text-xs font-mono text-[#a98a7d]">INITIALIZING_OPERATOR_MODE...</div>
      </div>
    </div>
  ),
});

export default function OperatorWrapper({ bidId }: { bidId: string }) {
  return <OperatorClient bidId={bidId} />;
}
