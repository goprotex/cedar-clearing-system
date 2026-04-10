import JobClient from './JobClient';

export const metadata = {
  title: 'Job — Cedar Hack',
};

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobClient jobId={id} />;
}

