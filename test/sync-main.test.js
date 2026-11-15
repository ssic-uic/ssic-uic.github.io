// Runs the whole sync offline against fake ORCID / Crossref / OpenAlex answers.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const YAML = require("yaml");

const article = (title, extra = {}) => ({ type: "journal-article", title: [title], author: [{ given: "Jordi", family: "Cabana" }],
  "container-title": ["Chemistry of Materials"], "short-container-title": ["Chem. Mater."], volume: "1", page: "1-10", issued: { "date-parts": [[2026, 1, 5]] }, ...extra });
const crossref = {
  "10.1/listed": article("A listed paper that became odd", { type: "posted-content" }), // must stay anyway
  "10.1/new": article("A new peer-reviewed article"),
  "10.1/abstract": article("A meeting abstract", { "container-title": ["Microscopy and Microanalysis"], page: "1-2" }),
  "10.1/notours": article("Somebody else's paper", { author: [{ given: "A", family: "Other" }] }),
  "10.1/other": article("Another work entirely"),
  "10.1/oa": article("Found by OpenAlex"),
};
const orcid = { group: [
  ["A listed paper that became odd", "10.1/listed"], ["A new peer-reviewed article", "10.1/new"], ["A meeting abstract", "10.1/abstract"],
  ["Somebody else's paper", "10.1/notours"], ["My abstract with the wrong DOI", "10.1/other"], ["A seen entry without a DOI", ""], ["A new entry without a DOI", ""],
].map(([t, d]) => ({ "work-summary": [{ title: { title: { value: t } }, type: "journal-article", "publication-date": { year: { value: "2026" } } }],
  "external-ids": { "external-id": d ? [{ "external-id-type": "doi", "external-id-value": d, "external-id-relationship": "self" }] : [] } })) };
const openalex = { results: [{ doi: "https://doi.org/10.1/oa", title: "Found by OpenAlex", publication_year: 2026, type: "article" }], meta: { count: 1 } };

function fakeFetch(url) {
  const ok = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  if (url.includes("pub.orcid.org")) return ok(orcid);
  if (url.includes("api.openalex.org")) return ok(openalex);
  const doi = decodeURIComponent(url.split("/works/")[1].split("?")[0]);
  return crossref[doi] ? ok({ message: crossref[doi] }) : Promise.resolve({ ok: false, status: 404 });
}

test("listed papers stay; only new items reach the owner", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
  const w = (f, v) => fs.writeFileSync(path.join(dir, f), typeof v === "string" ? v : YAML.stringify(v));
  w("publications.yml", "# header\n" + YAML.stringify([{ year: 2025, title: "A listed paper that became odd", authors: "J. Cabana", journal: "Chem. Mater.", citation: "1, 1", url: "https://doi.org/10.1/listed", doi: "10.1/listed", themes: ["ion"], themes_set_by: "owner" }]));
  w("extra-papers.yml", []); w("excluded.yml", []);
  w("known.yml", [{ kind: "orcid-no-doi", title: "A seen entry without a DOI" }]);
  w("review.yml", [{ kind: "not-author", title: "Somebody else's paper", doi: "10.1/notours", detail: "x", first_seen: "2026-01-01" }]);

  Object.assign(process.env, { ORCID: "0000-0000-0000-0000", DATA_DIR: dir, OPENALEX_API_KEY: "" });
  const realFetch = global.fetch, realLog = console.log;
  global.fetch = fakeFetch; console.log = () => {};
  delete require.cache[require.resolve("../scripts/sync-publications.js")];
  try { await require("../scripts/sync-publications.js").main(); }
  finally { global.fetch = realFetch; console.log = realLog; delete process.env.DATA_DIR; }

  const pubs = YAML.parse(fs.readFileSync(path.join(dir, "publications.yml"), "utf8"));
  const titles = pubs.map(p => p.title);
  assert.ok(titles.includes("A listed paper that became odd"), "a listed paper was removed");
  assert.deepStrictEqual(pubs.find(p => p.doi === "10.1/listed").themes, ["ion"], "owner's themes changed");
  assert.ok(titles.includes("A new peer-reviewed article"), "new article not added");
  assert.ok(!titles.includes("A meeting abstract"), "abstract was added");
  assert.ok(!titles.includes("Somebody else's paper"), "non-author paper was added");

  const excluded = YAML.parse(fs.readFileSync(path.join(dir, "excluded.yml"), "utf8"));
  assert.ok(excluded.some(e => e.doi === "10.1/abstract"), "abstract not recorded as excluded");

  const review = YAML.parse(fs.readFileSync(path.join(dir, "review.yml"), "utf8"));
  const kinds = Object.fromEntries(review.map(i => [i.title, i]));
  assert.strictEqual(kinds["Somebody else's paper"].first_seen, "2026-01-01", "first_seen not kept");
  assert.strictEqual(kinds["My abstract with the wrong DOI"].kind, "orcid-wrong-doi");
  assert.strictEqual(kinds["A new entry without a DOI"].kind, "orcid-no-doi");
  assert.strictEqual(kinds["Found by OpenAlex"].kind, "openalex-find");
  assert.ok(!kinds["A seen entry without a DOI"], "a known item was raised again");
  assert.ok(!titles.includes("Found by OpenAlex"), "OpenAlex find was added without the owner");
});
