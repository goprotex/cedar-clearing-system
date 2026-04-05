'use client';

import { useBidStore } from '@/lib/store';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';

export default function BidDetails() {
  const {
    currentBid,
    updateBidField,
    addCustomLineItem,
    updateCustomLineItem,
    removeCustomLineItem,
  } = useBidStore();

  return (
    <div className="space-y-4">
      {/* Client Info */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Client Information</h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label className="text-xs">Client Name</Label>
            <Input
              value={currentBid.clientName}
              onChange={(e) => updateBidField('clientName', e.target.value)}
              placeholder="Ranch owner name"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Phone</Label>
            <Input
              value={currentBid.clientPhone}
              onChange={(e) => updateBidField('clientPhone', e.target.value)}
              placeholder="(830) 555-0000"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input
              value={currentBid.clientEmail}
              onChange={(e) => updateBidField('clientEmail', e.target.value)}
              placeholder="client@email.com"
              className="h-8 text-sm"
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Address</Label>
            <Input
              value={currentBid.clientAddress}
              onChange={(e) => updateBidField('clientAddress', e.target.value)}
              placeholder="123 Ranch Rd, Kerrville TX"
              className="h-8 text-sm"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Property Info */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Property</h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Property Name</Label>
            <Input
              value={currentBid.propertyName}
              onChange={(e) => updateBidField('propertyName', e.target.value)}
              placeholder="Henderson Ranch"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Address</Label>
            <Input
              value={currentBid.propertyAddress}
              onChange={(e) => updateBidField('propertyAddress', e.target.value)}
              placeholder="Property address"
              className="h-8 text-sm"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Fees */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Fees & Adjustments</h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Mobilization Fee</Label>
            <Input
              type="number"
              value={currentBid.mobilizationFee}
              onChange={(e) => updateBidField('mobilizationFee', parseFloat(e.target.value) || 0)}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Burn Permit Fee</Label>
            <Input
              type="number"
              value={currentBid.burnPermitFee}
              onChange={(e) => updateBidField('burnPermitFee', parseFloat(e.target.value) || 0)}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Contingency %</Label>
            <Input
              type="number"
              min={0}
              max={50}
              value={currentBid.contingencyPct}
              onChange={(e) => updateBidField('contingencyPct', parseFloat(e.target.value) || 0)}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Discount %</Label>
            <Input
              type="number"
              min={0}
              max={50}
              value={currentBid.discountPct}
              onChange={(e) => updateBidField('discountPct', parseFloat(e.target.value) || 0)}
              className="h-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Custom Line Items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Custom Line Items</h3>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={addCustomLineItem}>
            + Add Item
          </Button>
        </div>
        {currentBid.customLineItems.map((li) => (
          <div key={li.id} className="flex gap-2 mb-2">
            <Input
              value={li.description}
              onChange={(e) => updateCustomLineItem(li.id, { description: e.target.value })}
              placeholder="Description"
              className="h-8 text-sm flex-1"
            />
            <Input
              type="number"
              value={li.amount}
              onChange={(e) => updateCustomLineItem(li.id, { amount: parseFloat(e.target.value) || 0 })}
              className="h-8 text-sm w-28"
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8 text-destructive px-2"
              onClick={() => removeCustomLineItem(li.id)}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>

      <Separator />

      {/* Validity + Notes */}
      <div className="space-y-2">
        <div>
          <Label className="text-xs">Valid Until</Label>
          <Input
            type="date"
            value={currentBid.validUntil}
            onChange={(e) => updateBidField('validUntil', e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Bid Notes</Label>
          <Textarea
            value={currentBid.notes}
            onChange={(e) => updateBidField('notes', e.target.value)}
            placeholder="Additional notes, special conditions..."
            className="text-sm h-20 resize-none"
          />
        </div>
      </div>
    </div>
  );
}
