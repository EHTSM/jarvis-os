# Local Electron Build — Known Environment Issue

If `npm run dist:mac` (or `dist:win`/`dist:linux`/`dist:all`) appears to
hang indefinitely at a spinner reading "Searching dependency tree" with no
further output and no active compiler process, this is a known issue with
`@electron/rebuild` on some local machines (reproduced on macOS arm64 /
Node v24.11.1 / electron-builder 25.1.8) — **not a defect in this
project's code**.

## Root cause

`@electron/rebuild`'s default Electron-headers download URL,
`https://www.electronjs.org/headers`, redirects to a malformed path
(`.../headers/dist/dist/v<version>/...` — a doubled `dist/` segment) which
404s. `node-gyp` does not fail fast on this 404 in the environment where
this was reproduced; it appears to hang rather than error out, and the
`ora` spinner's text never updates again because the actual rebuild
happens inside a worker process whose progress isn't reflected in the
parent's spinner text.

The correct, working URL is `https://artifacts.electronjs.org/headers`
(same CDN, without the broken redirect hop).

## Workaround: rebuild native modules manually, then skip electron-builder's internal rebuild

This project has exactly two native (compiled) dependencies:
`node-pty` and `better-sqlite3` (see `package.json`'s `asarUnpack`).
Rebuild each directly against Electron's ABI using the corrected URL,
then tell electron-builder to skip its own (hang-prone) internal rebuild
step since the binaries are already correctly built:

```bash
# 1. Rebuild node-pty for Electron's ABI (adjust --target to the installed
#    electron version: node -e "console.log(require('electron/package.json').version)")
cd node_modules/node-pty
npx node-gyp rebuild --arch=arm64 --target=<electron-version> --runtime=electron \
  --dist-url=https://artifacts.electronjs.org/headers/dist
cd ../..

# 2. Same for better-sqlite3
cd node_modules/better-sqlite3
npx node-gyp rebuild --arch=arm64 --target=<electron-version> --runtime=electron \
  --dist-url=https://artifacts.electronjs.org/headers/dist
cd ../..

# 3. Build, skipping electron-builder's own internal (hang-prone) rebuild —
#    -c.npmRebuild=false is a one-off CLI override, NOT a package.json change:
#    CI/other machines where @electron/rebuild works normally must keep
#    doing the automatic rebuild, so this flag is deliberately not baked
#    into the persisted "build" config.
npx electron-builder --mac --arm64 --publish never -c.npmRebuild=false
```

Repeat step 3 with `--win`/`--linux` and the appropriate `--arch` as
needed; steps 1-2 only need to be redone when the Electron version bumps
(check `node_modules/electron/package.json`) or after `npm ci`/`npm
install` reinstalls the native modules from scratch (their compiled
`build/Release/*.node` output gets wiped on reinstall).

## Verifying a manually-rebuilt native module

```bash
file node_modules/node-pty/build/Release/pty.node
file node_modules/better-sqlite3/build/Release/better_sqlite3.node
# Expect: "Mach-O 64-bit bundle arm64" (or x86_64 on Intel) — NOT a text
# file, NOT missing — and a *fresh* timestamp from the rebuild step above,
# not an old prebuild from `npm install`.
```

## Why this doesn't affect CI

`.github/workflows/release.yml`'s `desktop` job runs on fresh GitHub-hosted
runners (`macos-latest`/`windows-latest`/`ubuntu-latest`) with a clean
`npm ci` each time — this specific hang has not been observed there. If it
ever is, apply the same workaround inside the workflow step rather than
changing `package.json`'s persisted `npmRebuild` setting.
