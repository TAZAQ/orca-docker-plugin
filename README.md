# Orca Docker plugin

Docker and Docker Compose in the Orca side panel, with notifications when containers crash. The plugin runs on Orca's public plugin API (manifest format 2, `pluginApi: 1`) with no host patches. It needs Orca 1.4.246 or newer.

Inspired by JetBrains software: the tree, its context menus and the overall workflow follow the Docker node of the Services tool window in JetBrains IDEs. This is an independent project, not affiliated with or endorsed by JetBrains.

All code in this project is AI-generated.

## Development setup

```sh
npm install
npm run build        # dist/: orca-plugin.json, panel.html, main.mjs
```

In Orca, open Settings → Plugins → Development, add the `dist/` folder and approve the requested access. From a terminal, run `orca plugin dev load dist`, then repeat the command with the `--approve <fingerprint>` it prints.

## Features

### Services tree

The tree has the same layout as the Docker node in JetBrains IDEs: Docker-compose projects with their services, Dev Containers, Containers (every container), Images, Networks and Volumes.

- It updates by itself, because the worker follows Docker events.
- A green dot means containers are running. A red dot means a container is crash-looping, unhealthy or dead.
- Search finds projects, services, containers (by name, image or port), images, networks and volumes, and opens the groups with matches.
- Clicking a running container opens its shell in a new terminal tab. Clicking it again returns to that tab.
- The row last clicked stays highlighted.

### Context menus

Right-click a row to open its menu:

| Row | Actions |
| --- | --- |
| Compose project | Start All, Deploy (`up -d`), Restart, Stop, Down, Pull, Build, status and logs in a terminal, Copy Compose File Path |
| Service with several containers | Start, Restart, Stop, logs in a terminal, Rebuild |
| Container | Restart, Pause, Stop, Image, Show Logs, Show Files, Copy Container ID, Copy Image ID, Inspect, Show Processes, Attach, Exec, Create Terminal, Rebuild Service |
| Image | Inspect, Copy Image ID, Copy Image Name, Pull, Remove Image |
| Images group | Remove Dangling Images, Remove Unused Images |
| Docker root | Compose Up in Workspace Folder, for a project with no containers yet |

Commands open in a new terminal tab of the focused workspace and use absolute compose file paths. Container actions and details go straight to the Docker API. Jump to Source and Open Project wait for file opening in Orca's plugin API.

### Removing images

Removing an image asks for confirmation. The dialog lists the containers based on that image, because they are removed with it, even running ones. If that list changes after you confirm, nothing is removed.

Cleanup shows what it would remove first. It leaves alone any image a container uses, even a stopped one.

### Logs

Logs stream into the panel, keeping the last 5000 lines, with a line filter and auto-scroll. Terminal color codes are stripped. The panel shows one container at a time.

### Worker

The worker talks to the Docker Engine API directly, using the socket of the current `docker context`.

- It notifies you when a container crashes by itself (not after stop or down), runs out of memory or turns unhealthy. For a crash loop, it notifies at most once every 10 minutes.
- It adds two commands to the palette: `Docker: Show Compose Status` and `Docker: Toggle Crash Notifications`.

## Limitations

- Compose profiles and other project files cannot be chosen in the panel: commands use the files the project was started with.
- Networks and volumes are read-only for now.
- Plugins cannot create terminals through the API yet, so the worker calls the `orca-ide` CLI. If the focused workspace has no terminals and its name and branch are not unique, open any terminal in it, because the API does not identify the workspace more precisely.
- Expanded tree groups are not remembered.
- The worker gets a reduced environment: it cannot see `DOCKER_HOST` or `DOCKER_CONTEXT`, so the endpoint comes from `~/.docker`. It supports `unix://`, `npipe://` and `tcp://` without TLS.
- The worker starts on the first Orca event (agent status change, workspace creation), a palette command or a request from the panel. To keep Orca from unloading it after 5 idle minutes, it makes a light `storage.get` call every 2 minutes. It takes one of the 5 active worker slots.
- Commands assume a POSIX shell in the terminal.

## Checks

```sh
npm test
npm run typecheck
```
