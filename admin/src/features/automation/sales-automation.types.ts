export interface SalesSettings {
  enabled: boolean;
  displayName: string;
  welcome: string;
  policies: string;
  humanContact: string;
  telegramChatId: string;
  autoDispatch: boolean;
  evidenceRetentionDays: number;
}

export type HumanOutcome = "sale_completed" | "no_sale" | "follow_up" | "other";

export interface HumanResolution {
  outcome: HumanOutcome;
  note: string;
  resolvedAt: string;
  resolvedBy: string;
}

export interface SalesAdminSession {
  id: string;
  contact: string;
  paused: boolean;
  phase: string | null;
  resolutions: HumanResolution[] | null;
  updatedAt: string;
}

export interface SalesOverview {
  settings: SalesSettings;
  reviewers: { telegramUserId: string; userId: string }[];
  sessions: SalesAdminSession[];
  checkouts: { id: string; orderId: string; mode: string; status: string | null; attentionCode: string | null }[];
  reviews: { id: string; paymentId: string; status: string }[];
  failures: { id: string; channel: string; attempts: number }[];
  inboxFailures: { id: string; contact: string; attempts: number }[];
}

export interface SalesMutationInput {
  suffix?: string;
  method?: string;
  body: unknown;
}
