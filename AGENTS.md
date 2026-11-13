# JB Containers maintenance rules

## Identity and canonical addresses

- Product name: `JB Containers`; plugin and package ID: `jb-containers`.
- Repository: `https://github.com/TAZAQ/jb-like-docker-service`.
- Directory/status page: `https://orca.dev/plugins/tazaq/jb-like-docker-service`.
- Git-installed identity: `tazaq.jb-containers`; development identity: `local.jb-containers`.
- Panel ID: `jb-containers-docker`.
- Command IDs: `jb-containers-docker-status` and `jb-containers-docker-toggle-notifications`.
- Plugin-owned request/event names belong in `src/shared/protocol.ts` and use the `jb-containers-` prefix. Persistent keys use `jb-containers.`.
- Do not rename real Docker resource IDs or Orca-defined event names, capabilities and icon values. They are external contracts, not plugin-owned IDs.

## README and manifest are release contracts

Read `README.md` and `orca-plugin.json` before every change. Keep both accurate in the same change; do not leave stale names, repository URLs, install commands, features, limitations or publication instructions.

- The root `orca-plugin.json` is the only manifest source. Never create a second manifest under `public` or `dist`.
- Match every declared command ID to its worker registration and every panel entry to the built file. Update all consumers when identifiers change; do not leave aliases or old handlers.
- Keep versions identical in `package.json`, the root package records in `package-lock.json`, and `orca-plugin.json`.
- Use the current official manifest reference and schema. Include real author, repository, homepage, license, icon, cover and screenshot metadata. Do not invent unsupported fields or add unused contributions/capabilities just to fill the file.
- Leave deprecated `publisher` out. Orca derives it from the repository owner; keep `engines.orca` at least `>=1.4.246` and raise it if newer APIs or fields require it.
- An ID change creates a different plugin identity. Document the approval/storage consequences; never promise an automatic settings migration.
- Write documentation, manifest descriptions, captions and accessibility text in English.
- Keep the independent-project disclaimer: no affiliation with or endorsement by JetBrains or Docker.

## Build and verification

Run `npm run build`, `npm run typecheck`, `npm test`, and `orca plugin validate .` before shipping. Commit the rebuilt `dist/main.mjs` and `dist/panel.html` with their sources. These files may be byte-identical after a metadata-only change; do not fake a bundle change.

For changes to identity or the panel/worker protocol, smoke-test the built worker and panel in Orca. Verify actual responses and visible output, not just compilation. Use only temporary owned Docker fixtures for destructive checks; never remove the user's containers, networks, volumes or images to test a change. Obtain approval before enabling newly requested access.

Check catalog images against the manifest reference: icon at least 128×128 and at most 256 KiB; cover at least 800×500 and at most 1 MiB; screenshots at least 1280×800 and at most 1536 KiB each. Keep captions honest about demo data and inspect the resulting images.

## Publication

A push to `main` is not a directory release. When publication is requested, commit and push the complete package, then create and push a new matching `vX.Y.Z` tag. Never move or replace a published tag. Keep the repository topic `orca-plugin`.

Verify the published manifest and package. Report separately: successful build, pushed commit, published tag, installer approval boundary, and directory acceptance. A valid manifest or successful push does not prove the indexer accepted the release. Do not claim that adding metadata or renaming will automatically clear a moderation hold.
