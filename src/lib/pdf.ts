/**
 * PDF bid document generator using jsPDF.
 *
 * Produces a professional multi-page clearing proposal:
 *   Page 1: Cover (company, client, property, date)
 *   Page 2: Property overview + pasture table
 *   Pages 3+: One section per pasture with cost breakdown
 *   Final: Bid summary, terms, signature lines
 */

import { jsPDF } from 'jspdf';
import type { Bid, RateCard } from '@/types';
import {
  formatCurrency,
  formatCurrencyPrecise,
  VEGETATION_LABELS,
  DENSITY_LABELS,
  TERRAIN_LABELS,
  DISPOSAL_LABELS,
  getMethodConfig,
  calculateBidTotal,
} from '@/lib/rates';

// ─── Colors ─────────────────────────────────────────────────────────────────

const C = {
  black: '#1a1a1a',
  dark: '#2d2d2d',
  mid: '#6b6b6b',
  light: '#999999',
  rule: '#cccccc',
  bg: '#f5f2eb',
  primary: '#4A6741',
  accent: '#FF6B35',
  white: '#ffffff',
};

// ─── Layout constants (letter size in mm: 215.9 × 279.4) ───────────────────

const PAGE_W = 215.9;
const MARGIN = 20;
const CONTENT_W = PAGE_W - MARGIN * 2;
const COL_LEFT = MARGIN;
const COL_RIGHT = PAGE_W - MARGIN;

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 25) {
    doc.addPage();
    return 30;
  }
  return y;
}

function drawHRule(doc: jsPDF, y: number, color = C.rule): number {
  doc.setDrawColor(color);
  doc.setLineWidth(0.3);
  doc.line(COL_LEFT, y, COL_RIGHT, y);
  return y + 4;
}

function drawSectionTitle(doc: jsPDF, y: number, title: string): number {
  y = ensureSpace(doc, y, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(C.primary);
  doc.text(title.toUpperCase(), COL_LEFT, y);
  y += 2;
  doc.setDrawColor(C.primary);
  doc.setLineWidth(0.8);
  doc.line(COL_LEFT, y, COL_LEFT + 50, y);
  return y + 8;
}

function drawKeyValue(doc: jsPDF, y: number, key: string, value: string, xOffset = 0): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(C.mid);
  doc.text(key, COL_LEFT + xOffset, y);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(C.dark);
  doc.text(value, COL_LEFT + xOffset + 55, y);
  return y + 5.5;
}

function drawFooter(doc: jsPDF, bidNumber: string) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(C.light);
    doc.text(
      `Cactus Creek Clearing  \u2022  Bid #${bidNumber}  \u2022  Page ${i} of ${pageCount}`,
      PAGE_W / 2,
      pageH - 10,
      { align: 'center' },
    );
  }
}

// ─── Page builders ──────────────────────────────────────────────────────────

function buildCoverPage(doc: jsPDF, bid: Bid) {
  const pageH = doc.internal.pageSize.getHeight();

  // Top accent bar
  doc.setFillColor(C.primary);
  doc.rect(0, 0, PAGE_W, 8, 'F');

  // Company name
  let y = 50;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(C.primary);
  doc.text('CACTUS CREEK', COL_LEFT, y);
  y += 12;
  doc.setFontSize(22);
  doc.setTextColor(C.dark);
  doc.text('CLEARING', COL_LEFT, y);

  // Tagline
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(C.mid);
  doc.text('Professional Cedar & Brush Clearing  \u2022  Kerrville, TX', COL_LEFT, y);

  // Divider
  y += 15;
  doc.setDrawColor(C.accent);
  doc.setLineWidth(2);
  doc.line(COL_LEFT, y, COL_LEFT + 60, y);

  // Document title
  y += 20;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(C.accent);
  doc.text('CLEARING PROPOSAL', COL_LEFT, y);

  // Bid number + date
  y += 10;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(C.dark);
  doc.text(`Bid #${bid.bidNumber}`, COL_LEFT, y);
  y += 6;
  doc.setTextColor(C.mid);
  doc.text(`Prepared: ${new Date(bid.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, COL_LEFT, y);
  if (bid.validUntil) {
    y += 6;
    doc.text(`Valid until: ${new Date(bid.validUntil + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, COL_LEFT, y);
  }

  // Client info block
  y += 20;
  doc.setFillColor('#f0ede6');
  doc.roundedRect(COL_LEFT, y - 4, CONTENT_W, 45, 3, 3, 'F');

  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(C.primary);
  doc.text('PREPARED FOR', COL_LEFT + 6, y);

  y += 7;
  doc.setFontSize(14);
  doc.setTextColor(C.dark);
  doc.text(bid.clientName || 'Client Name', COL_LEFT + 6, y);

  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(C.mid);
  if (bid.clientAddress) { doc.text(bid.clientAddress, COL_LEFT + 6, y); y += 5; }
  if (bid.clientPhone) { doc.text(bid.clientPhone, COL_LEFT + 6, y); y += 5; }
  if (bid.clientEmail) { doc.text(bid.clientEmail, COL_LEFT + 6, y); y += 5; }

  // Property info block
  y += 15;
  doc.setFillColor('#f0ede6');
  doc.roundedRect(COL_LEFT, y - 4, CONTENT_W, 35, 3, 3, 'F');

  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(C.primary);
  doc.text('PROPERTY', COL_LEFT + 6, y);

  y += 7;
  doc.setFontSize(14);
  doc.setTextColor(C.dark);
  doc.text(bid.propertyName || 'Property', COL_LEFT + 6, y);

  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(C.mid);
  if (bid.propertyAddress) doc.text(bid.propertyAddress, COL_LEFT + 6, y);

  // Big total at bottom
  const totalY = pageH - 55;
  doc.setDrawColor(C.accent);
  doc.setLineWidth(1);
  doc.line(COL_LEFT, totalY, COL_RIGHT, totalY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(C.mid);
  doc.text('TOTAL ESTIMATE', COL_LEFT, totalY + 10);

  doc.setFontSize(32);
  doc.setTextColor(C.accent);
  doc.text(formatCurrency(bid.totalAmount), COL_LEFT, totalY + 24);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(C.mid);
  doc.text(
    `${bid.totalAcreage} acres  \u2022  Est. ${bid.estimatedDaysLow}\u2013${bid.estimatedDaysHigh} days  \u2022  ${bid.pastures.length} pasture${bid.pastures.length !== 1 ? 's' : ''}`,
    COL_LEFT,
    totalY + 32,
  );

  // Bottom accent bar
  doc.setFillColor(C.primary);
  doc.rect(0, pageH - 8, PAGE_W, 8, 'F');
}

function buildOverviewPage(doc: jsPDF, bid: Bid) {
  doc.addPage();
  let y = 30;

  y = drawSectionTitle(doc, y, 'Property Overview');

  y = drawKeyValue(doc, y, 'Property:', bid.propertyName || '\u2014');
  y = drawKeyValue(doc, y, 'Address:', bid.propertyAddress || '\u2014');
  y = drawKeyValue(doc, y, 'Total Acreage:', `${bid.totalAcreage} acres`);
  y = drawKeyValue(doc, y, 'Total Pastures:', `${bid.pastures.length}`);
  y = drawKeyValue(doc, y, 'Est. Duration:', `${bid.estimatedDaysLow}\u2013${bid.estimatedDaysHigh} days`);

  y += 6;
  y = drawHRule(doc, y);
  y += 4;

  // Pasture summary table
  y = drawSectionTitle(doc, y, 'Pasture Summary');

  // Table header
  const cols = [COL_LEFT, COL_LEFT + 45, COL_LEFT + 75, COL_LEFT + 105, COL_LEFT + 140];
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(C.primary);
  doc.text('PASTURE', cols[0], y);
  doc.text('ACRES', cols[1], y);
  doc.text('TYPE', cols[2], y);
  doc.text('DENSITY', cols[3], y);
  doc.text('SUBTOTAL', cols[4], y);
  y += 2;
  y = drawHRule(doc, y, C.primary);
  y += 2;

  // Table rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (const p of bid.pastures) {
    y = ensureSpace(doc, y, 8);
    doc.setTextColor(C.dark);
    doc.text(p.name.substring(0, 20), cols[0], y);
    doc.text(String(p.acreage), cols[1], y);
    doc.text(VEGETATION_LABELS[p.vegetationType] || p.vegetationType, cols[2], y);
    doc.text(DENSITY_LABELS[p.density] || p.density, cols[3], y);
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(p.subtotal), cols[4], y);
    doc.setFont('helvetica', 'normal');
    y += 6;
  }

  return y;
}

function buildPasturePages(doc: jsPDF, bid: Bid, rateCard: RateCard) {
  for (const p of bid.pastures) {
    doc.addPage();
    let y = 30;

    // Pasture header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(C.primary);
    doc.text(p.name, COL_LEFT, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(C.mid);
    doc.text(`${p.acreage} acres`, COL_RIGHT, y, { align: 'right' });

    y += 4;
    doc.setDrawColor(C.primary);
    doc.setLineWidth(0.8);
    doc.line(COL_LEFT, y, COL_RIGHT, y);
    y += 10;

    // Clearing specs
    y = drawSectionTitle(doc, y, 'Clearing Specifications');

    const mc = getMethodConfig(p.clearingMethod, rateCard);
    y = drawKeyValue(doc, y, 'Vegetation:', VEGETATION_LABELS[p.vegetationType] || p.vegetationType);
    y = drawKeyValue(doc, y, 'Density:', DENSITY_LABELS[p.density] || p.density);
    y = drawKeyValue(doc, y, 'Terrain:', TERRAIN_LABELS[p.terrain] || p.terrain);
    y = drawKeyValue(doc, y, 'Method:', mc?.label || p.clearingMethod);
    if (mc?.equipment) y = drawKeyValue(doc, y, 'Equipment:', mc.equipment);
    if (mc?.result) y = drawKeyValue(doc, y, 'Expected Result:', mc.result);
    y = drawKeyValue(doc, y, 'Disposal:', DISPOSAL_LABELS[p.disposalMethod] || p.disposalMethod);

    // Soil data
    if (p.soilData) {
      y += 4;
      y = drawSectionTitle(doc, y, 'Soil Data');
      y = drawKeyValue(doc, y, 'Soil Series:', p.soilData.series || '\u2014');
      y = drawKeyValue(doc, y, 'Map Unit:', p.soilData.mapUnit || '\u2014');
      y = drawKeyValue(doc, y, 'Slope:', p.soilData.slope_r != null ? `${p.soilData.slope_r}%` : '\u2014');
      y = drawKeyValue(doc, y, 'Rock Fragment:', p.soilData.fragvol_r != null ? `${p.soilData.fragvol_r}%` : '\u2014');
      y = drawKeyValue(doc, y, 'Drainage:', p.soilData.drainagecl || '\u2014');
      if (p.soilData.resdept_r != null) {
        y = drawKeyValue(doc, y, 'Depth to Bedrock:', `${p.soilData.resdept_r} cm`);
      }
      const soilMult = p.soilMultiplierOverride ?? p.soilMultiplier;
      y = drawKeyValue(doc, y, 'Soil Difficulty:', `${soilMult}x${p.soilMultiplierOverride ? ' (override)' : ''}`);
    }

    // Cedar analysis summary
    if (p.cedarAnalysis?.summary) {
      y += 4;
      y = ensureSpace(doc, y, 40);
      y = drawSectionTitle(doc, y, 'Satellite Analysis');
      const s = p.cedarAnalysis.summary;
      y = drawKeyValue(doc, y, 'Cedar Coverage:', `${s.cedar.pct}%`);
      if (s.oak) y = drawKeyValue(doc, y, 'Oak Coverage:', `${s.oak.pct}%`);
      y = drawKeyValue(doc, y, 'Est. Cedar Acres:', `${s.estimatedCedarAcres}`);
      y = drawKeyValue(doc, y, 'Sample Points:', `${s.totalSamples}`);
      y = drawKeyValue(doc, y, 'Confidence:', `${Math.round(s.confidence * 100)}%`);
    }

    // Cost breakdown
    y += 4;
    y = ensureSpace(doc, y, 40);
    y = drawSectionTitle(doc, y, 'Cost Breakdown');

    const baseRate = rateCard.baseRates[p.vegetationType];
    const densityMult = rateCard.densityMultipliers[p.density];
    const terrainMult = rateCard.terrainMultipliers[p.terrain];
    const soilMult = p.soilMultiplierOverride ?? p.soilMultiplier;
    const difficultyMult = Math.max(terrainMult, soilMult);
    const methodRateMult = mc?.rateMultiplier ?? 1.0;
    const disposalAdder = rateCard.disposalAdders[p.disposalMethod] ?? 0;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(C.dark);

    const breakdownLines = [
      [`Base rate (${VEGETATION_LABELS[p.vegetationType]})`, formatCurrencyPrecise(baseRate) + '/ac'],
      [`Density multiplier (${DENSITY_LABELS[p.density]})`, `\u00D7 ${densityMult}`],
      [`Difficulty multiplier (${difficultyMult === soilMult ? 'soil' : 'terrain'})`, `\u00D7 ${difficultyMult}`],
      [`Method multiplier (${mc?.label || ''})`, `\u00D7 ${methodRateMult}`],
    ];
    if (disposalAdder > 0) {
      breakdownLines.push([`Disposal (${DISPOSAL_LABELS[p.disposalMethod]})`, `+ ${formatCurrencyPrecise(disposalAdder)}/ac`]);
    }
    breakdownLines.push([`Acreage`, `\u00D7 ${p.acreage} ac`]);

    for (const [label, val] of breakdownLines) {
      y = ensureSpace(doc, y, 6);
      doc.setTextColor(C.mid);
      doc.text(label, COL_LEFT + 4, y);
      doc.setTextColor(C.dark);
      doc.text(val, COL_LEFT + 120, y);
      y += 5.5;
    }

    // Adders
    if (p.adders && p.adders.length > 0) {
      y += 2;
      for (const a of p.adders) {
        y = ensureSpace(doc, y, 6);
        const adderDef = rateCard.methodAdders.find((m) => m.id === a.adderId);
        doc.setTextColor(C.mid);
        doc.text(adderDef?.label || a.adderId, COL_LEFT + 4, y);
        doc.setTextColor(C.dark);
        doc.text(`${a.quantity} \u00D7 ${formatCurrencyPrecise(a.costPerUnit)}`, COL_LEFT + 120, y);
        y += 5.5;
      }
    }

    // Pasture subtotal
    y += 3;
    y = ensureSpace(doc, y, 12);
    doc.setDrawColor(C.accent);
    doc.setLineWidth(0.5);
    doc.line(COL_LEFT, y, COL_RIGHT, y);
    y += 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(C.accent);
    doc.text('SUBTOTAL', COL_LEFT, y);
    doc.text(formatCurrency(p.subtotal), COL_RIGHT, y, { align: 'right' });

    // Notes
    if (p.notes) {
      y += 10;
      y = ensureSpace(doc, y, 15);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(C.mid);
      const noteLines = doc.splitTextToSize(`Note: ${p.notes}`, CONTENT_W - 8);
      doc.text(noteLines, COL_LEFT + 4, y);
    }
  }
}

function buildSummaryPage(doc: jsPDF, bid: Bid, rateCard: RateCard) {
  doc.addPage();
  let y = 30;

  y = drawSectionTitle(doc, y, 'Bid Summary');

  const { pastureSubtotal, contingencyAmount, discountAmount } = calculateBidTotal(
    bid.pastures,
    bid.mobilizationFee,
    bid.burnPermitFee,
    bid.customLineItems,
    bid.contingencyPct,
    bid.discountPct,
    rateCard.minimumBid,
  );

  // Line items table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(C.primary);
  doc.text('ITEM', COL_LEFT, y);
  doc.text('AMOUNT', COL_RIGHT, y, { align: 'right' });
  y += 2;
  y = drawHRule(doc, y, C.primary);
  y += 3;

  doc.setFontSize(10);

  // Pasture subtotals
  for (const p of bid.pastures) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(C.dark);
    doc.text(`${p.name} (${p.acreage} ac)`, COL_LEFT + 4, y);
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(p.subtotal), COL_RIGHT, y, { align: 'right' });
    y += 6;
  }

  y += 2;
  y = drawHRule(doc, y);
  y += 3;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(C.dark);
  doc.text('Pasture Subtotal', COL_LEFT + 4, y);
  doc.setFont('helvetica', 'bold');
  doc.text(formatCurrency(pastureSubtotal), COL_RIGHT, y, { align: 'right' });
  y += 7;

  // Additional items
  if (bid.mobilizationFee > 0) {
    doc.setFont('helvetica', 'normal');
    doc.text('Mobilization', COL_LEFT + 4, y);
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(bid.mobilizationFee), COL_RIGHT, y, { align: 'right' });
    y += 6;
  }
  if (bid.burnPermitFee > 0) {
    doc.setFont('helvetica', 'normal');
    doc.text('Burn Permit', COL_LEFT + 4, y);
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(bid.burnPermitFee), COL_RIGHT, y, { align: 'right' });
    y += 6;
  }
  for (const li of bid.customLineItems) {
    if (li.amount === 0 && !li.description) continue;
    doc.setFont('helvetica', 'normal');
    doc.text(li.description || 'Custom Item', COL_LEFT + 4, y);
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(li.amount), COL_RIGHT, y, { align: 'right' });
    y += 6;
  }
  if (contingencyAmount > 0) {
    doc.setFont('helvetica', 'normal');
    doc.text(`Contingency (${bid.contingencyPct}%)`, COL_LEFT + 4, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`+${formatCurrency(contingencyAmount)}`, COL_RIGHT, y, { align: 'right' });
    y += 6;
  }
  if (discountAmount > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(C.primary);
    doc.text(`Discount (${bid.discountPct}%)`, COL_LEFT + 4, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`-${formatCurrency(discountAmount)}`, COL_RIGHT, y, { align: 'right' });
    y += 6;
  }

  // Total
  y += 4;
  doc.setFillColor(C.primary);
  doc.roundedRect(COL_LEFT, y - 4, CONTENT_W, 18, 2, 2, 'F');
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(C.white);
  doc.text('TOTAL ESTIMATE', COL_LEFT + 6, y);
  doc.setFontSize(16);
  doc.text(formatCurrency(bid.totalAmount), COL_RIGHT - 6, y, { align: 'right' });

  y += 20;

  // Timeline
  y = ensureSpace(doc, y, 20);
  y = drawSectionTitle(doc, y, 'Estimated Timeline');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(C.dark);
  doc.text(
    `Estimated project duration: ${bid.estimatedDaysLow}\u2013${bid.estimatedDaysHigh} working days`,
    COL_LEFT,
    y,
  );
  y += 5;
  doc.setTextColor(C.mid);
  doc.setFontSize(9);
  doc.text('Weather permitting. Actual duration depends on site conditions.', COL_LEFT, y);

  y += 15;

  // Notes
  if (bid.notes) {
    y = ensureSpace(doc, y, 20);
    y = drawSectionTitle(doc, y, 'Notes');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(C.dark);
    const noteLines = doc.splitTextToSize(bid.notes, CONTENT_W - 4);
    doc.text(noteLines, COL_LEFT, y);
    y += noteLines.length * 4.5 + 6;
  }

  // Terms
  y = ensureSpace(doc, y, 50);
  y = drawSectionTitle(doc, y, 'Terms & Conditions');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(C.mid);
  const terms = [
    bid.validUntil
      ? `This proposal is valid until ${new Date(bid.validUntil + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`
      : 'This proposal is valid for 30 days from the date of issue.',
    'Payment terms: 50% deposit due upon acceptance, balance due upon completion.',
    'Price includes all labor, equipment, and fuel costs unless otherwise noted.',
    'Disposal method as specified per pasture. Burn permits are the responsibility of the property owner unless included above.',
    'Cactus Creek Clearing carries general liability and workers\u2019 compensation insurance.',
    'Any additional work beyond the scope of this proposal will be quoted separately.',
  ];

  for (const t of terms) {
    y = ensureSpace(doc, y, 8);
    const lines = doc.splitTextToSize(`\u2022  ${t}`, CONTENT_W - 8);
    doc.text(lines, COL_LEFT + 4, y);
    y += lines.length * 3.5 + 2;
  }

  // Signature lines
  y += 10;
  y = ensureSpace(doc, y, 40);
  y = drawSectionTitle(doc, y, 'Acceptance');

  y += 8;
  doc.setDrawColor(C.dark);
  doc.setLineWidth(0.3);

  // Client signature
  doc.line(COL_LEFT, y, COL_LEFT + 75, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(C.mid);
  doc.text('Client Signature', COL_LEFT, y + 5);

  doc.line(COL_LEFT + 85, y, COL_LEFT + 130, y);
  doc.text('Date', COL_LEFT + 85, y + 5);

  // Contractor signature
  y += 20;
  doc.line(COL_LEFT, y, COL_LEFT + 75, y);
  doc.text('Contractor Signature', COL_LEFT, y + 5);

  doc.line(COL_LEFT + 85, y, COL_LEFT + 130, y);
  doc.text('Date', COL_LEFT + 85, y + 5);
}

// ─── Main export ────────────────────────────────────────────────────────────

export function generateBidPdf(bid: Bid, rateCard: RateCard): Uint8Array {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter',
  });

  buildCoverPage(doc, bid);
  buildOverviewPage(doc, bid);
  buildPasturePages(doc, bid, rateCard);
  buildSummaryPage(doc, bid, rateCard);
  drawFooter(doc, bid.bidNumber);

  return doc.output('arraybuffer') as unknown as Uint8Array;
}
