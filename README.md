# JB Containers

Docker and Docker Compose in an Orca sidebar inspired by the JetBrains Services tool window, with live logs and crash notifications. Requires Orca 1.4.246+.

<p align="center"><img src="docs/demo.gif" alt="Demo of the Docker panel in light and dark themes: the live tree, search, context menus, logs and image cleanup" width="720"></p>

- Inspired by JetBrains software: follows the Docker node of the Services tool window. Independent project, not affiliated with or endorsed by JetBrains or Docker.
- All code in this project is AI-generated.

## Install

Check the [Orca directory listing and publication status](https://orca.dev/plugins/tazaq/jb-like-docker-service), or install directly from GitHub:

```sh
orca plugin install TAZAQ/jb-like-docker-service
```

Orca asks you to approve the worker's full access to your machine. Review the access
shown, then repeat with the `--approve <fingerprint>` it prints.

## Plugin identity and access

- Plugin ID: `jb-containers`; installed identity: `tazaq.jb-containers`.
- Development identity: `local.jb-containers`.
- Panel ID: `jb-containers-docker`, displayed as **JB Containers**.
- Commands: `jb-containers-docker-status` and `jb-containers-docker-toggle-notifications`.
- Requests and events use the `jb-containers-` namespace; persistent keys use `jb-containers.`.

This is a different identity from the earlier `tazaq.docker` / `local.docker` releases.
Orca requires approval for the new identity; the old plugin's storage and approvals
are not migrated automatically. Namespaced preference keys also start with defaults.
Disable or remove the old copy before using the new one to avoid duplicate watchers
and notifications; removing a plugin does not remove Docker resources.

The trusted worker runs with your operating-system user's access to Docker and the
machine. Its declared Orca permissions are workspace details, agent status events,
desktop notifications and its own storage. Only approve it if you trust this code.

## Development

```sh
npm install
npm run build
orca plugin dev load .    # then repeat with the --approve <fingerprint> it prints
```

## Features

- **Live tree:** Compose projects, Dev Containers, Containers, Images, Networks, Volumes, with search.
- **Status dots:** green is running, red is crash-looping, unhealthy or dead.
- **Click a running container:** opens its shell in a terminal tab.
- **Right-click any row:** start, stop, restart, deploy, pause, inspect, processes, files, attach, exec, shells as root, open ports in the browser and more.
- **Dashboard:** select a container, image, network or volume to see its environment, ports, volumes, layers or users.
- **Compose groups:** Start All, Stop and Restart act on existing containers through Docker, without needing the source directory. Down confirms and removes the project's containers and Compose-owned networks, keeping volumes and images; it works after deleting the project files. Search does not narrow a group action.
- **Compose options:** Deploy… and Down with Options… use the recorded Compose files (services, profiles, env files, build, recreate, volumes), and Scale.
- **Images:** Pull with name suggestions, Create Container with run options, Push.
- **Logs in the panel:** live stream with a line filter.
- **Clean Up** on Docker, Containers, Images, Networks and Volumes: removes stopped or unused ones and the build cache. Lists what goes, then removes exactly that.
- **Create networks and volumes:** network driver picker, `--attachable` and `--internal` switches.
- **Removing an image also removes its containers.** You confirm the list first.
- **Crash notifications:** crashes, out-of-memory kills, unhealthy containers.
- **Docker contexts:** switch between the docker CLI's contexts, including TCP with TLS.
- **View options:** hide stopped containers and untagged images.

## Limitations

- No Compose profile or file picker.
- Jump to Source and Open Project are off until Orca's API can open files.
- Terminals open through the `orca-ide` CLI, because the plugin API cannot create them yet.
- SSH contexts are not supported; `DOCKER_HOST` and `DOCKER_CONTEXT` are not read, only `~/.docker` contexts.
- Browser clients with opaque origins may fail while loading view preferences; the desktop app is the verified target.
- Commands assume a POSIX shell.

## Checks

```sh
npm test
npm run typecheck
```

## Publish

The root manifest and committed `dist/main.mjs` and `dist/panel.html` make the
repository directly installable; users do not need to build it.
Keep `README.md`, `orca-plugin.json`, package versions and worker registrations in
sync as required by [AGENTS.md](AGENTS.md). A successful push is not a directory release.
The directory cover, `docs/cover.png`, is a 16:10 crop of the expanded Compose
project frame from `docs/demo.gif`, showing both light and dark themes.
`docs/icon.png` is an original container-box icon; `docs/screenshot-logs.png` is a
static frame of the demo with live-log sample data. Both are declared in the manifest.

For each release, update the version in `package.json`, `package-lock.json` and
`orca-plugin.json`, run the checks above and `npm run build`, then
`orca plugin validate .`. Commit the sources and rebuilt `dist` files, push to
`main`, and push a matching `vX.Y.Z` tag. Keep the repository's `orca-plugin` topic.
The directory indexes new tags, usually within an hour; check the listing page
for acceptance or rejection.
