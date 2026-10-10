// Time zones for scheduling (plan 05 §5.1, 10 §10.5): the database and the actions use UTC, the
// people think in the market's time zone. Pure functions over Intl, no dependencies, so the
// calendar's client code can use them too.

/** The offset of `timeZone` from UTC at `instant`, in minutes (Madrid in summer: 120). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

export type LocalDateTime = {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

/** "2026-10-20T13:00" → its parts; null if it is not that shape or not a real date. */
export function parseLocalDateTime(text: string): LocalDateTime | null {
  const m = LOCAL.exec(text.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  return { year, month, day, hour, minute };
}

/**
 * The instant at which the wall clock of `timeZone` shows `local`. A time that does not exist
 * (the hour skipped when clocks go forward) is moved forward by that hour and `adjusted` says so;
 * a time that happens twice (clocks go back) is the first of the two.
 */
export function zonedToUtc(
  local: LocalDateTime,
  timeZone: string,
): { utc: Date; adjusted: boolean } {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  // Two passes settle the offset around a change of offset.
  let utc = wall - zoneOffsetMinutes(new Date(wall), timeZone) * 60_000;
  utc = wall - zoneOffsetMinutes(new Date(utc), timeZone) * 60_000;
  // Ambiguous hour: the earlier instant is the one whose offset is the larger.
  const earlier = utc - 3_600_000;
  if (wall - zoneOffsetMinutes(new Date(earlier), timeZone) * 60_000 === earlier) utc = earlier;
  const back = localParts(new Date(utc), timeZone);
  const adjusted =
    back.year !== local.year ||
    back.month !== local.month ||
    back.day !== local.day ||
    back.hour !== local.hour ||
    back.minute !== local.minute;
  return { utc: new Date(utc), adjusted };
}

/** The wall clock of `timeZone` at `instant`. */
export function localParts(instant: Date, timeZone: string): LocalDateTime & { weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    year,
    month,
    day,
    hour: get("hour"),
    minute: get("minute"),
    // 0 = Monday … 6 = Sunday, from the calendar date alone.
    weekday: (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The wall clock as "2026-10-20T13:00", the value of a `datetime-local` input. */
export function formatLocalDateTime(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "2026-10-20" of the wall clock, to put a post on its day of the calendar. */
export const localDate = (instant: Date, timeZone: string): string =>
  formatLocalDateTime(instant, timeZone).slice(0, 10);

/** "UTC+2" / "UTC-5" / "UTC+5:30" for the zone at `instant`. */
export function offsetLabel(instant: Date, timeZone: string): string {
  const minutes = zoneOffsetMinutes(instant, timeZone);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${pad(m)}` : ""}`;
}
