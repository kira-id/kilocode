export interface ModeOption {
	slug: string
	name: string
	description: string
}

export const MODE_OPTIONS: ModeOption[] = [
	{
		slug: "architect",
		name: "Architect",
		description: "Plan and design before implementation",
	},
	{
		slug: "code",
		name: "Code",
		description: "Write, modify, and refactor code",
	},
	{
		slug: "ask",
		name: "Ask",
		description: "Get answers and explanations",
	},
	{
		slug: "debug",
		name: "Debug",
		description: "Diagnose and fix software issues",
	},
	{
		slug: "orchestrator",
		name: "Orchestrator",
		description: "Coordinate tasks across multiple modes",
	},
]

export const DEFAULT_MODE = "code"

export function isValidMode(slug: string): boolean {
	return MODE_OPTIONS.some((mode) => mode.slug === slug)
}
