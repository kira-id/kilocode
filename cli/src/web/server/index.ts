import express from "express"
import { createServer } from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import type { RawData } from "ws"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { logs } from "../../services/logs.js"
import { WebChatSession } from "./session.js"
import type { ClientMessage, ServerMessage } from "./types.js"

export interface StartWebServerOptions {
	port?: number
	host?: string
	workspace?: string
	staticDir?: string
}

export interface WebServerController {
	close: () => Promise<void>
	session: WebChatSession
}

function broadcast(clients: Set<WebSocket>, message: ServerMessage): void {
	const payload = JSON.stringify(message)
	for (const client of clients) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(payload)
		}
	}
}

function normalizeStaticDir(dir?: string): string | null {
	if (!dir) {
		return null
	}
	const resolved = path.resolve(dir)
	if (!fs.existsSync(resolved)) {
		return null
	}
	return resolved
}

export async function startWebServer(options: StartWebServerOptions = {}): Promise<WebServerController> {
	const port = options.port ?? 4173
	const host = options.host ?? "127.0.0.1"
	const workspace = options.workspace ?? process.cwd()
	const moduleDir = path.dirname(fileURLToPath(import.meta.url))
	const assetDir = path.resolve(moduleDir, "web-ui")
	const staticDir = normalizeStaticDir(options.staticDir || assetDir)

	const session = new WebChatSession({ workspace })
	await session.start()

	const app = express()
	app.use(express.json({ limit: "2mb" }))

	app.get("/healthz", (_req, res) => {
		res.json({ status: "ok" })
	})

	app.get("/api/state", (_req, res) => {
		res.json({ state: session.getClientState() })
	})

	app.post("/api/messages", async (req, res) => {
		try {
			const { text } = req.body as { text?: string }
			if (!text || typeof text !== "string") {
				res.status(400).json({ error: "Missing text" })
				return
			}
			await session.sendUserMessage(text)
			res.json({ ok: true })
		} catch (error) {
			logs.error("Failed to send message", "WebServer", { error })
			res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" })
		}
	})

	app.post("/api/mode", async (req, res) => {
		try {
			const { mode } = req.body as { mode?: string }
			if (!mode || typeof mode !== "string") {
				res.status(400).json({ error: "Mode is required" })
				return
			}
			await session.setMode(mode)
			res.json({ ok: true, state: session.getClientState() })
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error"
			const status = message.includes("not available") || message.includes("Mode is required") ? 400 : 500
			logs.error("Failed to set mode", "WebServer", { error })
			res.status(status).json({ error: message })
		}
	})

	app.post("/api/ask-response", async (req, res) => {
		try {
			const { response, text } = req.body as { response?: "yes" | "no"; text?: string }
			if (response !== "yes" && response !== "no") {
				res.status(400).json({ error: "Response must be 'yes' or 'no'" })
				return
			}
			await session.respondToTool(response, text)
			res.json({ ok: true })
		} catch (error) {
			logs.error("Failed to send ask response", "WebServer", { error })
			res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" })
		}
	})

	app.post("/api/cancel", async (_req, res) => {
		try {
			await session.cancelTask()
			res.json({ ok: true })
		} catch (error) {
			logs.error("Failed to cancel task", "WebServer", { error })
			res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" })
		}
	})

	if (staticDir) {
		app.use(express.static(staticDir))
		app.get("*", (_req, res, next) => {
			const indexFile = path.join(staticDir, "index.html")
			if (fs.existsSync(indexFile)) {
				res.sendFile(indexFile)
				return
			}
			next()
		})
	} else {
		logs.warn("Static web assets not found; API endpoints only", "WebServer")
	}

	const server = createServer(app)
	const clients = new Set<WebSocket>()
	const wss = new WebSocketServer({ server, path: "/ws" })

	const sendState = (socket: WebSocket) => {
		const payload: ServerMessage = {
			type: "state",
			state: session.getClientState(),
		}
		socket.send(JSON.stringify(payload))
	}

	const handleClientMessage = async (socket: WebSocket, raw: RawData) => {
		try {
			const parsed = JSON.parse(raw.toString()) as ClientMessage
			switch (parsed.type) {
				case "send_message":
					await session.sendUserMessage(parsed.text)
					break
				case "respond_to_tool":
					await session.respondToTool(parsed.response, parsed.text)
					break
				case "cancel_task":
					await session.cancelTask()
					break
				case "clear_task":
					await session.clearTask()
					break
				case "refresh_state":
					sendState(socket)
					break
				case "keepalive":
					break
			}
		} catch (error) {
			logs.error("Failed to handle client message", "WebServer", { error })
			const payload: ServerMessage = {
				type: "error",
				message: error instanceof Error ? error.message : "Invalid client message",
			}
			socket.send(JSON.stringify(payload))
		}
	}

	wss.on("connection", (socket) => {
		clients.add(socket)
		sendState(socket)
		socket.on("message", (data) => void handleClientMessage(socket, data))
		socket.on("close", () => {
			clients.delete(socket)
		})
	})

	session.on("state", () => {
		broadcast(clients, { type: "state", state: session.getClientState() })
	})

	session.on("message", (message) => {
		broadcast(clients, { type: "extension_message", message })
	})

	session.on("error", (error) => {
		broadcast(clients, { type: "error", message: error.message })
	})

	await new Promise<void>((resolve) => {
		server.listen(port, host, () => {
			logs.info(`Kilo Code web server listening on http://${host}:${port}`, "WebServer")
			resolve()
		})
	})

	return {
		close: async () => {
			wss.close()
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error)
						return
					}
					resolve()
				})
			})
			await session.dispose()
		},
		session,
	}
}
