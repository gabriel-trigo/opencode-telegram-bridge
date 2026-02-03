import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
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
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },
})
