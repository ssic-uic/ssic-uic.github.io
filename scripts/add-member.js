// Adds a group member, or gives an existing one a photo.
//
//   node scripts/add-member.js --name "Ana López" --group grads [--argonne] [--family "López"] [--photo ~/ana.jpg]
//   node scripts/add-member.js --name "Meghan Burns" --photo ~/meghan.jpg [--focus top]
//   node scripts/add-member.js --name "Jordi Cabana" --photo ~/jordi.jpg
//
// --group     postdocs | grads | undergrads (needed only for someone new)
// --family    family name, when it isn't the last word (e.g. "Abeysinghe Arachchilage");
//             members are kept in alphabetical order by family name
// --argonne   shows "Based at Argonne"
// --photo     any JPEG, PNG, WebP or TIFF. It is turned into a 480×480 WebP in data/photos/,
//             cropped square around the most salient region (usually the face), rotated
//             upright and stripped of all metadata (camera, GPS, date) before it is saved.
// --focus     how to choose the square: attention (default), entropy, top, center, bottom
//
// The member's thumbnail then shows the photo instead of their initials.
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

const root = path.join(__dirname, "..");
const PEOPLE = path.join(root, "data", "people.yml");
const PHOTOS = path.join(root, "data", "photos");
const SIZE = 480; // 2× the largest thumbnail (the PI's, 240 px)
const GROUPS = { postdoc: "postdocs", postdocs: "postdocs", grad: "grads", grads: "grads", graduate: "grads",
  undergrad: "undergrads", undergrads: "undergrads", undergraduate: "undergrads" };

const slug = name => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const familyOf = m => (m.family || m.name.replace(/\(.*?\)/g, "").trim().split(/\s+/).pop());
const byFamily = (a, b) => familyOf(a).localeCompare(familyOf(b), "en", { sensitivity: "base" })
  || a.name.localeCompare(b.name, "en", { sensitivity: "base" });

const photoFile = name => slug(name) + ".webp";

async function makePhoto(src, name, focus = "attention", dir = PHOTOS) {
  const sharp = require("sharp");
  const position = { attention: sharp.strategy.attention, entropy: sharp.strategy.entropy,
    top: "top", center: "centre", centre: "centre", bottom: "bottom" }[focus];
  if (position === undefined) throw new Error(`--focus must be attention, entropy, top, center or bottom (got "${focus}")`);
  let meta;
  try { meta = await sharp(src).metadata(); }
  catch (e) { throw new Error(`Can't read ${src} as an image (${e.message}). iPhone HEIC photos need converting to JPEG first.`); }
  const short = Math.min(meta.width, meta.height);
  fs.mkdirSync(dir, { recursive: true });
  const file = photoFile(name);
  await sharp(src).rotate() // apply EXIF orientation, then drop all metadata (sharp keeps none unless asked)
    .resize(SIZE, SIZE, { fit: "cover", position })
    .webp({ quality: 82 })
    .toFile(path.join(dir, file));
  const warn = short < SIZE ? `photo is only ${short} px on its short side; it will look soft (480 px or more is best)` : null;
  return { file, warn };
}

// Adds or updates a member in the parsed people.yml document. Returns what changed.
function upsert(doc, { name, group, family, argonne, photo }) {
  const data = doc.toJS();
  let where = null;
  if (data.pi && data.pi.name === name) where = { group: "pi" };
  for (const g of ["postdocs", "grads", "undergrads"]) {
    const i = (data[g] || []).findIndex(m => m.name === name);
    if (i >= 0) where = { group: g, index: i };
  }
  if (group && !GROUPS[group]) throw new Error(`--group must be postdocs, grads or undergrads (got "${group}")`);
  group = group && GROUPS[group];

  if (where && group && where.group !== group) throw new Error(`${name} is already listed under ${where.group}; move them by hand or leave out --group`);
  if (where) {
    const map = where.group === "pi" ? doc.get("pi") : doc.get(where.group).items[where.index];
    // new keys go right after the name, where they're easy to spot
    const put = (k, v) => map.has(k) ? map.set(k, v) : map.items.splice(1, 0, doc.createPair(k, v));
    if (photo) put("photo", photo);
    if (argonne) put("argonne", true);
    if (family) put("family", family);
    return `updated ${name} (${where.group})`;
  }
  if (!group) throw new Error(`${name} isn't in people.yml yet; say which --group to add them to`);
  const entry = { name };
  if (family) entry.family = family;
  if (argonne) entry.argonne = true;
  if (photo) entry.photo = photo;
  const list = data[group] || [];
  const at = list.findIndex(m => byFamily(entry, m) < 0);
  const index = at < 0 ? list.length : at;
  if (!doc.has(group) || doc.get(group) === null) doc.set(group, doc.createNode([]));
  doc.get(group).items.splice(index, 0, doc.createNode(entry));
  return `added ${name} to ${group}, position ${index + 1} of ${list.length + 1}`;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, "");
    if (k === "argonne") a.argonne = true;
    else a[k] = argv[++i];
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.name) { console.error("Usage: node scripts/add-member.js --name \"Full Name\" [--group grads] [--argonne] [--family \"Family\"] [--photo file] [--focus attention]"); process.exit(1); }
  a.name = a.name.trim();
  const photo = a.photo ? photoFile(a.name) : undefined;
  const doc = YAML.parseDocument(fs.readFileSync(PEOPLE, "utf8"));
  // check the people.yml change first, so a mistake leaves no stray photo behind
  const msg = upsert(doc, { name: a.name, group: a.group, family: a.family, argonne: a.argonne, photo });
  const warn = a.photo ? (await makePhoto(a.photo, a.name, a.focus)).warn : null;
  fs.writeFileSync(PEOPLE, doc.toString({ lineWidth: 0 }));
  console.log(msg + (photo ? `; photo data/photos/${photo}` : ""));
  if (warn) console.warn("Warning: " + warn);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { slug, photoFile, familyOf, byFamily, upsert, makePhoto, SIZE };
