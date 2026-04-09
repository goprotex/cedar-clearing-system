import OperatorClient from './OperatorClient';

export const metadata = {
  title: 'Operator Mode — Cedar Hack',
};

export default async function OperatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperatorClient bidId={id} />;
}
