import { access, stat } from "node:fs/promises"
import { constants } from "node:fs"
import { spawn } from "node:child_process"
import path from "node:path"
import { NextResponse, type NextRequest } from "next/server"

export const runtime = "nodejs"

async function fileExists(target: string): Promise<boolean> {
	try {
		await access(target, constants.F_OK)
		return true
	} catch {
		return false
	}
}

let cliBuildPromise: Promise<void> | null = null

async function needsCliRebuild(repoRoot: string): Promise<boolean> {
	const cliEntry = path.join(repoRoot, "cli", "dist", "index.js")
	const cliSrcDir = path.join(repoRoot, "cli", "src")

	const distExists = await fileExists(cliEntry)
	if (!distExists) {
		return true
	}

	try {
		const [distStat, srcStat] = await Promise.all([stat(cliEntry), stat(cliSrcDir)])
		return distStat.mtimeMs < srcStat.mtimeMs
	} catch {
		return true
	}
}

async function ensureCliBuild(repoRoot: string): Promise<void> {
	if (!(await needsCliRebuild(repoRoot))) {
		return
	}

	if (!cliBuildPromise) {
		cliBuildPromise = new Promise<void>((resolve, reject) => {
			const builder = spawn("pnpm", ["--filter", "@kilocode/cli", "build"], {
				cwd: repoRoot,
				stdio: "inherit",
				env: {
					...process.env,
					// Avoid color codes in downstream parsing
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

export async function POST(request: NextRequest) {
	const body = (await request.json().catch(() => null)) as { prompt?: string; workspace?: string } | null
	if (!body?.prompt || body.prompt.trim().length === 0) {
		return NextResponse.json({ error: "Prompt is required" }, { status: 400 })
	}

	const repoRoot = path.join(process.cwd(), "..", "..")
	const cliEntry = path.join(repoRoot, "cli", "dist", "index.js")

	try {
		await ensureCliBuild(repoRoot)
	} catch (error) {
		return NextResponse.json({ error: (error as Error).message }, { status: 500 })
	}

	const workspace = body.workspace && body.workspace.trim().length > 0 ? body.workspace.trim() : repoRoot
	const args = [cliEntry, "--auto", "--json", body.prompt.trim(), "--workspace", workspace]

	const child = spawn("node", args, {
		cwd: workspace,
		env: {
			...process.env,
			FORCE_COLOR: "0",
		},
	})

	const encoder = new TextEncoder()

	let safeClose = () => {}
	let safeEnqueue = (_chunk: string) => {}

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let isClosed = false
			safeEnqueue = (chunk: string) => {
				if (isClosed) return
				controller.enqueue(encoder.encode(chunk))
			}
			safeClose = () => {
				if (isClosed) return
				controller.close()
				isClosed = true
			}

			child.stdout.on("data", (data) => {
				safeEnqueue(data.toString())
			})

			child.stderr.on("data", (data) => {
				safeEnqueue(`STDERR: ${data.toString()}`)
			})

			child.on("close", (code) => {
				safeEnqueue(`\nProcess exited with code ${code ?? "unknown"}`)
				safeClose()
			})

			child.on("error", (error) => {
				safeEnqueue(`STDERR: ${error instanceof Error ? error.message : String(error)}`)
				safeClose()
			})
		},
		cancel() {
			child.kill("SIGINT")
			safeClose()
		},
	})

	return new NextResponse(stream, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "no-cache",
		},
	})
}
