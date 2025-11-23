import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import next from "next"
import { Server as SocketServer } from "socket.io"
import { logs } from "../../services/logs.js"
import type { ExtensionService } from "../../services/extension.js"
import type { CLIOptions } from "../../types/cli.js"
import type { WebviewMessage } from "../../types/messages.js"

interface WebUIServerOptions {
	service: ExtensionService
	port?: number
	options: CLIOptions
	onExit: () => void
}

export class WebUIServer {
	private service: ExtensionService
	private options: CLIOptions
	private port: number
	private onExit: () => void
	private server: http.Server | null = null
	private io: SocketServer | null = null

	constructor({ service, port = 4000, options, onExit }: WebUIServerOptions) {
		this.service = service
		this.port = port
		this.options = options
		this.onExit = onExit
	}

	async start(): Promise<void> {
		const dev = process.env.NODE_ENV !== "production"
		const nextApp = next({
			dev,
			dir: path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../web-ui"),
		})

		await nextApp.prepare()

		const app = express()
		const handle = nextApp.getRequestHandler()

		app.use(express.json())

		app.get("/api/status", (_req, res) => {
			res.json({
				ready: this.service.isReady(),
				workspace: this.options.workspace || process.cwd(),
				mode: this.options.mode || "code",
			})
		})

		app.post("/api/exit", (_req, res) => {
			res.json({ ok: true })
			this.onExit()
		})

		app.all("*", (req, res) => {
			void handle(req, res)
		})

		this.server = http.createServer(app)
		this.io = new SocketServer(this.server, {
			cors: {
				origin: true,
			},
		})

		this.io.on("connection", (socket) => {
			logs.info("Web UI connected", "WebUIServer")
			socket.emit("status", {
				ready: this.service.isReady(),
				workspace: this.options.workspace || process.cwd(),
				mode: this.options.mode || "code",
			})

			const forwardMessage = (message: unknown) => {
				socket.emit("extension-message", message)
			}

			this.service.on("message", forwardMessage)

			socket.on("send-prompt", async (text: string) => {
				const payload: WebviewMessage = {
					type: "askResponse",
					text,
					askResponse: "messageResponse",
				}

				await this.service.sendWebviewMessage(payload)
			})

			socket.on("disconnect", () => {
				this.service.off("message", forwardMessage)
			})
		})

		await new Promise<void>((resolve) => {
			if (!this.server) {
				resolve()
				return
			}
			this.server.listen(this.port, () => {
				logs.info(`Web UI available at http://localhost:${this.port}`, "WebUIServer")
				process.env.NEXT_PUBLIC_WEB_UI_PORT = this.port.toString()
				resolve()
			})
		})
	}

	async stop(): Promise<void> {
		await new Promise<void>((resolve) => {
			if (this.io) {
				this.io.removeAllListeners()
				this.io.close()
				this.io = null
			}

			if (this.server) {
				this.server.close(() => resolve())
				this.server = null
			} else {
				resolve()
			}
		})
	}
}
