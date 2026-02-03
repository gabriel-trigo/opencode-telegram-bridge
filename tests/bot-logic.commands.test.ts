import { describe, expect, it } from "vitest"

import {
  isCommandMessage,
  parseModelCommand,
  parseProjectCommand,
} from "../src/bot-logic.js"

describe("isCommandMessage", () => {
  it("detects bot_command at offset 0", () => {
    expect(
      isCommandMessage({ entities: [{ type: "bot_command", offset: 0 }] }),
    ).toBe(true)
  })

  it("ignores bot_command not at offset 0", () => {
    expect(
      isCommandMessage({ entities: [{ type: "bot_command", offset: 2 }] }),
    ).toBe(false)
  })

  it("handles missing entities", () => {
    expect(isCommandMessage({})).toBe(false)
  })
})

describe("parseProjectCommand", () => {
  it("defaults to list", () => {
    expect(parseProjectCommand("/project")).toEqual({ subcommand: "list", args: [] })
    expect(parseProjectCommand("/project   ")).toEqual({
      subcommand: "list",
      args: [],
    })
  })

  it("parses subcommand + args", () => {
    expect(parseProjectCommand("/project add demo /repo/a")).toEqual({
      subcommand: "add",
      args: ["demo", "/repo/a"],
    })
  })
})

describe("parseModelCommand", () => {
  it("defaults to current", () => {
    expect(parseModelCommand("/model")).toEqual({
      subcommand: "current",
      args: [],
    })
  })

  it("parses list", () => {
    expect(parseModelCommand("/model list")).toEqual({
      subcommand: "list",
      args: [],
    })
  })
})
