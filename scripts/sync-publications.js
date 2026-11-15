// Weekly publication sync. Runs in GitHub Actions (it needs open network access).
//
// ORCID decides which papers are ours. Crossref supplies the exact title, authors,
// volume/pages and dates for each DOI. OpenAlex is checked for papers missing from
// ORCID; those are written to data/candidates.yml for the owner to confirm, never
// added automatically.
//
// Rules:
// - year = the year the paper first appeared (Crossref "issued": the earlier of
//   online and print), so a paper never moves year when its print issue comes out.
// - themes set by the owner (themes_set_by: owner) are never changed; new papers get
//   a guess (themes_set_by: guess).
// - a "check" note is cleared once Crossref confirms the record.
//
// Env: ORCID (required), CONTACT_EMAIL (sent to Crossref as a courtesy),
// OPENALEX_API_KEY (optional; the OpenAlex check also runs without one).
// data/extra-papers.yml lists DOIs to include even though the ORCID record lacks them.
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const ORCID = process.env.ORCID;
const EMAIL = process.env.CONTACT_EMAIL || "";
const OPENALEX_KEY = process.env.OPENALEX_API_KEY || "";
const EXTRA = path.join(__dirname, "..", "data", "extra-papers.yml");
const root = path.join(__dirname, "..");
const PUBS = path.join(root, "data", "publications.yml");
const CANDIDATES = path.join(root, "data", "candidates.yml");
const KEEP_TYPES = new Set(["journal-article", "review", "book-chapter", "letter", "editorial"]);
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
      const j = await getJSON(`https://api.openalex.org/works?filter=author.orcid:${orcid}&per-page=200&page=${page}&select=doi,title,publication_year,type${key}`);
      const results = (j && j.results) || [];
      results.forEach(w => out.push({ doi: normDoi(w.doi), title: w.title || "", year: w.publication_year, type: w.type }));
      if (!results.length || page * 200 >= (j.meta?.count || 0)) break;
      await sleep(500);
    }
  } catch (e) {
    console.log(`OpenAlex check skipped: ${e.message}`);
    return null;
  }
  return out;
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
async function main() {
  if (!ORCID) throw new Error("Set ORCID");
  const today = new Date().toISOString().slice(0, 10);
  const text = fs.readFileSync(PUBS, "utf8");
  const header = text.split("\n").filter(l => l.startsWith("#")).join("\n");
  const existing = YAML.parse(text) || [];
  const byDoi = new Map(), byTitle = new Map();
  existing.forEach(p => { if (p.doi) byDoi.set(normDoi(p.doi), p); byTitle.set(normTitle(p.title), p); });

  const extras = fs.existsSync(EXTRA) ? (YAML.parse(fs.readFileSync(EXTRA, "utf8")) || []) : [];
  const fromOrcid = (await orcidWorks(ORCID)).filter(w => (!w.type || KEEP_TYPES.has(w.type)) && !SKIP_TITLE.test(w.title.trim()));
  // extra DOIs first, so ORCID entries without a DOI then match them by title
  const works = [...extras.map(e => ({ title: "", type: "journal-article", year: "", journal: "", doi: normDoi(e.doi) })), ...fromOrcid];
  const findSimilar = (title, year) => existing.find(e => Math.abs(Number(e.year) - Number(year || e.year)) <= 1 && similar(normTitle(e.title), normTitle(title)) >= 0.9);
  const done = new Set();
  console.log(`ORCID: ${fromOrcid.length} works, plus ${extras.length} extra DOI(s)`);
  const report = { added: [], updated: [], flagged: [], unmatched: [] };
  const seen = new Set();

  for (const w of works) {
    let p = (w.doi && byDoi.get(w.doi)) || byTitle.get(normTitle(w.title)) || findSimilar(w.title, w.year);
    const doi = w.doi || (p && p.doi) || "";
    if (doi && seen.has(doi)) continue;
    if (doi) seen.add(doi);
    const m = doi ? await crossref(doi) : null;
    await sleep(120);
    if (!m) {
      if (!p) report.unmatched.push(`${w.year} ${w.title} (no DOI found)`);
      continue;
    }
    const c = fromCrossref(m);
    if (!c.year || !c.title || SKIP_TITLE.test(c.title)) continue;
    if (!p) p = byTitle.get(normTitle(c.title)) || findSimilar(c.title, c.year);
    // the same paper listed twice on ORCID (for example a cover-art DOI): keep the first record
    if (p && done.has(p)) continue;
    if (p && p.doi && normDoi(p.doi) !== doi && byDoi.get(normDoi(p.doi)) === p && works.some(o => o.doi === normDoi(p.doi))) continue;
    if (!p) {
      p = { year: c.year, published: c.published, title: c.title, authors: c.authors, journal: c.journal || w.journal,
            citation: c.citation, url: `https://doi.org/${doi}`, doi, themes: guessThemes(c.title),
            themes_set_by: "guess", added: today };
      existing.push(p);
      byTitle.set(normTitle(p.title), p); byDoi.set(doi, p);
      report.added.push(`${c.year} ${c.title}`);
    } else {
      const before = JSON.stringify(p);
      p.doi = doi;
      p.title = c.title;
      p.year = c.year;
      p.published = c.published;
      p.authors = c.authors;
      p.citation = c.citation;
      if (!p.journal) p.journal = c.journal || w.journal;
      if (p.check) delete p.check;
      if (JSON.stringify(p) !== before) report.updated.push(`${c.year} ${p.title}`);
    }
    done.add(p);
    if (!c.hasCabana) {
      p.check = "Crossref does not list J. Cabana among the authors. Confirm this paper belongs here.";
      p.hide = true; // kept off the site until confirmed
      report.flagged.push(`${c.year} ${p.title}`);
    }
  }

  // papers OpenAlex links to the ORCID iD but ORCID does not list: hold for confirmation
  const oa = await openalexDois(ORCID);
  const known = new Set(existing.map(p => normDoi(p.doi)).filter(Boolean));
  // drop noise: abstract-service reprints, datasets, and papers already listed under another DOI
  const NOISE = /^chem\s*inform abstract|^research data supporting|^supplementary/i;
  const bare = t => normTitle(plain(t).replace(/^chem\s*inform abstract:\s*/i, ""));
  const listed = t => existing.some(e => similar(normTitle(e.title), bare(t)) >= 0.85);
  const candidates = [];
  for (const w of oa || []) {
    if (!w.doi || known.has(w.doi) || NOISE.test(w.title.trim()) || listed(w.title)) continue;
    if (!KEEP_TYPES.has(w.type === "article" ? "journal-article" : w.type)) continue;
    const m = await crossref(w.doi);
    await sleep(120);
    const c = m ? fromCrossref(m) : null;
    candidates.push({
      year: (c && c.year) || w.year, title: (c && c.title) || plain(w.title), journal: (c && c.journal) || "",
      doi: w.doi, cabana_in_crossref_authors: c ? c.hasCabana : "unknown", found_by: "OpenAlex",
      note: "Not on the ORCID record. Confirm it is ours before it is added.",
    });
  }
  candidates.sort((a, b) => b.year - a.year);

  // order: newest first by date of first appearance
  existing.sort((a, b) => (b.year - a.year) || String(b.published || "").localeCompare(String(a.published || "")) || a.title.localeCompare(b.title));
  const order = ["year", "published", "title", "authors", "journal", "citation", "url", "doi", "themes", "themes_set_by", "added", "check", "hide"];
  const tidy = existing.map(p => Object.fromEntries(order.filter(k => p[k] !== undefined && p[k] !== "").map(k => [k, p[k]])));
  fs.writeFileSync(PUBS, header + "\n" + YAML.stringify(tidy, { lineWidth: 0 }));
  fs.writeFileSync(CANDIDATES, "# Papers that OpenAlex links to the ORCID iD but the ORCID record does not list.\n# Confirm before adding; they are not shown on the site.\n" + YAML.stringify(candidates, { lineWidth: 0 }));

  const lines = [
    `## Publication sync, ${today}`,
    `${tidy.length} papers in total. ${report.added.length} added, ${report.updated.length} updated from Crossref, ${report.flagged.length} flagged, ${candidates.length} candidates from OpenAlex${oa === null ? " (OpenAlex check skipped)" : ""}.`,
    ...[["Added", report.added], ["Flagged", report.flagged], ["No DOI found", report.unmatched]]
      .filter(([, l]) => l.length).map(([h, l]) => `\n### ${h}\n` + l.map(x => `- ${x}`).join("\n")),
  ];
  const summary = lines.join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { authorList, initials, fromCrossref, guessThemes, plain, normDoi };
