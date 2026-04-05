'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBidStore } from '@/lib/store';
import { formatCurrency } from '@/lib/rates';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-500',
  sent: 'bg-blue-500',
  accepted: 'bg-emerald-500',
  declined: 'bg-red-500',
  expired: 'bg-amber-500',
};

export default function BidsListClient() {
  const router = useRouter();
  const { savedBids, loadBidList, newBid, loadBid, deleteBid } = useBidStore();

  useEffect(() => {
    loadBidList();
  }, [loadBidList]);

  const handleNewBid = () => {
    newBid();
    router.push(`/bid/${useBidStore.getState().currentBid.id}`);
  };

  const handleOpenBid = (id: string) => {
    loadBid(id);
    router.push(`/bid/${id}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-amber-500">Cedar Hack</h1>
              <p className="text-slate-400 text-sm mt-1">AI-Powered Clearing Company Operating System</p>
            </div>
            <Button
              onClick={handleNewBid}
              className="bg-amber-600 hover:bg-amber-700"
            >
              + New Bid
            </Button>
          </div>
        </div>
      </header>

      {/* Bid List */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <h2 className="text-lg font-semibold mb-4">Recent Bids</h2>

        {savedBids.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <p className="text-4xl mb-3">🌲</p>
              <p className="text-lg font-medium">No bids yet</p>
              <p className="text-sm mt-1">Create your first bid to get started</p>
              <Button
                onClick={handleNewBid}
                className="mt-4 bg-amber-600 hover:bg-amber-700"
              >
                Create First Bid
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {savedBids.map((bid) => (
              <Card
                key={bid.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleOpenBid(bid.id)}
              >
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium">{bid.bidNumber}</span>
                          <Badge className={`${STATUS_COLORS[bid.status] || ''} text-white text-xs`}>
                            {bid.status}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {bid.clientName || 'No client'} — {bid.propertyName || 'No property'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="font-mono font-semibold text-emerald-600">
                          {formatCurrency(bid.totalAmount)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {bid.totalAcreage} acres
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(bid.updatedAt).toLocaleDateString()}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Delete this bid?')) {
                            deleteBid(bid.id);
                            toast.success('Bid deleted');
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
