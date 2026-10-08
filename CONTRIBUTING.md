# How to contribute

We would love to accept your patches and contributions to this project.

## Before you begin

### Sign our Contributor License Agreement

Contributions to this project must be accompanied by a
[Contributor License Agreement](https://cla.developers.google.com/about) (CLA).
You (or your employer) keep the copyright to your contribution; the CLA gives us
permission to use and redistribute it as part of the project.

If you or your employer have already signed the Google CLA, even for a different
project, you probably do not need to do it again. Visit
<https://cla.developers.google.com/> to see your current agreements or to sign a
new one.

### Review our community guidelines

This project follows
[Google's Open Source Community Guidelines](https://opensource.google/conduct/).

## Getting set up

You need Node.js 22.18 or later and a Chrome build that supports WebMCP.

```bash
npm install
npm run build     # writes the unpacked extension to dist/
npm run server    # starts the companion server on http://127.0.0.1:3000
```

Then load `dist/` in `chrome://extensions` with Developer mode turned on. See the
[README](README.md) for the Chrome flags you need.

While working, `npm run dev` rebuilds on every change and automatically
reloads the extension in Chrome.

## Before you send a pull request

Run both checks and make sure they pass:

```bash
npm run typecheck
npm test
```

`npm run typecheck` checks everything: `extension/`, `server/`, `shared/`,
`scripts/` and `tests/`. The server and build scripts have no build step; Node
runs their `.ts` files directly by stripping the types. So code there has to
use only erasable TypeScript syntax (no `enum` or `namespace`), import local
files with their `.ts` extension, and bring in types with `import type`. The
typecheck enforces all three: a second pass (`tsconfig.node.json`) checks
these folders with Node's own module resolution.

CI runs `npm ci`, these two checks, and `npm run build`, so anything that
fails locally will fail there too.

A few things that make review quicker:

- Keep the change focused on one thing.
- Add a test for anything that could silently regress.
- Every new source file needs the Apache 2.0 SPDX header that the existing files
  have at the top.
- Do not commit `.env`, `dist/`, or any `.crx` or `.pem` file. They are
  gitignored for a reason: `.env` holds your API key and auth token, and the
  `.pem` is the extension signing key.

## Code review

All submissions, including those from project members, go through review. We use
GitHub pull requests for this. See
[GitHub Help](https://help.github.com/articles/about-pull-requests/) if you have
not used them before.
