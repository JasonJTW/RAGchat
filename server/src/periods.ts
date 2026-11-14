// The past time a question asks about: 「三月時…」「去年…」「上週…」
// 「2026-05-14 那天…」. Read by rules, in Taiwan time, so a question about
// what held then is answered from the facts valid then (時間檢索).

/** A span of time, from `from` (inclusive) to `to` (exclusive). */
export interface Period {
  from: Date;
  to: Date;
}

const NUMERALS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
};

const MONTH = String.raw`(1[0-2]|0?[1-9]|十[一二]?|[一二三四五六七八九])`;
const DAY = String.raw`(3[01]|[12]\d|0?[1-9])`;
const S = String.raw`\s*`;
const YEAR_WORD = "(去年|前年|今年)";
// Not 「每月」「個月」「下個月」: a month needs a numeral right before 月.
const PATTERNS: {
  re: RegExp;
  read: (m: RegExpExecArray, now: Today) => Period | undefined;
}[] = [
  {
    re: new RegExp(
      String.raw`(\d{4})${S}(?:[-/.]|年)${S}(\d{1,2})${S}(?:[-/.]|月)${S}(\d{1,2})`,
    ),
    read: (m) => day(+m[1], +m[2], +m[3]),
  },
  {
    re: new RegExp(
      String.raw`(\d{4})${S}(?:年${S}${MONTH}${S}月|[-/](\d{1,2})(?![\d/-]))`,
    ),
    read: (m) => month(+m[1], m[2] ? numeral(m[2]) : +m[3]),
  },
  {
    re: new RegExp(
      String.raw`${YEAR_WORD}?${S}(?<![\d])${MONTH}${S}月${S}${DAY}${S}[日號]`,
    ),
    read: (m, now) => {
      const mon = numeral(m[2]);
      return day(yearOf(m[1], mon, now), mon, +m[3]);
    },
  },
  {
    re: new RegExp(String.raw`${YEAR_WORD}?${S}(?<![\d個每])${MONTH}${S}月`),
    read: (m, now) => {
      const mon = numeral(m[2]);
      return month(yearOf(m[1], mon, now), mon);
    },
  },
  { re: /(\d{4})\s*年/, read: (m) => year(+m[1]) },
  {
    re: /去年|前年/,
    read: (m, now) => year(now.year - (m[0] === "前年" ? 2 : 1)),
  },
  {
    re: /上個?月/,
    read: (_, now) =>
      now.month === 1
        ? month(now.year - 1, 12)
        : month(now.year, now.month - 1),
  },
  {
    re: /上(?:個)?(?:週|周|星期|禮拜)/,
    read: (_, now) => {
      // Monday of this week, then the week before it.
      const monday = Date.UTC(now.year, now.month - 1, now.day - now.weekday);
      const from = new Date(monday - 7 * DAY_MS);
      return {
        from: taipei(
          from.getUTCFullYear(),
          from.getUTCMonth() + 1,
          from.getUTCDate(),
        ),
        to: taipei(now.year, now.month, now.day - now.weekday),
      };
    },
  },
];

const DAY_MS = 86_400_000;

const TEAM_DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" });

/** A time as the team reads its date: YYYY-MM-DD in Taiwan. */
export function teamDate(at: Date | string): string {
  return TEAM_DATE.format(new Date(at));
}

/** A YYYY-MM-DD as midnight in Taiwan (epoch ms); NaN if it isn't one. */
export function teamMidnight(date: string | null | undefined): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(date ?? "")
    ? Date.parse(`${date}T00:00:00+08:00`)
    : NaN;
}

// What makes a named time the time asked about, rather than a date the
// question merely mentions (「2026-11-12 週會決議…」): 「…時」「…的時候」
// 「…當時」「…以前」 after it, or 「在」「截至」「到」 before it.
const AT_THAT_TIME =
  /^\s*[日號份]?\s*的?\s*(?:時候|時|當時|那時|那天|那週|那個月|那年|那陣子|以前|之前|為止)/;
const AS_OF = /(?:在|於|截至|截止|到)\s*$/;

/**
 * The past period the text asks about: a time it names as the time asked
 * about (「三月時」「截至 2026-05-14」, see AT_THAT_TIME). Undefined when it
 * names none, or one that has not ended yet (今年, this month, the
 * future): that is a question about now.
 */
export function periodAsked(text: string, now: Date): Period | undefined {
  const today = todayOf(now);
  for (const { re, read } of PATTERNS)
    for (const match of text.matchAll(new RegExp(re.source, "g"))) {
      const end = match.index + match[0].length;
      if (
        !AT_THAT_TIME.test(text.slice(end)) &&
        !AS_OF.test(text.slice(0, match.index))
      )
        continue;
      const period = read(match, today);
      if (!period || Number.isNaN(period.to.getTime())) return undefined;
      return period.to.getTime() > now.getTime() ? undefined : period;
    }
  return undefined;
}

interface Today {
  year: number;
  month: number;
  day: number;
  /** 0 for Monday … 6 for Sunday. */
  weekday: number;
}

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
});
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function todayOf(now: Date): Today {
  const parts = Object.fromEntries(
    PARTS.formatToParts(now).map((p) => [p.type, p.value]),
  );
  return {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

function numeral(text: string): number {
  return NUMERALS[text] ?? Number(text);
}

// A month named without a year is its latest one: this year's, unless that
// is still to come.
function yearOf(word: string | undefined, mon: number, now: Today): number {
  if (word === "去年") return now.year - 1;
  if (word === "前年") return now.year - 2;
  if (word === "今年") return now.year;
  return mon > now.month ? now.year - 1 : now.year;
}

// Midnight in Taiwan; days and months past their end roll over.
function taipei(y: number, m: number, d: number): Date {
  const utc = new Date(Date.UTC(y, m - 1, d));
  const iso = utc.toISOString().slice(0, 10);
  return new Date(`${iso}T00:00:00+08:00`);
}

function day(y: number, m: number, d: number): Period | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  return { from: taipei(y, m, d), to: taipei(y, m, d + 1) };
}

function month(y: number, m: number): Period | undefined {
  if (m < 1 || m > 12) return undefined;
  return { from: taipei(y, m, 1), to: taipei(y, m + 1, 1) };
}

function year(y: number): Period {
  return { from: taipei(y, 1, 1), to: taipei(y + 1, 1, 1) };
}
