# Stable release runbook

This runbook covers the final transition from an accepted beta to its stable
release. In commands below, replace `X.Y.Z` with the stable version and `N`
with the accepted beta number. Do not use it to bypass a failed candidate or
`main` gate. Every command below is expected to run from a clean checkout of
the canonical repository, `BurntToasters/Zephus`.

## 1. One-time stable branch enforcement

The stable release branch, `main`, must be protected before stable promotion.
The `beta` branch is an intentionally mutable staging branch and does not need
branch protection. With a GitHub CLI account that has repository
administration permission, run:

```sh
npm run repo:protect-release-branches
```

The command protects `main` with the source-bound `ci-gate` status check that
aggregates every CI proof job, requires the branch to be up to date, allows the
intentional administrator bypass, and disables force pushes and branch
deletion. CI remains limited to tests, audits, validation, and unsigned compile
smoke; all release building, signing, and publishing stays on the manually
operated release VMs. Branch protection is optional: `release:preflight` does
not check it and does not wait for hosted CI. For both stable and beta it
requires a clean local checkout of the release branch that exactly matches its
`origin` branch.

Confirm the repository Settings page shows the rule before continuing.

## 2. Freeze and prove the stable candidate

### Soak gate

Stable promotion needs a tested beta. `release:preflight` does not check the
beta tag's age. Every condition below must hold before the candidate is frozen:

- No runtime change has landed since that tag. The production-tree comparison
  in the candidate proof below shows it.
- No open regression is known for that beta. Every report filed against it is
  either fixed in a later beta or closed with a recorded reason.
- The field exposure check is recorded. Download counts are a proxy, not a count
  of installs or updates. Record them before the gate opens:

  ```sh
  gh release view vX.Y.Z-beta.N --json assets --jq '.assets[] | [.name, .downloadCount] | @tsv'
  ```

  The maintainer sets the minimum download count before the soak starts. Write
  it, with the observed counts and the date, in the stable promotion record.
  Until that minimum is recorded and met, the gate is not met.

### Microsoft Store gate

`npm run build:msstore` builds the x64 and arm64 no-bundle binaries, then packs
one MSIX bundle. Store packages are stable only, and their version is `X.Y.Z.0`.
The Store is a follow-up after the GitHub stable release. It does not block
stable. Before a Store package goes public, run a Partner Center package flight
and record the flight ID and the result.

### Candidate freeze and proof

The only stable candidate source branch is `next-X.Y.Z`, promoted directly to
`main`. The published `beta` branch is not an intermediate merge target.

The production source must remain the accepted beta source users tested.
Review every post-beta difference and prove that any accepted difference is
limited to tests or documentation and cannot enter release binaries. No
production, packaging, updater, installer, build, or release-toolchain path may
change without another beta. Then run the complete gate:

```sh
git fetch --tags origin
git rev-parse --verify "refs/tags/vX.Y.Z-beta.N^{commit}"
git switch next-X.Y.Z
git pull --ff-only origin next-X.Y.Z
git diff --name-status vX.Y.Z-beta.N..HEAD
git diff --check vX.Y.Z-beta.N..HEAD
npm ci --ignore-scripts
npm run workspace:bootstrap
npm run test:all -- --require-clean-proof
```

Confirm that the displayed beta-tag commit is the exact published beta source
users tested. Use this tag as the comparison baseline.

Do not run `release:preflight` on `next-X.Y.Z`; it deliberately accepts only an
actual release branch (`beta` for beta versions and `main` for stable versions).
Open the promotion pull request from `next-X.Y.Z` directly to `main`. All GitHub
Actions jobs for that exact pull-request head must be green on every supported
runner before merge. Do not treat a platform-local release build as a
replacement for cross-platform CI. If the production-tree comparison above
finds a runtime change, stop: that runtime must be beta-tested before stable
promotion.

If the accepted beta still needs to be published, use the normal beta release
flow first and complete beta smoke testing before the stable version change.

## 3. Promote the tested source to main

Merge the exact accepted `next-X.Y.Z` pull-request head into protected `main`
through the normal GitHub merge flow. Do not merge it through `beta` first and
do not force push either release branch. Require the post-merge `main` CI run to
pass, then start a short-lived stable-metadata branch from that pushed `main`
tip:

```sh
git switch main
git pull --ff-only origin main
git switch -c release/X.Y.Z
```

Change only the release metadata needed for stable `X.Y.Z`. Edit `package.json`
`version` to `X.Y.Z`, then synchronize that value without performing dependency
updates:

```sh
npm run sync-version
```

Edit `CHANGELOG.md` so the current section is the final stable `X.Y.Z` entry and
remove beta-only release wording. Review the resulting diff carefully, then
commit it and merge the stable-metadata branch to protected `main` through the
normal pull-request flow. Require every pull-request and post-merge `main` CI
job to pass.

## 4. Prove the stable source

On the exact pushed stable commit, run the complete quality gate and strict
license collection:

```sh
npm ci --ignore-scripts
npm run workspace:bootstrap
npm run test:all -- --require-clean-proof
npm run licenses:cargo:strict
npm run release:preflight
```

The strict Cargo license step may fetch the exact immutable VCS revisions
recorded by crates.io when a published crate omitted a workspace-root license.
It accepts only HTTPS repositories and exact recorded commit hashes.

Also confirm:

- `git status --short` is empty apart from generated Tauri schema paths that the
  release tooling explicitly permits.
- `npm audit --omit=dev --audit-level=high` passes.
- `npm run audit:dev-reviewed` passes (fails only if an advisory is production-reachable).
- `cargo audit` reports no unignored vulnerability.
- The stable version is `X.Y.Z` everywhere and contains no `-beta.N` suffix.

## 5. Build and sign on isolated platform VMs

Use clean, isolated release VMs. Load their signing secrets for the session
only and delete `.env` afterwards. The normal entry points run release preflight
and create or reuse the commit-bound draft:

```sh
# Windows release VM (x64 and arm64 NSIS)
npm run release:win

# macOS release VM (arm64 and x64)
npm run release:mac

# Linux x64 release VM
npm run release:linux
```

Linux arm64 wiring is retained for a later release but is not part of the
default release matrix. Do not use beta recovery overrides for a stable release.
Stable Windows builds refuse `SKIP_WIN_CODESIGN`.

The platform release commands intentionally skip GUI E2E on the signing VM.
That is acceptable only because step 4 and protected CI already proved the
exact stable commit with E2E enabled.

## 6. Packaged-artifact QA

Before publishing, install each signed artifact on its platform and verify:
launch, open a site, edit a page, theme preview, publish, the updater on the
stable and beta channels, macOS notarization, and Linux desktop integration
(AppImage and Flatpak launchers).

Test the update path from the accepted beta to the stable candidate on each
platform. Install the accepted beta artifact, then update in-app to the stable
candidate's signed artifacts:

- **macOS, user-owned app location:** the update replaces the app, and the app
  relaunches as `X.Y.Z`.
- **macOS, admin-owned `/Applications`:** the update asks for administrator
  approval where needed and replaces the app. Record any failure in full.
- **Windows x64 NSIS and Windows ARM64 NSIS:** the update installs over the beta,
  and the app starts as `X.Y.Z`.
- **Linux AppImage:** the update replaces the AppImage, and it starts as `X.Y.Z`.
- **Flatpak:** the in-app updater does not apply. Reinstall the stable Flatpak
  asset manually, then confirm the installed version.

Record each result with the artifact name and its SHA-256 checksum.

Fix and rebuild any failing artifact. Do not publish a draft that has not
passed this matrix.

## 7. Publish, then verify the live feed

Publish only through the guarded command:

```sh
npm run release:publish
```

Verify GitHub shows `vX.Y.Z` as the latest non-prerelease release and that the
tag resolves to the exact stable `main` commit. The live updater feed must
serve the signed artifacts for `X.Y.Z`.

## 8. Post-release checks

Install or update to `X.Y.Z` through each supported distribution path and perform
a short smoke test: launch, open a site, preview, and check for updates. Keep
strict `main` protection enabled for the next cycle; `beta` may remain
unprotected.

If any publish-time verification fails, stop distribution work and repair the
release metadata or assets. Do not create a second same-version stable release.

## 9. Recovering an interrupted macOS update

The macOS in-app updater replaces only the `Contents` directory of the installed
app, so the outer `Zephus.app` directory and its Dock identity stay in place. The
swap is two renames (`swap_macos_app_contents` in
`src-tauri/vendor/tauri-plugin-updater/src/updater.rs`). The backup directory
name is built in `macos_update_backup_path`: the `.` in `Zephus.app` becomes
`-`, and the suffix stays `rosi-update-backup` because that string is part of
the vendored updater.

1. `Zephus.app/Contents` moves into a hidden sibling backup directory named
   `.Zephus-app.rosi-update-backup-<hash>`, where `<hash>` is 16 lowercase hex
   digits. The old `Contents` is at
   `/Applications/.Zephus-app.rosi-update-backup-<hash>/Contents`.
2. The staged `Contents` moves into `Zephus.app/Contents`.

A crash or power loss between the two renames leaves `Zephus.app` with no
`Contents`. macOS cannot launch that bundle. Restore the app by hand. The paths
below assume `/Applications`; substitute the folder that contains `Zephus.app`.

1. Quit Zephus if it is running.
2. Check the state. `ls -la /Applications/Zephus.app` must show no `Contents`
   directory. If `Zephus.app/Contents` exists, stop: this is not the state
   described here. Do not move anything, and keep the backup.
3. Find the backup and confirm it holds `Contents`:
   `ls -la /Applications | grep rosi-update-backup` and then
   `ls /Applications/.Zephus-app.rosi-update-backup-*/Contents`.
4. Move the backup's `Contents` back into the app, using the exact backup name
   from step 3:

   ```sh
   mv "/Applications/.Zephus-app.rosi-update-backup-<hash>/Contents" "/Applications/Zephus.app/Contents"
   ```

   If `/Applications` is owned by an administrator and `mv` is denied, run the
   same command with `sudo`.

5. Remove the emptied backup directory:

   ```sh
   rmdir "/Applications/.Zephus-app.rosi-update-backup-<hash>"
   ```

6. Launch Zephus. The restored `Contents` is the pre-update build. The next update
   check offers the update again.

Record any case that does not match these steps, with the output of the `ls`
commands, before retrying the update.
