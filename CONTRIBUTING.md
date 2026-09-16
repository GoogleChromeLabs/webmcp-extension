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

You need Node.js 20 or later and a Chrome build that supports WebMCP.

```bash
npm install
npm run build     # writes the unpacked extension to dist/
npm run server    # starts the companion server on http://127.0.0.1:3000
```

Then load `dist/` in `chrome://extensions` with Developer mode turned on. See the
[README](README.md) for the Chrome flags you need.

While working, `npm run watch` rebuilds on every change. You still have to press
the reload button on the extension card for background and content script
changes to take effect.

## Before you send a pull request

Run all three checks and make sure they pass:

```bash
npm run typecheck
npm run check:syntax
npm test
```

`npm run typecheck` only covers `src/`, `tests/` and `extension/`, so
`npm run check:syntax` is what catches a syntax error in the server or the
build script.

CI runs `npm ci`, these three checks, and `npm run build`, so anything that
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
