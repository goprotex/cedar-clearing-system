import BidEditorClient from './BidEditorClient';

export const metadata = {
  title: 'Bid Editor — Cactus Creek Clearing',
};

export default async function BidEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BidEditorClient bidId={id} />;
}
