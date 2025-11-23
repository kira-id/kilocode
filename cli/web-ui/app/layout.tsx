import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
	title: "Kilo Code CLI",
	description: "Web experience for the Kilo Code CLI",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	)
}
