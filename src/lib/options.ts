import { v4 as uuidv4 } from 'uuid';
import type { Bid, BidOption, ClearingMethod, DisposalMethod, Pasture, RateCard } from '@/types';
import { calculatePastureCost, calculateBidTotal, estimateDuration } from './rates';

interface OptionPreset {
  label: string;
  clearingMethod: ClearingMethod;
  disposalMethod: DisposalMethod;
  recommended: boolean;
}

const DEFAULT_PRESETS: OptionPreset[] = [
  {
    label: 'Option A: Premium Fine Mulch',
    clearingMethod: 'fine_mulch',
    disposalMethod: 'mulch_in_place',
    recommended: false,
  },
  {
    label: 'Option B: Standard Rough Mulch',
    clearingMethod: 'rough_mulch',
    disposalMethod: 'mulch_in_place',
    recommended: true,
  },
  {
    label: 'Option C: Chainsaw & Pile',
    clearingMethod: 'chainsaw_pile',
    disposalMethod: 'pile_and_burn',
    recommended: false,
  },
];

export function generateBidOptions(
  bid: Bid,
  rateCard: RateCard,
  presets: OptionPreset[] = DEFAULT_PRESETS
): BidOption[] {
  if (bid.pastures.length === 0 || bid.totalAcreage === 0) return [];

  return presets.map((preset) => {
    // Apply this method/disposal to all pastures
    const modifiedPastures: Pasture[] = bid.pastures.map((p) => {
      const modified = {
        ...p,
        clearingMethod: preset.clearingMethod,
        disposalMethod: preset.disposalMethod,
      };
      const { subtotal, methodMultiplier, estimatedHrsPerAcre } = calculatePastureCost(
        modified,
        rateCard
      );
      return { ...modified, subtotal, methodMultiplier, estimatedHrsPerAcre };
    });

    const { totalAmount } = calculateBidTotal(
      modifiedPastures,
      bid.mobilizationFee,
      bid.burnPermitFee,
      bid.customLineItems,
      bid.contingencyPct,
      bid.discountPct,
      rateCard.minimumBid
    );

    const { low, high } = estimateDuration(modifiedPastures);

    return {
      id: uuidv4(),
      label: preset.label,
      clearingMethod: preset.clearingMethod,
      disposalMethod: preset.disposalMethod,
      totalAmount,
      perAcreCost: bid.totalAcreage > 0 ? Math.round(totalAmount / bid.totalAcreage) : 0,
      estimatedDaysLow: low,
      estimatedDaysHigh: high,
      pastureBreakdown: modifiedPastures.map((p) => ({
        pastureId: p.id,
        pastureName: p.name,
        acreage: p.acreage,
        subtotal: p.subtotal,
      })),
      recommended: preset.recommended,
    };
  });
}

export { DEFAULT_PRESETS };
export type { OptionPreset };
