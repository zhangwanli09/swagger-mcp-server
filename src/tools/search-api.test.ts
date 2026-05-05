import { describe, expect, it } from "vitest";
import { matchesKeyword } from "./search-api.js";
import type { InterfaceInfo, Module } from "../types.js";

function iface(overrides: Partial<InterfaceInfo> = {}): InterfaceInfo {
  return {
    interfaceId: "i1",
    interfaceName: "用户登录",
    description: "登录接口",
    fullPath: "/api/user/login",
    httpMethodName: "POST",
    interfaceStatusName: "已发布",
    inParamModelData: {
      queryParam: [],
      bodyParam: [],
      formParam: [],
      headerParam: [],
      pathParam: [],
    },
    ...overrides,
  };
}

function mod(overrides: Partial<Module> = {}): Module {
  return {
    moduleId: "m1",
    moduleName: "用户模块",
    interfaceInfos: [],
    ...overrides,
  };
}

describe("matchesKeyword", () => {
  it("matches against interface name (case insensitive)", () => {
    expect(matchesKeyword("LOGIN", iface({ interfaceName: "User Login" }), mod())).toBe(true);
  });

  it("matches against description", () => {
    expect(matchesKeyword("登录", iface({ interfaceName: "x", description: "用户登录接口" }), mod())).toBe(true);
  });

  it("matches against fullPath", () => {
    expect(matchesKeyword("order", iface({ fullPath: "/api/Order/create" }), mod())).toBe(true);
  });

  it("matches against module name", () => {
    expect(matchesKeyword("订单", iface({ interfaceName: "x", description: "y", fullPath: "/z" }), mod({ moduleName: "订单管理" }))).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(
      matchesKeyword("nope", iface({ interfaceName: "a", description: "b", fullPath: "/c" }), mod({ moduleName: "d" }))
    ).toBe(false);
  });

  it("tolerates missing description without throwing", () => {
    expect(
      matchesKeyword("login", iface({ interfaceName: "login", description: undefined }), mod())
    ).toBe(true);
  });
});
