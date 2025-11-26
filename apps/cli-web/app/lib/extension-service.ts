import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { access, stat } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"

export class CliRunRequestError extends Error {
	status: number

	constructor(message: string, status = 400) {
		super(message)
		this.name = "CliRunRequestError"
		this.status = status
	}
}

const encoder = new TextEncoder()

async function pathExists(target: string): Promise<boolean> {
	try {
		await access(target, constants.F_OK)
		return true
	} catch {
		return false
	}
}

async function findRepoRoot(): Promise<string> {
	const markers = ["pnpm-workspace.yaml", "package.json", ".git"]
	let current = process.cwd()

	while (true) {
		const found = await Promise.all(
			markers.map(async (marker) => ({ marker, exists: await pathExists(path.join(current, marker)) })),
		)

		if (found.some((entry) => entry.exists)) {
			return current
		}

		const parent = path.dirname(current)
		if (parent === current) {
			return process.cwd()
		}

		current = parent
	}
}

const repoRootPromise = findRepoRoot()

async function getCliEntry(): Promise<string> {
	const repoRoot = await repoRootPromise
	return path.join(repoRoot, "cli", "dist", "index.js")
}

async function needsCliRebuild(cliEntry: string, repoRoot: string): Promise<boolean> {
	const distExists = await pathExists(cliEntry)
	if (!distExists) return true

	const cliSrcDir = path.join(repoRoot, "cli", "src")
	try {
		const [distStat, srcStat] = await Promise.all([stat(cliEntry), stat(cliSrcDir)])
		return distStat.mtimeMs < srcStat.mtimeMs
	} catch {
		return true
	}
}

let cliBuildPromise: Promise<void> | null = null

async function ensureCliBuild(cliEntry: string, repoRoot: string): Promise<void> {
	if (!(await needsCliRebuild(cliEntry, repoRoot))) {
		return
	}

	if (!cliBuildPromise) {
		cliBuildPromise = new Promise<void>((resolve, reject) => {
			const builder = spawn("pnpm", ["--filter", "@kilocode/cli", "build"], {
				cwd: repoRoot,
				stdio: "inherit",
				env: {
					...process.env,
					FORCE_COLOR: "0",
				},
			})

			builder.on("error", reject)
			builder.on("exit", (code) => {
				if (code === 0) {
					resolve()
				} else {
					reject(new Error(`CLI build failed with exit code ${code}`))
				}
			})
		}).finally(() => {
			cliBuildPromise = null
		})
	}

	return cliBuildPromise
}

async function resolveWorkspacePath(
	workspace?: string,
): Promise<{ workspace: string; repoRoot: string; cliEntry: string }> {
	const repoRoot = await repoRootPromise
	const cliEntry = await getCliEntry()
	const trimmed = workspace?.trim() ?? ""
	const target = trimmed.length === 0 ? repoRoot : path.isAbsolute(trimmed) ? trimmed : path.join(repoRoot, trimmed)

	const targetStat = await stat(target).catch(() => null)

	if (!targetStat?.isDirectory()) {
		throw new CliRunRequestError(`Workspace does not exist or is not a directory: ${target}`)
	}

	return { workspace: target, repoRoot, cliEntry }
}

function createStreamFromProcess(child: ChildProcessWithoutNullStreams): ReadableStream<Uint8Array> {
	let closed = false

	return new ReadableStream<Uint8Array>({
		start(controller) {
			const enqueue = (chunk: string) => {
				if (closed) return
				controller.enqueue(encoder.encode(chunk))
			}

			const close = () => {
				if (closed) return
				closed = true
				controller.close()
			}

			child.stdout.on("data", (data) => enqueue(data.toString()))
			child.stderr.on("data", (data) => enqueue(`STDERR: ${data.toString()}`))

			child.on("close", (code) => {
				enqueue(`\nProcess exited with code ${code ?? "unknown"}`)
				close()
			})

			child.on("error", (error) => {
				enqueue(`STDERR: ${error instanceof Error ? error.message : String(error)}`)
				close()
			})
		},
		cancel() {
			child.kill("SIGINT")
			closed = true
		},
	})
}

export interface CliRunOptions {
	prompt: string
	workspace?: string
}

export async function createCliRunStream(options: CliRunOptions): Promise<ReadableStream<Uint8Array>> {
	const prompt = options.prompt.trim()
	if (!prompt) {
		throw new CliRunRequestError("Prompt is required")
	}

	const { workspace, repoRoot, cliEntry } = await resolveWorkspacePath(options.workspace)

	await ensureCliBuild(cliEntry, repoRoot)

	const args = [cliEntry, "--auto", "--json", prompt, "--workspace", workspace]

	const child = spawn("node", args, {
		cwd: workspace,
		env: {
			...process.env,
			FORCE_COLOR: "0",
		},
	})

	return createStreamFromProcess(child)
}
