// Finding personal data in a text (ADR-0004): where the names, organisations,
// contact details and amounts are, never what to replace them with
// (pseudonyms.ts does that). The recognizers for Taiwan's formats are defined
// here once and run two ways:
//
// - `presidioAnalyzer`: the Presidio Analyzer sidecar (docker-compose.yml),
//   sent our recognizers with every request, plus its own English NER model
//   for Latin-script names and its built-in email, phone and card checks.
// - `localAnalyzer`: our recognizers alone, in JavaScript. The fake for tests
//   and E2E (`PII_ANALYZER=local`), since CI has no sidecar.
//
// Every pattern must mean the same in Python's `re` and JavaScript; Presidio
// compiles them case-insensitive, multiline and dot-all, and so does
// `localAnalyzer`.

/** What a sensitive value is; its pseudonym is named after it (〔人名3〕). */
export type PiiKind =
  | "人名"
  | "組織"
  | "電話"
  | "信箱"
  | "身分證"
  | "統編"
  | "地址"
  | "金額"
  | "卡號"
  | "敏感詞";

/** Where a sensitive value is in a text, in JavaScript string offsets. */
export interface PiiSpan {
  start: number;
  end: number;
  kind: PiiKind;
}

export interface PiiAnalyzer {
  /** Throws when it can't look, so nothing passes on unchecked. */
  analyze(text: string): Promise<PiiSpan[]>;
}

declare global {
  // Set by tests in place of the analyzer env picks.
  var PII_ANALYZER: PiiAnalyzer | undefined;
}

const DEFAULT_PRESIDIO_URL = "http://localhost:5002";

/**
 * The analyzer to use: the one a test installed, else the local one when
 * PII_ANALYZER=local, else Presidio at PRESIDIO_URL (default :5002).
 */
export function piiAnalyzer(): PiiAnalyzer {
  if (globalThis.PII_ANALYZER) return globalThis.PII_ANALYZER;
  if (process.env.PII_ANALYZER === "local") return localAnalyzer();
  return presidioAnalyzer(process.env.PRESIDIO_URL || DEFAULT_PRESIDIO_URL);
}

const CJK = "\\u4e00-\\u9fff";
const SURNAMES =
  "王李張劉陳楊黃趙吳周徐孫馬朱胡郭何林高羅鄭梁謝宋唐許韓馮鄧曹彭曾蕭田董袁潘蔣蔡余杜葉程蘇魏呂丁任沈姚盧姜崔鍾譚陸汪范金廖賈夏韋白鄒孟熊秦邱江尹薛閻段雷侯龍史陶黎賀顧毛郝龔邵萬錢嚴武戴莫孔湯簡賴洪施翁游詹柯溫";
const HONORIFICS =
  "先生|小姐|女士|經理|老師|主任|教授|博士|總監|執行長|董事長|同學|律師|醫師|會計師";
const COUNTIES =
  "臺北|台北|新北|桃園|臺中|台中|臺南|台南|高雄|基隆|新竹|嘉義|苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|臺東|台東|澎湖|金門|連江";
// Characters that end a name before an organisation's suffix: punctuation and
// the particles that join one to the rest of a sentence (跟、的、在…).
const NOT_IN_NAME =
  "\\s，。、！？：；「」『』（）()和與跟及的在是向給把被對從為";

interface Recognizer {
  entity: string;
  kind: PiiKind;
  regex: string;
}

/** Our recognizers, as Presidio ad hoc recognizers and the local analyzer run them. */
const RECOGNIZERS: Recognizer[] = [
  {
    entity: "TW_MOBILE",
    kind: "電話",
    regex:
      "(?<!\\d)(?:\\+886[\\s-]?|0)9\\d{2}[\\s-]?\\d{3}[\\s-]?\\d{3}(?!\\d)",
  },
  {
    entity: "TW_LANDLINE",
    kind: "電話",
    regex: "(?<!\\d)(?:\\(0\\d{1,2}\\)\\s?|0\\d{1,2}-)\\d{3,4}-?\\d{4}(?!\\d)",
  },
  {
    entity: "TW_ID",
    kind: "身分證",
    regex: "(?<![A-Za-z0-9])[A-Z][12]\\d{8}(?!\\d)",
  },
  {
    // Any 8 digits could be one, so only right after its label.
    entity: "TW_UBN",
    kind: "統編",
    regex:
      "(?:(?<=統編)|(?<=統編[:： ])|(?<=統一編號)|(?<=統一編號[:： ]))\\d{8}(?!\\d)",
  },
  {
    // From the county or city to the number (and floor).
    entity: "TW_ADDRESS",
    kind: "地址",
    regex: `(?:${COUNTIES})[市縣](?:[${CJK}]{1,3}?[區鄉鎮市])?[${CJK}\\d]{1,8}?(?:路|街|大道)(?:[一二三四五六七八九十\\d]+段)?(?:\\d+巷)?(?:\\d+弄)?\\d+(?:之\\d+)?號(?:\\d+樓(?:之\\d+)?)?`,
  },
  {
    entity: "AMOUNT",
    kind: "金額",
    regex: `(?:NT\\$|NTD\\s?|US\\$|USD\\s?|新台幣|新臺幣|台幣|臺幣)\\s?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?[萬億千百]+)?(?:\\s?元)?|(?<![\\d.])\\d[\\d,]*(?:\\.\\d+)?\\s?[萬億千]*\\s?元(?![件素宇旦])`,
  },
  {
    // Chinese NER is out of scope (spec): a surname before a title only.
    // The title stays; 「林經理」 becomes 「〔人名1〕經理」.
    entity: "ZH_PERSON",
    kind: "人名",
    regex: `[${SURNAMES}][${CJK}]{0,2}?(?=${HONORIFICS})`,
  },
  {
    entity: "ZH_ORGANIZATION",
    kind: "組織",
    regex: `[^${NOT_IN_NAME}]{2,8}?(?:股份有限公司|有限公司|基金會|協會|事務所)`,
  },
  {
    entity: "EMAIL_ADDRESS",
    kind: "信箱",
    regex: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
  },
];

// Presidio's own recognizers worth keeping, by its entity names.
const PRESIDIO_BUILT_IN: Record<string, PiiKind> = {
  PERSON: "人名",
  EMAIL_ADDRESS: "信箱",
  PHONE_NUMBER: "電話",
  CREDIT_CARD: "卡號",
};

const KIND_OF: Record<string, PiiKind> = {
  ...PRESIDIO_BUILT_IN,
  ...Object.fromEntries(RECOGNIZERS.map((r) => [r.entity, r.kind])),
};

/** Our recognizers in JavaScript; no NER model. */
export function localAnalyzer(): PiiAnalyzer {
  const compiled = RECOGNIZERS.map((r) => ({
    kind: r.kind,
    regex: new RegExp(r.regex, "gims"),
  }));
  return {
    analyze: (text) =>
      Promise.resolve(
        compiled.flatMap(({ kind, regex }) =>
          [...text.matchAll(regex)]
            .filter((match) => match[0].length > 0)
            .map((match) => ({
              start: match.index,
              end: match.index + match[0].length,
              kind,
            })),
        ),
      ),
  };
}

const PRESIDIO_TIMEOUT_MS = 10_000;
// Presidio's built-in phone check scores 0.4; ours score 0.85.
const SCORE_THRESHOLD = 0.4;

interface PresidioResult {
  start: number;
  end: number;
  entity_type: string;
}

/** The Presidio Analyzer at `url`, with our recognizers. */
export function presidioAnalyzer(url: string): PiiAnalyzer {
  const endpoint = new URL("/analyze", url).href;
  return {
    async analyze(text) {
      if (!text.trim()) return [];
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          // Presidio's English pipeline: the Chinese text only meets our
          // patterns; its NER model is kept for Latin-script names.
          language: "en",
          score_threshold: SCORE_THRESHOLD,
          entities: Object.keys(KIND_OF),
          ad_hoc_recognizers: RECOGNIZERS.map((r) => ({
            name: r.entity,
            supported_language: "en",
            supported_entity: r.entity,
            patterns: [{ name: r.entity, regex: r.regex, score: 0.85 }],
          })),
        }),
        signal: AbortSignal.timeout(PRESIDIO_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Presidio Analyzer answered ${res.status}`);
      const results = (await res.json()) as PresidioResult[];
      const offset = utf16Offsets(text);
      return results.flatMap((result) => {
        const kind = KIND_OF[result.entity_type];
        if (!kind) return [];
        const span = {
          start: offset[result.start],
          end: offset[result.end],
          kind,
        };
        // Its English model calls runs of Chinese characters names too.
        if (
          result.entity_type === "PERSON" &&
          !isLatinName(text.slice(span.start, span.end))
        )
          return [];
        return [span];
      });
    },
  };
}

const isLatinName = (s: string) =>
  /[A-Za-z]/.test(s) && !new RegExp(`[${CJK}]`).test(s);

// Python counts code points, JavaScript UTF-16 units: the JavaScript offset
// of each code point offset (and of the end).
function utf16Offsets(text: string): number[] {
  const offsets: number[] = [];
  let unit = 0;
  for (const char of text) {
    offsets.push(unit);
    unit += char.length;
  }
  offsets.push(unit);
  return offsets;
}
