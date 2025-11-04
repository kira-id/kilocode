import "@testing-library/jest-dom"
import "@testing-library/jest-dom/vitest"

// Force React into development mode for tests
// This is needed to enable act(...) function in React Testing Library
globalThis.process = globalThis.process || {}
globalThis.process.env = globalThis.process.env || {}
globalThis.process.env.NODE_ENV = "test" // kilocode_change force test mode instead for: https://github.com/Kilo-Org/kilocode/blob/2c46e913bba7699eb3bc1425dbe898217f7ee9fe/webview-ui/src/components/settings/SettingsView.tsx#L429

class MockResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

global.ResizeObserver = MockResizeObserver

// Fix for Microsoft FAST Foundation compatibility with JSDOM
// FAST Foundation tries to set HTMLElement.focus property, but it's read-only in JSDOM
// The issue is that FAST Foundation's handleUnsupportedDelegatesFocus tries to set element.focus = originalFocus
// but JSDOM's HTMLElement.focus is a getter-only property
Object.defineProperty(HTMLElement.prototype, "focus", {
	get: function () {
		return (
			this._focus ||
			function () {
				// Mock focus behavior for tests
			}
		)
	},
	set: function (value) {
		this._focus = value
	},
	configurable: true,
})

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
})

// Mock scrollIntoView which is not available in jsdom
Element.prototype.scrollIntoView = vi.fn()

// kilocode_change start
// Mock i18n setup to prevent eager loading of locale files during tests
// This prevents Vite from trying to parse all JSON files at import time
vi.mock("./src/i18n/setup", () => {
	const mockI18next = {
		language: "en",
		use: vi.fn().mockReturnThis(),
		init: vi.fn().mockReturnThis(),
		t: vi.fn((key: string) => key),
		changeLanguage: vi.fn(),
		addResourceBundle: vi.fn(),
	}

	return {
		default: mockI18next,
		loadTranslations: vi.fn(),
	}
})
// kilocode_change end
