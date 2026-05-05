import { describe, expect, it } from "vitest";
import { parseSourcesJson, parseWebUrl } from "./swagger-client.js";

describe("parseSourcesJson", () => {
  it("parses a JSON array of URL strings", () => {
    const raw = '["http://a.example.com", "http://b.example.com"]';
    expect(parseSourcesJson(raw, "test")).toEqual([
      "http://a.example.com",
      "http://b.example.com",
    ]);
  });

  it("rejects invalid JSON with the origin in the error message", () => {
    expect(() => parseSourcesJson("not json", "SWAGGER_SOURCES env var")).toThrow(
      /SWAGGER_SOURCES env var/
    );
  });

  it("rejects non-array payloads", () => {
    expect(() => parseSourcesJson('{"url":"x"}', "test")).toThrow(
      /must be a JSON array of URL strings/
    );
  });

  it("rejects arrays containing non-string entries", () => {
    expect(() => parseSourcesJson('["http://a", 42]', "test")).toThrow(
      /must be a JSON array of URL strings/
    );
  });

  it("rejects empty arrays", () => {
    expect(() => parseSourcesJson("[]", "test")).toThrow(
      /must contain at least one URL/
    );
  });
});

describe("parseWebUrl", () => {
  it("extracts uid and fs-tenant from a typical web URL", () => {
    const input =
      "http://swagger.example.com/?redirect=/login#/swaggerManage?fs-tenant=null&uid=abc123&formShare=0";
    expect(parseWebUrl(input)).toBe(
      "http://swagger.example.com/flow/swagger/share?uid=abc123&fs-tenant=null"
    );
  });

  it("URL-encodes fs-tenant values", () => {
    const input =
      "http://swagger.example.com/#/swaggerManage?fs-tenant=team%2Falpha&uid=xyz";
    expect(parseWebUrl(input)).toBe(
      "http://swagger.example.com/flow/swagger/share?uid=xyz&fs-tenant=team%2Falpha"
    );
  });

  it("defaults fs-tenant to 'null' when missing", () => {
    const input = "http://swagger.example.com/#/swaggerManage?uid=onlyuid";
    expect(parseWebUrl(input)).toBe(
      "http://swagger.example.com/flow/swagger/share?uid=onlyuid&fs-tenant=null"
    );
  });

  it("throws when the hash has no query string", () => {
    expect(() =>
      parseWebUrl("http://swagger.example.com/#/swaggerManage")
    ).toThrow(/Cannot parse uid/);
  });

  it("throws when uid is missing", () => {
    expect(() =>
      parseWebUrl("http://swagger.example.com/#/swaggerManage?fs-tenant=null")
    ).toThrow(/No uid found/);
  });
});
