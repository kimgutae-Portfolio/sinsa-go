import type { VisitorSummary, VisitorCounters } from "./visitorStats";
import type { PublicLantern } from "./lanterns";
export interface AdminUser extends VisitorSummary {
  online: boolean;
  activeLanternCount: number;
  expiredLanternCount: number;
}
export interface AdminLantern extends PublicLantern {
  room: string;
  visitorId: string | null;
  status: "active" | "expired";
  reports: number;
}
export interface AdminOverview {
  asOf: number;
  totals: {
    users: number;
    onlineUsers: number;
    connections: number;
    visits: number;
    prayers: number;
    activeLanterns: number;
    retainedExpiredLanterns: number;
    lanternsHung: number;
  };
  daily: {
    day: string;
    connections: number;
    visits: number;
    prayers: number;
    lanterns: number;
  }[];
}
export interface AdminPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  asOf: number;
}
export interface AdminUserDetail {
  user: AdminUser;
  lanterns: AdminLantern[];
  daily: { day: string; counters: VisitorCounters }[];
}
export interface AdminSession {
  configured: boolean;
  authenticated: boolean;
  csrfToken?: string;
  expiresAt?: number;
}
