/**
 * DSAL results-page parser: scraped HTML → normalized `DsalRecord`s.
 *
 * The query CGI wraps every entry in the same skeleton across all four
 * dictionaries (verified against live samples, kept as test fixtures):
 *
 *   <div class='container mb-3 rounded border shadow-sm py-3'>&nbsp;&nbsp;
 *     1) <a href="/cgi-bin/app/<slug>_query.py?qs=<hw>&…matchtype=exact"><hw text></a> <translit>
 *     (<a href="…?page=767">p. 767</a>)
 *     <div class='px-4'>…entry body…</div>
 *   </div>
 *
 * What differs per dictionary is the body markup:
 *  - Molesworth/Vaze: `<hw>…</hw> <i>n</i> S  gloss. 2 gloss. 3 gloss…`
 *    (POS in the first italic after the headword; senses as inline
 *    numbers in prose; `<d>…</d>` wraps Marathi example text).
 *  - Platts: `<entry><span class="new_p">A <hw><pa>کمل</pa> <d>कमल</d>
 *    <i>kamal</i></hw> , s.m. …` (etymology letter before the headword;
 *    Devanagari orthography in `<d>`; POS as `s.m.`/`adj.` abbreviations;
 *    no numbered senses — one long body).
 *  - Praharaj: fully tagged — `<gramGrp>` for the grammar marker,
 *    `<sense>` containing `<span class="new_p">` per sense with `<nmb>`
 *    numbers, `<verse>` spans holding quotations, `<or>` wrapping Odia
 *    text (the importer's en/or split leans on the resulting `ODIA— 1.
 *    English.` shape surviving into the cleaned sense text).
 *
 * Parsing is regex-over-known-shape, not a general HTML parser — the
 * pages are machine-generated and regular, the same trade the branch-
 * era Molesworth TEI scanner made. If DSAL redesigns, fixtures break
 * loudly and we revisit.
 */
import type { DsalDictionaryConfig } from './config.js';
import type { DsalRecord } from './records.js';

export type ParseStats = {
  /** Entry blocks found in the HTML. */
  blocks: number;
  /** Records successfully parsed. */
  parsed: number;
  /** Platts entries dropped because no Devanagari orthography exists. */
  noDevanagari: number;
  /** Blocks dropped for a missing/empty headword. */
  noHeadword: number;
  /** Blocks dropped for a missing/empty body. */
  noBody: number;
  /** The "N results" count the page itself declares, if present. */
  declaredResults: number | null;
};

export type ParseOutcome = {
  records: Array<Omit<DsalRecord, 'ord'>>;
  stats: ParseStats;
};

const ENTRY_BLOCK_OPEN = "<div class='container mb-3 rounded border shadow-sm py-3'>";
const BODY_OPEN = "<div class='px-4'>";

const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** Strip tags, decode the entities DSAL pages actually use, collapse whitespace. */
export function htmlToText(html: string): string {
  let text = html.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)));
  text = text.replace(/&[a-z]+;|&#39;/gi, (m) => NAMED_ENTITIES[m.toLowerCase()] ?? m);
  return text.replace(/\s+/g, ' ').trim();
}

/** The "N results" / "1 result" count the results page declares about itself. */
export function parseDeclaredResultCount(html: string): number | null {
  const m = /(\d[\d,]*)\s+results?\b/.exec(html);
  if (!m) return null;
  return Number(m[1]!.replace(/,/g, ''));
}

type EntryBlock = {
  /** Text of the headword anchor. */
  anchorText: string;
  /** Untagged text between the anchor and the page ref — the printed transliteration. */
  anchorTail: string;
  page: number | undefined;
  /** Inner HTML of the `<div class='px-4'>` body. */
  bodyHtml: string;
};

function splitEntryBlocks(html: string): { blocks: EntryBlock[]; total: number } {
  const chunks = html.split(ENTRY_BLOCK_OPEN).slice(1);
  const blocks: EntryBlock[] = [];
  for (const chunk of chunks) {
    const anchor = /<a href="[^"]*_query\.py\?qs=[^"]*matchtype=exact"[^>]*>([\s\S]*?)<\/a>([^<(]*)/.exec(chunk);
    const page = /_query\.py\?page=(\d+)/.exec(chunk);
    // Bodies contain spans and inline tags but no nested <div> (checked
    // against all four dictionaries), so the first </div> closes the body.
    const bodyStart = chunk.indexOf(BODY_OPEN);
    let bodyHtml = '';
    if (bodyStart !== -1) {
      const rest = chunk.slice(bodyStart + BODY_OPEN.length);
      const bodyEnd = rest.indexOf('</div>');
      bodyHtml = bodyEnd === -1 ? rest : rest.slice(0, bodyEnd);
    }
    blocks.push({
      anchorText: anchor ? htmlToText(anchor[1]!) : '',
      anchorTail: anchor ? anchor[2]!.trim() : '',
      page: page ? Number(page[1]) : undefined,
      bodyHtml,
    });
  }
  return { blocks, total: chunks.length };
}

/**
 * Molesworth prefixes glosses with a single-capital etymology marker
 * (S Sanskrit, A Arabic, P Persian, H Hindi, E English…); Platts puts
 * the same letter before the headword. Strip it from the start of a
 * sense so glosses don't all begin "S Knowledge…".
 */
function stripEtymologyLetter(text: string): string {
  return text.replace(/^[A-Z](?:\s*&\s*[A-Z])?\s+(?=[A-Z(,])/, '');
}

/**
 * Split Molesworth-style prose senses at inline numbers: the first
 * sense is unnumbered, subsequent ones start " 2 ", " 3 ", … in an
 * ascending run. Numbers inside examples don't ascend from the current
 * position, so requiring the exact next index keeps them in the text.
 */
export function splitNumberedSenses(text: string): string[] {
  const matches = [...text.matchAll(/\s(\d{1,2})\s+/g)];
  const cuts: Array<{ index: number; length: number }> = [];
  let expected = 2;
  for (const m of matches) {
    if (Number(m[1]) === expected) {
      cuts.push({ index: m.index!, length: m[0]!.length });
      expected += 1;
    }
  }
  if (cuts.length === 0) return [text.trim()].filter(Boolean);
  const senses: string[] = [];
  let start = 0;
  for (const cut of cuts) {
    senses.push(text.slice(start, cut.index).trim());
    start = cut.index + cut.length;
  }
  senses.push(text.slice(start).trim());
  return senses.filter(Boolean);
}

/** Remove the `<hw>…</hw>` element (and Platts' `<entry>` wrapper) from a body. */
function dropHeadwordElement(bodyHtml: string): string {
  return bodyHtml.replace(/<hw>[\s\S]*?<\/hw>/, ' ').replace(/<\/?entry>/g, ' ');
}

/* ------------------------------------------------------------------ */
/* Molesworth / Vaze                                                   */
/* ------------------------------------------------------------------ */

/** POS is the first italic right after the headword element: `</hw> <i>n</i>`. */
const MARATHI_POS_RE = /<\/hw>\s*<i>([^<]{1,20})<\/i>/;

function parseMarathiBlock(block: EntryBlock): Omit<DsalRecord, 'ord' | 'slug'> | null {
  const hw = block.anchorText.normalize('NFC');
  if (!hw) return null;
  const posMatch = MARATHI_POS_RE.exec(block.bodyHtml);
  let body = dropHeadwordElement(block.bodyHtml);
  if (posMatch) body = body.replace(`<i>${posMatch[1]!}</i>`, ' ');
  const text = stripEtymologyLetter(htmlToText(body));
  if (!text) return null;
  const rec: Omit<DsalRecord, 'ord' | 'slug'> = {
    hw,
    senses: splitNumberedSenses(text),
  };
  if (block.anchorTail) rec.translit = block.anchorTail;
  if (posMatch) rec.posRaw = posMatch[1]!.trim();
  if (block.page !== undefined) rec.page = block.page;
  return rec;
}

/* ------------------------------------------------------------------ */
/* Platts                                                              */
/* ------------------------------------------------------------------ */

const PLATTS_POS_RE =
  /\b(s\.m\.|s\.f\.|adj\.|adv\.|v\.n\.|v\.t\.|intj\.|interj\.|prep\.|postpn\.|pron\.|conj\.|part\.)/;

type PlattsParse =
  | { kind: 'record'; rec: Omit<DsalRecord, 'ord' | 'slug'> }
  | { kind: 'noDevanagari' }
  | { kind: 'noBody' };

function parsePlattsBlock(block: EntryBlock, config: DsalDictionaryConfig): PlattsParse {
  const hwElement = /<hw>([\s\S]*?)<\/hw>/.exec(block.bodyHtml);
  const hwHtml = hwElement?.[1] ?? '';
  // The Devanagari orthography lives in <d>…</d> inside the headword
  // element. Entries carrying only Perso-Arabic + roman (pure
  // Urdu/Arabic vocabulary) can't be matched by a Devanagari reader and
  // are skipped — the count is reported, not swallowed.
  const devanagari = [...hwHtml.matchAll(/<d>([^<]+)<\/d>/g)]
    .map((m) => m[1]!.trim().normalize('NFC'))
    .filter((s) => config.scriptRange.test(s));
  if (devanagari.length === 0) return { kind: 'noDevanagari' };

  const hwAlt = [...hwHtml.matchAll(/<pa>([^<]+)<\/pa>/g)].map((m) => m[1]!.trim());
  const translitMatch = /<i>([^<]+)<\/i>/.exec(hwHtml);

  const text = stripEtymologyLetter(htmlToText(dropHeadwordElement(block.bodyHtml)))
    .replace(/^[,\s]+/, '');
  if (!text) return { kind: 'noBody' };
  const posMatch = PLATTS_POS_RE.exec(text);

  const rec: Omit<DsalRecord, 'ord' | 'slug'> = {
    hw: devanagari[0]!,
    senses: [text],
  };
  const alts = [...devanagari.slice(1), ...hwAlt];
  if (alts.length > 0) rec.hwAlt = alts;
  if (translitMatch) rec.translit = translitMatch[1]!.trim();
  else if (block.anchorTail) rec.translit = block.anchorTail;
  if (posMatch) rec.posRaw = posMatch[1]!;
  if (block.page !== undefined) rec.page = block.page;
  return { kind: 'record', rec };
}

/* ------------------------------------------------------------------ */
/* Praharaj                                                            */
/* ------------------------------------------------------------------ */

/**
 * Praharaj senses are `<span class="new_p">` chunks inside `<sense>`:
 * a span opening with `<nmb>N</nmb>` starts sense N; a span without a
 * number (typically a `<verse>` quotation) belongs to the sense before
 * it. Entries without a `<sense>` element fall back to the whole body.
 */
function praharajSenses(bodyHtml: string): string[] {
  const senseEl = /<sense>([\s\S]*?)<\/sense>/.exec(bodyHtml);
  const scope = senseEl?.[1] ?? dropHeadwordElement(bodyHtml).replace(/<gramGrp>[\s\S]*?<\/gramGrp>/, ' ');
  const spans = [...scope.matchAll(/<span class="new_p">([\s\S]*?)<\/span>/g)].map((m) => m[1]!);
  if (spans.length === 0) {
    const text = htmlToText(scope);
    return text ? [text] : [];
  }
  const senses: string[] = [];
  for (const span of spans) {
    const startsNewSense = /^\s*(?:<[^>]+>\s*)*<nmb>/.test(span);
    const text = htmlToText(span.replace(/<nmb>\d+<\/nmb>\s*।?/, ' '));
    if (!text) continue;
    if (startsNewSense || senses.length === 0) senses.push(text);
    else senses[senses.length - 1] += ` ${text}`;
  }
  return senses;
}

function parsePraharajBlock(block: EntryBlock): Omit<DsalRecord, 'ord' | 'slug'> | null {
  const hw = block.anchorText.normalize('NFC');
  if (!hw) return null;
  const senses = praharajSenses(block.bodyHtml);
  if (senses.length === 0) return null;
  // The grammar marker is the first Odia-tagged run inside <gramGrp>,
  // e.g. `ସଂ. ବି. (ଅଭି+ଧା ଧାତୁ+ଭାବ. ଅନ)`.
  const gramGrp = /<gramGrp>[\s\S]*?<or>([\s\S]*?)<\/or>/.exec(block.bodyHtml);
  const rec: Omit<DsalRecord, 'ord' | 'slug'> = { hw, senses };
  if (block.anchorTail) rec.translit = block.anchorTail;
  if (gramGrp) rec.posRaw = htmlToText(gramGrp[1]!).replace(/[—-]\s*$/, '').trim();
  if (block.page !== undefined) rec.page = block.page;
  return rec;
}

/* ------------------------------------------------------------------ */

export function parseDsalResultsHtml(html: string, config: DsalDictionaryConfig): ParseOutcome {
  const { blocks, total } = splitEntryBlocks(html);
  const stats: ParseStats = {
    blocks: total,
    parsed: 0,
    noDevanagari: 0,
    noHeadword: 0,
    noBody: 0,
    declaredResults: parseDeclaredResultCount(html),
  };
  const records: Array<Omit<DsalRecord, 'ord'>> = [];

  for (const block of blocks) {
    if (config.slug === 'dsal-platts') {
      const outcome = parsePlattsBlock(block, config);
      if (outcome.kind === 'noDevanagari') stats.noDevanagari += 1;
      else if (outcome.kind === 'noBody') stats.noBody += 1;
      else {
        records.push({ ...outcome.rec, slug: config.slug });
        stats.parsed += 1;
      }
      continue;
    }

    const rec =
      config.slug === 'dsal-praharaj' ? parsePraharajBlock(block) : parseMarathiBlock(block);
    if (!rec) {
      if (block.anchorText) stats.noBody += 1;
      else stats.noHeadword += 1;
      continue;
    }
    if (!config.scriptRange.test(rec.hw)) {
      stats.noHeadword += 1;
      continue;
    }
    records.push({ ...rec, slug: config.slug });
    stats.parsed += 1;
  }

  return { records, stats };
}
