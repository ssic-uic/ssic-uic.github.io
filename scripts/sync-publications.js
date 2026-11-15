// Weekly publication sync. Runs in GitHub Actions (it needs open network access).
//
// ORCID decides which papers are ours. Crossref supplies the exact title, authors,
// volume/pages and dates for each DOI. OpenAlex is checked for papers missing from
// ORCID; those go to data/review.yml for the owner to confirm, never added automatically.
//
// Rules:
// - year = the year the paper first appeared (Crossref "issued": the earlier of
//   online and print), so a paper never moves year when its print issue comes out.
// - papers already listed are permanent: the sync updates their details from Crossref
//   (and swaps a listed preprint for its published version) but never removes or
//   hides them. Only the owner removes a listed paper. The rules below apply to new items.
// - themes set by the owner (themes_set_by: owner) are never changed; new papers get
//   a guess (themes_set_by: guess).
// - anything that needs the owner's decision goes to data/review.yml with the date it
//   was first seen: papers OpenAlex finds that ORCID lacks, new ORCID entries whose
//   DOI points to a different work, new ORCID entries without a DOI, and new papers
//   where Crossref does not list J. Cabana. data/known.yml lists items the owner has
//   seen and wants left alone; they are never raised again.
// - only peer-reviewed journal articles are listed (owner's rule): no conference
//   abstracts, proceedings, book chapters, preprints or editorials. A preprint whose
//   Crossref record points to a published version is replaced by that version.
//   Everything left out is recorded in data/excluded.yml and never re-added; delete
//   an entry there to revisit it. The owner can add DOIs there to exclude them.
// - corresponding authorship (for the Research page, which shows each theme's most
//   recent papers with J. Cabana as corresponding author) comes from OpenAlex's
//   is_corresponding flags: corresponding: true/false, corresponding_set_by: openalex.
//   When OpenAlex flags nobody on a paper, the field stays absent (unknown) and the
//   last known value is kept. The owner's word (corresponding_set_by: owner) is never
//   changed. Unknown papers recent enough to take a Research-page slot go to review.yml.
//
// Env: ORCID (required), CONTACT_EMAIL (sent to Crossref as a courtesy),
// OPENALEX_API_KEY (optional; the OpenAlex check also runs without one).
// data/extra-papers.yml lists papers the owner wants listed: DOIs the ORCID record lacks,
// and pieces the owner confirmed (such as editorials) that the rules would otherwise leave out.
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const ORCID = process.env.ORCID;
const EMAIL = process.env.CONTACT_EMAIL || "";
const OPENALEX_KEY = process.env.OPENALEX_API_KEY || "";
// DATA_DIR lets the tests run the sync against a scratch copy of the data
const DATA = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const EXTRA = path.join(DATA, "extra-papers.yml");
const PUBS = path.join(DATA, "publications.yml");
const EXCLUDED = path.join(DATA, "excluded.yml");
const REVIEW = path.join(DATA, "review.yml");
const KNOWN = path.join(DATA, "known.yml");
const RESEARCH = path.join(DATA, "research.yml");
// ORCID work types that can be peer-reviewed articles; Crossref has the final say
const KEEP_TYPES = new Set(["journal-article", "review", "letter"]);
const UA = `ssic-website publication sync (mailto:${EMAIL})`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const normDoi = d => (d || "").trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
const SKIP_TITLE = /^(publisher|author)?\s*correction|^correction to|^erratum|^retraction|^expression of concern/i;
const bigrams = s => { const b = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); b.set(k, (b.get(k) || 0) + 1); } return b; };
function similar(a, b) {
  if (!a || !b) return 0;
  const A = bigrams(a), B = bigrams(b); let both = 0;
  for (const [k, n] of A) both += Math.min(n, B.get(k) || 0);
  return (2 * both) / (a.length + b.length - 2);
}
const normTitle = t => (t || "").toLowerCase().normalize("NFKD").replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "");

async function getJSON(url, headers = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers } });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${url}`);
    } catch (e) {
      if (attempt === 3) throw e;
    }
    await sleep(2000 * attempt);
  }
  return null;
}

// ---------- sources ----------
async function orcidWorks(orcid) {
  const j = await getJSON(`https://pub.orcid.org/v3.0/${orcid}/works`);
  if (!j) throw new Error("ORCID record not found");
  return (j.group || []).map(g => {
    const s = (g["work-summary"] || [])[0] || {};
    const ids = (g["external-ids"] || {})["external-id"] || [];
    const doi = ids.find(i => i["external-id-type"] === "doi" && i["external-id-relationship"] !== "part-of");
    return {
      title: s.title?.title?.value || "",
      type: s.type || "",
      year: s["publication-date"]?.year?.value || "",
      journal: s["journal-title"]?.value || "",
      doi: doi ? normDoi(doi["external-id-value"]) : "",
    };
  });
}

async function crossref(doi) {
  const j = await getJSON(`https://api.crossref.org/works/${encodeURIComponent(doi)}${EMAIL ? `?mailto=${encodeURIComponent(EMAIL)}` : ""}`);
  return j ? j.message : null;
}

// Works without a key: plain page numbers (not cursor paging, which needs a key)
// and about two requests a week, well inside OpenAlex's keyless daily allowance.
async function openalexDois(orcid) {
  const out = [];
  const key = OPENALEX_KEY ? `&api_key=${encodeURIComponent(OPENALEX_KEY)}` : "";
  try {
    for (let page = 1; page <= 10; page++) {
      const j = await getJSON(`https://api.openalex.org/works?filter=author.orcid:${orcid}&per-page=200&page=${page}&select=doi,title,publication_year,type,authorships${key}`);
      const results = (j && j.results) || [];
      results.forEach(w => out.push({ doi: normDoi(w.doi), title: w.title || "", year: w.publication_year, type: w.type, corresponding: cabanaCorresponds(w.authorships, orcid) }));
      if (!results.length || page * 200 >= (j.meta?.count || 0)) break;
      await sleep(500);
    }
  } catch (e) {
    console.log(`OpenAlex check skipped: ${e.message}`);
    return null;
  }
  return out;
}

// Is J. Cabana a corresponding author, per OpenAlex? true / false, or null when OpenAlex
// flags no corresponding author at all on the paper (unknown, not "no").
function cabanaCorresponds(authorships, orcid) {
  const list = authorships || [];
  if (!list.some(a => a.is_corresponding)) return null;
  const isMe = a => (orcid && String(a.author?.orcid || "").endsWith(orcid)) || isCabana({ family: (a.author?.display_name || a.raw_author_name || "").split(/\s+/).pop() });
  return list.some(a => a.is_corresponding && isMe(a));
}

// ---------- formatting ----------
const decode = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function plain(s) {
  // MathML formulas (used by APS): drop the markup and the whitespace between its pieces
  let t = (s || "").replace(/<mml:math[\s\S]*?<\/mml:math>/g, m => m.replace(/>\s+</g, "><").replace(/<[^>]+>/g, ""));
  // join formula pieces that markup split apart: "V <sub>2</sub> O <sub>5</sub>" -> "V2O5"
  t = t.replace(/<(sub|sup)>\s*([\s\S]*?)\s*<\/\1>/g, "<$1>$2</$1>")
       .replace(/\s+(?=<(sub|sup)>)/g, "")
       .replace(/<\/(sub|sup)>\s+(?=[A-Z][A-Za-z]*<(sub|sup)>)/g, "</$1>");
  return decode(t.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function initials(given) {
  return given.trim().split(/\s+/).map(part =>
    part.split("-").map(p => p.replace(/\./g, "")).filter(Boolean).map(p => p[0].toUpperCase() + ".").join("-")
  ).join(" ");
}
function authorList(authors) {
  const names = (authors || []).map(a => a.family ? `${a.given ? initials(a.given) + " " : ""}${a.family}` : (a.name || "")).filter(Boolean);
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}
const isCabana = a => /^cabana/i.test((a.family || a.name || "").normalize("NFKD").replace(/[̀-ͯ]/g, ""));
const dateOf = parts => parts && parts[0] ? parts[0].map((n, i) => i ? String(n).padStart(2, "0") : String(n)).join("-") : "";

function fromCrossref(m) {
  const issued = m.issued?.["date-parts"] || m["published-online"]?.["date-parts"] || m["published-print"]?.["date-parts"];
  const pages = m.page ? m.page.replace(/-/g, "–") : (m["article-number"] || "");
  return {
    year: issued?.[0]?.[0] ? Number(issued[0][0]) : null,
    published: dateOf(issued),
    title: plain((m.title || [])[0]),
    authors: authorList(m.author),
    journal: plain((m["short-container-title"] || [])[0] || (m["container-title"] || [])[0] || ""),
    citation: [m.volume, pages].filter(Boolean).join(", ") || "online ahead of print",
    hasCabana: (m.author || []).some(isCabana),
    type: m.type,
  };
}

// Why a Crossref record is not a peer-reviewed journal article, or "" if it is one.
const ABSTRACT_VENUES = /meeting abstracts|ecs transactions|proceedings|proc\.|symposium|conference|congress/i;
function notArticleReason(m) {
  const type = m.type || "";
  if (type === "posted-content") return "preprint";
  if (/proceedings/.test(type)) return "conference proceedings";
  if (/book|monograph|reference/.test(type)) return "book or book chapter";
  if (type === "dataset" || type === "component") return "dataset or supplement";
  if (type === "peer-review") return "peer-review report";
  if (type !== "journal-article") return `not a journal article (${type || "unknown type"})`;
  const venue = [...(m["container-title"] || []), ...(m["short-container-title"] || [])].join(" ");
  const page = String(m.page || "");
  const [a, b] = page.split(/[-–]/).map(x => parseInt(String(x).replace(/\D/g, ""), 10));
  const span = Number.isFinite(a) && Number.isFinite(b) ? b - a + 1 : (Number.isFinite(a) ? 1 : 0);
  if (ABSTRACT_VENUES.test(venue)) return "conference abstract or proceedings";
  // its meeting abstracts are 1-2 pages, often with no page range at all, in supplement issues
  if (/microscopy and microanalysis|microsc\.? microanal/i.test(venue) && (span <= 2 || /s|suppl/i.test(String(m.issue || "")))) return "conference abstract";
  if (/acta cryst/i.test(venue) && /^[ae]\d/i.test(page)) return "conference abstract";
  if (/supplement/i.test(String(m.issue || "")) && span > 0 && span <= 2) return "conference abstract";
  return "";
}
const publishedVersion = m => normDoi((((m.relation || {})["is-preprint-of"] || []).find(r => r["id-type"] === "doi") || {}).id || "");

function guessThemes(title) {
  const t = title.toLowerCase();
  const th = [];
  if (/intercalat|ion(ic)? conduct|ionic|diffusion|transport|cathode|anode|electrode|magnesium|calcium|sodium|li-ion|na-ion|mg-ion|solid electrolyte|batter/.test(t)) th.push("ion");
  if (/anionic|oxygen redox|anion redox|covalen|ligand|li-rich|li-excess|lithium-rich|disordered rock|oxyfluoride|chalcogenide/.test(t)) th.push("redox");
  if (/interphase|interface|interfacial|catalys|co2|co₂|oxygen evolution|plating|electrodeposit|deposition|decomposition|oxidation of/.test(t)) th.push("interface");
  if (/x-ray|xas|xanes|exafs|rixs|ptycho|tomograph|diffraction|scattering|spectromicroscopy|imaging|bragg|synchrotron|microscopy/.test(t)) th.push("xray");
  return th;
}


// ---------- main ----------
const readYaml = (f, fallback) => fs.existsSync(f) ? (YAML.parse(fs.readFileSync(f, "utf8")) ?? fallback) : fallback;
const PREPRINT_VENUE = /chemrxiv|arxiv|research square|ssrn|biorxiv|preprints\.org|techrxiv|engrxiv/i;

async function main() {
  if (!ORCID) throw new Error("Set ORCID");
  const today = new Date().toISOString().slice(0, 10);
  const text = fs.readFileSync(PUBS, "utf8");
  const header = text.split("\n").filter(l => l.startsWith("#")).join("\n");
  const existing = YAML.parse(text) || [];
  const permanent = new Set(existing); // listed before this run: never removed
  const byDoi = new Map(), byTitle = new Map();
  const index = p => { if (p.doi) byDoi.set(normDoi(p.doi), p); byTitle.set(normTitle(p.title), p); };
  existing.forEach(index);
  const findSimilar = (title, year) => existing.find(e => (!year || Math.abs(Number(e.year) - Number(year)) <= 1) && similar(normTitle(e.title), normTitle(title)) >= 0.9);

  const report = { added: [], updated: [], excluded: [] };
  const pending = []; // items for the owner's decision
  const ask = (kind, title, doi, detail) => pending.push({ kind, title, doi: doi || undefined, detail });

  const extras = readYaml(EXTRA, []);
  const excludedList = readYaml(EXCLUDED, []);
  // the owner's include list wins over the rules
  const ownerListed = new Set(extras.map(e => normDoi(e.doi)));
  for (let i = excludedList.length - 1; i >= 0; i--) if (ownerListed.has(normDoi(excludedList[i].doi))) excludedList.splice(i, 1);
  const excludedDois = new Set(excludedList.map(e => normDoi(e.doi)));
  const exclude = (doi, title, reason) => {
    if (!doi || excludedDois.has(doi)) return;
    excludedDois.add(doi);
    excludedList.push({ doi, title, reason, by: "rule", date: today });
    report.excluded.push(`${title} (${reason})`);
  };

  const fromOrcid = (await orcidWorks(ORCID)).filter(w => (!w.type || KEEP_TYPES.has(w.type)) && !SKIP_TITLE.test(w.title.trim()));
  console.log(`ORCID: ${fromOrcid.length} works, plus ${extras.length} on the owner's include list`);
  // the owner's include list first, so ORCID entries without a DOI then match those papers by title
  const works = [...extras.map(e => ({ title: "", year: "", journal: "", doi: normDoi(e.doi), owner: true })), ...fromOrcid];
  // listed papers ORCID no longer carries still get their details refreshed
  const orcidDois = new Set(works.map(w => w.doi).filter(Boolean));
  existing.filter(p => p.doi && !orcidDois.has(normDoi(p.doi))).forEach(p => works.push({ title: p.title, year: p.year, journal: p.journal, doi: normDoi(p.doi), listed: true }));

  const seen = new Set();
  const droppedPreprints = [];
  const mt = m => plain((m.title || [])[0]);

  // refresh a listed paper from a Crossref record; returns nothing
  function refresh(p, doi, m, w) {
    const c = fromCrossref(m);
    if (!c.year || !c.title) return;
    const before = JSON.stringify(p);
    if (p.doi && normDoi(p.doi) !== doi) byDoi.delete(normDoi(p.doi));
    Object.assign(p, { doi, url: `https://doi.org/${doi}`, title: c.title, year: c.year, published: c.published, authors: c.authors, citation: c.citation });
    if (!p.journal || PREPRINT_VENUE.test(p.journal)) p.journal = c.journal || (w && w.journal) || p.journal;
    delete p.check; delete p.hide;
    byDoi.set(doi, p); byTitle.set(normTitle(p.title), p);
    if (JSON.stringify(p) !== before) report.updated.push(`${c.year} ${p.title}`);
  }

  for (const w of works) {
    let p = (w.doi && byDoi.get(w.doi)) || byTitle.get(normTitle(w.title)) || (w.title ? findSimilar(w.title, w.year) : null);
    let doi = w.doi || (p && p.doi ? normDoi(p.doi) : "");
    if (doi && seen.has(doi)) continue;
    if (doi) seen.add(doi);

    if (!doi) { if (!p) ask("orcid-no-doi", w.title, "", `ORCID entry (${w.year || "no year"}) has no DOI, so it can't be checked or added.`); continue; }

    // a listed paper: refresh, never remove (the matched record must really be this DOI)
    if (p && permanent.has(p) && normDoi(p.doi) === doi) {
      let m = await crossref(doi); await sleep(120);
      if (!m) continue;
      if (m.type === "posted-content" && publishedVersion(m) && !byDoi.has(publishedVersion(m))) {
        const pub = publishedVersion(m);
        const pm = await crossref(pub); await sleep(120);
        if (pm && !notArticleReason(pm)) { exclude(doi, mt(m), "preprint; the published version is listed"); seen.add(pub); refresh(p, pub, pm, w); continue; }
      }
      if (w.title && similar(normTitle(w.title), normTitle(mt(m))) < 0.5 && !w.listed) {
        ask("orcid-wrong-doi", w.title, doi, `ORCID entry carries DOI ${doi}, which is "${mt(m)}". The listed paper is unaffected.`);
        continue;
      }
      refresh(p, doi, m, w);
      continue;
    }

    // ---- a new item: the rules apply ----
    if (excludedDois.has(doi)) {
      const ex = excludedList.find(e => normDoi(e.doi) === doi);
      if (w.title && ex && similar(normTitle(w.title), normTitle(ex.title)) < 0.5) ask("orcid-wrong-doi", w.title, doi, `ORCID entry carries DOI ${doi}, which is "${ex.title}".`);
      continue;
    }
    let m = await crossref(doi); await sleep(120);
    if (!m) { ask("orcid-no-doi", w.title, doi, `DOI ${doi} is not in Crossref, so it can't be checked.`); continue; }
    if (m.type === "posted-content" && publishedVersion(m)) {
      const pub = publishedVersion(m);
      exclude(doi, mt(m), "preprint; the published version is listed");
      if (byDoi.has(pub) || seen.has(pub)) continue;
      seen.add(pub);
      doi = pub;
      m = await crossref(doi); await sleep(120);
      if (!m) continue;
    }
    if (w.title && similar(normTitle(w.title), normTitle(mt(m))) < 0.5) {
      ask("orcid-wrong-doi", w.title, doi, `ORCID entry carries DOI ${doi}, which is "${mt(m)}". Not added.`);
      continue;
    }
    const why = w.owner ? "" : notArticleReason(m);
    if (why) { if (why === "preprint") droppedPreprints.push(mt(m) || w.title); exclude(doi, mt(m) || w.title, why); continue; }
    const c = fromCrossref(m);
    if (!c.year || !c.title || SKIP_TITLE.test(c.title)) continue;
    if (!c.hasCabana && !w.owner) { ask("not-author", c.title, doi, `On the ORCID record, but Crossref does not list J. Cabana among the authors. Not added.`); continue; }
    // already listed under another DOI: upgrade a listed preprint, otherwise keep the listed record
    const twin = byTitle.get(normTitle(c.title)) || findSimilar(c.title, c.year);
    if (twin) { if (PREPRINT_VENUE.test(twin.journal || "")) { exclude(normDoi(twin.doi), twin.title, "preprint; the published version is listed"); refresh(twin, doi, m, w); } continue; }
    const np = { year: c.year, published: c.published, title: c.title, authors: c.authors, journal: c.journal || w.journal,
      citation: c.citation, url: `https://doi.org/${doi}`, doi, themes: guessThemes(c.title), themes_set_by: "guess", added: today };
    existing.push(np); index(np);
    report.added.push(`${c.year} ${c.title}`);
  }

  // papers OpenAlex links to the ORCID iD but ORCID does not list
  const oa = await openalexDois(ORCID);
  const NOISE = /^chem\s*inform abstract|^research data supporting|^supplementary|^data:/i;
  const bare = t => normTitle(plain(t).replace(/^chem\s*inform abstract:\s*/i, ""));
  const listed = t => existing.some(e => similar(normTitle(e.title), bare(t)) >= 0.85);
  for (const w of oa || []) {
    if (!w.doi || byDoi.has(w.doi) || excludedDois.has(w.doi) || ownerListed.has(w.doi) || NOISE.test(w.title.trim()) || listed(w.title)) continue;
    if (!KEEP_TYPES.has(w.type === "article" ? "journal-article" : w.type)) continue;
    const m = await crossref(w.doi); await sleep(120);
    if (!m || notArticleReason(m)) continue;
    const c = fromCrossref(m);
    // the published version of a preprint dropped this run: list it in the preprint's place
    if (c.hasCabana && droppedPreprints.some(t => similar(normTitle(t), normTitle(c.title)) >= 0.9)) {
      const np = { year: c.year, published: c.published, title: c.title, authors: c.authors, journal: c.journal,
        citation: c.citation, url: `https://doi.org/${w.doi}`, doi: w.doi, themes: guessThemes(c.title), themes_set_by: "guess", added: today };
      existing.push(np); index(np);
      report.added.push(`${c.year} ${c.title} (published version of a preprint)`);
      continue;
    }
    ask("openalex-find", c.title, w.doi, `${c.journal || "journal unknown"}, ${c.year}. Linked to the ORCID iD by OpenAlex but not on the ORCID record. Crossref ${c.hasCabana ? "lists" : "does not list"} J. Cabana as an author.`);
  }

  // ---- corresponding authorship (Research page) ----
  const oaCorr = new Map((oa || []).filter(w => w.doi && w.corresponding !== null && w.corresponding !== undefined).map(w => [w.doi, w.corresponding]));
  for (const p of existing) {
    if (p.corresponding_set_by === "owner" || !p.doi) continue;
    const v = oaCorr.get(normDoi(p.doi));
    if (v === undefined) continue; // unknown this week: keep what we had
    p.corresponding = v; p.corresponding_set_by = "openalex";
  }
  // unknown papers that could take one of a theme's three Research-page slots: ask the owner
  const newestFirst = [...existing].filter(p => !p.hide).sort((a, b) => (b.year - a.year) || String(b.published || "").localeCompare(String(a.published || "")));
  const unknownAsked = new Set();
  for (const k of readYaml(RESEARCH, {}).themes?.map(t => t.key) || ["ion", "redox", "interface", "xray"]) {
    let shown = 0;
    for (const p of newestFirst.filter(p => (p.themes || []).includes(k))) {
      if (shown >= 3) break;
      if (p.corresponding === true) shown++;
      else if (p.corresponding === undefined && !unknownAsked.has(p)) {
        unknownAsked.add(p);
        ask("corresponding-unknown", p.title, p.doi, `${p.journal} ${p.year}. OpenAlex doesn't say who the corresponding author is, and the paper is recent enough to be one of the Research page's papers. Is J. Cabana a corresponding author?`);
      }
    }
  }

  // ---- the review list: pending decisions, minus anything known or already decided ----
  const keyOf = i => `${i.kind}|${i.doi ? normDoi(i.doi) : normTitle(i.title)}`;
  const knownKeys = new Set(readYaml(KNOWN, []).map(keyOf));
  const prev = new Map(readYaml(REVIEW, []).map(i => [keyOf(i), i]));
  const decided = i => i.doi && (byDoi.has(normDoi(i.doi)) || excludedDois.has(normDoi(i.doi)) || ownerListed.has(normDoi(i.doi))) && !["orcid-wrong-doi", "corresponding-unknown"].includes(i.kind);
  const review = [];
  const keys = new Set();
  for (const i of pending) {
    const k = keyOf(i);
    if (keys.has(k) || knownKeys.has(k) || decided(i)) continue;
    keys.add(k);
    review.push({ kind: i.kind, title: i.title, ...(i.doi ? { doi: i.doi } : {}), detail: i.detail, first_seen: (prev.get(k) || {}).first_seen || today });
  }
  review.sort((a, b) => b.first_seen.localeCompare(a.first_seen) || a.kind.localeCompare(b.kind));
  const fresh = review.filter(i => i.first_seen === today);

  // ---- write ----
  existing.sort((a, b) => (b.year - a.year) || String(b.published || "").localeCompare(String(a.published || "")) || a.title.localeCompare(b.title));
  const order = ["year", "published", "title", "authors", "journal", "citation", "url", "doi", "themes", "themes_set_by", "corresponding", "corresponding_set_by", "added"];
  const tidy = existing.map(p => Object.fromEntries(order.filter(k => p[k] !== undefined && p[k] !== "").map(k => [k, p[k]])));
  fs.writeFileSync(PUBS, header + "\n" + YAML.stringify(tidy, { lineWidth: 0 }));
  fs.writeFileSync(EXCLUDED, "# Works left out of the site because they are not peer-reviewed journal articles\n# (conference abstracts, proceedings, book chapters, preprints, editorials).\n# by: rule = left out automatically; owner = the owner's decision. The sync never re-adds\n# anything listed here. To revisit one, delete its entry.\n" + YAML.stringify(excludedList, { lineWidth: 0 }));
  fs.writeFileSync(REVIEW, "# Decisions waiting for the owner, newest first. Written by the weekly sync; don't edit by hand.\n# kinds: openalex-find (a paper ORCID lacks), not-author (Crossref doesn't list J. Cabana),\n# orcid-wrong-doi (an ORCID entry's DOI points to another work), orcid-no-doi,\n# corresponding-unknown (could be on the Research page; set corresponding + corresponding_set_by: owner).\n# An item leaves this list once it is decided: added to extra-papers.yml, excluded.yml, or known.yml.\n" + (review.length ? YAML.stringify(review, { lineWidth: 0 }) : "[]\n"));

  const lines = [
    `## Publication sync, ${today}`,
    `${tidy.length} papers listed. ${report.added.length} added, ${report.updated.length} updated from Crossref, ${report.excluded.length} left out as not peer-reviewed articles. ${fresh.length} new item(s) for the owner to decide; ${review.length} waiting in total${oa === null ? " (OpenAlex check skipped)" : ""}.`,
    ...[["Added", report.added], ["Left out (not peer-reviewed articles)", report.excluded], ["New for the owner to decide", fresh.map(i => `${i.title} (${i.kind}): ${i.detail}`)]]
      .filter(([, l]) => l.length).map(([h, l]) => `\n### ${h}\n` + l.map(x => `- ${x}`).join("\n")),
  ];
  const summary = lines.join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { cabanaCorresponds, authorList, initials, fromCrossref, guessThemes, plain, normDoi, notArticleReason, publishedVersion, main };
