import { clearWorkbenchCache } from "./workbenchCache";

// Keep the existing key so search/reading users retain their login state.
// Reviewer owns user_id/username/current_user; never read or change those keys.
export const RESEARCH_ACCOUNT_KEY = "paperseacrh_current_user";
export const RESEARCH_ACCOUNT_EVENT = "research-account-changed";

export function readResearchUsername(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(RESEARCH_ACCOUNT_KEY) || "";
}

export function writeResearchUsername(username: string): void {
  clearWorkbenchCache();
  if (username) window.localStorage.setItem(RESEARCH_ACCOUNT_KEY, username);
  else window.localStorage.removeItem(RESEARCH_ACCOUNT_KEY);
  window.dispatchEvent(new Event(RESEARCH_ACCOUNT_EVENT));
}
