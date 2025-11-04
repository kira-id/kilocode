// kilocode_change - new file: Sample release notes data for Storybook testing
import { ReleaseNote } from "@roo-code/types"

export const sampleReleaseNotes: ReleaseNote[] = [
	{
		version: "4.106.0",
		changes: [
			{
				description: "Preliminary support for native tool calling (a.k.a native function calling) was added",
				prNumber: 2833,
				commitHash: "0b8ef46",
				author: "mcowger",
			},
			{
				description: "CMD-I now invokes the agent so you can give it more complex prompts",
				prNumber: 3050,
				commitHash: "357d438",
				author: "markijbema",
			},
		],
	},
	{
		version: "4.105.0",
		changes: [
			{
				description: "Improve the edit chat area to allow context and file drag and drop when editing messages",
				prNumber: 3005,
				commitHash: "b87ae9c",
				author: "kevinvandijk",
			},
			{
				description: "A warning is now shown when the webview memory usage crosses 90% of the limit",
				prNumber: 3046,
				commitHash: "1bd934f",
				author: "chrarnoldus",
			},
		],
	},
]
