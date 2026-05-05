import { describe, expect, it } from "vitest";
import {
  collectMockFields,
  collectOutputFields,
  collectParams,
  isRequired,
  resolveType,
  tryParseJson,
} from "./get-api-detail.js";
import type { MockResultField, OutputResultItem, Param } from "../types.js";

describe("isRequired (platform checkType quirks)", () => {
  it("checkType=0 means optional", () => {
    expect(isRequired({ paramName: "x", checkType: 0 })).toBe("no");
  });

  it("checkType=2 means required", () => {
    expect(isRequired({ paramName: "x", checkType: 2 })).toBe("yes");
  });

  it("checkType>=2 means required (e.g., 3 with custom message)", () => {
    expect(isRequired({ paramName: "x", checkType: 3 })).toBe("yes");
  });

  it("checkType=1 with non-empty resultMsg means required", () => {
    expect(isRequired({ paramName: "x", checkType: 1, resultMsg: "必填" })).toBe("yes");
  });

  it("checkType=1 with no resultMsg is unknown (ambiguous)", () => {
    expect(isRequired({ paramName: "x", checkType: 1 })).toBe("unknown");
  });

  it("checkType=1 with whitespace-only resultMsg is unknown", () => {
    expect(isRequired({ paramName: "x", checkType: 1, resultMsg: "   " })).toBe("unknown");
  });

  it("checkType=1 with empty-string resultMsg is unknown", () => {
    expect(isRequired({ paramName: "x", checkType: 1, resultMsg: "" })).toBe("unknown");
  });

  it("undefined checkType defaults to optional", () => {
    expect(isRequired({ paramName: "x" })).toBe("no");
  });

  it("negative checkType falls through to optional", () => {
    expect(isRequired({ paramName: "x", checkType: -1 })).toBe("no");
  });
});

describe("resolveType", () => {
  const typeMap = new Map<string, string>([
    ["0", "String"],
    ["16", "Object"],
  ]);

  it("returns '-' for undefined paramType", () => {
    expect(resolveType(undefined, false, typeMap)).toBe("-");
  });

  it("returns '-' for empty string paramType", () => {
    expect(resolveType("", false, typeMap)).toBe("-");
  });

  it("does not short-circuit on the literal '0' (which is a valid dict key)", () => {
    expect(resolveType("0", false, typeMap)).toBe("String");
  });

  it("maps known paramType IDs through the dict map", () => {
    expect(resolveType("16", false, typeMap)).toBe("Object");
  });

  it("falls back to the raw paramType when no mapping exists", () => {
    expect(resolveType("999", false, typeMap)).toBe("999");
  });

  it("appends [] when isList is true", () => {
    expect(resolveType("16", true, typeMap)).toBe("Object[]");
  });

  it("treats undefined isList as not-a-list", () => {
    expect(resolveType("16", undefined, typeMap)).toBe("Object");
  });
});

describe("collectParams", () => {
  const typeMap = new Map<string, string>([
    ["0", "String"],
    ["16", "Object"],
  ]);

  it("returns [] for undefined input", () => {
    expect(collectParams(undefined, typeMap)).toEqual([]);
  });

  it("returns [] for empty array", () => {
    expect(collectParams([], typeMap)).toEqual([]);
  });

  it("normalizes a flat param", () => {
    const input: Param[] = [
      { paramName: "userId", paramType: "0", checkType: 2, description: "用户 ID" },
    ];
    expect(collectParams(input, typeMap)).toEqual([
      { name: "userId", type: "String", required: "yes", description: "用户 ID" },
    ]);
  });

  it("recurses into children for object params", () => {
    const input: Param[] = [
      {
        paramName: "user",
        paramType: "16",
        checkType: 2,
        description: "用户对象",
        children: [
          { paramName: "name", paramType: "0", checkType: 1, resultMsg: "name 必填" },
        ],
      },
    ];
    expect(collectParams(input, typeMap)).toEqual([
      {
        name: "user",
        type: "Object",
        required: "yes",
        description: "用户对象",
        children: [
          { name: "name", type: "String", required: "yes", description: "" },
        ],
      },
    ]);
  });

  it("defaults missing description to empty string", () => {
    const input: Param[] = [{ paramName: "p", paramType: "0", checkType: 0 }];
    expect(collectParams(input, typeMap)[0].description).toBe("");
  });
});

describe("collectOutputFields", () => {
  it("returns [] for undefined input", () => {
    expect(collectOutputFields(undefined)).toEqual([]);
  });

  it("strips Java package prefix from dataType", () => {
    const input: OutputResultItem[] = [
      { parameterName: "name", dataType: "java.lang.String", content: "姓名", isDynamic: 0, children: [] },
    ];
    expect(collectOutputFields(input)).toEqual([
      { name: "name", type: "String", description: "姓名" },
    ]);
  });

  it("keeps single-segment types as-is", () => {
    const input: OutputResultItem[] = [
      { parameterName: "x", dataType: "String", content: "", isDynamic: 0, children: [] },
    ];
    expect(collectOutputFields(input)[0].type).toBe("String");
  });

  it("recurses into children", () => {
    const input: OutputResultItem[] = [
      {
        parameterName: "data",
        dataType: "com.example.User",
        content: "用户数据",
        isDynamic: 0,
        children: [
          { parameterName: "id", dataType: "java.lang.Long", content: "", isDynamic: 0, children: [] },
        ],
      },
    ];
    expect(collectOutputFields(input)).toEqual([
      {
        name: "data",
        type: "User",
        description: "用户数据",
        children: [{ name: "id", type: "Long", description: "" }],
      },
    ]);
  });
});

describe("collectMockFields", () => {
  function field(overrides: Partial<MockResultField> = {}): MockResultField {
    return {
      name: "f",
      type: "java.lang.String",
      description: "",
      isList: false,
      fieldTypeOriginEnum: "BUILTIN",
      typeOrigin: 0,
      ...overrides,
    };
  }

  it("returns [] for undefined input", () => {
    expect(collectMockFields(undefined)).toEqual([]);
  });

  it("strips package prefix and respects isList", () => {
    expect(collectMockFields([field({ name: "tags", isList: true })])).toEqual([
      { name: "tags", type: "String[]", description: "" },
    ]);
  });

  it("includes defaultValue only when defined", () => {
    const out = collectMockFields([
      field({ name: "a", defaultValue: "hello" }),
      field({ name: "b" }),
    ]);
    expect(out[0].defaultValue).toBe("hello");
    expect(out[1]).not.toHaveProperty("defaultValue");
  });

  it("recurses into children", () => {
    const input: MockResultField[] = [
      field({
        name: "user",
        type: "com.example.User",
        children: [field({ name: "id", type: "java.lang.Long" })],
      }),
    ];
    expect(collectMockFields(input)).toEqual([
      {
        name: "user",
        type: "User",
        description: "",
        children: [{ name: "id", type: "Long", description: "" }],
      },
    ]);
  });
});

describe("tryParseJson", () => {
  it("returns undefined for undefined input", () => {
    expect(tryParseJson(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(tryParseJson("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(tryParseJson("   \n  ")).toBeUndefined();
  });

  it("returns undefined for the literal 'null'", () => {
    expect(tryParseJson("null")).toBeUndefined();
  });

  it("parses JSON objects", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON arrays", () => {
    expect(tryParseJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("returns undefined for malformed JSON", () => {
    expect(tryParseJson("{not json}")).toBeUndefined();
  });

  // 当前行为：JSON 原语会被解析返回原值。下游 (get-api-detail.ts:380) 用 JSON.stringify
  // 处理这些值是合法的，但语义上几乎一定是脏数据。这些用例锁定当前行为，将来若决定
  // 把原语视作 undefined（更严格），改实现并同步修改这些断言。
  it("parses bare boolean primitives", () => {
    expect(tryParseJson("true")).toBe(true);
    expect(tryParseJson("false")).toBe(false);
  });

  it("parses bare numeric primitives", () => {
    expect(tryParseJson("42")).toBe(42);
    expect(tryParseJson("0")).toBe(0);
  });

  it("parses bare quoted strings", () => {
    expect(tryParseJson('"abc"')).toBe("abc");
  });
});
