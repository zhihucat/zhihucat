/** Request and upstream JSON must be narrowed before use. */
export type JsonObject = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

export type HttpError = Error & { statusCode: number };
export type VerifiedUser = { id: string; email: string; username: string };
export type Session = { user: VerifiedUser; profileId: string };
export type PlayerProfile = {
  id: string;
  name: string;
  avatar: string;
  total_score: number;
  completed_levels: number;
};

export type LawSource = { title: string; article: string; url: string; status: string };
export type CampaignEvidence = {
  id: string;
  title: string;
  type: string;
  sourceDocumentId: string;
  sourceRange: string;
  description: string;
  proofPurpose: string;
  credibility: number;
  authenticity: string;
  relevance: string;
};
export type CampaignScene = {
  id: string;
  title: string;
  description: string;
  hotspots: { id: string; evidenceId: string; title: string; icon: string; hint: string }[];
};
export type CampaignDocument = {
  id: string;
  name: string;
  type: string;
  content: string;
  hotspots: { id: string; evidenceId: string; label: string }[];
};
export type CampaignCard = {
  id: string;
  name: string;
  type: 'damage' | 'defense';
  cost: number;
  value: number;
  hint: string;
  text: string;
};
export type CampaignCase = {
  id: string;
  levelId: number;
  levelTitle: string;
  desc: string;
  title: string;
  type: string;
  difficulty: number;
  playerSide: string;
  opponentSide: string;
  goal: string;
  summary: string;
  focus: string[];
  actionPoints: number;
  scenes: CampaignScene[];
  documents: CampaignDocument[];
  evidence: CampaignEvidence[];
  keyEvidenceIds: string[];
  cards: CampaignCard[];
  keywords: string[][];
  adversary: string[];
  judgment: { award: string; reasoning: string; sources: LawSource[] };
};
export type PublicCampaignCase = Omit<CampaignCase, 'judgment' | 'adversary' | 'keywords'>;
export type BattleStart = { ticket: string; seed: number };
export type BattleTicket = {
  v: 1;
  profileId: string | null;
  caseId: string;
  evidenceIds: string[];
  seed: number;
  expiresAt: number;
};
