import AppShell from '@/components/AppShell';
import MonitorClient from './MonitorClient';

export const metadata = {
  title: 'Monitor — Cedar Hack',
};

export default function MonitorPage() {
  return (
    <AppShell>
      <MonitorClient />
    </AppShell>
  );
}

