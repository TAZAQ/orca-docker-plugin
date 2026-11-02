# Orca Docker plugin

Docker and Docker Compose in the Orca side panel, with crash notifications. Needs Orca 1.4.246+.

- Inspired by JetBrains software: follows the Docker node of the Services tool window. Independent project, not affiliated with JetBrains.
- All code in this project is AI-generated.

## Setup

```sh
npm install
npm run build
orca plugin dev load dist    # then repeat with the --approve <fingerprint> it prints
```

## Features

- **Live tree:** Compose projects, Dev Containers, Containers, Images, Networks, Volumes, with search.
- **Status dots:** green is running, red is crash-looping, unhealthy or dead.
- **Click a running container:** opens its shell in a terminal tab.
- **Right-click any row:** start, stop, restart, deploy, pause, inspect, processes, files, attach, exec and more.
- **Logs in the panel:** live stream with a line filter.
- **Image cleanup:** remove dangling or unused images. Shows what goes first.
- **Removing an image also removes its containers.** You confirm the list first.
- **Crash notifications:** crashes, out-of-memory kills, unhealthy containers.

## Limitations

- Networks and volumes are read-only.
- No Compose profile or file picker.
- Jump to Source and Open Project are off until Orca's API can open files.
- Terminals open through the `orca-ide` CLI, because the plugin API cannot create them yet.
- TCP endpoints without TLS only; `DOCKER_HOST` and `DOCKER_CONTEXT` are not read.
- Commands assume a POSIX shell.

## Checks

```sh
npm test
npm run typecheck
```
