"use client"

import { useCallback, useMemo, useRef, useState } from "react"

interface RunPayload {
	prompt: string
	workspace?: string
}

type RunStatus = "idle" | "running" | "error" | "complete"

export default function HomePage() {
	const [prompt, setPrompt] = useState("")
	const [workspace, setWorkspace] = useState("")
	const [status, setStatus] = useState<RunStatus>("idle")
	const [output, setOutput] = useState("")
	const [error, setError] = useState<string | null>(null)
	const controllerRef = useRef<AbortController | null>(null)

	const isDisabled = useMemo(() => status === "running" || prompt.trim().length === 0, [prompt, status])

	const runCommand = useCallback(async () => {
		if (prompt.trim().length === 0) return

		setStatus("running")
		setOutput("")
		setError(null)

		const payload: RunPayload = { prompt: prompt.trim() }
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

			if (!response.body) {
				setStatus("error")
				setError("Streaming is not supported in this environment.")
				return
			}

			if (!response.ok) {
				const message = await response.text()
				setStatus("error")
				setError(message || "Unable to start CLI session")
				return
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
			if ((err as Error).name === "AbortError") {
				setError("Run cancelled")
			} else {
				setError((err as Error).message)
			}
			setStatus("error")
		} finally {
			controllerRef.current = null
		}
	}, [prompt, workspace])

	const stopRun = useCallback(() => {
		controllerRef.current?.abort()
	}, [])

	return (
		<main className="container">
			<div className="panel">
				<header style={{ marginBottom: 18 }}>
					<h1 style={{ margin: 0, fontSize: 30 }}>Kilo Code Web UI</h1>
					<p style={{ margin: "8px 0 0", color: "rgba(255,255,255,0.7)" }}>
						Browser-friendly version of the CLI. Provide a prompt, pick a workspace, and stream results over
						HTTP.
					</p>
				</header>

				<div style={{ display: "grid", gap: 16 }}>
					<div>
						<label htmlFor="workspace">Workspace (optional)</label>
						<input
							id="workspace"
							placeholder="Defaults to the repository root"
							value={workspace}
							onChange={(event) => setWorkspace(event.target.value)}
						/>
					</div>

					<div>
						<label htmlFor="prompt">Prompt</label>
						<textarea
							id="prompt"
							rows={4}
							placeholder="e.g. Refactor the data loading pipeline"
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
						/>
					</div>

					<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
						<button onClick={runCommand} disabled={isDisabled}>
							{status === "running" ? "Running…" : "Run with Kilo Code"}
						</button>
						{status === "running" ? (
							<button onClick={stopRun} style={{ background: "#ff79c6", color: "#0b1021" }}>
								Stop
							</button>
						) : null}
						<span className="status">
							{status === "running"
								? "Executing via CLI backend"
								: status === "complete"
									? "Finished"
									: status === "error"
										? "There was a problem"
										: "Idle"}
						</span>
					</div>
				</div>

				<div className="log-box" aria-live="polite">
					{output || "Output will appear here once the CLI starts sending events."}
				</div>

				{error ? (
					<div className="status" style={{ color: "#ffb86c" }}>
						{error}
					</div>
				) : null}

				<p className="footer">
					The browser interface launches the existing <code>@kilocode/cli</code> in autonomous JSON mode,
					builds it on demand, and streams output chunks to this page. Keep this tab open until the run
					completes.
				</p>
			</div>
		</main>
	)
}
