# cairn-ui

The browser viewer for [cairn](https://github.com/DoeringChristian/cairn): the
React application, its prebuilt bundle, and the Python surface that drives it.

```
pip install 'cairn-track[ui]'
```

You do not install this directly and there is nothing to import. It exists so that
`pip install cairn-track` — on a compute node that will only ever log metrics —
downloads no browser application. Tracking, the CLI and the HTTP API all work
without it; only `cairn ui` and `cairn server --ui` need it.

## What is in here

- `src/`, `scripts/`, and the bundler config — the React/TypeScript application.
- `cairn_ui/_dist/` — its built bundle (three HTML entries plus hashed assets),
  **committed** so installing never needs Node.
- `cairn_ui/cards/` — the Python surface that builds card specs for that bundle
  to render, reached as `cairn.ui` once installed.
- `vendor/cairn-plot` — the renderer, as a submodule. The build compiles its
  TypeScript in, so clone with `--recurse-submodules`.

`cairn_ui/__init__.py` exposes exactly one function, `dist_path()`. Everything
about *serving* the bundle — routes, shells, the CPU-renderer override — lives in
cairn-track's `cairn/viewer.py`, so this package holds no logic that could drift
from the server.

## Building

```
git submodule update --init
npm ci
npm run build          # -> cairn_ui/_dist
```

Commit the rebuilt `_dist` with your source change: it is a released wheel's
payload, and a stale bundle would ship silently. The build is byte-reproducible,
so `git diff --exit-code -- cairn_ui/_dist` after a build is a valid staleness
gate.

## Developing against a different bundle

Point cairn-track at any build directory:

```
CAIRN_UI_DIST=/path/to/some/dist cairn ui
```

That override wins outright — if it names something unusable, no viewer is served
rather than silently falling back to the installed one.
