// Builds the site into dist/ from the data files in data/ and the sources in src/.
// Run with: npm run build
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const crypto = require("crypto");
const { validate } = require("./validate");
const { groupMembers, boldAuthors } = require("../lib/group-authors");

const root = path.join(__dirname, "..");
const out = path.join(root, "dist");
const PHOTOS = path.join(root, "data", "photos");
// The site's public address. If a custom domain is added later, change it here only:
// the canonical link, sitemap.xml and robots.txt all follow.
const SITE_URL = "https://ssic-uic.github.io/";
const read = f => YAML.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));

function loadData() {
  return {
    photos: fs.existsSync(PHOTOS) ? fs.readdirSync(PHOTOS).filter(f => !f.startsWith(".")) : [],
    research: read("research.yml").themes,
    people: read("people.yml"),
    alumni: read("alumni.yml").groups,
    news: read("news.yml").items || [],
    publications: read("publications.yml") || [],
    openings: read("join.yml").openings || [],
    groupAuthors: fs.existsSync(path.join(root, "data", "group-authors.yml")) ? read("group-authors.yml") || [] : [],
  };
}

// photo: file.webp in the data becomes assets/photos/file.webp?v=<hash>, so a replaced
// photo shows up at once instead of waiting for browser caches to expire
function photoURL(file) {
  const hash = crypto.createHash("sha1").update(fs.readFileSync(path.join(PHOTOS, file))).digest("hex").slice(0, 8);
  return `assets/photos/${encodeURIComponent(file)}?v=${hash}`;
}
const withPhoto = ({ family, ...m }) => (m.photo ? { ...m, photo: photoURL(m.photo) } : m);

function siteFrom(d) {
  const ppl = d.people;
  const members = groupMembers(d.people, d.alumni);
  return {
    research: d.research,
    people: { ...ppl, pi: withPhoto(ppl.pi),
      ...Object.fromEntries(["postdocs", "grads", "undergrads"].map(g => [g, (ppl[g] || []).map(withPhoto)])) },
    alumni: d.alumni,
    // draft news stays out of the public site until approved
    news: d.news.filter(n => n.status === "published").map(({ status, ...n }) => ({ ...n, date: String(n.date) })),
    // papers flagged "hide" (for example, authorship not confirmed) stay off the site
    publications: d.publications.filter(p => !p.hide).map(p => ({
      year: String(p.year), title: p.title, authors: p.authors, journal: p.journal,
      citation: String(p.citation ?? ""), url: p.url, doi: String(p.doi || "").toLowerCase(), themes: p.themes || [],
      ...(p.corresponding === true ? { corresponding: true } : {}),
      // group members on the paper, bolded on the page (lib/group-authors.js, data/group-authors.yml)
      ...((b => (b.length ? { bold: b } : {}))(boldAuthors(p, members, d.groupAuthors))),
    })),
    openings: d.openings,
    updated: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" }),
  };
}

function build() {
  const data = loadData();
  const errors = validate(data);
  if (errors.length) {
    console.error("Data problems, build stopped:\n- " + errors.join("\n- "));
    process.exit(1);
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "assets", "fonts"), { recursive: true });

  // For search engines. The pages are #sections of one URL, so the sitemap lists that one URL.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  fs.writeFileSync(path.join(out, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${SITE_URL}</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`);
  fs.writeFileSync(path.join(out, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
  for (const f of ["tokens.css", "styles.css", "app.js"]) {
    fs.copyFileSync(path.join(root, "src", f), path.join(out, "assets", f));
  }
  if (fs.existsSync(PHOTOS)) {
    fs.mkdirSync(path.join(out, "assets", "photos"));
    for (const f of fs.readdirSync(PHOTOS).filter(f => f.endsWith(".webp"))) fs.copyFileSync(path.join(PHOTOS, f), path.join(out, "assets", "photos", f));
  }
  const fontDir = path.join(root, "node_modules", "@fontsource-variable", "schibsted-grotesk", "files");
  for (const f of ["schibsted-grotesk-latin-wght-normal.woff2", "schibsted-grotesk-latin-wght-italic.woff2"]) {
    fs.copyFileSync(path.join(fontDir, f), path.join(out, "assets", "fonts", f));
  }

  fs.writeFileSync(path.join(out, "assets", "data.js"), "window.SITE = " + JSON.stringify(siteFrom(data)) + ";\n");
  const chem = fs.readFileSync(path.join(root, "lib", "chem.js"), "utf8");
  fs.writeFileSync(path.join(out, "assets", "chem.js"), "(function(){ var module;\n" + chem + "\nwindow.chem = chem; })();\n");

  // index.html is written last so each script and stylesheet link can carry ?v=<hash of the built file>.
  // A change to the data or design then reaches visitors at once instead of waiting for
  // browsers (phones especially) to drop their cached copies.
  const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8")
    .replace("</title>", `</title>\n<link rel="canonical" href="${SITE_URL}">\n<meta property="og:url" content="${SITE_URL}">`)
    .replace(/(src|href)="assets\/([\w.-]+\.(?:js|css))"/g, (m, attr, f) => {
      const file = path.join(out, "assets", f);
      if (!fs.existsSync(file)) return m;
      const hash = crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
      return `${attr}="assets/${f}?v=${hash}"`;
    });
  fs.writeFileSync(path.join(out, "index.html"), html);

  console.log(`Built dist/: ${data.publications.length} papers, ${data.news.filter(n => n.status === "published").length} published news items.`);
}

if (require.main === module) build();
module.exports = { loadData, siteFrom };
