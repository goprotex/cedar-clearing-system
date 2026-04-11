import { redirect } from 'next/navigation';

/** Old standalone map + recon notes demo — use /operations instead. */
export default function MapRadarRedirectPage() {
  redirect('/operations');
}
