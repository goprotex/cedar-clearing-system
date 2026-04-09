import OperatorWrapper from './OperatorWrapper';

export const metadata = {
  title: 'Operator Mode — Cedar Hack',
};

export default async function OperatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <link
        rel="stylesheet"
        href="https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.css"
      />
      <OperatorWrapper bidId={id} />
    </>
  );
}
