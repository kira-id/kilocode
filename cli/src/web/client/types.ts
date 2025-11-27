export interface ModeConfig {
	slug: string
	name: string
	description?: string
	whenToUse?: string
	iconName?: string
	source?: string
}

export interface ExtensionChatMessage {
	ts?: number
	type: string
	role?: string
	text?: string
	ask?: string
	say?: string
	content?: { text?: string }[]
	partial?: boolean
	isAnswered?: boolean
	reasoning?: string
	images?: string[]
	metadata?: Record<string, unknown>
	progressStatus?: { icon?: string; text?: string }
	checkpoint?: Record<string, unknown>
}

import type { AutoApprovalConfig } from "../../config/types.js"

export interface ExtensionState {
	chatMessages?: ExtensionChatMessage[]
	cwd?: string
	mode?: string
	currentApiConfigName?: string
	customModes?: ModeConfig[]
	availableModes?: ModeConfig[]
	autoApproval?: AutoApprovalConfig | null
}
