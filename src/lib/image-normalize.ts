// Re-encode browser-decodable images to JPEG before uploading to Supabase Storage.
//
// Why: the image buckets (avatars, company-logos, equipment-photos, job-media)
// only allow image/jpeg, image/png, image/webp and image/gif. iPhones capture
// photos as HEIC by default, so selecting a recent photo and uploading the raw
// File makes Storage reject it with a 400 ("mime type not supported"). Safari can
// decode HEIC into a <canvas>, so re-encoding to JPEG here both satisfies the
// bucket's allow-list and guarantees the stored file renders in every browser
// (Chrome/Windows cannot display HEIC). It also downsizes huge captures so they
// stay under the bucket size limit.

type NormalizeOptions = {
  /** Longest-edge cap in pixels; larger images are scaled down. */
  maxDimension?: number;
  /** JPEG quality, 0–1. */
  quality?: number;
};

/**
 * Returns a web-safe File suitable for upload. Images are re-encoded to JPEG;
 * non-images (e.g. PDFs), GIFs (which may be animated), and anything the browser
 * cannot decode are returned unchanged.
 */
export async function normalizeImageForUpload(
  file: File,
  opts: NormalizeOptions = {},
): Promise<File> {
  const { maxDimension = 2048, quality = 0.85 } = opts;

  // Pass non-image files (e.g. application/pdf) through untouched.
  if (file.type && !file.type.startsWith('image/')) return file;
  // GIFs are already allowed and re-encoding would flatten any animation.
  if (file.type === 'image/gif') return file;
  // Canvas APIs are browser-only; bail out safely during SSR.
  if (typeof document === 'undefined') return file;

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });

    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
    );
    if (!blob) return file;

    const base = file.name.replace(/\.[^./\\]+$/, '') || 'image';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch {
    // If the browser can't decode it, upload the original and let the caller's
    // error handling surface any rejection.
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
