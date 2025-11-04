// kilocode_change - new file: Storybook story for Show Release Notes Button Inner component
import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { ShowReleaseNotesButtonInner } from "@/components/release-notes/ShowReleaseNotesButtonInner"
import { Bell } from "lucide-react"

const meta = {
	title: "Components/ShowReleaseNotesButton",
	component: ShowReleaseNotesButtonInner,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story) => (
			<div className="p-4">
				<Story />
			</div>
		),
	],
	argTypes: {
		buttonText: {
			control: { type: "text" },
		},
		showBadge: {
			control: { type: "boolean" },
		},
		className: {
			control: { type: "text" },
		},
	},
	args: {
		onClick: fn(),
	},
} satisfies Meta<typeof ShowReleaseNotesButtonInner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		buttonText: "View Release Notes",
		showBadge: false,
	},
}

export const WithBadge: Story = {
	args: {
		buttonText: "View Release Notes",
		showBadge: true,
	},
}
