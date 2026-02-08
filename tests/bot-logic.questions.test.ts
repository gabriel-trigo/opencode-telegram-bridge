
import { describe, expect, it } from "vitest"

import { parseQuestionCallback } from "../src/bot-logic.js"

describe("question callback parsing", () => {
  it("parses option/next/cancel callbacks", () => {
    expect(parseQuestionCallback("q:req-1:next")).toEqual({
      requestId: "req-1",
      action: "next",
    })
    expect(parseQuestionCallback("q:req-1:cancel")).toEqual({
      requestId: "req-1",
      action: "cancel",
    })
    expect(parseQuestionCallback("q:req-1:opt:0")).toEqual({
      requestId: "req-1",
      action: "option",
      optionIndex: 0,
    })
  })

  it("rejects invalid callbacks", () => {
    expect(parseQuestionCallback("nope")).toBeNull()
    expect(parseQuestionCallback("q::next")).toBeNull()
    expect(parseQuestionCallback("q:req-1:")).toBeNull()
    expect(parseQuestionCallback("q:req-1:wat")).toBeNull()
    expect(parseQuestionCallback("q:req-1:opt")).toBeNull()
    expect(parseQuestionCallback("q:req-1:opt:-1")).toBeNull()
    expect(parseQuestionCallback("q:req-1:opt:x")).toBeNull()
    expect(parseQuestionCallback("q:req-1:opt:1:extra")).toBeNull()
  })
})
