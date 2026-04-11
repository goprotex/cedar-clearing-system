import { NextRequest, NextResponse } from 'next/server';
import { generateBidPdf } from '@/lib/pdf';
import type { Bid, RateCard } from '@/types';
import { DEFAULT_RATE_CARD } from '@/lib/rates';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bid = body.bid as Bid | undefined;
    const rateCard = (body.rateCard as RateCard | undefined) ?? DEFAULT_RATE_CARD;

    if (!bid?.id || !bid.bidNumber) {
      return NextResponse.json({ error: 'Missing bid data' }, { status: 400 });
    }

    const pdfBytes = generateBidPdf(bid, rateCard);
    const buffer = Buffer.from(pdfBytes);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="CCC-${bid.bidNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[pdf] Generation failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'PDF generation failed' },
      { status: 500 },
    );
  }
}
