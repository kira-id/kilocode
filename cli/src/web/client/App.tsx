import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { marked, Renderer } from "marked"
import type { AutoApprovalConfig } from "../../config/types.js"
import type { ExtensionChatMessage, ExtensionState, ModeConfig } from "./types"

const renderer = new Renderer()
renderer.heading = (text, level) => `<h${level}>${text}</h${level}>`
marked.setOptions({ gfm: true, breaks: true, renderer })

type ServerMessage =
	| { type: "state"; state: ExtensionState | null }
	| { type: "extension_message"; message: { type: string; [key: string]: unknown } }
	| { type: "error"; message: string }
	| { type: "status"; message: string }

type ConnectionState = "connecting" | "open" | "closed" | "error"

interface ToolPayload {
	tool?: string
	path?: string
	reason?: string
	content?: string
	diff?: string
	batchFiles?: { path: string }[]
	batchDiffs?: Array<{ path: string; diff?: string }>
	command?: string
	args?: string
	description?: string
	mode?: string
}

interface FollowupPayload {
	question?: string
	suggest?: Array<{ answer: string; mode?: string }>
}

interface CommandOutputPayload {
	executionId?: string
	command?: string
	output?: string
}

interface CheckpointRestorePayload {
	commitHash?: string
	checkpointTs?: number
	message?: string
}

interface McpPayload {
	type?: string
	serverName?: string
	toolName?: string
	arguments?: string
	uri?: string
}

interface ActionDetails {
	title: string
	description?: string
	highlights: Array<{ label: string; value: string }>
	blocks: Array<{ label: string; content: string; type?: "code" | "text" }>
	suggestions?: Array<{ answer: string; mode?: string }>
	raw?: unknown
	severity?: "info" | "warning" | "danger"
}

const STRUCTURED_SAY_TYPES = new Set([
	"mcp_server_request_started",
	"mcp_server_response",
	"command_output",
	"codebase_search_result",
])
const TEXT_RESPONSE_ASKS = new Set(["followup"])

const ASK_COPY: Record<string, { title: string; description: string }> = {
	tool: { title: "Tool Request", description: "Allow Kilo Code to run a tool (edit files, create diffs, etc.)." },
	command: { title: "Command Approval", description: "Approve or deny the proposed terminal command." },
	command_output: { title: "Command Output", description: "Allow Kilo Code to stream the running command output." },
	followup: { title: "Follow-up Question", description: "Provide more context so the task can continue." },
	completion_result: {
		title: "Review Completion",
		description: "Confirm whether the task is finished or needs more work.",
	},
	checkpoint_restore: {
		title: "Restore Checkpoint",
		description: "Confirm before reverting the workspace to an earlier checkpoint.",
	},
	payment_required_prompt: { title: "Payment Required", description: "Add credits or switch providers to continue." },
	resume_task: { title: "Resume Task", description: "Resume the paused task with the current context." },
	resume_completed_task: {
		title: "Resume Completed Task",
		description: "Re-open the task even though it was marked done.",
	},
	browser_action_launch: { title: "Browser Action", description: "Allow Kilo Code to open a browser window." },
	use_mcp_server: { title: "MCP Request", description: "Allow access to the requested MCP server resource." },
	auto_approval_max_req_reached: {
		title: "Auto-Approval Limit Reached",
		description: "Manual approval is required before continuing.",
	},
	mistake_limit_reached: {
		title: "Mistake Limit Reached",
		description: "Decide how to proceed after repeated errors.",
	},
	condense: { title: "Condense Context", description: "Permit context condensation to keep the session responsive." },
	invalid_model: { title: "Invalid Model", description: "Switch providers or fix the configuration to continue." },
	report_bug: { title: "Report a Bug", description: "Share details about the issue you encountered." },
}

const ACTION_BUTTON_COPY: Record<string, { approve: string; reject: string }> = {
	tool: { approve: "Allow Tool", reject: "Deny" },
	command: { approve: "Run Command", reject: "Cancel" },
	command_output: { approve: "Allow Output", reject: "Stop" },
	completion_result: { approve: "Mark Complete", reject: "Needs Work" },
	checkpoint_restore: { approve: "Restore", reject: "Keep Current" },
	resume_task: { approve: "Resume", reject: "Pause" },
	resume_completed_task: { approve: "Resume", reject: "Keep Finished" },
	browser_action_launch: { approve: "Open Browser", reject: "Block" },
	use_mcp_server: { approve: "Allow", reject: "Deny" },
	default: { approve: "Approve", reject: "Reject" },
}

const FALLBACK_MODES: ModeConfig[] = [
	{ slug: "architect", name: "Architect", description: "Plan & design before coding" },
	{ slug: "code", name: "Code", description: "Write, edit, and refactor" },
	{ slug: "debug", name: "Debug", description: "Diagnose and fix issues" },
	{ slug: "ask", name: "Ask", description: "Explain and research" },
	{ slug: "orchestrator", name: "Orchestrator", description: "Break down & delegate" },
]

function getWsUrl(): string {
	const { protocol, host } = window.location
	const wsProtocol = protocol === "https:" ? "wss" : "ws"
	return `${wsProtocol}://${host}/ws`
}

function formatTimestamp(ts?: number): string {
	if (!ts) return ""
	try {
		return new Date(ts).toLocaleTimeString()
	} catch {
		return ""
	}
}

function formatRelativeTime(ts?: number): string {
	if (!ts) return "just now"
	const diff = Date.now() - ts
	const minutes = Math.round(diff / 60000)
	if (minutes < 1) {
		const seconds = Math.max(1, Math.round(diff / 1000))
		return `${seconds}s ago`
	}
	if (minutes < 60) {
		return `${minutes}m ago`
	}
	const hours = Math.round(minutes / 60)
	if (hours < 24) {
		return `${hours}h ago`
	}
	const days = Math.round(hours / 24)
	return `${days}d ago`
}

function formatLabel(value: string): string {
	return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function safeJsonParse<T>(value?: string | null): T | null {
	if (!value) return null
	const trimmed = value.trim()
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		return null
	}
	try {
		return JSON.parse(trimmed) as T
	} catch {
		return null
	}
}

function mergeModes(...lists: Array<ModeConfig[] | undefined>): ModeConfig[] {
	const map = new Map<string, ModeConfig>()
	for (const list of lists) {
		if (!list) continue
		for (const mode of list) {
			map.set(mode.slug, mode)
		}
	}
	const merged = Array.from(map.values())
	return merged.length ? merged : [...FALLBACK_MODES]
}

type AutoApprovalDecision = { action: "auto-approve" | "auto-reject" | "manual"; delay?: number; message?: string }

function matchesCommandPattern(command: string, patterns: string[]): boolean {
	if (!patterns.length) return false
	const normalizedCommand = command.trim()
	return patterns.some((pattern) => {
		const normalizedPattern = pattern.trim()
		if (normalizedPattern === "*") return true
		if (normalizedPattern === normalizedCommand) return true
		if (normalizedCommand.startsWith(normalizedPattern)) {
			const nextChar = normalizedCommand[normalizedPattern.length]
			return nextChar === undefined || nextChar === " " || nextChar === "\t"
		}
		return false
	})
}

function getToolDecision(message: ExtensionChatMessage, config: AutoApprovalConfig): AutoApprovalDecision {
	const data = safeJsonParse<Record<string, unknown>>(message.text) || {}
	const tool = data.tool as string | undefined

	if (
		tool === "readFile" ||
		tool === "listFiles" ||
		tool === "listFilesTopLevel" ||
		tool === "listFilesRecursive" ||
		tool === "searchFiles" ||
		tool === "codebaseSearch" ||
		tool === "listCodeDefinitionNames"
	) {
		const isOutside = data.isOutsideWorkspace === true
		const allow = isOutside ? config.read?.outside : config.read?.enabled
		return allow ? { action: "auto-approve" } : { action: "manual" }
	}

	if (
		tool === "editedExistingFile" ||
		tool === "appliedDiff" ||
		tool === "newFileCreated" ||
		tool === "insertContent" ||
		tool === "searchAndReplace"
	) {
		const isOutside = data.isOutsideWorkspace === true
		const isProtected = data.isProtected === true

		const allow = isProtected
			? config.write?.protected
			: isOutside
				? config.write?.outside
				: config.write?.enabled

		return allow ? { action: "auto-approve" } : { action: "manual" }
	}

	if (tool === "browser_action") {
		return config.browser?.enabled ? { action: "auto-approve" } : { action: "manual" }
	}

	if (tool === "use_mcp_tool" || tool === "use_mcp_server" || tool === "access_mcp_resource") {
		return config.mcp?.enabled ? { action: "auto-approve" } : { action: "manual" }
	}

	if (tool === "switchMode") {
		return config.mode?.enabled ? { action: "auto-approve" } : { action: "manual" }
	}

	if (tool === "newTask") {
		return config.subtasks?.enabled ? { action: "auto-approve" } : { action: "manual" }
	}

	if (tool === "updateTodoList") {
		return config.todo?.enabled ? { action: "auto-approve" } : { action: "manual" }
	}

	return { action: "manual" }
}

function getCommandDecision(message: ExtensionChatMessage, config: AutoApprovalConfig): AutoApprovalDecision {
	if (!config.execute?.enabled) return { action: "manual" }

	let command = ""
	const parsed = safeJsonParse<{ command?: string }>(message.text)
	if (parsed?.command) {
		command = parsed.command
	} else if (typeof message.text === "string") {
		command = message.text
	}

	const denied = config.execute?.denied ?? []
	if (matchesCommandPattern(command, denied)) {
		return { action: "manual" }
	}

	const allowed = config.execute?.allowed ?? []
	if (allowed.length === 0) return { action: "manual" }

	return matchesCommandPattern(command, allowed) ? { action: "auto-approve" } : { action: "manual" }
}

function getRetryDecision(config: AutoApprovalConfig): AutoApprovalDecision {
	if (!config.retry?.enabled) return { action: "manual" }
	const delayMs = Math.max(0, (config.retry.delay ?? 0) * 1000)
	return { action: "auto-approve", ...(delayMs ? { delay: delayMs } : {}) }
}

function getFollowupDecision(config: AutoApprovalConfig): AutoApprovalDecision {
	return config.question?.enabled ? { action: "auto-approve" } : { action: "manual" }
}

function getAutoApprovalDecision(
	message: ExtensionChatMessage,
	config?: AutoApprovalConfig | null,
): AutoApprovalDecision {
	if (!config?.enabled) return { action: "manual" }
	if (message.type !== "ask" || message.partial || message.isAnswered) return { action: "manual" }

	switch (message.ask) {
		case "tool":
			return getToolDecision(message, config)
		case "command":
			return getCommandDecision(message, config)
		case "api_req_failed":
			return getRetryDecision(config)
		case "followup":
			return getFollowupDecision(config)
		case "use_mcp_server":
			return config.mcp?.enabled ? { action: "auto-approve" } : { action: "manual" }
		default:
			return { action: "manual" }
	}
}

function buildActionDetails(message: ExtensionChatMessage): ActionDetails {
	const askType = message.ask || "action"
	const copy = ASK_COPY[askType] || {
		title: formatLabel(askType),
		description: "Review the details below and respond to continue.",
	}

	const details: ActionDetails = {
		title: copy.title,
		description: copy.description,
		highlights: [],
		blocks: [],
	}

	switch (askType) {
		case "tool": {
			const data = safeJsonParse<ToolPayload>(message.text)
			if (data) {
				details.highlights.push({ label: "Tool", value: formatLabel(data.tool || "unknown") })
				if (data.path) {
					details.highlights.push({ label: "Path", value: data.path })
				}
				if (data.mode) {
					details.highlights.push({ label: "Mode", value: formatLabel(data.mode) })
				}
				if (data.reason) {
					details.blocks.push({ label: "Reason", content: data.reason })
				}
				if (data.command) {
					details.blocks.push({ label: "Command", content: data.command, type: "code" })
				}
				if (data.content) {
					details.blocks.push({ label: "Content", content: data.content, type: "code" })
				}
				if (data.diff) {
					details.blocks.push({ label: "Diff", content: data.diff, type: "code" })
				}
				if (data.batchFiles?.length) {
					details.blocks.push({
						label: "Files",
						content: data.batchFiles.map((file) => `• ${file.path}`).join("\n"),
					})
				}
				details.raw = data
			} else if (message.text) {
				details.blocks.push({ label: "Details", content: message.text })
			}
			break
		}
		case "command": {
			const content = message.text || "Command requires approval."
			details.blocks.push({ label: "Command", content, type: "code" })
			break
		}
		case "command_output": {
			const data = safeJsonParse<CommandOutputPayload>(message.text)
			if (data?.command) {
				details.blocks.push({ label: "Command", content: data.command, type: "code" })
			}
			if (data?.output) {
				details.blocks.push({ label: "Latest Output", content: data.output, type: "code" })
			}
			details.raw = data
			break
		}
		case "followup": {
			const followup = safeJsonParse<FollowupPayload>(message.text)
			const question = followup?.question || message.text || "Provide additional details."
			details.blocks.push({ label: "Question", content: question })
			if (followup?.suggest?.length) {
				details.suggestions = followup.suggest
			}
			details.raw = followup
			break
		}
		case "completion_result": {
			if (message.text) {
				details.blocks.push({ label: "Summary", content: message.text })
			}
			break
		}
		case "checkpoint_restore": {
			const data = safeJsonParse<CheckpointRestorePayload>(message.text)
			if (data?.commitHash) {
				details.highlights.push({ label: "Checkpoint", value: data.commitHash.slice(0, 12) })
			}
			if (data?.checkpointTs) {
				details.highlights.push({ label: "Created", value: new Date(data.checkpointTs).toLocaleString() })
			}
			if (data?.message) {
				details.blocks.push({ label: "Notes", content: data.message })
			}
			details.raw = data
			details.severity = "danger"
			break
		}
		case "resume_task":
		case "resume_completed_task":
		case "auto_approval_max_req_reached":
		case "mistake_limit_reached":
		case "payment_required_prompt":
		case "browser_action_launch":
		case "condense":
		case "invalid_model":
		case "report_bug": {
			if (message.text) {
				details.blocks.push({ label: "Details", content: message.text })
			}
			break
		}
		case "use_mcp_server": {
			const data = safeJsonParse<McpPayload>(message.text)
			if (data?.serverName) {
				details.highlights.push({ label: "Server", value: data.serverName })
			}
			if (data?.toolName) {
				details.highlights.push({ label: "Tool", value: data.toolName })
			}
			if (data?.arguments) {
				details.blocks.push({ label: "Arguments", content: data.arguments, type: "code" })
			}
			if (data?.uri) {
				details.blocks.push({ label: "URI", content: data.uri })
			}
			details.raw = data
			break
		}
		default: {
			if (message.text) {
				details.blocks.push({ label: "Details", content: message.text })
			}
			break
		}
	}

	return details
}

function getAskLabels(message: ExtensionChatMessage): string[] {
	const labels: string[] = []
	if (message.ask) {
		labels.push(formatLabel(message.ask))
	}
	if (message.say) {
		labels.push(formatLabel(message.say))
	}
	if (message.partial) {
		labels.push("Streaming")
	}
	if (message.isAnswered) {
		labels.push("Resolved")
	}
	return labels
}

const MarkdownBlock = ({ text }: { text: string }) => {
	const html = useMemo(() => (text ? (marked.parse(text, { async: false }) as string) : ""), [text])
	return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

const MessageCard = ({ message }: { message: ExtensionChatMessage }) => {
	const role = message.role === "user" ? "user" : message.type === "ask" ? "action" : "assistant"
	const labels = getAskLabels(message)
	const askDetails = message.type === "ask" ? buildActionDetails(message) : null
	const isReasoning = message.say === "reasoning"

	const textBlocks: string[] = []
	if (!isReasoning && message.content?.length) {
		for (const block of message.content) {
			if (block?.text) {
				textBlocks.push(block.text)
			}
		}
	}
	if (!isReasoning && message.text && message.type !== "ask") {
		if (!STRUCTURED_SAY_TYPES.has(message.say || "")) {
			textBlocks.push(message.text)
		}
	}

	const reasoning = message.reasoning || (isReasoning ? message.text : undefined)
	const structuredData =
		message.type !== "ask" && STRUCTURED_SAY_TYPES.has(message.say || "")
			? safeJsonParse<Record<string, unknown>>(message.text)
			: null

	return (
		<div className={`message-card ${role}`}>
			<div className="message-header">
				<div>
					<strong>{role === "user" ? "You" : role === "action" ? "Action" : "Kilo Code"}</strong>
					{message.ts && <span className="message-time">{formatTimestamp(message.ts)}</span>}
				</div>
				{labels.length > 0 && (
					<div className="message-badges">
						{labels.map((label) => (
							<span key={label}>{label}</span>
						))}
					</div>
				)}
			</div>

			{askDetails ? (
				<div className="message-body">
					{askDetails.highlights.length > 0 && (
						<div className="action-highlights">
							{askDetails.highlights.map((item) => (
								<div key={`${item.label}-${item.value}`}>
									<span>{item.label}</span>
									<strong>{item.value}</strong>
								</div>
							))}
						</div>
					)}
					{askDetails.blocks.map((block) => (
						<div key={`${block.label}-${block.content.slice(0, 24)}`} className="action-block">
							<span>{block.label}</span>
							{block.type === "code" ? (
								<pre className="code-block">
									<code>{block.content}</code>
								</pre>
							) : (
								<MarkdownBlock text={block.content} />
							)}
						</div>
					))}
				</div>
			) : (
				<div className="message-body">
					{textBlocks.map((block, index) => (
						<div key={index} className="message-block">
							<MarkdownBlock text={block} />
						</div>
					))}
					{structuredData && (
						<details className="structured-block">
							<summary>Inspect structured data</summary>
							<pre>{JSON.stringify(structuredData, null, 2)}</pre>
						</details>
					)}
				</div>
			)}

			{reasoning && (
				<details className="reasoning-block">
					<summary>Reasoning</summary>
					<MarkdownBlock text={reasoning} />
				</details>
			)}

			{message.say === "checkpoint_saved" && message.text && (
				<div className="checkpoint-chip">Checkpoint saved • {message.text}</div>
			)}
			{message.progressStatus?.text && <div className="progress-line">{message.progressStatus.text}</div>}
		</div>
	)
}

const MessageList = ({ messages }: { messages: ExtensionChatMessage[] }) => {
	const endRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		endRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [messages.length])

	if (messages.length === 0) {
		return <p className="empty-state">No messages yet. Start by sending a prompt.</p>
	}

	return (
		<div className="message-feed">
			{messages.map((message) => (
				<MessageCard
					key={`${message.ts}-${message.type}-${message.ask ?? message.say ?? ""}`}
					message={message}
				/>
			))}
			<div ref={endRef} />
		</div>
	)
}

const ModeSelector = ({
	modes,
	selected,
	onSelect,
	disabled,
}: {
	modes: ModeConfig[]
	selected?: string | undefined
	onSelect: (slug: string) => void | Promise<void>
	disabled?: boolean
}) => {
	const current = modes.find((mode) => mode.slug === selected) || modes[0]
	return (
		<div className="mode-selector">
			<div className="mode-selector-head">
				<div>
					<span>Mode</span>
					<p>{current?.description || "Choose how Kilo Code should operate."}</p>
				</div>
			</div>
			<div className="mode-buttons">
				{modes.map((mode) => (
					<button
						key={mode.slug}
						className={`mode-button ${mode.slug === selected ? "active" : ""}`}
						onClick={() => onSelect(mode.slug)}
						disabled={disabled}>
						{mode.name}
					</button>
				))}
			</div>
			{current?.whenToUse && <p className="mode-footnote">{current.whenToUse}</p>}
		</div>
	)
}

const CheckpointPanel = ({ checkpoints }: { checkpoints: ExtensionChatMessage[] }) => {
	const unique = useMemo(() => {
		const seen = new Set<string>()
		const deduped: ExtensionChatMessage[] = []
		for (let i = checkpoints.length - 1; i >= 0; i -= 1) {
			const cp = checkpoints[i]
			if (!cp) continue
			const hash = cp.text || `cp-${cp.ts}`
			if (!hash || seen.has(hash)) continue
			seen.add(hash)
			deduped.push(cp)
		}
		return deduped.slice(0, 5)
	}, [checkpoints])

	const copyHash = useCallback((hash: string) => {
		if (!hash) return
		if (navigator?.clipboard?.writeText) {
			navigator.clipboard.writeText(hash).catch(() => {
				// Ignore clipboard errors
			})
		}
	}, [])

	if (unique.length === 0) {
		return null
	}

	return (
		<div className="card side-card checkpoint-card">
			<div className="card-title">Recent checkpoints</div>
			<ul className="checkpoint-list">
				{unique.map((cp) => (
					<li key={cp.text || cp.ts}>
						<div>
							<strong>{cp.text?.slice(0, 12) || "(unknown)"}</strong>
							<span>{formatRelativeTime(cp.ts)}</span>
						</div>
						<button onClick={() => copyHash(cp.text || "")}>Copy</button>
					</li>
				))}
			</ul>
			<p className="card-hint">Use `/checkpoint list` or `/checkpoint restore &lt;hash&gt;` in chat.</p>
		</div>
	)
}

const ActionRequestCard = ({
	message,
	onRespond,
	onPrefill,
	focusInput,
}: {
	message: ExtensionChatMessage
	onRespond: (response: "yes" | "no", note?: string) => Promise<void>
	onPrefill: (text: string) => void
	focusInput: () => void
}) => {
	const details = useMemo(() => buildActionDetails(message), [message])
	const requiresTextResponse = TEXT_RESPONSE_ASKS.has(message.ask || "")
	const [note, setNote] = useState("")
	const [submitting, setSubmitting] = useState<"yes" | "no" | null>(null)

	useEffect(() => {
		setNote("")
		setSubmitting(null)
	}, [message.ts, message.ask])

	const buttonCopy: { approve: string; reject: string } =
		(ACTION_BUTTON_COPY[message.ask || ""] ?? ACTION_BUTTON_COPY.default)!

	const handleRespond = async (response: "yes" | "no") => {
		setSubmitting(response)
		try {
			await onRespond(response, note.trim() ? note.trim() : undefined)
			setNote("")
		} finally {
			setSubmitting(null)
		}
	}

	return (
		<div className={`card action-card ${details.severity || "info"}`}>
			<div className="action-header">
				<div>
					<p>Action required</p>
					<h3>{details.title}</h3>
					{details.description && <span>{details.description}</span>}
				</div>
				<div className="action-meta">
					{message.ts && <span>{formatTimestamp(message.ts)}</span>}
					{message.ask && <span className="action-chip">{formatLabel(message.ask)}</span>}
				</div>
			</div>

			{details.highlights.length > 0 && (
				<div className="action-highlights">
					{details.highlights.map((item) => (
						<div key={`${item.label}-${item.value}`}>
							<span>{item.label}</span>
							<strong>{item.value}</strong>
						</div>
					))}
				</div>
			)}

			{details.blocks.map((block) => (
				<div key={`${block.label}-${block.content.slice(0, 24)}`} className="action-block">
					<span>{block.label}</span>
					{block.type === "code" ? (
						<pre className="code-block">
							<code>{block.content}</code>
						</pre>
					) : (
						<MarkdownBlock text={block.content} />
					)}
				</div>
			))}

			{details.suggestions && details.suggestions.length > 0 && (
				<div className="suggestion-pills">
					{details.suggestions.map((suggestion, idx) => (
						<button
							key={`${suggestion.answer}-${idx}`}
							onClick={() => {
								onPrefill(suggestion.answer)
								focusInput()
							}}>
							{suggestion.answer}
							{suggestion.mode && <span>• {formatLabel(suggestion.mode)}</span>}
						</button>
					))}
				</div>
			)}

			{details.raw !== undefined && details.raw !== null && (
				<details className="structured-block">
					<summary>Raw payload</summary>
					<pre>{JSON.stringify(details.raw, null, 2)}</pre>
				</details>
			)}

			{requiresTextResponse ? (
				<div className="action-hint">
					<p>Use the chat box to answer this question.</p>
					<button onClick={focusInput}>Focus reply area</button>
				</div>
			) : (
				<>
					<textarea
						className="note-input"
						placeholder="Optional note (shared with your decision)"
						value={note}
						onChange={(event) => setNote(event.target.value)}
					/>
					<div className="action-buttons">
						<button className="approve" disabled={!!submitting} onClick={() => void handleRespond("yes")}>
							{submitting === "yes" ? "Sending…" : buttonCopy.approve}
						</button>
						<button className="reject" disabled={!!submitting} onClick={() => void handleRespond("no")}>
							{submitting === "no" ? "Sending…" : buttonCopy.reject}
						</button>
					</div>
				</>
			)}
		</div>
	)
}

export default function App() {
	const [state, setState] = useState<ExtensionState | null>(null)
	const [connectionState, setConnectionState] = useState<ConnectionState>("connecting")
	const [lastStatus, setLastStatus] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [input, setInput] = useState("")
	const [pending, setPending] = useState(false)
	const [modePending, setModePending] = useState(false)
	const [autoApprovalStatus, setAutoApprovalStatus] = useState<{
		ts: number
		action: "approve" | "reject"
		status: "pending" | "sent" | "error"
		message?: string
	} | null>(null)
	const reconnectTimer = useRef<number | null>(null)
	const inputRef = useRef<HTMLTextAreaElement | null>(null)
	const autoHandledRef = useRef<Set<number>>(new Set())

	const fetchInitialState = useCallback(async () => {
		try {
			const response = await fetch("/api/state")
			const data = (await response.json()) as { state?: ExtensionState | null }
			setState(data.state ?? null)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load state")
		}
	}, [])

	useEffect(() => {
		void fetchInitialState()
	}, [fetchInitialState])

	useEffect(() => {
		let socket: WebSocket | null = null
		let isMounted = true

		const connect = () => {
			setConnectionState("connecting")
			const url = getWsUrl()
			socket = new WebSocket(url)

			socket.onopen = () => {
				if (!isMounted) return
				setConnectionState("open")
			}

			socket.onclose = () => {
				if (!isMounted) return
				setConnectionState("closed")
				if (reconnectTimer.current) {
					window.clearTimeout(reconnectTimer.current)
				}
				reconnectTimer.current = window.setTimeout(connect, 2000)
			}

			socket.onerror = () => {
				if (!isMounted) return
				setConnectionState("error")
			}

			socket.onmessage = (event) => {
				if (!isMounted) return
				try {
					const payload = JSON.parse(event.data) as ServerMessage
					switch (payload.type) {
						case "state":
							setState(payload.state ?? null)
							break
						case "error":
							setError(payload.message)
							break
						case "status":
							setLastStatus(payload.message)
							break
						case "extension_message":
							setLastStatus(`Extension: ${payload.message.type}`)
							break
						default:
							break
					}
				} catch (err) {
					setError(err instanceof Error ? err.message : "Failed to parse server event")
				}
			}
		}

		connect()

		return () => {
			isMounted = false
			if (reconnectTimer.current) {
				window.clearTimeout(reconnectTimer.current)
			}
			socket?.close()
		}
	}, [])

	const chatMessages = state?.chatMessages ?? []
	const autoApprovalConfig = state?.autoApproval ?? null
	const pendingAsk = useMemo(() => {
		for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
			const msg = chatMessages[i]
			if (msg?.type === "ask" && msg.isAnswered !== true) {
				return msg
			}
		}
		return null
	}, [chatMessages])

	const pendingAskTs = pendingAsk?.ts ?? -1
	const autoStatusForPending =
		autoApprovalStatus && pendingAskTs !== -1 && autoApprovalStatus.ts === pendingAskTs
	const hideActionCard = autoStatusForPending && autoApprovalStatus.status !== "error"

	const checkpoints = useMemo(
		() => chatMessages.filter((msg) => msg.say === "checkpoint_saved" && msg.text),
		[chatMessages],
	)

	const availableModes = useMemo(
		() => mergeModes(FALLBACK_MODES, state?.availableModes, state?.customModes),
		[state?.availableModes, state?.customModes],
	)

	const handleModeChange = useCallback(
		async (mode: string) => {
			if (!mode || mode === state?.mode || modePending) {
				return
			}
			setModePending(true)
			setError(null)
			try {
				const response = await fetch("/api/mode", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ mode }),
				})
				if (!response.ok) {
					const data = (await response.json()) as { error?: string }
					throw new Error(data.error || "Failed to set mode")
				}
				const data = (await response.json()) as { state?: ExtensionState | null }
				setState(data.state ?? null)
				setLastStatus(`Mode switched to ${formatLabel(mode)}`)
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to change mode")
			} finally {
				setModePending(false)
			}
		},
		[state?.mode, modePending],
	)

	const sendPrompt = useCallback(async () => {
		const trimmed = input.trim()
		if (!trimmed || pending) return
		setPending(true)
		setError(null)
		try {
			const response = await fetch("/api/messages", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: trimmed }),
			})
			if (!response.ok) {
				const data = (await response.json()) as { error?: string }
				throw new Error(data.error || "Failed to send message")
			}
			setInput("")
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to send message")
		} finally {
			setPending(false)
		}
	}, [input, pending])

	const respondToAsk = useCallback(async (response: "yes" | "no", note?: string) => {
		setError(null)
		try {
			const res = await fetch("/api/ask-response", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ response, text: note }),
			})
			if (!res.ok) {
				const data = (await res.json()) as { error?: string }
				throw new Error(data.error || "Failed to respond")
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to respond to tool")
		}
	}, [])

	useEffect(() => {
		if (!pendingAsk || pendingAsk.partial) {
			setAutoApprovalStatus(null)
			return
		}

		const ts = pendingAsk.ts ?? -1
		if (!autoApprovalConfig?.enabled || ts === -1) {
			setAutoApprovalStatus(null)
			return
		}

		// Avoid re-processing the same message
		if (autoHandledRef.current.has(ts)) {
			return
		}

		const decision = getAutoApprovalDecision(pendingAsk, autoApprovalConfig)
		if (decision.action === "manual") {
			setAutoApprovalStatus(null)
			return
		}

		autoHandledRef.current.add(ts)
		const action = decision.action === "auto-approve" ? "approve" : "reject"
		setAutoApprovalStatus({
			ts,
			action,
			status: "pending",
			...(decision.message ? { message: decision.message } : {}),
		})

		const respond = async () => {
			try {
				await respondToAsk(action === "approve" ? "yes" : "no", decision.message)
				setAutoApprovalStatus((prev) => (prev && prev.ts === ts ? { ...prev, status: "sent" } : prev))
			} catch (err) {
				autoHandledRef.current.delete(ts)
				const message = err instanceof Error ? err.message : "Failed to auto-respond"
				setError(message)
				setAutoApprovalStatus({
					ts,
					action,
					status: "error",
					message,
				})
			}
		}

		let timer: number | null = null
		if (decision.delay && decision.delay > 0) {
			timer = window.setTimeout(() => {
				void respond()
			}, decision.delay)
		} else {
			void respond()
		}

		return () => {
			if (timer) {
				window.clearTimeout(timer)
			}
		}
	}, [pendingAsk, autoApprovalConfig, respondToAsk, setError])

	const cancelTask = useCallback(async () => {
		try {
			await fetch("/api/cancel", { method: "POST" })
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to cancel task")
		}
	}, [])

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault()
			void sendPrompt()
		}
	}

	const appendToInput = useCallback((text: string) => {
		setInput((current) => (current ? `${current}\n${text}` : text))
	}, [])

	return (
		<div className="app-shell">
			<div className="card header-card">
				<div className="header-row">
					<div>
						<h2>Kilo Code Web Chat</h2>
						<p>
							Workspace: {state?.cwd || "(not set)"}
							{state?.currentApiConfigName && <span> • Provider: {state.currentApiConfigName}</span>}
						</p>
					</div>
					<div className="status-pill">
						<span
							style={{
								display: "inline-block",
								width: 8,
								height: 8,
								borderRadius: "50%",
								backgroundColor:
									connectionState === "open"
										? "#4ade80"
										: connectionState === "connecting"
											? "#facc15"
											: "#f87171",
							}}
						/>
						<span style={{ textTransform: "capitalize" }}>{connectionState}</span>
					</div>
				</div>
				<ModeSelector
					modes={availableModes}
					selected={state?.mode}
					onSelect={handleModeChange}
					disabled={modePending}
				/>
			</div>

			{error && <div className="error-banner">{error}</div>}
			{lastStatus && !error && <div className="status-pill secondary">{lastStatus}</div>}
			{autoStatusForPending && autoApprovalStatus.status === "pending" && (
				<div className="status-pill secondary">
					{autoApprovalStatus.action === "approve" ? "Auto-approving" : "Auto-rejecting"}{" "}
					{pendingAsk?.ask ? formatLabel(pendingAsk.ask) : "request"} based on your settings…
				</div>
			)}
			{autoStatusForPending && autoApprovalStatus.status === "sent" && (
				<div className="status-pill secondary">
					{pendingAsk?.ask ? formatLabel(pendingAsk.ask) : "Request"} automatically{" "}
					{autoApprovalStatus.action === "approve" ? "approved" : "rejected"}
				</div>
			)}

			<div className="layout-grid">
				<div className="primary-column">
					<div className="card messages-card">
						<MessageList messages={chatMessages} />
					</div>
					<div className="card input-card">
						<div className="chat-input">
							<textarea
								ref={inputRef}
								placeholder="Describe the change you need..."
								value={input}
								onChange={(event) => setInput(event.target.value)}
								onKeyDown={handleKeyDown}
							/>
							<button disabled={!input.trim() || pending} onClick={() => void sendPrompt()}>
								{pending ? "Sending…" : "Send"}
							</button>
						</div>
						<div className="input-actions">
							<button onClick={() => void fetchInitialState()}>Refresh state</button>
							<button onClick={() => void cancelTask()}>Cancel task</button>
						</div>
					</div>
				</div>

				<div className="secondary-column">
					{pendingAsk && !hideActionCard && (
						<ActionRequestCard
							message={pendingAsk}
							onRespond={respondToAsk}
							onPrefill={appendToInput}
							focusInput={() => inputRef.current?.focus()}
						/>
					)}
					<CheckpointPanel checkpoints={checkpoints} />
				</div>
			</div>
		</div>
	)
}
