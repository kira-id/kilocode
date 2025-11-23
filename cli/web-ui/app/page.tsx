"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { io, Socket } from "socket.io-client"

interface ExtensionMessage {
	type: string
	text?: string
	chatMessages?: { role: string; content: string }[]
	[key: string]: unknown
}

interface StatusMessage {
	workspace?: string
	mode?: string
	ready: boolean
}

const socketPort = Number(process.env.NEXT_PUBLIC_WEB_UI_PORT || "4000")

export default function Page() {
	const [socket, setSocket] = useState<Socket | null>(null)
	const [status, setStatus] = useState<StatusMessage>({ ready: false })
	const [messages, setMessages] = useState<ExtensionMessage[]>([])
	const [input, setInput] = useState("")
	const [connectionError, setConnectionError] = useState<string | null>(null)
	const listRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const instance = io(`http://localhost:${socketPort}`)

		const handleStatus = (payload: StatusMessage) => setStatus(payload)
		const handleMessage = (payload: ExtensionMessage) => setMessages((prev) => [...prev, payload].slice(-200))

		instance.on("connect_error", (err) => setConnectionError(err.message))
		instance.on("status", handleStatus)
		instance.on("extension-message", handleMessage)
		instance.on("disconnect", () => setConnectionError("Disconnected from CLI"))

		setSocket(instance)

		return () => {
			instance.off("status", handleStatus)
			instance.off("extension-message", handleMessage)
			instance.disconnect()
		}
	}, [])

	useEffect(() => {
		if (!listRef.current) return
		listRef.current.scrollTop = listRef.current.scrollHeight
	}, [messages])

	const handleSend = () => {
		if (!socket || !input.trim()) return
		socket.emit("send-prompt", input.trim())
		setInput("")
	}

	const handleExit = async () => {
		await fetch("/api/exit", { method: "POST" })
	}

	const combinedMessages = useMemo(() => {
		const flattened: { id: number; text: string }[] = []
		messages.forEach((message, index) => {
			if (message.text) {
				flattened.push({ id: index * 2, text: message.text })
			}
			if (message.chatMessages) {
				message.chatMessages.forEach((chat, chatIndex) => {
					flattened.push({
						id: index * 100 + chatIndex,
						text: `${chat.role}: ${chat.content}`,
					})
				})
			}
		})
		return flattened
	}, [messages])

	return (
		<main style={{ maxWidth: 900, margin: "0 auto", padding: "24px" }}>
			<header style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
				<h1 style={{ margin: 0, fontSize: 32 }}>Kilo Code CLI</h1>
				<p style={{ margin: 0, opacity: 0.8 }}>
					The terminal UI now runs as a Next.js web application. Keep this tab open to guide the agent.
				</p>
				<div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
					<span
						style={{
							padding: "6px 12px",
							borderRadius: 999,
							background: status.ready ? "#16a34a" : "#f59e0b",
							color: "#0b1224",
							fontWeight: 700,
						}}>
						{status.ready ? "Ready" : "Starting"}
					</span>
					{status.workspace && <span>Workspace: {status.workspace}</span>}
					{status.mode && <span>Mode: {status.mode}</span>}
					{connectionError && <span style={{ color: "#f87171" }}>{connectionError}</span>}
				</div>
				<div style={{ display: "flex", gap: 12 }}>
					<input
						value={input}
						onChange={(event) => setInput(event.target.value)}
						placeholder="Ask Kilo Code to perform a task"
						style={{
							flex: 1,
							padding: "12px 14px",
							borderRadius: 10,
							border: "1px solid #334155",
							background: "rgba(255,255,255,0.04)",
							color: "inherit",
							fontSize: 15,
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault()
								handleSend()
							}
						}}
					/>
					<button
						type="button"
						onClick={handleSend}
						style={{
							padding: "12px 16px",
							borderRadius: 10,
							border: "1px solid #4ade80",
							background: "#16a34a",
							color: "#0b1224",
							fontWeight: 700,
						}}>
						Send
					</button>
					<button
						type="button"
						onClick={handleExit}
						style={{
							padding: "12px 16px",
							borderRadius: 10,
							border: "1px solid #fda4af",
							background: "#f43f5e",
							color: "#0b1224",
							fontWeight: 700,
						}}>
						End Session
					</button>
				</div>
			</header>
			<section
				ref={listRef}
				style={{
					background: "rgba(15,23,42,0.7)",
					border: "1px solid #1e293b",
					borderRadius: 16,
					padding: 16,
					height: "60vh",
					overflow: "auto",
					display: "flex",
					flexDirection: "column",
					gap: 10,
				}}>
				{combinedMessages.length === 0 ? (
					<p style={{ opacity: 0.7 }}>Waiting for the extension to send messages…</p>
				) : (
					combinedMessages.map((message) => (
						<div
							key={message.id}
							style={{
								padding: "10px 12px",
								borderRadius: 12,
								background: "rgba(255,255,255,0.04)",
								border: "1px solid rgba(148,163,184,0.3)",
							}}>
							{message.text}
						</div>
					))
				)}
			</section>
		</main>
	)
}
