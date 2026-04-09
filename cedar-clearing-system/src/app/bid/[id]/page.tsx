import BidEditorClient from './BidEditorClient';

export const metadata = {
  title: 'Bid Editor — Cedar Hack',
};

export default async function BidEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BidEditorClient bidId={id} />;
}
