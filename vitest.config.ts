import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.test.*",
        "**/*.spec.*",
        "**/tests/**",
        "**/dist/**",
        "**/coverage/**",
        "**/node_modules/**",
        "**/site/**",
        "**/docs/**",
        "**/scripts/**",
        "**/systemd/**",
        "**/bin/**",
      ],
      thresholds: {
        statements: 28,
        branches: 27,
        functions: 40,
        lines: 28,
      },
    },
  },
})
