import { NextResponse } from 'next/server';

const WORLD_IMAGERY_EXPORT_URL =
  'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export';

function parseSize(raw: string | null): string {
  if (!raw) return '256,256';

  const [width, height] = raw.split(',').map((part) => Number(part.trim()));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return '256,256';

  const clampedWidth = Math.max(64, Math.min(1024, Math.round(width)));
  const clampedHeight = Math.max(64, Math.min(1024, Math.round(height)));

  return `${clampedWidth},${clampedHeight}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bbox = searchParams.get('bbox');

  if (!bbox) {
    return NextResponse.json({ error: 'Missing bbox.' }, { status: 400 });
  }

  const params = new URLSearchParams({
    bbox,
    bboxSR: '3857',
    imageSR: '3857',
    size: parseSize(searchParams.get('size')),
    format: 'png32',
    transparent: 'false',
    f: 'image',
  });

  try {
    const response = await fetch(`${WORLD_IMAGERY_EXPORT_URL}?${params.toString()}`, {
      headers: {
        accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
      },
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream imagery request failed with ${response.status}.` },
        { status: 502 },
      );
    }

    const image = await response.arrayBuffer();

    return new NextResponse(image, {
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'image/png',
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load world imagery.' }, { status: 502 });
  }
}