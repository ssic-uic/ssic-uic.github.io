// Builds the site into dist/ from the data files in data/ and the sources in src/.
// Run with: npm run build
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const crypto = require("crypto");
const { validate } = require("./validate");

const root = path.join(__dirname, "..");
const out = path.join(root, "dist");
const PHOTOS = path.join(root, "data", "photos");
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
      citation: String(p.citation ?? ""), url: p.url, themes: p.themes || [],
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

  fs.copyFileSync(path.join(root, "src", "index.html"), path.join(out, "index.html"));
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

  console.log(`Built dist/: ${data.publications.length} papers, ${data.news.filter(n => n.status === "published").length} published news items.`);
}

if (require.main === module) build();
module.exports = { loadData, siteFrom };
