import { homedir } from "node:os";
import { request } from "node:http";
import { request as request$1 } from "node:https";
import { StringDecoder } from "node:string_decoder";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
// src/shared/protocol.ts
/** The contract between the panel and the worker, shared by both sides. */
var OPEN_TERMINAL_REQUEST = "terminal.open";
var TREE_REQUEST = "docker.tree";
var TREE_CHANGED_EVENT = "docker.tree.changed";
function emptyTree(error) {
	return {
		projects: [],
		devContainers: [],
		containers: [],
		images: [],
		networks: [],
		volumes: [],
		...error === void 0 ? {} : { error }
	};
}
var CONTAINER_ACTION_REQUEST = "docker.container";
var CONTAINER_ACTIONS = [
	"start",
	"stop",
	"restart",
	"pause",
	"unpause",
	"remove"
];
var LOGS_START_REQUEST = "docker.logs.start";
var LOGS_RENEW_REQUEST = "docker.logs.renew";
var LOGS_STOP_REQUEST = "docker.logs.stop";
var LOGS_EVENT = "docker.logs";
var INSPECT_REQUEST = "docker.inspect";
var PROCESSES_REQUEST = "docker.processes";
var FILES_REQUEST = "docker.files";
var IMAGE_REMOVE_REQUEST = "docker.image.remove";
var IMAGE_PRUNE_PREVIEW_REQUEST = "docker.images.prunePreview";
var IMAGE_PRUNE_REQUEST = "docker.images.prune";
/** dangling: untagged images. unused: every image no container uses, tagged or not. */
var PRUNE_MODES = ["dangling", "unused"];
var CLEANUP_PREVIEW_REQUEST = "docker.cleanup.preview";
var CLEANUP_REQUEST = "docker.cleanup";
var NETWORK_CREATE_REQUEST = "docker.network.create";
var VOLUME_CREATE_REQUEST = "docker.volume.create";
/** Stopped containers, or networks and volumes no container refers to. */
var CLEANUP_KINDS = [
	"containers",
	"networks",
	"volumes"
];
var NETWORK_DRIVERS = [
	"bridge",
	"overlay",
	"macvlan",
	"ipvlan"
];
/** What Docker accepts as a network or volume name. */
var DOCKER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
var IMAGE_SEARCH_REQUEST = "docker.images.search";
var SYSTEM_CLEANUP_PREVIEW_REQUEST = "docker.system.cleanupPreview";
var SYSTEM_CLEANUP_REQUEST = "docker.system.cleanup";
var DASHBOARD_REQUEST = "docker.dashboard";
var REMOVE_REQUEST = "docker.remove";
var CONTEXT_USE_REQUEST = "docker.context.use";
// src/worker/compose-status.ts
var PROJECT_LABEL = "com.docker.compose.project";
var STANDALONE = "(standalone)";
function containerName$1(container) {
	return container.Labels["com.docker.compose.service"] ?? container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12);
}
function summarizeProjects(containers) {
	const byProject = /* @__PURE__ */ new Map();
	for (const container of containers) {
		const project = container.Labels["com.docker.compose.project"] ?? STANDALONE;
		const status = byProject.get(project) ?? {
			project,
			running: 0,
			total: 0,
			problems: []
		};
		status.total += 1;
		if (container.State === "running") {
			status.running += 1;
			if (container.Status.includes("(unhealthy)")) status.problems.push(`${containerName$1(container)} unhealthy`);
		} else if (container.State === "restarting" || container.State === "dead") status.problems.push(`${containerName$1(container)} ${container.State}`);
		byProject.set(project, status);
	}
	return [...byProject.values()].sort((a, b) => Number(a.project === STANDALONE) - Number(b.project === STANDALONE) || a.project.localeCompare(b.project));
}
function formatStatus(projects) {
	if (projects.length === 0) return "No containers";
	const text = projects.map((status) => {
		const head = `${status.project}: ${status.running}/${status.total} running`;
		return status.problems.length === 0 ? head : `${head} — ${status.problems.join(", ")}`;
	}).join("\n");
	return text.length <= 1e3 ? text : `${text.slice(0, 999)}…`;
}
// src/worker/crash-notifier.ts
/** `docker stop`, `compose down` and friends send a kill before the container dies. */
var INTENTIONAL_KILL_WINDOW_MS = 3e4;
var WATCHED_EVENTS = [
	"kill",
	"die",
	"oom",
	"health_status"
];
var TITLE_MAX = 120;
var CrashNotifier = class {
	lastKill = /* @__PURE__ */ new Map();
	lastNotified = /* @__PURE__ */ new Map();
	handle(event, now) {
		if (event.Type !== "container") return null;
		const id = event.Actor.ID;
		const attributes = event.Actor.Attributes;
		this.prune(now);
		let problem;
		if (event.Action === "kill") {
			this.lastKill.set(id, now);
			return null;
		} else if (event.Action === "die") {
			const exitCode = attributes.exitCode ?? "?";
			const killedRecently = now - (this.lastKill.get(id) ?? -Infinity) < INTENTIONAL_KILL_WINDOW_MS;
			if (exitCode === "0" || killedRecently) return null;
			problem = `exited with code ${exitCode}`;
		} else if (event.Action === "oom") problem = "ran out of memory";
		else if (event.Action === "health_status: unhealthy") problem = "is unhealthy";
		else return null;
		const previous = this.lastNotified.get(id);
		if (previous && now - previous.at < 6e5) {
			previous.suppressed += 1;
			return null;
		}
		this.lastNotified.set(id, {
			at: now,
			suppressed: 0
		});
		const title = `${attributes["com.docker.compose.service"] ?? attributes.name ?? id.slice(0, 12)} ${problem}`;
		const details = [attributes[PROJECT_LABEL], attributes.image].filter(Boolean).join(" · ");
		const repeats = previous?.suppressed ? `${previous.suppressed} more times since the last notice` : "";
		return {
			title: title.length <= TITLE_MAX ? title : `${title.slice(0, 119)}…`,
			body: [repeats, details].filter(Boolean).join("\n")
		};
	}
	prune(now) {
		for (const [id, at] of this.lastKill) if (now - at >= 3e4) this.lastKill.delete(id);
		for (const [id, entry] of this.lastNotified) if (now - entry.at >= 12e5) this.lastNotified.delete(id);
	}
};
// src/worker/log-decoder.ts
/** Turns the bytes of Docker's /logs stream into text for the panel. */
var HEADER_BYTES = 8;
var ANSI_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
/**
* Without a TTY Docker wraps output into frames: stream type, three zero bytes, then the payload
* size as a big-endian 32-bit integer. With a TTY the stream is the raw output. A chunk may end
* anywhere, in the middle of a frame or of a UTF-8 character.
*/
var LogDecoder = class {
	tty;
	text = new StringDecoder("utf8");
	pending = Buffer.alloc(0);
	constructor(tty) {
		this.tty = tty;
	}
	push(chunk) {
		return (this.tty ? this.text.write(chunk) : this.unframe(chunk)).replace(ANSI_SEQUENCE, "");
	}
	unframe(chunk) {
		this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
		let output = "";
		let offset = 0;
		while (this.pending.length - offset >= HEADER_BYTES) {
			const size = this.pending.readUInt32BE(offset + 4);
			const end = offset + HEADER_BYTES + size;
			if (end > this.pending.length) break;
			output += this.text.write(this.pending.subarray(offset + HEADER_BYTES, end));
			offset = end;
		}
		this.pending = this.pending.subarray(offset);
		return output;
	}
};
// src/worker/docker-api.ts
var DockerApiError = class extends Error {
	statusCode;
	constructor(message, statusCode) {
		super(message);
		this.statusCode = statusCode;
	}
};
var REQUEST_TIMEOUT_MS = 1e4;
/** A stop waits out the container's grace period before Docker kills it. */
var ACTION_TIMEOUT_MS = 6e4;
/** Pruning walks every image and its layers. */
var PRUNE_TIMEOUT_MS = 6e5;
var NOT_MODIFIED = 304;
/** A request's answer may not exceed 1 MiB, and a file listing has no natural limit. */
var EXEC_OUTPUT_MAX_CHARS = 524288;
var DockerApi = class {
	endpoint;
	constructor(endpoint) {
		this.endpoint = endpoint;
	}
	open(path, signal, method = "GET", body) {
		const endpoint = this.endpoint;
		const target = endpoint.kind === "socket" ? { socketPath: endpoint.socketPath } : {
			host: endpoint.host,
			port: endpoint.port
		};
		const tls = endpoint.kind === "tcp" ? endpoint.tls : void 0;
		const send = tls ? request$1 : request;
		return new Promise((resolve, reject) => {
			const payload = body === void 0 ? void 0 : JSON.stringify(body);
			const headers = {
				Host: endpoint.kind === "socket" ? "docker" : `${endpoint.host}:${endpoint.port}`,
				...payload === void 0 ? {} : { "Content-Type": "application/json" }
			};
			const req = send({
				...target,
				...tls ? {
					ca: tls.ca,
					cert: tls.cert,
					key: tls.key,
					rejectUnauthorized: tls.verify
				} : {},
				path,
				method,
				signal,
				headers
			});
			req.on("response", (res) => {
				if (res.statusCode !== void 0 && res.statusCode >= 200 && res.statusCode < 300) {
					resolve(res);
					return;
				}
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => body += chunk);
				res.on("end", () => {
					reject(new DockerApiError((() => {
						try {
							return JSON.parse(body).message;
						} catch {
							return;
						}
					})() ?? `HTTP ${res.statusCode}`, res.statusCode));
				});
			});
			req.on("error", reject);
			req.end(payload);
		});
	}
	async getJson(path) {
		const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
		const res = await this.open(path, signal);
		let body = "";
		res.setEncoding("utf8");
		for await (const chunk of res) body += chunk;
		return JSON.parse(body);
	}
	listContainers() {
		return this.getJson("/containers/json?all=1");
	}
	listImages() {
		return this.getJson("/images/json");
	}
	listNetworks() {
		return this.getJson("/networks");
	}
	async listVolumes() {
		const { Volumes } = await this.getJson("/volumes");
		return Volumes ?? [];
	}
	/** Networks and volumes answer at their bare path; containers and images under /json. */
	inspect(kind, id) {
		const path = `/${kind}s/${encodeURIComponent(id)}`;
		return this.getJson(kind === "network" || kind === "volume" ? path : `${path}/json`);
	}
	imageHistory(id) {
		return this.getJson(`/images/${encodeURIComponent(id)}/history`);
	}
	containerProcesses(id) {
		return this.getJson(`/containers/${id}/top`);
	}
	/** Sends a request that changes something and reads its JSON answer, if any. */
	async change(method, path, body) {
		const res = await this.open(path, AbortSignal.timeout(ACTION_TIMEOUT_MS), method, body);
		let text = "";
		res.setEncoding("utf8");
		for await (const chunk of res) text += chunk;
		return text === "" ? null : JSON.parse(text);
	}
	async createNetwork({ name, driver, attachable, internal }) {
		await this.change("POST", "/networks/create", {
			Name: name,
			Driver: driver,
			Attachable: attachable,
			Internal: internal,
			CheckDuplicate: true
		});
	}
	async createVolume(name) {
		await this.change("POST", "/volumes/create", { Name: name });
	}
	async removeNetwork(id) {
		await this.change("DELETE", `/networks/${encodeURIComponent(id)}`);
	}
	async removeVolume(name) {
		await this.change("DELETE", `/volumes/${encodeURIComponent(name)}`);
	}
	/** Without force, so the daemon refuses a container that started again. */
	async removeStoppedContainer(id) {
		await this.change("DELETE", `/containers/${id}`);
	}
	/** Without force: the daemon keeps an image that something still uses. */
	async removeUnusedImage(id) {
		await this.change("DELETE", `/images/${encodeURIComponent(id)}`);
	}
	/**
	* Bytes a build cache prune frees: not in use by a build, and not shared with an image,
	* which keeps those layers anyway. `docker system df` counts it the same way.
	*/
	async buildCacheSize() {
		const { BuildCache } = await this.getJson("/system/df?type=build-cache");
		return (BuildCache ?? []).filter((item) => !item.InUse && !item.Shared).reduce((sum, item) => sum + item.Size, 0);
	}
	async pruneBuildCache() {
		return (await this.change("POST", "/build/prune?all=true"))?.SpaceReclaimed ?? 0;
	}
	async searchImages(term) {
		return (await this.getJson(`/images/search?term=${encodeURIComponent(term)}&limit=10`)).sort((a, b) => Number(b.is_official) - Number(a.is_official) || b.star_count - a.star_count).map((item) => item.name);
	}
	async forceRemoveContainer(id) {
		(await this.open(`/containers/${id}?force=1`, AbortSignal.timeout(ACTION_TIMEOUT_MS), "DELETE")).resume();
	}
	/** Force, because an image with several tags cannot be removed by its id otherwise. */
	async removeImage(id) {
		const path = `/images/${encodeURIComponent(id)}?force=1`;
		(await this.open(path, AbortSignal.timeout(ACTION_TIMEOUT_MS), "DELETE")).resume();
	}
	async pruneImages(mode) {
		const filters = encodeURIComponent(JSON.stringify({ dangling: [String(mode === "dangling")] }));
		const res = await this.open(`/images/prune?filters=${filters}`, AbortSignal.timeout(PRUNE_TIMEOUT_MS), "POST");
		let body = "";
		res.setEncoding("utf8");
		for await (const chunk of res) body += chunk;
		const { ImagesDeleted, SpaceReclaimed } = JSON.parse(body);
		return {
			removed: (ImagesDeleted ?? []).filter((item) => item.Deleted !== void 0).length,
			reclaimed: SpaceReclaimed
		};
	}
	/** Runs a command in a running container and returns what it printed. */
	async execOutput(id, cmd) {
		const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
		const created = await this.open(`/containers/${id}/exec`, signal, "POST", {
			AttachStdout: true,
			AttachStderr: true,
			Cmd: cmd
		});
		let answer = "";
		created.setEncoding("utf8");
		for await (const chunk of created) answer += chunk;
		const { Id } = JSON.parse(answer);
		const res = await this.open(`/exec/${Id}/start`, signal, "POST", {
			Detach: false,
			Tty: false
		});
		const decoder = new LogDecoder(false);
		let output = "";
		for await (const chunk of res) output += decoder.push(chunk);
		return output.slice(0, EXEC_OUTPUT_MAX_CHARS);
	}
	async containerAction(id, action) {
		const [method, path] = action === "remove" ? ["DELETE", `/containers/${id}`] : ["POST", `/containers/${id}/${action}`];
		try {
			(await this.open(path, AbortSignal.timeout(ACTION_TIMEOUT_MS), method)).resume();
		} catch (error) {
			if (!(error instanceof DockerApiError) || error.statusCode !== NOT_MODIFIED) throw error;
		}
	}
	/** Follows a container's output until it stops, the daemon goes away, or `signal` aborts. */
	async followLogs(id, onText, signal) {
		const { Config } = await this.getJson(`/containers/${id}/json`);
		const res = await this.open(`/containers/${id}/logs?follow=1&stdout=1&stderr=1&tail=500`, signal);
		const decoder = new LogDecoder(Config.Tty);
		for await (const chunk of res) {
			const text = decoder.push(chunk);
			if (text !== "") onText(text);
		}
	}
	/** Follows /events until the stream ends, the daemon goes away, or `signal` aborts. */
	async streamEvents(filters, onEvent, signal) {
		const query = encodeURIComponent(JSON.stringify(filters));
		const res = await this.open(`/events?filters=${query}`, signal);
		res.setEncoding("utf8");
		let buffered = "";
		for await (const chunk of res) {
			buffered += chunk;
			let newline = buffered.indexOf("\n");
			while (newline !== -1) {
				const line = buffered.slice(0, newline).trim();
				buffered = buffered.slice(newline + 1);
				if (line !== "") onEvent(JSON.parse(line));
				newline = buffered.indexOf("\n");
			}
		}
	}
};
// src/worker/docker-endpoint.ts
var DEFAULT_CONTEXT = "default";
var DEFAULT_UNIX_SOCKET = "/var/run/docker.sock";
var DEFAULT_WINDOWS_PIPE = "\\\\.\\pipe\\docker_engine";
function parseDockerHost(value) {
	if (value.startsWith("unix://")) {
		const socketPath = value.slice(7);
		return socketPath === "" ? null : {
			kind: "socket",
			socketPath
		};
	}
	if (value.startsWith("npipe://")) {
		const pipe = value.slice(8).replaceAll("/", "\\");
		return pipe === "" ? null : {
			kind: "socket",
			socketPath: pipe
		};
	}
	if (value.startsWith("tcp://")) try {
		const url = new URL(`http://${value.slice(6)}`);
		return {
			kind: "tcp",
			host: url.hostname,
			port: url.port === "" ? 2375 : Number(url.port)
		};
	} catch {
		return null;
	}
	return null;
}
async function readJson(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return null;
	}
}
var contextId = (name) => createHash("sha256").update(name).digest("hex");
async function readOptional(path) {
	try {
		return await readFile(path);
	} catch {
		return;
	}
}
async function cliContext(dockerDir) {
	const name = (await readJson(join(dockerDir, "config.json")))?.currentContext;
	return typeof name === "string" && name !== "" ? name : DEFAULT_CONTEXT;
}
async function listContexts(home) {
	const dockerDir = join(home, ".docker");
	const metaDir = join(dockerDir, "contexts", "meta");
	let ids = [];
	try {
		ids = await readdir(metaDir);
	} catch {}
	return {
		names: [DEFAULT_CONTEXT, ...(await Promise.all(ids.map(async (id) => (await readJson(join(metaDir, id, "meta.json")))?.Name))).filter((name) => typeof name === "string" && name !== "default").sort()],
		cli: await cliContext(dockerDir)
	};
}
/** TLS material sits next to the metadata, as `docker context create --docker tls…` stores it. */
async function contextTls(dockerDir, id, skipVerify) {
	const dir = join(dockerDir, "contexts", "tls", id, "docker");
	const [ca, cert, key] = await Promise.all([
		"ca.pem",
		"cert.pem",
		"key.pem"
	].map((file) => readOptional(join(dir, file))));
	if (!ca && !cert && !key && !skipVerify) return;
	return {
		ca,
		cert,
		key,
		verify: !skipVerify
	};
}
/**
* Orca gives plugin workers a scrubbed environment without DOCKER_HOST or DOCKER_CONTEXT,
* so the endpoint comes from a docker CLI context in ~/.docker, as `docker` itself resolves it:
* the one named, or else the CLI's current one.
*/
async function resolveDockerEndpoint(home, platform = process.platform, contextName = null) {
	const fallback = {
		kind: "socket",
		socketPath: platform === "win32" ? DEFAULT_WINDOWS_PIPE : DEFAULT_UNIX_SOCKET
	};
	const dockerDir = join(home, ".docker");
	const name = contextName ?? await cliContext(dockerDir);
	if (name === "default") return fallback;
	const id = contextId(name);
	const meta = await readJson(join(dockerDir, "contexts", "meta", id, "meta.json"));
	const host = meta?.Endpoints?.docker?.Host;
	if (typeof host !== "string") return fallback;
	if (host.startsWith("ssh://")) throw new Error(`Docker context ${name} connects over SSH, which this plugin does not support yet`);
	const endpoint = parseDockerHost(host);
	if (!endpoint) return fallback;
	if (endpoint.kind === "tcp") {
		const tls = await contextTls(dockerDir, id, meta?.Endpoints?.docker?.SkipTLSVerify === true);
		return tls ? {
			...endpoint,
			tls
		} : endpoint;
	}
	return endpoint;
}
function describeEndpoint(endpoint) {
	if (endpoint.kind === "socket") return endpoint.socketPath;
	return `${endpoint.tls ? "https" : "http"}://${endpoint.host}:${endpoint.port}`;
}
// src/worker/docker-tree.ts
/** Lays Docker out the way the Services view of JetBrains IDEs does. */
var CONFIG_FILES_LABEL = "com.docker.compose.project.config_files";
/** Set by the Dev Containers CLI and by editors on the containers they start. */
var DEV_CONTAINER_LABEL = "devcontainer.local_folder";
var NO_RESOURCES = {
	images: [],
	networks: [],
	volumes: []
};
/** Everything that changes what the tree shows, on top of what the crash notifier needs. */
var TREE_EVENTS = [
	...WATCHED_EVENTS,
	"create",
	"start",
	"stop",
	"restart",
	"pause",
	"unpause",
	"destroy",
	"rename",
	"pull",
	"delete",
	"tag",
	"untag"
];
/** Images, networks and volumes change the tree too; only containers matter to the crash notifier. */
var TREE_EVENT_TYPES = [
	"container",
	"image",
	"network",
	"volume"
];
function readHealth(status) {
	if (status.includes("(unhealthy)")) return "unhealthy";
	if (status.includes("(healthy)")) return "healthy";
	return status.includes("(health: starting)") ? "starting" : null;
}
function readPorts(container) {
	const ports = (container.Ports ?? []).flatMap((port) => port.PublicPort === void 0 ? [] : [`${port.PublicPort}→${port.PrivatePort}`]);
	return [...new Set(ports)];
}
function toTreeContainer(container) {
	return {
		id: container.Id,
		name: container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12),
		image: container.Image,
		imageId: container.ImageID,
		state: container.State,
		status: container.Status,
		health: readHealth(container.Status),
		ports: readPorts(container)
	};
}
var byName$1 = (a, b) => a.name.localeCompare(b.name);
function toTreeImage(image) {
	const tags = (image.RepoTags ?? []).filter((tag) => tag !== "<none>:<none>");
	return {
		id: image.Id,
		name: tags[0] ?? image.Id.replace(/^sha256:/, "").slice(0, 12),
		tags,
		size: image.Size
	};
}
function buildTree(containers, resources = NO_RESOURCES) {
	const projects = /* @__PURE__ */ new Map();
	for (const container of containers) {
		const name = container.Labels[PROJECT_LABEL];
		if (name === void 0) continue;
		const project = projects.get(name) ?? {
			name,
			configFiles: [],
			services: []
		};
		projects.set(name, project);
		if (project.configFiles.length === 0) project.configFiles = (container.Labels[CONFIG_FILES_LABEL] ?? "").split(",").filter(Boolean);
		const serviceName = container.Labels["com.docker.compose.service"] ?? "(unnamed)";
		let service = project.services.find((item) => item.name === serviceName);
		if (!service) {
			service = {
				name: serviceName,
				containers: []
			};
			project.services.push(service);
		}
		service.containers.push(toTreeContainer(container));
	}
	for (const network of resources.networks) {
		const name = network.Labels?.[PROJECT_LABEL];
		if (name && !projects.has(name)) projects.set(name, {
			name,
			configFiles: [],
			services: []
		});
	}
	const sorted = [...projects.values()].sort(byName$1);
	for (const project of sorted) {
		project.services.sort(byName$1);
		for (const service of project.services) service.containers.sort(byName$1);
	}
	return {
		projects: sorted,
		devContainers: containers.filter((container) => container.Labels[DEV_CONTAINER_LABEL] !== void 0).map(toTreeContainer).sort(byName$1),
		containers: containers.map(toTreeContainer).sort(byName$1),
		images: resources.images.map(toTreeImage).sort(byName$1),
		networks: resources.networks.map((network) => ({
			id: network.Id,
			name: network.Name,
			driver: network.Driver,
			...network.Labels?.["com.docker.compose.project"] ? { composeProject: network.Labels[PROJECT_LABEL] } : {}
		})).sort(byName$1),
		volumes: resources.volumes.map((volume) => ({
			name: volume.Name,
			driver: volume.Driver
		})).sort(byName$1)
	};
}
/** Reads the tree when Docker reports a change and pushes it to panels only if it really differs. */
var TreePublisher = class {
	options;
	timer;
	lastPosted = "";
	constructor(options) {
		this.options = options;
	}
	async current() {
		try {
			const tree = await this.options.load();
			this.lastPosted = JSON.stringify(tree);
			return tree;
		} catch (error) {
			return emptyTree(error instanceof Error ? error.message : String(error));
		}
	}
	schedule() {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.publish(), this.options.debounceMs ?? 300);
	}
	stop() {
		clearTimeout(this.timer);
	}
	async publish() {
		const previous = this.lastPosted;
		const tree = await this.current();
		const text = JSON.stringify(tree);
		if (text !== previous) {
			this.lastPosted = text;
			this.options.post(Buffer.byteLength(text) <= 204800 ? tree : null);
		}
	}
};
// src/worker/docker-dashboard.ts
var shortId = (id) => id.replace(/^sha256:/, "").slice(0, 12);
var megabytes = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
var nameOf = (container) => container.Names[0]?.replace(/^\//, "") ?? shortId(container.Id);
function labelsTable(labels) {
	const rows = Object.entries(labels ?? {}).sort(([a], [b]) => a.localeCompare(b));
	return rows.length > 0 ? [{
		title: "Labels",
		columns: ["Name", "Value"],
		rows
	}] : [];
}
function containersTable(containers) {
	return [{
		title: "Containers",
		columns: ["Name", "Status"],
		rows: containers.map((container) => [nameOf(container), container.Status])
	}];
}
async function containerDashboard(docker, id) {
	const info = await docker.inspect("container", id);
	const env = (info.Config.Env ?? []).map((pair) => {
		const at = pair.indexOf("=");
		return at === -1 ? [pair, ""] : [pair.slice(0, at), pair.slice(at + 1)];
	});
	const ports = Object.entries(info.NetworkSettings.Ports ?? {}).flatMap(([port, bindings]) => bindings && bindings.length > 0 ? bindings.map((binding) => [port, `${binding.HostIp || "0.0.0.0"}:${binding.HostPort}`]) : [[port, "not published"]]);
	const command = [...info.Config.Entrypoint ?? [], ...info.Config.Cmd ?? []].join(" ");
	return {
		title: info.Name.replace(/^\//, ""),
		fields: [
			{
				label: "ID",
				value: shortId(info.Id)
			},
			{
				label: "Image",
				value: info.Config.Image
			},
			{
				label: "Status",
				value: `${info.State.Status}${info.State.Status === "exited" ? ` (${info.State.ExitCode})` : ""}`
			},
			{
				label: "Created",
				value: info.Created
			},
			{
				label: "Command",
				value: command
			},
			{
				label: "Restart policy",
				value: info.HostConfig.RestartPolicy?.Name || "no"
			}
		],
		tables: [
			{
				title: "Environment variables",
				columns: ["Name", "Value"],
				rows: env
			},
			{
				title: "Port bindings",
				columns: ["Container", "Host"],
				rows: ports
			},
			{
				title: "Volume bindings",
				columns: [
					"Source",
					"Destination",
					"Mode"
				],
				rows: info.Mounts.map((mount) => [
					mount.Name ?? mount.Source,
					mount.Destination,
					mount.RW ? "rw" : "ro"
				])
			},
			{
				title: "Networks",
				columns: ["Name", "IP"],
				rows: Object.entries(info.NetworkSettings.Networks ?? {}).map(([name, network]) => [name, network.IPAddress])
			},
			...labelsTable(info.Config.Labels)
		]
	};
}
async function imageDashboard(docker, id) {
	const [info, history, containers] = await Promise.all([
		docker.inspect("image", id),
		docker.imageHistory(id),
		docker.listContainers()
	]);
	const tags = info.RepoTags ?? [];
	return {
		title: tags[0] ?? shortId(info.Id),
		fields: [
			{
				label: "ID",
				value: shortId(info.Id)
			},
			{
				label: "Size",
				value: megabytes(info.Size)
			},
			{
				label: "Created",
				value: info.Created
			},
			{
				label: "Platform",
				value: `${info.Os}/${info.Architecture}`
			}
		],
		tables: [
			{
				title: "Tags",
				columns: ["Tag"],
				rows: tags.map((tag) => [tag])
			},
			...containersTable(containers.filter((container) => container.ImageID === info.Id)),
			{
				title: "Layers",
				columns: ["Size", "Created by"],
				rows: history.map((layer) => [megabytes(layer.Size), layer.CreatedBy.replace(/^\/bin\/sh -c (#\(nop\)\s+)?/, "")])
			},
			...labelsTable(info.Config?.Labels)
		]
	};
}
async function networkDashboard(docker, id) {
	const info = await docker.inspect("network", id);
	const subnets = (info.IPAM.Config ?? []).map((item) => [item.Subnet, item.Gateway].filter(Boolean).join(" via "));
	return {
		title: info.Name,
		fields: [
			{
				label: "ID",
				value: shortId(info.Id)
			},
			{
				label: "Driver",
				value: info.Driver
			},
			{
				label: "Scope",
				value: info.Scope
			},
			{
				label: "Subnet",
				value: subnets.join(", ")
			},
			{
				label: "Internal",
				value: info.Internal ? "yes" : "no"
			},
			{
				label: "Attachable",
				value: info.Attachable ? "yes" : "no"
			},
			{
				label: "Created",
				value: info.Created
			}
		],
		tables: [{
			title: "Containers",
			columns: ["Name", "Address"],
			rows: Object.values(info.Containers ?? {}).map((container) => [container.Name, container.IPv4Address])
		}, ...labelsTable(info.Labels)]
	};
}
async function volumeDashboard(docker, name) {
	const [info, containers] = await Promise.all([docker.inspect("volume", name), docker.listContainers()]);
	const users = containers.filter((container) => (container.Mounts ?? []).some((mount) => mount.Type === "volume" && mount.Name === info.Name));
	return {
		title: info.Name,
		fields: [
			{
				label: "Driver",
				value: info.Driver
			},
			{
				label: "Scope",
				value: info.Scope
			},
			{
				label: "Mountpoint",
				value: info.Mountpoint
			},
			{
				label: "Created",
				value: info.CreatedAt ?? ""
			}
		],
		tables: [...containersTable(users), ...labelsTable(info.Labels)]
	};
}
function buildDashboard(docker, kind, id) {
	switch (kind) {
		case "container": return containerDashboard(docker, id);
		case "image": return imageDashboard(docker, id);
		case "network": return networkDashboard(docker, id);
		case "volume": return volumeDashboard(docker, id);
	}
}
// src/worker/docker-images.ts
function isDangling(image) {
	return toTreeImage(image).tags.length === 0;
}
/** Mirrors what the daemon's prune takes: nothing a container uses, even a stopped one. */
function pruneCandidates(images, containers, mode) {
	const used = new Set(containers.map((container) => container.ImageID));
	return images.filter((image) => !used.has(image.Id) && (mode === "unused" || isDangling(image)));
}
async function previewPrune(docker, mode) {
	const [images, containers] = await Promise.all([docker.listImages(), docker.listContainers()]);
	return { images: pruneCandidates(images, containers, mode).map((image) => ({
		name: toTreeImage(image).name,
		size: image.Size
	})) };
}
/** Refuses when a container appeared or went since the person agreed: they saw another list. */
async function removeImageWithContainers(docker, imageId, agreedContainerIds) {
	const current = (await docker.listContainers()).filter((container) => container.ImageID === imageId).map((container) => container.Id);
	const agreed = new Set(agreedContainerIds);
	if (current.length !== agreed.size || current.some((id) => !agreed.has(id))) throw Object.assign(/* @__PURE__ */ new Error("The containers of this image changed. Look at the list again."), { code: "conflict" });
	for (const id of current) await docker.forceRemoveContainer(id);
	await docker.removeImage(imageId);
}
// src/worker/docker-cleanup.ts
/** Docker's own networks, which it never prunes and cannot remove. */
var BUILTIN_NETWORKS = /* @__PURE__ */ new Set([
	"bridge",
	"host",
	"none"
]);
var STOPPED_STATES = /* @__PURE__ */ new Set([
	"exited",
	"created",
	"dead"
]);
function containerName(container) {
	return container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12);
}
/** A stopped container still holds its networks and volumes, as Docker's prune sees it. */
function stoppedContainers(containers) {
	return containers.filter((container) => STOPPED_STATES.has(container.State)).map((container) => ({
		id: container.Id,
		name: containerName(container),
		detail: container.Status
	}));
}
function unusedNetworks(networks, containers) {
	const used = new Set(containers.flatMap((container) => Object.values(container.NetworkSettings?.Networks ?? {}).map((network) => network.NetworkID)));
	return networks.filter((network) => !BUILTIN_NETWORKS.has(network.Name) && network.Scope !== "swarm" && !used.has(network.Id)).map((network) => ({
		id: network.Id,
		name: network.Name,
		detail: network.Driver
	}));
}
function unusedVolumes(volumes, containers) {
	const used = new Set(containers.flatMap((container) => (container.Mounts ?? []).flatMap((mount) => mount.Type === "volume" && mount.Name ? [mount.Name] : [])));
	return volumes.filter((volume) => !used.has(volume.Name)).map((volume) => ({
		id: volume.Name,
		name: volume.Name,
		detail: volume.Driver
	}));
}
async function candidates(docker, kind) {
	const containers = await docker.listContainers();
	switch (kind) {
		case "containers": return stoppedContainers(containers);
		case "networks": return unusedNetworks(await docker.listNetworks(), containers);
		case "volumes": return unusedVolumes(await docker.listVolumes(), containers);
	}
}
var byName = (a, b) => a.name.localeCompare(b.name);
async function previewCleanup(docker, kind) {
	return { items: (await candidates(docker, kind)).sort(byName) };
}
/** Removes the agreed items that are still unused now; anything else stays. */
async function cleanup(docker, kind, ids) {
	const current = new Map((await candidates(docker, kind)).map((item) => [item.id, item]));
	const remove = {
		containers: (id) => docker.removeStoppedContainer(id),
		networks: (id) => docker.removeNetwork(id),
		volumes: (id) => docker.removeVolume(id)
	}[kind];
	const result = {
		removed: 0,
		skipped: 0,
		failed: []
	};
	for (const id of new Set(ids)) {
		const item = current.get(id);
		if (!item) {
			result.skipped += 1;
			continue;
		}
		try {
			await remove(id);
			result.removed += 1;
		} catch (error) {
			result.failed.push({
				name: item.name,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return result;
}
function danglingImages(images, containers) {
	return pruneCandidates(images, containers, "dangling").map((image) => ({
		id: image.Id,
		name: toTreeImage(image).name,
		detail: `${Math.round(image.Size / 1e6)} MB`
	}));
}
async function previewSystemCleanup(docker) {
	const [containers, networks, volumes, images, buildCacheBytes] = await Promise.all([
		docker.listContainers(),
		docker.listNetworks(),
		docker.listVolumes(),
		docker.listImages(),
		docker.buildCacheSize()
	]);
	return {
		containers: stoppedContainers(containers).sort(byName),
		networks: unusedNetworks(networks, containers).sort(byName),
		volumes: unusedVolumes(volumes, containers).sort(byName),
		images: danglingImages(images, containers).sort(byName),
		buildCacheBytes
	};
}
/**
* Containers go first, so the networks, volumes and images they held are free by the time
* those are checked again. Each kind removes only agreed items that are still unused.
*/
async function systemCleanup(docker, input) {
	const total = {
		removed: 0,
		skipped: 0,
		failed: [],
		buildCacheFreed: 0
	};
	const add = (result) => {
		total.removed += result.removed;
		total.skipped += result.skipped;
		total.failed.push(...result.failed);
	};
	add(await cleanup(docker, "containers", input.containers));
	add(await cleanup(docker, "networks", input.networks));
	add(await cleanup(docker, "volumes", input.volumes));
	const current = new Map(danglingImages(await docker.listImages(), await docker.listContainers()).map((item) => [item.id, item]));
	for (const id of new Set(input.images)) {
		const item = current.get(id);
		if (!item) {
			total.skipped += 1;
			continue;
		}
		try {
			await docker.removeUnusedImage(id);
			total.removed += 1;
		} catch (error) {
			total.failed.push({
				name: item.name,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
	if (input.buildCache) total.buildCacheFreed = await docker.pruneBuildCache();
	return total;
}
// src/worker/event-watcher.ts
/** Keeps a /events stream open, reconnecting with backoff while the daemon is down or restarting. */
var RECONNECT_MIN_MS = 2e3;
var RECONNECT_MAX_MS = 3e4;
function abortableSleep(ms, signal) {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener("abort", () => {
			clearTimeout(timer);
			resolve();
		}, { once: true });
	});
}
var EventWatcher = class {
	options;
	controller = null;
	loop = null;
	constructor(options) {
		this.options = options;
	}
	get running() {
		return this.controller !== null;
	}
	start() {
		if (this.controller) return;
		const controller = new AbortController();
		this.controller = controller;
		this.loop = this.run(controller.signal);
	}
	async stop() {
		this.controller?.abort();
		this.controller = null;
		await this.loop;
		this.loop = null;
	}
	async run(signal) {
		const sleep = this.options.sleep ?? abortableSleep;
		let delay = RECONNECT_MIN_MS;
		let lastError = "";
		while (!signal.aborted) {
			const startedAt = Date.now();
			try {
				await (await this.options.api()).streamEvents(this.options.filters, this.options.onEvent, signal);
				lastError = "";
			} catch (error) {
				if (signal.aborted) break;
				const message = error instanceof Error ? error.message : String(error);
				if (message !== lastError) {
					this.options.log(`docker events unavailable: ${message}`);
					lastError = message;
				}
			}
			if (Date.now() - startedAt >= 3e4) delay = RECONNECT_MIN_MS;
			await sleep(delay, signal);
			delay = Math.min(delay * 2, RECONNECT_MAX_MS);
		}
	}
};
/** A panel can close without saying so; a stream nobody renews stops by itself. */
var LOGS_LEASE_MS = 6e4;
var LogStreams = class {
	options;
	stream = null;
	nextId = 0;
	constructor(options) {
		this.options = options;
	}
	start(containerId) {
		this.stop();
		const stream = {
			id: `logs-${++this.nextId}`,
			controller: new AbortController(),
			buffered: ""
		};
		this.stream = stream;
		this.renew(stream.id);
		this.run(stream, containerId);
		return stream.id;
	}
	renew(streamId) {
		const stream = this.stream;
		if (stream?.id !== streamId) return false;
		clearTimeout(stream.leaseTimer);
		stream.leaseTimer = setTimeout(() => this.stop(streamId), LOGS_LEASE_MS);
		return true;
	}
	/** Stops the given stream, or whichever is running. */
	stop(streamId) {
		const stream = this.stream;
		if (!stream || streamId !== void 0 && stream.id !== streamId) return;
		this.stream = null;
		this.release(stream);
		stream.controller.abort();
	}
	release(stream) {
		clearTimeout(stream.flushTimer);
		clearTimeout(stream.leaseTimer);
	}
	async run(stream, containerId) {
		let error;
		try {
			await this.options.follow(containerId, (text) => this.append(stream, text), stream.controller.signal);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
		if (stream.controller.signal.aborted) return;
		this.flush(stream);
		this.stop(stream.id);
		this.options.post({
			streamId: stream.id,
			kind: "ended",
			...error === void 0 ? {} : { error }
		});
	}
	append(stream, text) {
		stream.buffered = (stream.buffered + text).slice(-65536);
		stream.flushTimer ??= setTimeout(() => this.flush(stream), 250);
	}
	flush(stream) {
		clearTimeout(stream.flushTimer);
		stream.flushTimer = void 0;
		if (stream.buffered !== "") {
			this.options.post({
				streamId: stream.id,
				kind: "text",
				text: stream.buffered
			});
			stream.buffered = "";
		}
	}
};
// src/worker/orca-cli.ts
var CLI_TIMEOUT_MS = 15e3;
var CliNotFound = class extends Error {};
function run(file, args) {
	return new Promise((resolve, reject) => {
		execFile(file, [...args, "--json"], { timeout: CLI_TIMEOUT_MS }, (error, stdout) => {
			if (error?.code === "ENOENT") {
				reject(new CliNotFound(file));
				return;
			}
			try {
				const answer = JSON.parse(stdout);
				if (answer.ok) resolve(answer.result);
				else reject(new Error(answer.error?.message ?? "orca failed"));
			} catch {
				reject(error ?? /* @__PURE__ */ new Error("orca gave an unreadable answer"));
			}
		});
	});
}
/** Never plain `orca`: on Linux desktops that is usually the GNOME screen reader. */
function orcaCli(home) {
	const candidates = ["orca-ide", join(home, ".config/orca/linux-orca-cli-shim/orca")];
	return async (args) => {
		for (const file of candidates) try {
			return await run(file, args);
		} catch (error) {
			if (!(error instanceof CliNotFound)) throw error;
		}
		throw new Error("The Orca command line tool was not found");
	};
}
// src/worker/panel-requests.ts
/** The id goes into a Docker API path, so nothing but a container id may get there. */
var CONTAINER_ID = /^[0-9a-f]{12,64}$/;
var IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
function invalidParams(request) {
	return Object.assign(/* @__PURE__ */ new Error(`${request}: malformed input`), { code: "invalid_params" });
}
function isContainerInput(input) {
	const value = input;
	return typeof value?.id === "string" && CONTAINER_ID.test(value.id);
}
/** Containers, images and networks go by a hex id (images with its sha256: prefix), volumes by name. */
function isObjectId(kind, id) {
	if (typeof id !== "string") return false;
	switch (kind) {
		case "container":
		case "network": return CONTAINER_ID.test(id);
		case "image": return IMAGE_ID.test(id);
		case "volume": return DOCKER_NAME.test(id);
		default: return false;
	}
}
function isInspectInput(input) {
	const value = input;
	return isObjectId(value?.kind, value?.id);
}
function isRemoveInput(input) {
	const value = input;
	return (value?.kind === "network" || value?.kind === "volume") && isObjectId(value.kind, value.id);
}
function isImageRemoveInput(input) {
	const value = input;
	return typeof value?.id === "string" && IMAGE_ID.test(value.id) && Array.isArray(value.containerIds) && value.containerIds.every((id) => typeof id === "string" && CONTAINER_ID.test(id));
}
function isPruneInput(input) {
	return PRUNE_MODES.includes(input?.mode);
}
function isCleanupKind(kind) {
	return CLEANUP_KINDS.includes(kind);
}
/** Containers and networks go by id, volumes by name: each has to look like one. */
function isCleanupInput(input) {
	const value = input;
	if (!isCleanupKind(value?.kind) || !Array.isArray(value.ids)) return false;
	const pattern = value.kind === "volumes" ? DOCKER_NAME : CONTAINER_ID;
	return value.ids.every((id) => typeof id === "string" && pattern.test(id));
}
function isIdList(value, pattern) {
	return Array.isArray(value) && value.every((id) => typeof id === "string" && pattern.test(id));
}
function isSystemCleanupInput(input) {
	const value = input;
	return isIdList(value?.containers, CONTAINER_ID) && isIdList(value.networks, CONTAINER_ID) && isIdList(value.volumes, DOCKER_NAME) && isIdList(value.images, IMAGE_ID) && typeof value.buildCache === "boolean";
}
function isNetworkCreateInput(input) {
	const value = input;
	return typeof value?.name === "string" && DOCKER_NAME.test(value.name) && NETWORK_DRIVERS.includes(value.driver) && typeof value.attachable === "boolean" && typeof value.internal === "boolean";
}
function isVolumeCreateInput(input) {
	const value = input;
	return typeof value?.name === "string" && DOCKER_NAME.test(value.name);
}
function isFilesInput(input) {
	const value = input;
	return isContainerInput(input) && typeof value?.path === "string" && value.path.startsWith("/");
}
function isLogsStreamInput(input) {
	return typeof input?.streamId === "string";
}
function isContainerActionInput(input) {
	const value = input;
	return typeof value?.id === "string" && CONTAINER_ID.test(value.id) && CONTAINER_ACTIONS.includes(value.action);
}
function isOpenTerminalInput(input) {
	const value = input;
	return typeof value?.title === "string" && typeof value.command === "string" && value.command !== "" && (value.reuseKey === void 0 || typeof value.reuseKey === "string");
}
function registerPanelRequests(orca, deps) {
	orca.panels.handle(TREE_REQUEST, () => deps.tree.current());
	orca.panels.handle(CONTAINER_ACTION_REQUEST, async (input) => {
		if (!isContainerActionInput(input)) throw invalidParams(CONTAINER_ACTION_REQUEST);
		await deps.containerAction(input.id, input.action);
		return null;
	});
	orca.panels.handle(INSPECT_REQUEST, (input) => {
		if (!isInspectInput(input)) throw invalidParams(INSPECT_REQUEST);
		return deps.inspect(input.kind, input.id);
	});
	orca.panels.handle(DASHBOARD_REQUEST, (input) => {
		if (!isInspectInput(input)) throw invalidParams(DASHBOARD_REQUEST);
		return deps.dashboard(input.kind, input.id);
	});
	orca.panels.handle(REMOVE_REQUEST, async (input) => {
		if (!isRemoveInput(input)) throw invalidParams(REMOVE_REQUEST);
		await deps.remove(input.kind, input.id);
		return null;
	});
	orca.panels.handle(PROCESSES_REQUEST, async (input) => {
		if (!isContainerInput(input)) throw invalidParams(PROCESSES_REQUEST);
		const { Titles, Processes } = await deps.processes(input.id);
		return {
			titles: Titles,
			processes: Processes ?? []
		};
	});
	orca.panels.handle(FILES_REQUEST, async (input) => {
		if (!isFilesInput(input)) throw invalidParams(FILES_REQUEST);
		return { text: await deps.files(input.id, input.path) };
	});
	orca.panels.handle(IMAGE_REMOVE_REQUEST, async (input) => {
		if (!isImageRemoveInput(input)) throw invalidParams(IMAGE_REMOVE_REQUEST);
		await deps.removeImage(input.id, input.containerIds);
		return null;
	});
	orca.panels.handle(IMAGE_PRUNE_PREVIEW_REQUEST, (input) => {
		if (!isPruneInput(input)) throw invalidParams(IMAGE_PRUNE_PREVIEW_REQUEST);
		return deps.previewPrune(input.mode);
	});
	orca.panels.handle(IMAGE_PRUNE_REQUEST, (input) => {
		if (!isPruneInput(input)) throw invalidParams(IMAGE_PRUNE_REQUEST);
		return deps.pruneImages(input.mode);
	});
	orca.panels.handle(CLEANUP_PREVIEW_REQUEST, (input) => {
		const kind = input?.kind;
		if (!isCleanupKind(kind)) throw invalidParams(CLEANUP_PREVIEW_REQUEST);
		return deps.previewCleanup(kind);
	});
	orca.panels.handle(CLEANUP_REQUEST, (input) => {
		if (!isCleanupInput(input)) throw invalidParams(CLEANUP_REQUEST);
		return deps.cleanup(input.kind, input.ids);
	});
	orca.panels.handle(IMAGE_SEARCH_REQUEST, async (input) => {
		const term = input?.term;
		if (typeof term !== "string" || term.trim().length < 2 || term.length > 100) throw invalidParams(IMAGE_SEARCH_REQUEST);
		return { names: await deps.searchImages(term.trim()) };
	});
	orca.panels.handle(SYSTEM_CLEANUP_PREVIEW_REQUEST, () => deps.previewSystemCleanup());
	orca.panels.handle(SYSTEM_CLEANUP_REQUEST, (input) => {
		if (!isSystemCleanupInput(input)) throw invalidParams(SYSTEM_CLEANUP_REQUEST);
		const { containers, networks, volumes, images, buildCache } = input;
		return deps.systemCleanup({
			containers,
			networks,
			volumes,
			images,
			buildCache
		});
	});
	orca.panels.handle(CONTEXT_USE_REQUEST, async (input) => {
		const name = input?.name;
		if (name !== null && (typeof name !== "string" || name.length > 200)) throw invalidParams(CONTEXT_USE_REQUEST);
		await deps.useContext(name);
		return null;
	});
	orca.panels.handle(NETWORK_CREATE_REQUEST, async (input) => {
		if (!isNetworkCreateInput(input)) throw invalidParams(NETWORK_CREATE_REQUEST);
		const { name, driver, attachable, internal } = input;
		await deps.createNetwork({
			name,
			driver,
			attachable,
			internal
		});
		return null;
	});
	orca.panels.handle(VOLUME_CREATE_REQUEST, async (input) => {
		if (!isVolumeCreateInput(input)) throw invalidParams(VOLUME_CREATE_REQUEST);
		await deps.createVolume(input.name);
		return null;
	});
	orca.panels.handle(LOGS_START_REQUEST, (input) => {
		if (!isContainerInput(input)) throw invalidParams(LOGS_START_REQUEST);
		return { streamId: deps.logs.start(input.id) };
	});
	orca.panels.handle(LOGS_RENEW_REQUEST, (input) => {
		if (!isLogsStreamInput(input)) throw invalidParams(LOGS_RENEW_REQUEST);
		return { alive: deps.logs.renew(input.streamId) };
	});
	orca.panels.handle(LOGS_STOP_REQUEST, (input) => {
		if (!isLogsStreamInput(input)) throw invalidParams(LOGS_STOP_REQUEST);
		deps.logs.stop(input.streamId);
		return null;
	});
	orca.panels.handle(OPEN_TERMINAL_REQUEST, async (input) => {
		if (!isOpenTerminalInput(input)) throw invalidParams(OPEN_TERMINAL_REQUEST);
		await deps.terminals.open(input);
		return null;
	});
}
// src/worker/terminal-launcher.ts
var TerminalLauncher = class {
	options;
	reusable = /* @__PURE__ */ new Map();
	constructor(options) {
		this.options = options;
	}
	async open({ title, command, reuseKey }) {
		const context = await this.options.readContext();
		if (!context) throw new Error("No workspace is in focus");
		const known = reuseKey === void 0 ? void 0 : this.reusable.get(reuseKey);
		if (known && context.terminals.some((terminal) => terminal.id === known)) {
			await this.options.cli([
				"terminal",
				"switch",
				"--terminal",
				known
			]);
			return;
		}
		const worktree = await this.focusedWorktree(context);
		const created = await this.options.cli([
			"terminal",
			"create",
			"--worktree",
			`id:${worktree}`,
			"--title",
			title,
			"--command",
			command,
			"--focus"
		]);
		if (reuseKey !== void 0) this.reusable.set(reuseKey, created.terminal.handle);
	}
	/** Plugins are told the focused workspace only by name, and two workspaces may share a name. */
	async focusedWorktree(context) {
		const [first] = context.terminals;
		if (first) return (await this.options.cli([
			"terminal",
			"show",
			"--terminal",
			first.id
		])).terminal.worktreeId;
		const { worktrees } = await this.options.cli(["worktree", "list"]);
		const matching = worktrees.filter((worktree) => worktree.displayName === context.displayName && worktree.branch.replace("refs/heads/", "") === context.branch);
		const [only] = matching;
		if (matching.length === 1 && only) return only.id;
		throw new Error("Open any terminal in this workspace first: its name is not unique");
	}
};
// src/worker/main.ts
var NOTIFICATIONS_KEY = "crashNotifications";
/** The context chosen in the panel; absent means the docker CLI's current one. */
var CONTEXT_KEY = "dockerContext";
/** Orca reaps a worker after 5 idle minutes; any host call counts as activity. */
var KEEPALIVE_MS = 12e4;
var stopWorker = null;
async function activate(orca) {
	let contextOverride = null;
	const api = async () => new DockerApi(await resolveDockerEndpoint(homedir(), process.platform, contextOverride));
	const treeContext = async () => {
		const { names, cli } = await listContexts(homedir());
		return {
			active: contextOverride ?? cli,
			cli,
			names
		};
	};
	const notifier = new CrashNotifier();
	let keepalive;
	let notifying = false;
	async function notify(title, body) {
		try {
			await orca.host.call("notifications.show", body ? {
				title,
				body
			} : { title });
		} catch (error) {
			orca.log(`notification failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const tree = new TreePublisher({
		load: async () => {
			const context = await treeContext();
			try {
				const docker = await api();
				const [containers, images, networks, volumes] = await Promise.all([
					docker.listContainers(),
					docker.listImages(),
					docker.listNetworks(),
					docker.listVolumes()
				]);
				return {
					...buildTree(containers, {
						images,
						networks,
						volumes
					}),
					context
				};
			} catch (error) {
				return {
					...emptyTree(error instanceof Error ? error.message : String(error)),
					context
				};
			}
		},
		post: (value) => orca.panels.post(TREE_CHANGED_EVENT, value)
	});
	const watcher = new EventWatcher({
		api,
		filters: {
			type: TREE_EVENT_TYPES,
			event: TREE_EVENTS
		},
		onEvent: (event) => {
			tree.schedule();
			const notification = notifying ? notifier.handle(event, Date.now()) : null;
			if (notification) notify(notification.title, notification.body);
		},
		log: (message) => orca.log(message)
	});
	function setNotifying(enabled) {
		notifying = enabled;
		clearInterval(keepalive);
		if (!enabled) return;
		keepalive = setInterval(() => {
			orca.host.call("storage.get", { key: NOTIFICATIONS_KEY }).catch(() => void 0);
		}, KEEPALIVE_MS);
	}
	async function notificationsEnabled() {
		return (await orca.host.call("storage.get", { key: NOTIFICATIONS_KEY }))?.value !== false;
	}
	orca.commands.register("docker-status", async () => {
		try {
			const projects = summarizeProjects(await (await api()).listContainers());
			await notify("Docker Compose", formatStatus(projects));
			return { projects };
		} catch (error) {
			const endpoint = describeEndpoint(await resolveDockerEndpoint(homedir()));
			const message = error instanceof Error ? error.message : String(error);
			await notify("Docker is not reachable", `${endpoint}: ${message}`);
			return { error: message };
		}
	});
	orca.commands.register("docker-toggle-notifications", async () => {
		const enabled = !await notificationsEnabled();
		await orca.host.call("storage.set", {
			key: NOTIFICATIONS_KEY,
			value: enabled
		});
		setNotifying(enabled);
		await notify(enabled ? "Crash notifications on" : "Crash notifications off");
		return { enabled };
	});
	const logs = new LogStreams({
		follow: async (id, onText, signal) => (await api()).followLogs(id, onText, signal),
		post: (payload) => orca.panels.post(LOGS_EVENT, payload)
	});
	registerPanelRequests(orca, {
		terminals: new TerminalLauncher({
			cli: orcaCli(homedir()),
			readContext: async () => await orca.host.call("workspace.readContext")
		}),
		tree,
		logs,
		containerAction: async (id, action) => (await api()).containerAction(id, action),
		inspect: async (kind, id) => (await api()).inspect(kind, id),
		dashboard: async (kind, id) => buildDashboard(await api(), kind, id),
		remove: async (kind, id) => {
			const docker = await api();
			await (kind === "network" ? docker.removeNetwork(id) : docker.removeVolume(id));
		},
		processes: async (id) => (await api()).containerProcesses(id),
		files: async (id, path) => (await api()).execOutput(id, [
			"ls",
			"-la",
			path
		]),
		removeImage: async (id, containerIds) => removeImageWithContainers(await api(), id, containerIds),
		previewPrune: async (mode) => previewPrune(await api(), mode),
		pruneImages: async (mode) => (await api()).pruneImages(mode),
		previewCleanup: async (kind) => previewCleanup(await api(), kind),
		cleanup: async (kind, ids) => cleanup(await api(), kind, ids),
		createNetwork: async (input) => (await api()).createNetwork(input),
		createVolume: async (name) => (await api()).createVolume(name),
		searchImages: async (term) => (await api()).searchImages(term),
		previewSystemCleanup: async () => previewSystemCleanup(await api()),
		systemCleanup: async (input) => systemCleanup(await api(), input),
		useContext: async (name) => {
			const { names, cli } = await listContexts(homedir());
			if (name !== null && !names.includes(name)) throw Object.assign(/* @__PURE__ */ new Error(`There is no Docker context ${name}`), { code: "invalid_params" });
			contextOverride = name === cli ? null : name;
			await orca.host.call("storage.set", {
				key: CONTEXT_KEY,
				value: contextOverride
			});
			logs.stop();
			await watcher.stop();
			watcher.start();
			tree.schedule();
		}
	});
	orca.events.on("workspace.created", () => void 0);
	orca.events.on("agent.status.changed", () => void 0);
	stopWorker = async () => {
		clearInterval(keepalive);
		tree.stop();
		logs.stop();
		await watcher.stop();
	};
	const stored = await orca.host.call("storage.get", { key: CONTEXT_KEY });
	contextOverride = typeof stored?.value === "string" ? stored.value : null;
	watcher.start();
	setNotifying(await notificationsEnabled());
	orca.log("docker plugin active");
}
async function deactivate() {
	await stopWorker?.();
	stopWorker = null;
}
export { KEEPALIVE_MS, deactivate, activate as default };
