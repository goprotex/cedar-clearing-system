import BidEditorClient from '../bid/[id]/BidEditorClient';

export const metadata = {
  title: 'Operate — Cedar Hack',
  description: 'Field operator console — map, pastures, and spectral analysis.',
};

/** Stable session id so operator work persists under `ccc_bid_operate` in localStorage. */
const OPERATE_BID_ID = 'operate';

export default function OperatePage() {
  return <BidEditorClient bidId={OPERATE_BID_ID} />;
}
