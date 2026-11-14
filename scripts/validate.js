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
  });

  const pi = d.people && d.people.pi;
  if (!pi) errs.push("people.yml: missing pi");
  else need(pi, ["name", "role", "email"], "people.yml pi");
  ["postdocs", "grads"].forEach(g => ((d.people || {})[g] || []).forEach((m, i) => need(m, ["name"], `people.yml ${g} ${i + 1}`)));

  (d.alumni || []).forEach((g, i) => need(g, ["role", "people"], `alumni.yml group ${i + 1}`));

  (d.news || []).forEach((n, i) => {
    need(n, ["date", "title", "body", "url", "status"], `news.yml item ${i + 1}`);
    if (n.status && !["draft", "published"].includes(n.status)) errs.push(`news.yml item ${i + 1}: status must be draft or published`);
  });

  (d.openings || []).forEach((o, i) => need(o, ["title", "summary", "apply", "posted"], `join.yml opening ${i + 1}`));
  return errs;
}

module.exports = { validate, THEMES };
