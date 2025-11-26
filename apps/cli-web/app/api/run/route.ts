import { NextResponse, type NextRequest } from "next/server"
import { CliRunRequestError, createCliRunStream } from "@/lib/extension-service"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
	const body = (await request.json().catch(() => null)) as {
		prompt?: string
		workspace?: string
		mode?: string
	} | null
	if (!body?.prompt || body.prompt.trim().length === 0) {
		return NextResponse.json({ error: "Prompt is required" }, { status: 400 })
	}

	try {
		const stream = await createCliRunStream({ prompt: body.prompt, workspace: body.workspace, mode: body.mode })

		return new NextResponse(stream, {
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "no-cache",
			},
		})
	} catch (error) {
		const status = error instanceof CliRunRequestError ? error.status : 500
		const message = (error as Error).message || "Unexpected error"
		return NextResponse.json({ error: message }, { status })
	}
}
