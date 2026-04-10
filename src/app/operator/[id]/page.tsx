import Link from 'next/link';

export default async function OperatorProfilePlaceholder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] p-6 space-y-4">
      <div className="max-w-xl mx-auto border-2 border-[#353534] bg-[#0e0e0e] p-6 space-y-3">
        <div className="text-[#FF6B00] text-2xl font-black uppercase tracking-widest">OPERATOR_PROFILE</div>
        <div className="text-xs font-mono text-[#a98a7d]">
          Placeholder page &mdash; the operator profile UI goes here (assignments, stats, machine, notes).
        </div>
        <div className="text-sm font-mono">
          Operator ID: <span className="text-[#13ff43]">{id}</span>
        </div>
        <div className="flex gap-2">
          <Link
            href="/monitor"
            className="px-3 py-2 text-xs bg-[#FF6B00] text-black hover:bg-white font-black uppercase tracking-widest"
          >
            Back to Monitor
          </Link>
          <Link
            href="/bids"
            className="px-3 py-2 text-xs border border-[#353534] text-[#a98a7d] hover:text-white hover:bg-[#353534] font-bold uppercase tracking-widest"
          >
            Bids
          </Link>
        </div>
      </div>
    </div>
  );
}
