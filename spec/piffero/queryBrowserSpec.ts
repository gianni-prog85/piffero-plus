import * as fs from "fs";
import * as path from "path";
import {
  query,
  Piffero,
  PifferoError,
  PifferoJsonPathError,
} from "../../src/query";

describe("piffero-plus/query (browser/edge-safe entry point)", function () {
  const sample = {
    store: {
      book: [
        { category: "reference", author: "Nigel Rees", title: "Sayings of the Century", price: 8.95 },
        { category: "fiction", author: "Evelyn Waugh", title: "Sword of Honour", price: 12.99 },
        { category: "fiction", author: "Herman Melville", title: "Moby Dick", price: 8.99 },
      ],
    },
  };

  it("evaluates in-memory objects with RFC 9535 and Goessner syntax", function () {
    expect(query(sample, "$.store.book[*].title")).toEqual([
      "Sayings of the Century",
      "Sword of Honour",
      "Moby Dick",
    ]);
    expect(query(sample, "$.store.book[-1].title")).toEqual(["Moby Dick"]);
    expect(query(sample, "$.store.book[(@.length-1)].title")).toEqual(["Moby Dick"]);
    expect(query(sample, "$.store.book[?@.price < 10].title")).toEqual([
      "Sayings of the Century",
      "Moby Dick",
    ]);
    expect(query(sample, "$.store.book[?length(@.author) > 12].author")).toEqual([
      "Herman Melville",
    ]);
    expect(query(sample, '$.store.book[?match(@.category, "fiction")].title')).toEqual([
      "Sword of Honour",
      "Moby Dick",
    ]);
  });

  it("supports Piffero.query drop-in namespace and all resultTypes", function () {
    expect(Piffero.query(sample, "$.store.book[0].title")).toEqual(["Sayings of the Century"]);
    expect(query(sample, "$.store.book[0].title", { resultType: "path" })).toEqual([
      "$['store']['book'][0]['title']",
    ]);
    expect(query(sample, "$.store.book[0].title", { resultType: "pointer" })).toEqual([
      "/store/book/0/title",
    ]);
    expect(query(sample, "$.store.book[0].title", { resultType: "all" })).toEqual([
      {
        path: "$['store']['book'][0]['title']",
        pointer: "/store/book/0/title",
        value: "Sayings of the Century",
      },
    ]);
  });

  it("supports JSON string and Uint8Array inputs", function () {
    const json = JSON.stringify(sample);
    const bytes = new TextEncoder().encode(json);
    expect(query(json, "$.store.book[-1].price")).toEqual([8.99]);
    expect(query(bytes, "$.store.book[-1].price")).toEqual([8.99]);
  });

  it("throws PifferoJsonPathError on invalid JSONPath and PifferoError on invalid JSON/input", function () {
    expect(() => query(sample, "invalid[[")).toThrowError(PifferoJsonPathError);
    expect(() => query("{bad json", "$")).toThrowError(PifferoError);
    expect(() => query(null as any, "$")).toThrowError(PifferoError);
    expect(() => query(42 as any, "$")).toThrowError(PifferoError);
  });

  it("emits a pure native ESM browser bundle with zero Node.js built-ins", function () {
    const browserDir = path.resolve(__dirname, "../../esm/browser");
    const playgroundLibDir = path.resolve(__dirname, "../../docs/playground/lib");
    expect(fs.existsSync(path.join(browserDir, "query.js"))).toBeTrue();
    expect(fs.existsSync(path.join(playgroundLibDir, "query.js"))).toBeTrue();

    const forbidden = /\bfrom\s+["'](?:node:)?(?:stream|fs|path|os|util|events|buffer|string_decoder|process)["']|\brequire\s*\(|\bBuffer\./;
    const files = [
      path.join(browserDir, "query.js"),
      path.join(browserDir, "handler/jsonpathEngine.js"),
      path.join(browserDir, "conditioneval/conditioneval.js"),
    ];
    for (const f of files) {
      const code = fs.readFileSync(f, "utf8");
      expect(forbidden.test(code)).toBeFalse();
    }
  });
});
