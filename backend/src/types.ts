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
  quote?: string;
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
export type StorySource = {
  provider: string;
  workId: string;
  title: string;
  author: string;
  labels: string[];
  artwork?: string;
  introduction?: string;
  mode: 'zhihu-live' | 'curated-fallback';
  notice: string;
  apiUrl: string;
  originalUrl: string;
  verifiedQuoteCount: number;
};
export type StoryHypothesis = {
  id: string;
  title: string;
  description: string;
  support: string;
  evidenceGap: string;
  nextStep: string;
};
export type StoryQuestion = {
  id: string;
  title: string;
  question: string;
  explanation: string;
  informationValue: string;
  risk: string;
  limitation: string;
  recommended: boolean;
};
export type StoryEnding = {
  title: string;
  description: string;
  hypotheses: StoryHypothesis[];
  questions: StoryQuestion[];
  closing: string;
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
  judgment: {
    award: string;
    reasoning: string;
    sources: LawSource[];
    playerWinner?: string;
    opponentWinner?: string;
    lossAward?: string;
    lossReasoning?: string;
    resultNote?: string;
    disclaimer?: string;
  };
  hypothesisEvidenceIds?: string[];
  storyEnding?: StoryEnding;
  source?: StorySource;
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
