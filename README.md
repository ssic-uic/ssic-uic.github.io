# Solid State and Inorganic Chemistry group website

Website of the Solid State and Inorganic Chemistry group at the University of Illinois Chicago (Principal Investigator: Jordi Cabana).

Every push to `main` is tested, built and published to GitHub Pages by `.github/workflows/deploy.yml`.

## Where things live

| What | File |
| --- | --- |
| Research themes (title, question, text) | `data/research.yml` |
| PI profile, postdocs, graduate students | `data/people.yml` |
| Alumni | `data/alumni.yml` |
| Publications, with research themes per paper | `data/publications.yml` |
| News (draft items stay off the public site) | `data/news.yml` |
| Postdoc openings (each expires after its closing date) | `data/join.yml` |
| Colours, fonts, sizes | `src/tokens.css` |
| Layout and components | `src/styles.css` |
| Page text that rarely changes (hero, Join us, footer) | `src/index.html` |
| Rendering | `src/app.js` |
| Chemical formula formatting in titles | `lib/chem.js` |

A design change touches only `src/`; a content change touches only `data/`.

## Publication sync

`.github/workflows/sync-publications.yml` runs every Monday (and on demand). `scripts/sync-publications.js` reads the PI's ORCID record to decide which papers are ours, takes authors, journal, volume/pages and dates from Crossref, and adds new papers with a guessed research theme. A paper's year is the year it first appeared, so it never moves when its print issue comes out. Themes marked `themes_set_by: owner` are never changed. Papers that OpenAlex links to the ORCID iD but ORCID doesn't list go to `data/candidates.yml` and are not shown until confirmed. The OpenAlex check needs no API key; an optional `OPENALEX_API_KEY` secret raises its allowance. A run commits the changes and triggers publishing; a trial run (manual, "trial" ticked) only uploads the result for review.

## Building locally

```
npm ci
npm test        # formula formatter, data checks, page renders
npm run build   # writes the site to dist/
```

The build stops with a list of problems if a data file is missing a required field or uses an unknown research theme.
