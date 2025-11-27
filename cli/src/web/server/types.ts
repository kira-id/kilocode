import type { ExtensionMessage, ExtensionState } from "../../types/messages.js"

export type ClientMessage =
	| {
			type: "send_message"
			text: string
	  }
	| {
			type: "respond_to_tool"
			response: "yes" | "no"
			text?: string
	  }
	| {
			type: "cancel_task"
	  }
	| {
			type: "refresh_state"
	  }
	| {
			type: "clear_task"
	  }
	| {
			type: "keepalive"
	  }

export type ServerMessage =
	| {
			type: "state"
			state: ExtensionState | null
	  }
	| {
			type: "extension_message"
			message: ExtensionMessage
	  }
	| {
			type: "error"
			message: string
	  }
	| {
			type: "status"
			message: string
	  }
