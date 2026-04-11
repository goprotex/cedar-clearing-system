'use client';

import { useBidStore } from '@/lib/store';
import BidClientLinker from '@/components/bid/BidClientLinker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

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
      <div className="bg-[#1c1b1b] border border-[#353534] p-4">
        <h3 className="text-[10px] text-[#FF6B00] font-black uppercase tracking-widest mb-3">CLIENT_DATA</h3>
        <BidClientLinker />
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Name</Label>
            <Input
              value={currentBid.clientName}
              onChange={(e) => updateBidField('clientName', e.target.value)}
              placeholder="Ranch owner name"
              className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
          </div>
          <div>
            <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Phone</Label>
            <Input
              value={currentBid.clientPhone}
              onChange={(e) => updateBidField('clientPhone', e.target.value)}
              placeholder="(830) 555-0000"
              className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
          </div>
          <div>
            <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Email</Label>
            <Input
              value={currentBid.clientEmail}
              onChange={(e) => updateBidField('clientEmail', e.target.value)}
              placeholder="client@email.com"
              className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
          </div>
          <div className="col-span-2">
            <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Address</Label>
            <Input
              value={currentBid.clientAddress}
              onChange={(e) => updateBidField('clientAddress', e.target.value)}
              placeholder="123 Ranch Rd, Kerrville TX"
              className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
          </div>
        </div>
      </div>

      {/* Property Info */}
      <div className="bg-[#1c1b1b] border border-[#353534] p-4">
        <h3 className="text-[10px] text-[#FF6B00] font-black uppercase tracking-widest mb-3">PROPERTY_DATA</h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Property Name</Label>
            <Input
              value={currentBid.propertyName}
              onChange={(e) => updateBidField('propertyName', e.target.value)}
              placeholder="Henderson Ranch"
              className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
          </div>
          <div>
            <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Address</Label>
            <Input
              value={currentBid.propertyAddress}
              onChange={(e) => updateBidField('propertyAddress', e.target.value)}
              placeholder="Property address"
              className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
          </div>
        </div>
      </div>

      {/* Fees */}
      <div className="bg-[#1c1b1b] border border-[#353534] p-4">
        <h3 className="text-[10px] text-[#FF6B00] font-black uppercase tracking-widest mb-3">FEES_&_ADJUSTMENTS</h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Mobilization</Label>
            <Input
              type="number"
              value={currentBid.mobilizationFee}
              onChange={(e) => updateBidField('mobilizationFee', parseFloat(e.target.value) || 0)}
              className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
          </div>
          <div>
            <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Burn Permit</Label>
            <Input
              type="number"
              value={currentBid.burnPermitFee}
              onChange={(e) => updateBidField('burnPermitFee', parseFloat(e.target.value) || 0)}
              className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
          </div>
          <div>
            <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Contingency %</Label>
            <Input
              type="number"
              min={0}
              max={50}
              value={currentBid.contingencyPct}
              onChange={(e) => updateBidField('contingencyPct', parseFloat(e.target.value) || 0)}
              className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
          </div>
          <div>
            <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Discount %</Label>
            <Input
              type="number"
              min={0}
              max={50}
              value={currentBid.discountPct}
              onChange={(e) => updateBidField('discountPct', parseFloat(e.target.value) || 0)}
              className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
          </div>
        </div>
      </div>

      {/* Custom Line Items */}
      <div className="bg-[#1c1b1b] border border-[#353534] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] text-[#FF6B00] font-black uppercase tracking-widest">CUSTOM_LINE_ITEMS</h3>
          <button
            className="text-[10px] text-[#13ff43] font-bold uppercase hover:text-white transition-colors"
            onClick={addCustomLineItem}
          >
            + ADD_ITEM
          </button>
        </div>
        {currentBid.customLineItems.map((li) => (
          <div key={li.id} className="flex gap-2 mb-2">
            <Input
              value={li.description}
              onChange={(e) => updateCustomLineItem(li.id, { description: e.target.value })}
              placeholder="Description"
              className="h-8 text-sm flex-1 bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
            <Input
              type="number"
              value={li.amount}
              onChange={(e) => updateCustomLineItem(li.id, { amount: parseFloat(e.target.value) || 0 })}
              className="h-8 text-sm w-28 bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
            />
            <button
              className="text-xs text-[#5a4136] hover:text-red-500 px-2 transition-colors"
              onClick={() => removeCustomLineItem(li.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Validity + Notes */}
      <div className="bg-[#1c1b1b] border border-[#353534] p-4 space-y-2">
        <h3 className="text-[10px] text-[#FF6B00] font-black uppercase tracking-widest mb-3">BID_METADATA</h3>
        <div>
          <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Valid Until</Label>
          <Input
            type="date"
            value={currentBid.validUntil}
            onChange={(e) => updateBidField('validUntil', e.target.value)}
            className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
          />
        </div>
        <div>
          <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Notes</Label>
          <Textarea
            value={currentBid.notes}
            onChange={(e) => updateBidField('notes', e.target.value)}
            placeholder="Additional notes, special conditions..."
            className="text-sm h-20 resize-none bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00]"
          />
        </div>
      </div>
    </div>
  );
}
