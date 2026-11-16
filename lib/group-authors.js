// Which authors on a paper were members of the group, so the site can bold them.
//
// Everyone in people.yml (current members) and alumni.yml (Alums) counts. An author matches a
// member when the family name and the first initial agree ("H. D. Yoo" = Hyun Deog (Sam) Yoo),
// ignoring accents and case. data/group-authors.yml holds the owner's exceptions:
//   until: last year to bold the person (after that they collaborate as independent researchers)
//   also:  DOIs to bold anyway after `until`
//   not:   DOIs where an author with the same initial and family name is someone else
//   as:    extra spellings to match exactly, for names that don't follow the first-initial rule
// The PI is bolded separately by the page.

const norm = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const normDoi = d => norm(d).replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
const isInitial = t => /^\p{L}{1,2}\.(-\p{L}{1,2}\.)*$/u.test(t);

// "Y.-S. Yu" -> { first: "y", family: "yu" }; "S. Kumar Singh" -> { first: "s", family: "kumar singh" }
function parseAuthor(a) {
  const t = String(a).trim().split(/\s+/);
  let i = 0;
  while (i < t.length - 1 && isInitial(t[i])) i++;
  return { first: i ? norm(t[0])[0] : "", family: norm(t.slice(i).join(" ")) };
}

// every current member and alum, as { name, first, family }
function groupMembers(people, alumni) {
  const names = [
    ...["postdocs", "grads", "undergrads"].flatMap(g => ((people || {})[g] || []).map(m => ({ name: m.name, family: m.family }))),
    ...(alumni || []).flatMap(g => (g.people || []).map(n => (typeof n === "string" ? { name: n } : n))),
  ];
  return names.map(m => {
    const words = m.name.replace(/\(.*?\)/g, "").trim().split(/\s+/);
    return { name: m.name, first: norm(words[0])[0], family: norm(m.family || words[words.length - 1]) };
  });
}

const splitAuthors = s => String(s || "").split(/, | and /).map(a => a.trim()).filter(Boolean);

// the author names (exactly as written in paper.authors) to bold
function boldAuthors(paper, members, rules = []) {
  const doi = normDoi(paper.doi), year = Number(paper.year);
  const rule = new Map(rules.map(r => [r.name, r]));
  const out = [];
  for (const a of splitAuthors(paper.authors)) {
    const p = parseAuthor(a);
    const m = members.find(m => (rule.get(m.name)?.as || []).includes(a) || (p.first && p.first === m.first && p.family === m.family));
    if (!m) continue;
    const r = rule.get(m.name) || {};
    if ((r.not || []).map(normDoi).includes(doi)) continue;
    if (r.until && year > Number(r.until) && !(r.also || []).map(normDoi).includes(doi)) continue;
    out.push(a);
  }
  return out;
}

module.exports = { parseAuthor, groupMembers, boldAuthors, splitAuthors };
