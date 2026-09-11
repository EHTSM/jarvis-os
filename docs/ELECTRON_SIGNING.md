# Electron Signing & Notarization

Code signing and macOS notarization are **fully wired and automatic** —
electron-builder 25.x detects the credentials below via environment
variables at build time and signs/notarizes accordingly. There is no
custom `afterSign` script or manual notarization step in this repo: it's
handled natively by `electron-builder`/`@electron/notarize`
(`node_modules/app-builder-lib/out/macPackager.js:getNotarizeOptions`).

**Without these env vars set, `npm run dist:*` produces a real, working,
unsigned build** — the app launches and runs identically, but macOS
Gatekeeper shows an "unidentified developer" warning and Windows
SmartScreen shows an "unrecognized app" warning on first launch. This is
expected and safe for local development/testing; only a public release
needs signing.

## What's required, and where it's already consumed

| Env var | Consumed by | Effect when set |
|---|---|---|
| `CSC_LINK` | electron-builder (mac) | Base64-encoded or file-path `.p12` Developer ID Application certificate — signs the `.app` and `.dmg` |
| `CSC_KEY_PASSWORD` | electron-builder (mac) | Password for the `.p12` above |
| `APPLE_ID` | `@electron/notarize` (via electron-builder) | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | `@electron/notarize` | App-specific password generated at appleid.apple.com (not your real Apple ID password) |
| `APPLE_TEAM_ID` | `@electron/notarize` | Your Apple Developer Team ID |
| `WIN_CSC_LINK` | electron-builder (win) | Base64-encoded or file-path `.pfx` code-signing certificate |
| `WIN_CSC_KEY_PASSWORD` | electron-builder (win) | Password for the `.pfx` above |

Linux (`AppImage`) has no signing step in electron-builder — AppImage's
own trust model doesn't use a code-signing certificate the way mac/Windows
do.

## Where these are already plumbed in CI

`.github/workflows/release.yml`'s `desktop` job (triggered by pushing a
`v*.*.*` tag) already reads these from GitHub Secrets and passes them
through to `electron-builder --publish always`:

```yaml
CSC_LINK: ${{ secrets.MACOS_CERT_P12 }}
CSC_KEY_PASSWORD: ${{ secrets.MACOS_CERT_PASSWORD }}
APPLE_ID: ${{ secrets.APPLE_ID }}
APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
WIN_CSC_LINK: ${{ secrets.WIN_CERT_PFX }}
WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CERT_PASSWORD }}
```

**To activate real signing/notarization: add the 7 secrets above to the
GitHub repo's Settings → Secrets → Actions, using a real Apple Developer
ID certificate (Developer ID Application) and a real Windows code-signing
certificate.** No code or workflow changes are needed — the pipeline
already checks for and uses them; unset secrets simply resolve to empty
strings, which electron-builder treats as "produce an unsigned build"
rather than failing the job.

## Local (non-CI) signed build

To produce a signed build from a local machine with real certificates
installed, export the same env vars before running the dist script, e.g.:

```bash
export CSC_LINK=/path/to/cert.p12
export CSC_KEY_PASSWORD=...
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=...
export APPLE_TEAM_ID=...
npm run dist:mac
```

## Verifying a build's signature after the fact

```bash
# macOS
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Ooplix.app"
spctl --assess --type execute "dist/mac-arm64/Ooplix.app"   # Gatekeeper check
xcrun stapler validate "dist/Ooplix-<version>-arm64.dmg"      # notarization ticket stapled

# Windows (from a Windows host, or with osslsigncode on Linux/mac)
signtool verify /pa /v "dist\Ooplix Setup <version>.exe"
```
