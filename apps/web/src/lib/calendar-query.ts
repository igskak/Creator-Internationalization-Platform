import { localDate, localParts, parseLocalDateTime, zonedToUtc } from "@rc/modules/publishing/time";

// URL state and week arithmetic of /content/calendar (plan 10 §10.2): the view, the week and the
// time zone of the grid live in the address. Pure functions, shared by the page and its links.

export const CALENDAR_VIEWS = ["week", "list"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export type CalendarFilters = {
  view: CalendarView;
  /** A date ("2026-10-19") inside the week to show; undefined = this week. */
  week: string | undefined;
  /** `markets.code` whose time zone the grid is drawn in; undefined = the first active market. */
  zone: string | undefined;
};

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value) || undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseCalendarSearch(params: Params): CalendarFilters {
  const view = first(params.view);
  const week = first(params.week);
  const zone = first(params.zone);
  return {
    view: view === "list" ? "list" : "week",
    week: week && DATE.test(week) && parseLocalDateTime(`${week}T00:00`) ? week : undefined,
    zone: zone && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(zone) ? zone : undefined,
  };
}

export function calendarHref(
  filters: CalendarFilters,
  change: Partial<CalendarFilters> = {},
): string {
  const next = { ...filters, ...change };
  const query = new URLSearchParams();
  if (next.view !== "week") query.set("view", next.view);
  if (next.week) query.set("week", next.week);
  if (next.zone) query.set("zone", next.zone);
  const text = query.toString();
  return text ? `/content/calendar?${text}` : "/content/calendar";
}

const pad = (n: number) => String(n).padStart(2, "0");
const toDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** `date` moved by whole days (calendar arithmetic, no time zone involved). */
export const addDays = (date: string, days: number): string =>
  toDate(dayMs(date) + days * 86_400_000);

/** The Monday of the week that contains the calendar date. */
export function mondayOf(date: string): string {
  const weekday = (new Date(dayMs(date)).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

export type WeekRange = {
  /** Monday's date. */
  monday: string;
  /** The seven dates, Monday first. */
  days: string[];
  /** The instants the week starts and ends at in `timeZone` (a week with a clock change is not 168 hours). */
  from: Date;
  to: Date;
};

/** The week to show in `timeZone`: the one in the address, else the one that contains `now`. */
export function weekRange(
  filters: Pick<CalendarFilters, "week">,
  now: Date,
  timeZone: string,
): WeekRange {
  const today = localDate(now, timeZone);
  const monday = mondayOf(filters.week ?? today);
  const start = (date: string) =>
    zonedToUtc(
      parseLocalDateTime(`${date}T00:00`) as NonNullable<ReturnType<typeof parseLocalDateTime>>,
      timeZone,
    ).utc;
  return {
    monday,
    days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
    from: start(monday),
    to: start(addDays(monday, 7)),
  };
}

/** Today's date in the zone, to mark the column. */
export const todayIn = (now: Date, timeZone: string): string => localDate(now, timeZone);

/** Hour and minute of an instant in a zone as "13:05". */
export function clock(at: Date, timeZone: string): string {
  const p = localParts(at, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
