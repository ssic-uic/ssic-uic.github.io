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

`.github/workflows/sync-publications.yml` runs every Monday (and on demand) and commits any changes, which republishes the site.

- **Sources.** The PI's ORCID record decides which papers are candidates; Crossref supplies authors, journal, volume/pages and dates; OpenAlex points out papers linked to the ORCID iD that the ORCID record lacks.
- **Listed papers are permanent.** The sync refreshes their details (and swaps a listed preprint for its published version) but never removes or hides them. Only the owner removes a paper.
- **Rules for new items.** Only peer-reviewed journal articles are added. Conference abstracts, proceedings, book chapters and preprints are left out and recorded in `data/excluded.yml`, which the sync never re-adds from. A paper's year is the year it first appeared.
- **The owner's lists win.** `data/extra-papers.yml` holds papers to list regardless (DOIs ORCID lacks, editorials the owner keeps). `data/excluded.yml` entries marked `by: owner` are the owner's removals.
- **Decisions.** Anything that needs the owner goes to `data/review.yml` with the date it was first seen: OpenAlex finds, new papers where Crossref doesn't list J. Cabana, new ORCID entries whose DOI points to a different work, and new ORCID entries without a DOI. Items the owner has seen and wants left alone go in `data/known.yml` and are never raised again. A weekly scheduled task notifies the owner only when something new appears.
- **Themes.** Marked `themes_set_by: owner` are never changed; new papers get a guess.

A trial run (manual, "trial" ticked) writes its result to the `sync-trial` branch instead of `main`.

## Building locally

```
npm ci
npm test        # formula formatter, data checks, page renders
npm run build   # writes the site to dist/
```

The build stops with a list of problems if a data file is missing a required field or uses an unknown research theme.
