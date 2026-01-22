/**
 * Proposal Type Definitions
 *
 * Defines types for proposals in the collaborative workflow,
 * including proposal metadata and state management interfaces.
 */

export type ProposalType = 'comment' | 'proposed' | 'approved' | 'rejected';
export type ProposalAuthor = 'user' | 'claude';

export interface Proposal {
  id: string;
  type: ProposalType;
  lineStart: number;
  lineEnd: number;
  content: string;
  originalContent?: string; // For proposed changes, stores original
  author: ProposalAuthor;
  timestamp: number;
}

export interface ProposalState {
  proposals: Record<string, Proposal[]>; // keyed by item id
  addProposal: (itemId: string, proposal: Omit<Proposal, 'id' | 'timestamp'>) => string;
  updateProposal: (itemId: string, proposalId: string, updates: Partial<Proposal>) => void;
  removeProposal: (itemId: string, proposalId: string) => void;
  approveProposal: (itemId: string, proposalId: string) => void;
  rejectProposal: (itemId: string, proposalId: string) => void;
  clearProposals: (itemId: string) => void;
  getProposalsForItem: (itemId: string) => Proposal[];
}
