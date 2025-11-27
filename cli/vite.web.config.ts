import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

const rootDir = path.resolve(__dirname, "src/web/client")

export default defineConfig(({ mode }) => {
	const backendUrl = process.env.KILOCODE_WEB_BACKEND ?? "http://localhost:4173"
	const backendWsUrl = backendUrl.replace(/^http/i, "ws")

	return {
		root: rootDir,
		base: "/",
		plugins: [react()],
		server: {
			port: 5173,
			proxy: {
				"/api": {
					target: backendUrl,
					changeOrigin: true,
				},
				"/healthz": {
					target: backendUrl,
					changeOrigin: true,
				},
				"/ws": {
					target: backendWsUrl,
					changeOrigin: true,
					ws: true,
				},
			},
		},
		build: {
			outDir: path.resolve(__dirname, "dist/web-ui"),
			emptyOutDir: mode === "production",
			sourcemap: true,
			assetsDir: "assets",
		},
	}
})
