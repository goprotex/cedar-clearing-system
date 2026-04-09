import OperatorWrapper from './OperatorWrapper';

export const metadata = {
  title: 'Operator Mode — Cedar Hack',
};

export default async function OperatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperatorWrapper bidId={id} />;
}
