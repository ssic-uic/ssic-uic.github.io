// Journal names follow CAS (CASSI) abbreviations (owner, 16 Nov 2026). data/journals.yml lists each
// journal's CAS form (cas) and other spellings that map to it (also).
const key = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[.,:;()'’-]/g, " ").replace(/\s+/g, " ").trim();

// lookup(name) -> { name, known }: the CAS form when the journal is in the list, otherwise the name as given
function journalLookup(list) {
  const map = new Map();
  for (const j of list || []) for (const n of [j.cas, ...(j.also || [])]) map.set(key(n), j.cas);
  return name => (map.has(key(name)) ? { name: map.get(key(name)), known: true } : { name, known: false });
}

module.exports = { journalLookup, journalKey: key };
