import { ParlayWorkspaceClient } from './ParlayWorkspaceClient';

export const metadata = {
  title: 'Parlay Workspace · Court Context',
  description: 'Review selected props together before running Court Context analysis.',
};

export default function ParlayWorkspacePage() {
  return <ParlayWorkspaceClient />;
}
