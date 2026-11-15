// Checks the data files before a build, so a bad edit fails loudly instead of
// publishing a broken page. Returns a list of problems (empty when all is well).
const THEMES = ["ion", "redox", "interface", "xray"];

function validate(d) {
  const errs = [];
  const need = (obj, keys, where) => keys.forEach(k => {
    if (obj[k] === undefined || obj[k] === null || obj[k] === "") errs.push(`${where}: missing "${k}"`);
  });

  if (!Array.isArray(d.research) || !d.research.length) errs.push("research.yml: no themes");
  (d.research || []).forEach((t, i) => {
    need(t, ["key", "title", "question", "text"], `research.yml theme ${i + 1}`);
    if (t.key && !THEMES.includes(t.key)) errs.push(`research.yml theme ${i + 1}: unknown key "${t.key}"`);
  });

  (d.publications || []).forEach((p, i) => {
    const where = `publications.yml entry ${i + 1} (${(p.title || "").slice(0, 40)})`;
    need(p, ["year", "title", "authors", "journal", "url"], where);
    if (p.year && !/^\d{4}$/.test(String(p.year))) errs.push(`${where}: year "${p.year}" is not a 4-digit year`);
    (p.themes || []).forEach(t => { if (!THEMES.includes(t)) errs.push(`${where}: unknown theme "${t}"`); });
    if (p.corresponding !== undefined && typeof p.corresponding !== "boolean") errs.push(`${where}: corresponding must be true or false`);
    if (p.corresponding_set_by !== undefined && !["openalex", "owner"].includes(p.corresponding_set_by)) errs.push(`${where}: corresponding_set_by must be openalex or owner`);
  });

  const pi = d.people && d.people.pi;
  if (!pi) errs.push("people.yml: missing pi");
  else {
    need(pi, ["name", "roles", "email"], "people.yml pi");
    (pi.roles || []).forEach((r, i) => need(r, ["text"], `people.yml pi role ${i + 1}`));
    (pi.cv || []).forEach((c, i) => need(c, ["years", "text"], `people.yml pi cv ${i + 1}`));
  }
  ["postdocs", "grads", "undergrads"].forEach(g => ((d.people || {})[g] || []).forEach((m, i) => need(m, ["name"], `people.yml ${g} ${i + 1}`)));

  // Photos: every photo named in people.yml exists, and every file in data/photos/ belongs
  // to a current member (so a departed member's photo doesn't stay online by accident).
  if (d.photos) {
    const ppl = d.people || {};
    const members = [ppl.pi, ...["postdocs", "grads", "undergrads"].flatMap(g => ppl[g] || [])].filter(Boolean);
    const used = new Set();
    members.filter(m => m.photo).forEach(m => {
      used.add(m.photo);
      if (!/^[a-z0-9-]+\.webp$/.test(m.photo)) errs.push(`people.yml ${m.name}: photo "${m.photo}" should be a .webp made by scripts/add-member.js`);
      else if (!d.photos.includes(m.photo)) errs.push(`people.yml ${m.name}: photo data/photos/${m.photo} not found`);
    });
    d.photos.filter(f => !used.has(f)).forEach(f => errs.push(`data/photos/${f} isn't used by any current member; delete it`));
  }
  // Each group stays in alphabetical order by family name
  const { byFamily } = require("./add-member");
  ["postdocs", "grads", "undergrads"].forEach(g => {
    const list = ((d.people || {})[g] || []).filter(m => m.name);
    list.forEach((m, i) => { if (i && byFamily(list[i - 1], m) > 0) errs.push(`people.yml ${g}: ${m.name} should come before ${list[i - 1].name} (alphabetical by family name; set family: if the last word isn't it)`); });
  });

  (d.alumni || []).forEach((g, i) => need(g, ["role", "people"], `alumni.yml group ${i + 1}`));

  (d.news || []).forEach((n, i) => {
    need(n, ["date", "title", "body", "url", "status"], `news.yml item ${i + 1}`);
    if (n.status && !["draft", "published"].includes(n.status)) errs.push(`news.yml item ${i + 1}: status must be draft or published`);
  });

  (d.openings || []).forEach((o, i) => need(o, ["title", "summary", "apply", "posted"], `join.yml opening ${i + 1}`));
  return errs;
}

module.exports = { validate, THEMES };
