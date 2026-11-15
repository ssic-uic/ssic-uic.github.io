// Imports a folder of photos dropped by group members (e.g. downloaded from the Box
// file request) into the site.
//
//   node scripts/import-photos.js <folder> [--dry-run]
//
// Each file is matched to a current member (or the PI) by the name in its file name:
// "Meghan Burns.jpg", "burns_meghan.HEIC" and "Dzevad Kozlica (1).png" all work;
// accents, case, order and extra words don't matter. Matched photos go through
// add-member.js (square crop, 480×480 WebP, metadata stripped). iPhone HEIC files are
// converted first with Python's pillow-heif (pip install pillow-heif).
//
// Files already imported (same content) are skipped, so the whole folder can be passed
// every time; data/photo-intake.yml records what was imported and when. When one
// member has several new files, the newest wins.
//
// Prints a JSON report: imported, skipped (already done) and needs_owner (no match,
// several matches, or not a readable image) for the owner to sort out.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const YAML = require("yaml");
const { upsert, makePhoto, photoFile } = require("./add-member");

const root = path.join(__dirname, "..");
const DEFAULTS = {
  peoplePath: path.join(root, "data", "people.yml"),
  photosDir: path.join(root, "data", "photos"),
  intakePath: path.join(root, "data", "photo-intake.yml"),
};
const IMAGE = /\.(jpe?g|png|webp|tiff?|heic|heif|avif|gif)$/i;

const tokens = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\(.*?\)/g, " ").split(/[^a-z]+/).filter(Boolean);

function rosterOf(people) {
  return [people.pi, ...["postdocs", "grads", "undergrads"].flatMap(g => people[g] || [])]
    .filter(Boolean).map(m => ({ name: m.name, tokens: tokens(m.name) }));
}

// The member whose every name part appears in the file name; when several do, the one
// with the most name parts (so "Kin Lung Seetho" beats a shorter name inside it).
function matchName(file, roster) {
  const t = new Set(tokens(path.basename(file).replace(/\.[^.]+$/, "")));
  const hits = roster.filter(m => m.tokens.length && m.tokens.every(x => t.has(x)));
  if (!hits.length) return { error: "no current member's full name in the file name" };
  const most = Math.max(...hits.map(h => h.tokens.length));
  const best = hits.filter(h => h.tokens.length === most);
  if (best.length > 1) return { error: `matches several members: ${best.map(b => b.name).join(", ")}` };
  return { name: best[0].name };
}

function heicToJpeg(src) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "heic-")), "photo.jpg");
  const py = "import sys, pillow_heif; from PIL import Image, ImageOps; pillow_heif.register_heif_opener(); " +
    "im = ImageOps.exif_transpose(Image.open(sys.argv[1])); im.convert('RGB').save(sys.argv[2], quality=95)";
  try { execFileSync("python3", ["-I", "-c", py, src, out], { stdio: "pipe" }); }
  catch (e) { throw new Error("HEIC photo could not be converted (pip install pillow-heif): " + String(e.stderr || e.message).trim().split("\n").pop()); }
  return out;
}

async function importPhotos(dir, opts = {}) {
  const { peoplePath, photosDir, intakePath, dryRun } = { ...DEFAULTS, ...opts };
  const doc = YAML.parseDocument(fs.readFileSync(peoplePath, "utf8"));
  const roster = rosterOf(doc.toJS());
  const intake = fs.existsSync(intakePath) ? (YAML.parse(fs.readFileSync(intakePath, "utf8")) || {}).imported || [] : [];
  const seen = new Set(intake.map(i => i.sha1));
  const report = { imported: [], skipped: [], needs_owner: [] };

  const files = fs.readdirSync(dir).filter(f => !f.startsWith(".") && fs.statSync(path.join(dir, f)).isFile())
    .map(f => ({ f, p: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // newest first, so the newest photo per member wins
  const done = new Set();
  for (const { f, p } of files) {
    if (!IMAGE.test(f)) { report.needs_owner.push({ file: f, reason: "not an image file" }); continue; }
    const sha1 = crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
    if (seen.has(sha1)) { report.skipped.push({ file: f, reason: "already imported" }); continue; }
    const m = matchName(f, roster);
    if (m.error) { report.needs_owner.push({ file: f, reason: m.error }); continue; }
    if (done.has(m.name)) { report.skipped.push({ file: f, reason: `older than another new photo of ${m.name}` }); continue; }
    if (dryRun) { report.imported.push({ file: f, name: m.name, dry_run: true }); done.add(m.name); continue; }
    try {
      const src = /\.hei[cf]$/i.test(f) ? heicToJpeg(p) : p;
      const { warn } = await makePhoto(src, m.name, "attention", photosDir);
      upsert(doc, { name: m.name, photo: photoFile(m.name) });
      intake.push({ sha1, name: m.name, date: new Date().toISOString().slice(0, 10) });
      seen.add(sha1);
      done.add(m.name);
      report.imported.push({ file: f, name: m.name, photo: `data/photos/${photoFile(m.name)}`, ...(warn ? { warning: warn } : {}) });
    } catch (e) {
      report.needs_owner.push({ file: f, name: m.name, reason: e.message });
    }
  }
  if (!dryRun && report.imported.length) {
    fs.writeFileSync(peoplePath, doc.toString({ lineWidth: 0 }));
    fs.writeFileSync(intakePath, "# Photos imported by scripts/import-photos.js, by content hash, so a file is never\n" +
      "# imported twice. Only the hash is kept; the original photo is never stored.\n" +
      YAML.stringify({ imported: intake }));
  }
  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args.find(a => !a.startsWith("--"));
  if (!dir) { console.error("Usage: node scripts/import-photos.js <folder> [--dry-run]"); process.exit(1); }
  importPhotos(dir, { dryRun: args.includes("--dry-run") })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { importPhotos, matchName, rosterOf, tokens };
