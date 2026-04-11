import ClientsDetailClient from './ClientsDetailClient';

export const metadata = {
  title: 'Client — Cedar Hack',
};

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientsDetailClient id={id} />;
}
