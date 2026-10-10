import type { HubLink } from './hubs';

/** URL alone is not record identity: a register may contain independent items. */
export function distinctRecords(rows: HubLink[]) {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = JSON.stringify([row.href, row.label, row.sub ?? '']);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function workspaceRecords(attention: HubLink[], recent: HubLink[]) {
  const priorities = distinctRecords(attention);
  const identity = new Set(priorities.map(row => row.href + '\u0000' + row.label));
  return { priorities, records: distinctRecords(recent).filter(row => !identity.has(row.href + '\u0000' + row.label)) };
}
export const DESKS: Record<string, { question: string; title: string; action: string; context: string; mode: string }> = {
  Discover: { question: 'What is worth pursuing?', title: 'Discovery runs', action: 'Review findings', context: 'Open a run to inspect sources and accept or dismiss findings. Eligibility, a relevant project need and an open deadline must be established before pursuit.', mode: 'runs' },
  Projects: { question: 'What moves each project forward?', title: 'Project portfolio', action: 'Open project', context: 'Review stage, blockers and supporting evidence. Capital readiness and integrity are separate decisions; advancing a stage requires the appropriate review.', mode: 'portfolio' },
  Capital: { question: 'What can finance the next milestone?', title: 'Capital counterparties', action: 'Review mandate', context: 'Confirm the provider’s mandate, ticket, geography and project readiness before proposing an introduction. A listed profile does not establish investment fit.', mode: 'capital' },
  Network: { question: 'Who can help move this work?', title: 'Relationship directory', action: 'Open relationship', context: 'Check expertise, contact history and linked projects. An organization record is not an approved outreach recipient.', mode: 'directory' },
  Intelligence: { question: 'What do we need to know to decide?', title: 'Research desk', action: 'Review evidence', context: 'Start with a decision question, examine sources and record the implication. Generated analysis remains a draft until reviewed.', mode: 'research' },
  Engage: { question: 'What turns this need into agreed work?', title: 'Commercial pipeline', action: 'Review next action', context: 'Confirm scope, next action and terms. These are Regenera engagements; project capital and grant values remain separate.', mode: 'pipeline' },
  Workflows: { question: 'What is due, and what is blocking it?', title: 'Delivery queue', action: 'Open work item', context: 'Check the owner, deadline and dependencies. Application approval and submission remain human decisions.', mode: 'delivery' },
  Steward: { question: 'Are we keeping our commitments?', title: 'Commitment register', action: 'Review obligation', context: 'Close an obligation against its supporting evidence. Keep targets, reported outcomes and verified outcomes separate.', mode: 'commitments' },
};
