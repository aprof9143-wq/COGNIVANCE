<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Repository boundary — read before editing

This repository holds two separate systems.

- **`src/`, `public/` and the root config files** are the web application
  (TanStack Start). This is the part Lovable manages.
- **`core/`** is the NIMBLE scientific platform: Python, layered, and the source
  of every benchmark figure we publish.

Do not edit `core/` from web work, and do not edit the web application from
Python work. Automated or prompt-driven edits to the web app must leave `core/`
untouched — the numbers it produces have to be reproducible from their
provenance records, which a drive-by edit silently breaks.

Within `core/`, a modality library stays inside its own modality package:
`nibabel` and `nilearn` only under `core/cognivance_core/imaging/`, `mne` only
under `core/cognivance_core/eeg/`. Anything downstream sees
`UnifiedNeuralRecord` and nothing else. CI enforces this.
