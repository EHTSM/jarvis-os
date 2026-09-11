# Release Playbook

How every future release of Ooplix should happen, based on the actual CI/CD pipeline already wired up in this repo (`.github/workflows/ci.yml` and `.github/workflows/release.yml`).

---

## The two pipelines

**`CI`** — runs on every push and pull request to `main`. This is your safety net; it must pass before you ever cut a release.

**`Release`** — runs only when you push a tag matching `v[0-9]*.[0-9]*.[0-9]*` (e.g. `v1.0.0`, `v1.2.3-rc1`). This is what actually builds and publishes.

## What CI checks, in order

1. **Security Audit** — `npm audit` on backend dependencies
2. **Regression Suite (144 checks)** — starts the backend, runs the full regression suite, verifies 144/144 pass, stops the server
3. **Frontend Build** — installs frontend deps, builds, verifies output exists, uploads as an artifact
4. **Deploy Script Verification** — syntax-checks every script in `deploy/`, shellchecks them (warnings only, non-blocking)
5. **Validate** — depends on regression + build-frontend passing
6. **`ci-pass`** — the final gate; depends on all of the above

**Never cut a release tag from a commit where CI hasn't gone green on `ci-pass`.** Check: `gh run list --branch main --workflow CI` or the Actions tab.

## What Release does, in order

1. **Build Frontend** — fresh `npm ci --prefix frontend` + `npm run build:frontend`, uploads as an artifact all downstream jobs reuse
2. **Package Server Release** — `npm ci --omit=dev`, bundles `backend/`, `agents/`, `scripts/`, `deploy/`, the built frontend, and `package.json`/`package-lock.json` into `ooplix-server-vX.Y.Z.tar.gz` + a `.sha256` checksum file
3. **Build Desktop** (matrix: macOS, Windows, Linux) — `npm ci` (full, including devDependencies), downloads the frontend build artifact, runs `electron-builder --{mac,win,linux} --publish always`. Code signing is opt-in via repo secrets (`CSC_LINK`, `WIN_CSC_LINK`, etc.) — unsigned if unset, not a failure.
4. **Extract Changelog** — pulls the section matching the tag's version from `CHANGELOG.md`
5. **Create GitHub Release** — depends on Package + Changelog; publishes the server tarball + checksum as release assets, marks `prerelease: true` if the tag contains `-beta` or `-rc`, `false` otherwise

## Cutting a release — the actual steps

### 1. Confirm `main` is clean and CI is green
```bash
git status                          # working tree clean
git log --oneline -5                # sanity check recent history
gh run list --branch main --limit 3 # latest CI run succeeded
```

### 2. Bump the version
Edit `package.json`:
```json
"version": "1.2.3"
```
This is the single source of truth the release pipeline reads (`GITHUB_REF_NAME` strips the `v` prefix from the tag and that becomes the artifact filename — keep the tag and `package.json` version in sync manually, nothing enforces this automatically).

### 3. Add a CHANGELOG entry
At the top of `CHANGELOG.md`, above the previous entry:
```markdown
## [1.2.3] — YYYY-MM-DD — <short description>

<what changed and why, in plain language — this text is extracted verbatim
and shown on the GitHub Release page>
```
The changelog extraction (`awk` in the release workflow) matches on `## [VERSION]` exactly — get the brackets and version string right or the release notes will fall back to "See CHANGELOG.md for details."

### 4. Commit and push
```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): bump to v1.2.3"
git push origin main
```
Wait for CI to go green on this exact commit before tagging.

### 5. Tag and push the tag
```bash
git tag -a v1.2.3 -m "Release v1.2.3 — <one-line summary>"
git push origin v1.2.3
```
Pushing the tag is what triggers the Release workflow — nothing happens on `git tag` alone until you push it.

### 6. Watch the release run
```bash
gh run list --repo EHTSM/jarvis-os --limit 3
gh run watch <run-id>
```
This takes a while — the desktop matrix (3 platforms, native module compilation) is the slow part. Don't assume success until all jobs report green; a partial failure (e.g. one platform's desktop build fails) still means the release isn't fully done even if the server package published fine.

### 7. Verify the release
```bash
gh release view v1.2.3 --repo EHTSM/jarvis-os
```
Check: the right assets are attached (`ooplix-server-v1.2.3.tar.gz` + `.sha256`, plus desktop installers if that job succeeded), `prerelease` flag is correct for the tag type, changelog notes rendered correctly.

Verify the checksum actually matches:
```bash
gh release download v1.2.3 --repo EHTSM/jarvis-os
sha256sum -c ooplix-server-v1.2.3.tar.gz.sha256
```

### 8. Deploy it
See [PRODUCTION_DEPLOYMENT_GUIDE.md](PRODUCTION_DEPLOYMENT_GUIDE.md). For the VPS path, `deploy/update.sh` pulls from `main` directly (not from the release tarball) — if you want the VPS running exactly what was tagged, `git checkout v1.2.3` before running `update.sh`, or just keep `main` and tags in sync by always tagging immediately after the version-bump commit lands (step 4→5 above with no other commits in between).

---

## Versioning convention

This repo uses `vMAJOR.MINOR.PATCH` with optional pre-release suffixes:
- `v1.0.0-rc1`, `v1.0.0-rc2`, ... — release candidates, marked as GitHub pre-releases automatically
- `v1.0.0-beta.1` — beta, same pre-release handling
- `v1.0.0` — the real thing, marked as a full release

If a release candidate's pipeline fails and you fix the issue, **cut a new rc number rather than force-moving the existing tag** (e.g. `rc2` → `rc3`, don't delete and recreate `rc2`). This keeps a clean, honest history of what was actually tried and what broke — genuinely useful when you're debugging CI issues six months from now and need to know what changed between attempts.

## If a release fails partway through

- **Frontend/package job failed:** nothing was published. Fix the root cause, cut the next rc/patch number, retry.
- **One desktop platform failed, others + server package succeeded:** the GitHub Release still gets created (it only depends on `package` + `changelog`, not on `desktop` succeeding) — but it's missing that platform's installer. Decide: ship without it and follow up, or treat the whole release as blocked until all three platforms succeed. Don't silently ship a release page that's missing an asset without knowing you're doing that — check `gh run view <run-id> --json jobs` for the actual per-job conclusion before considering a release "done."
- **A hang/timeout in dependency installation:** check whether it's transient (retry the specific failed job: `gh run rerun <run-id> --failed`) or a real regression. If a hang recurs identically across a retry, it's not transient — root-cause it before retrying blindly. (This exact scenario happened during RC-1 hardening; see the CHANGELOG entries for rc4 through rc8 for a worked example of diagnosing a CI hang all the way to root cause rather than just adding more retries.)

## What never changes in a release

- Never skip CI to cut a release faster — the regression suite is what stands between "it built" and "it works"
- Never hand-edit a published GitHub Release's assets — if something's wrong, cut a new patch version
- Never force-push over an already-pushed tag that has a real (even if broken) release attached — cut the next version number instead
