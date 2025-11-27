import { EventEmitter } from "events"
import type { ExtensionMessage, ExtensionState, WebviewMessage, ModeConfig } from "../../types/messages.js"
import type { CLIConfig } from "../../config/types.js"
import { createExtensionService, ExtensionService } from "../../services/extension.js"
import type { ExtensionServiceOptions } from "../../services/extension.js"
import { loadConfig } from "../../config/persistence.js"
import { mapConfigToExtensionState } from "../../config/mapper.js"
import { loadCustomModes } from "../../config/customModes.js"
import { getTelemetryService, getIdentityManager } from "../../services/telemetry/index.js"
import { logs } from "../../services/logs.js"
import { getAllModes } from "../../constants/modes/defaults.js"

export interface WebSessionOptions {
	workspace: string
	mode?: string
}

export interface PendingAskInfo {
	message?: ExtensionMessage
}

type SessionEvents = {
	state: (state: ExtensionState | null) => void
	message: (message: ExtensionMessage) => void
	status: (info: string) => void
	error: (error: Error) => void
}

export declare interface WebChatSession {
	on<U extends keyof SessionEvents>(event: U, listener: SessionEvents[U]): this
	off<U extends keyof SessionEvents>(event: U, listener: SessionEvents[U]): this
}

export class WebChatSession extends EventEmitter {
	private options: WebSessionOptions
	private service: ExtensionService | null = null
	private config: CLIConfig | null = null
	private state: ExtensionState | null = null
	private customModes: ModeConfig[] = []
	private availableModes: ModeConfig[] = []
	private isStarted = false

	constructor(options: WebSessionOptions) {
		super()
		this.options = options
	}

	public async start(): Promise<void> {
		if (this.isStarted) {
			return
		}

		const workspace = this.options.workspace || process.cwd()
		this.customModes = await loadCustomModes(workspace)
		this.availableModes = getAllModes(this.customModes)

		const { config } = await loadConfig()
		this.config = config

		const telemetry = getTelemetryService()
		await telemetry.initialize(config, {
			workspace,
			mode: this.options.mode || config.mode || "code",
			ciMode: false,
		})

		const identityManager = getIdentityManager()
		const identity = identityManager.getIdentity()

		const serviceOptions: ExtensionServiceOptions = {
			workspace,
			mode: this.options.mode || config.mode || "code",
			customModes: this.customModes,
		}

		if (identity) {
			serviceOptions.identity = {
				machineId: identity.machineId,
				sessionId: identity.sessionId,
				cliUserId: identity.cliUserId,
			}
		}

		this.service = createExtensionService(serviceOptions)
		this.registerServiceEvents()

		await this.service.initialize()

		await new Promise<void>((resolve) => {
			if (!this.service) {
				resolve()
				return
			}

			if (this.service.isReady()) {
				resolve()
				return
			}

			this.service.once("ready", () => resolve())
		})

		await this.syncConfiguration()
		this.state = this.service.getState()
		this.emit("state", this.state)
		this.isStarted = true
		this.emit("status", "Web session initialized")
	}

	public getState(): ExtensionState | null {
		return this.state
	}

	public getClientState(): (ExtensionState & { availableModes: ModeConfig[] }) | null {
		if (!this.state) {
			return null
		}

		const serializedCustomModes = this.state.customModes?.length ? this.state.customModes : this.customModes
		return {
			...this.state,
			customModes: serializedCustomModes,
			availableModes: this.getAvailableModes(),
			// Expose auto-approval config to the web client so it can mirror CLI behaviour
			autoApproval: this.config?.autoApproval,
		}
	}

	public getWorkspace(): string {
		return this.options.workspace
	}

	private registerServiceEvents(): void {
		if (!this.service) {
			return
		}

		this.service.on("ready", (api) => {
			try {
				this.state = api.getState()
				this.emit("state", this.state)
			} catch (error) {
				logs.error("Failed to read initial state", "WebChatSession", { error })
			}
		})

		this.service.on("stateChange", (state) => {
			this.state = state
			this.emit("state", state)
		})

		this.service.on("message", (message) => {
			if (message.type === "state" && message.state) {
				this.state = message.state
				this.emit("state", this.state)
				return
			}
			this.emit("message", message)
		})

		this.service.on("warning", ({ context, error }) => {
			const warning = new Error(`Extension warning in ${context}: ${error.message}`)
			this.emit("error", warning)
		})

		this.service.on("error", (error) => {
			this.emit("error", error)
		})
	}

	private async syncConfiguration(): Promise<void> {
		if (!this.service || !this.config) {
			return
		}

		const extensionHost = this.service.getExtensionHost()
		const mappedState = mapConfigToExtensionState(this.config, this.state || undefined)
		await extensionHost.injectConfiguration(mappedState)
	}

	private ensureService(): ExtensionService {
		if (!this.service) {
			throw new Error("Web session not started")
		}
		return this.service
	}

	private getAvailableModes(): ModeConfig[] {
		if (!this.availableModes.length) {
			this.availableModes = getAllModes(this.customModes)
		}
		return this.availableModes
	}

	private hasActiveTask(): boolean {
		const messages = this.state?.chatMessages || []
		return messages.length > 0
	}

	public async sendUserMessage(text: string): Promise<void> {
		const trimmed = text.trim()
		if (!trimmed) {
			throw new Error("Message text cannot be empty")
		}

		const message: WebviewMessage = this.hasActiveTask()
			? {
					type: "askResponse",
					askResponse: "messageResponse",
					text: trimmed,
				}
			: {
					type: "newTask",
					text: trimmed,
				}

		await this.ensureService().sendWebviewMessage(message)
	}

	public async respondToTool(response: "yes" | "no", text?: string): Promise<void> {
		const message: WebviewMessage = {
			type: "askResponse",
			askResponse: response === "yes" ? "yesButtonClicked" : "noButtonClicked",
			...(text ? { text } : {}),
		}
		await this.ensureService().sendWebviewMessage(message)
	}

	public async cancelTask(): Promise<void> {
		await this.ensureService().sendWebviewMessage({ type: "cancelTask" })
	}

	public async clearTask(): Promise<void> {
		await this.ensureService().sendWebviewMessage({ type: "clearTask" })
	}

	public async setMode(mode: string): Promise<void> {
		const trimmedMode = mode.trim()
		if (!trimmedMode) {
			throw new Error("Mode is required")
		}

		const availableModes = this.getAvailableModes()
		const isValidMode = availableModes.some((availableMode) => availableMode.slug === trimmedMode)
		if (!isValidMode) {
			throw new Error(`Mode '${trimmedMode}' is not available`)
		}

		await this.ensureService().sendWebviewMessage({ type: "mode", text: trimmedMode })
		getTelemetryService().setMode(trimmedMode)

		if (this.state) {
			this.state = {
				...this.state,
				mode: trimmedMode,
			}
			this.emit("state", this.state)
		}
	}

	public async dispose(): Promise<void> {
		if (!this.service) {
			return
		}
		await this.service.dispose()
		this.service = null
		this.isStarted = false
	}
}
