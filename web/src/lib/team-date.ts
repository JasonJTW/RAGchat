// Dates as the team reads them: YYYY-MM-DD in Taiwan.
const TEAM_DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" });

/** The ISO timestamp as a date in Taiwan, e.g. "2026-11-14". */
export function teamDate(iso: string): string {
  return TEAM_DATE.format(new Date(iso));
}
