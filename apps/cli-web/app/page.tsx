"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { DEFAULT_MODE, MODE_OPTIONS } from "@/lib/modes"

interface RunPayload {
	prompt: string
	workspace?: string
	mode?: string
}

type RunStatus = "idle" | "running" | "error" | "complete"

const statusLabel: Record<RunStatus, string> = {
	idle: "Ready to run",
	running: "Streaming from CLI",
	complete: "Run finished",
	error: "Something went wrong",
}

export default function HomePage() {
	const [prompt, setPrompt] = useState("")
	const [workspace, setWorkspace] = useState("")
	const [mode, setMode] = useState<string>(DEFAULT_MODE)
	const [status, setStatus] = useState<RunStatus>("idle")
	const [output, setOutput] = useState("")
	const [error, setError] = useState<string | null>(null)
	const controllerRef = useRef<AbortController | null>(null)
	const logRef = useRef<HTMLDivElement | null>(null)

	const isRunning = status === "running"
	const isDisabled = useMemo(() => isRunning || prompt.trim().length === 0, [prompt, isRunning])
	const currentMode = useMemo(() => MODE_OPTIONS.find((entry) => entry.slug === mode), [mode])

	useEffect(() => {
		if (logRef.current) {
			logRef.current.scrollTop = logRef.current.scrollHeight
		}
	}, [output])

	const reset = useCallback(() => {
		setStatus("idle")
		setOutput("")
		setError(null)
	}, [])

	const runCommand = useCallback(async () => {
		if (prompt.trim().length === 0) return

		setStatus("running")
		setOutput("")
		setError(null)

		const payload: RunPayload = { prompt: prompt.trim(), mode }
		if (workspace.trim().length > 0) {
			payload.workspace = workspace.trim()
		}

		const controller = new AbortController()
		controllerRef.current = controller

		try {
			const response = await fetch("/api/run", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			})

			if (!response.ok) {
				const message =
					(await response.json().catch(() => null))?.error ||
					(await response.text()) ||
					"Unable to start CLI session"
				throw new Error(message)
			}

			if (!response.body) {
				throw new Error("Streaming is not supported in this environment.")
			}

			const reader = response.body.getReader()
			const decoder = new TextDecoder()

			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				const chunk = decoder.decode(value, { stream: true })
				setOutput((prev) => prev + chunk)
			}

			setStatus("complete")
		} catch (err) {
			const message = (err as Error).name === "AbortError" ? "Run cancelled" : (err as Error).message
			setError(message)
			setStatus("error")
		} finally {
			controllerRef.current = null
		}
	}, [mode, prompt, workspace])

	const onSubmit = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault()
			await runCommand()
		},
		[runCommand],
	)

	const stopRun = useCallback(() => {
		controllerRef.current?.abort()
	}, [])

	const cliPreview = useMemo(() => {
		const base = `node cli/dist/index.js --auto --json --mode ${mode}`
		const promptArg = prompt.trim().length > 0 ? ` "${prompt.trim()}"` : ""
		const workspaceArg = workspace.trim().length > 0 ? ` --workspace ${workspace.trim()}` : ""
		return `${base}${promptArg}${workspaceArg}`
	}, [mode, prompt, workspace])

	return (
		<main className="page">
			<div className="page__header">
				<div>
					<p className="eyebrow">Kilo Code · Web CLI</p>
					<h1>Run the CLI directly from Next.js</h1>
					<p className="lede">
						Provide a prompt, optionally target a workspace, and stream the CLI output without leaving your
						browser. The interface wraps the existing <code>@kilocode/cli</code> in autonomous JSON mode so
						you can debug runs visually.
					</p>
					<p className="muted">
						Using <strong>{currentMode?.name ?? mode}</strong> mode by default. Switch modes below to run as
						an architect, coder, debugger, orchestrator, or Q&A specialist.
					</p>
				</div>
				<div className="status-pill" data-status={status}>
					<span className="dot" aria-hidden />
					<span>{statusLabel[status]}</span>
				</div>
			</div>

			<div className="grid">
				<section className="card">
					<header className="card__header">
						<div>
							<p className="eyebrow">Execution settings</p>
							<h2>Compose a run</h2>
						</div>
						<div className="actions">
							<button type="button" className="ghost" onClick={reset} disabled={isRunning}>
								Clear output
							</button>
						</div>
					</header>

					<form className="stack" onSubmit={onSubmit}>
						<label className="field">
							<div className="field__label">
								<span>Workspace (optional)</span>
								<span className="hint">Defaults to repository root</span>
							</div>
							<input
								id="workspace"
								name="workspace"
								placeholder="e.g. /workspace/kilocode/apps/cli-web"
								value={workspace}
								onChange={(event) => setWorkspace(event.target.value)}
							/>
						</label>

						<label className="field">
							<div className="field__label">
								<span>Mode</span>
								<span className="hint">Pick the agent specialization to run</span>
							</div>
							<select
								id="mode"
								name="mode"
								value={mode}
								onChange={(event) => setMode(event.target.value)}>
								{MODE_OPTIONS.map((option) => (
									<option key={option.slug} value={option.slug}>
										{option.name} · {option.description}
									</option>
								))}
							</select>
							<p className="hint">
								Current mode: {MODE_OPTIONS.find((entry) => entry.slug === mode)?.name}
							</p>
						</label>

						<label className="field">
							<div className="field__label">
								<span>Prompt</span>
								<span className="hint">Plain text, will be forwarded directly to the CLI</span>
							</div>
							<textarea
								id="prompt"
								name="prompt"
								rows={5}
								placeholder="Refactor the data loading pipeline"
								value={prompt}
								onChange={(event) => setPrompt(event.target.value)}
							/>
						</label>

						<div className="form-footer">
							<div className="button-row">
								<button type="submit" disabled={isDisabled}>
									{isRunning ? "Running…" : "Run with Kilo Code"}
								</button>
								{isRunning ? (
									<button type="button" className="danger" onClick={stopRun}>
										Stop run
									</button>
								) : null}
							</div>
							<p className="muted">
								Press enter to execute. Keep this tab open while the CLI streams output.
							</p>
						</div>
					</form>
				</section>

				<section className="card">
					<header className="card__header">
						<div>
							<p className="eyebrow">Live output</p>
							<h2>CLI stream</h2>
						</div>
						<code className="command-preview">{cliPreview}</code>
					</header>

					<div className="log-box" ref={logRef} aria-live="polite">
						{output || "Output will appear here once the CLI starts sending events."}
					</div>

					{error ? (
						<div className="callout" role="alert">
							<p className="callout__title">Run halted</p>
							<p className="callout__body">{error}</p>
						</div>
					) : status === "complete" ? (
						<div className="callout callout--success" role="status">
							<p className="callout__title">Run finished</p>
							<p className="callout__body">The CLI exited successfully. Review the stream above.</p>
						</div>
					) : null}
				</section>
			</div>

			<section className="card">
				<header className="card__header">
					<div>
						<p className="eyebrow">Helpful prompts</p>
						<h2>Examples to try</h2>
					</div>
				</header>
				<div className="examples">
					<button
						type="button"
						className="ghost"
						onClick={() => setPrompt("Audit dependencies and update insecure packages")}>
						Audit dependencies and update insecure packages
					</button>
					<button
						type="button"
						className="ghost"
						onClick={() =>
							setPrompt("Generate docs for the CLI API, including expected inputs and example responses")
						}>
						Generate docs for the CLI API
					</button>
					<button
						type="button"
						className="ghost"
						onClick={() => setPrompt("Add smoke tests for the Next.js web UI")}>
						Add smoke tests for the Next.js web UI
					</button>
				</div>
			</section>
		</main>
	)
}
