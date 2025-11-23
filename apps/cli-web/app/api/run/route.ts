import { access } from "node:fs/promises"
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

async function ensureCliBuild(repoRoot: string): Promise<void> {
	const cliDist = path.join(repoRoot, "cli", "dist", "index.js")
	if (await fileExists(cliDist)) {
		return
	}

	await new Promise<void>((resolve, reject) => {
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
	})
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

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			child.stdout.on("data", (data) => {
				controller.enqueue(encoder.encode(data.toString()))
			})

			child.stderr.on("data", (data) => {
				controller.enqueue(encoder.encode(`STDERR: ${data.toString()}`))
			})

			child.on("close", (code) => {
				controller.enqueue(encoder.encode(`\nProcess exited with code ${code ?? "unknown"}`))
				controller.close()
			})
		},
		cancel() {
			child.kill("SIGINT")
		},
	})

	return new NextResponse(stream, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "no-cache",
		},
	})
}
