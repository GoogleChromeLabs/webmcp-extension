# Security policy

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Use GitHub's
[private vulnerability reporting](https://github.com/GoogleChromeLabs/webmcp-extension/security/advisories/new)
instead. That opens a private advisory only the maintainers can see.

This is not an officially supported Google product, and it is **not** eligible
for the
[Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security).
Reports are read and fixed on a best-effort basis, and there is no reward and no
guaranteed response time.

## What this project is

This is a developer sample for exploring the WebMCP API. It is not a hardened
product and is not meant to be deployed anywhere but your own machine.

Two things follow from that, and neither is a vulnerability:

- **The companion server binds to `127.0.0.1` and is meant to stay there.** It
  has no user accounts and no rate limiting. Exposing it to a network or the
  internet is not supported.
- **The auth token is inlined into the built `sidebar.js`.** The build step
  substitutes it as a string literal so the side panel can call the server. It
  keeps other local pages from reaching the server; it is not a secret that
  survives someone reading your `dist/` folder.

Reports about the extension mishandling untrusted page content, about the log
dashboard, or about the server accepting requests it should reject, are all in
scope and welcome.

## Things to keep out of version control

`.gitignore` already covers these, but worth stating:

- `.env` holds your Gemini API key and the WebMCP auth token.
- `*.pem` is your extension signing key.
- `*.crx` and `*.zip` are packed builds that contain the inlined token.
