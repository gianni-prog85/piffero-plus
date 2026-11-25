import "../../src/handler/jsonpathEngine";
import {
  ConditionEval,
  NOTHING,
  rfc9535Equals,
} from "../../src/conditioneval/conditioneval";

describe("ConditionEval", function () {
  it("simple condition", function () {
    ConditionEval.createCondition('?(!.attribute==="asd")');
    // TODO assert
  });

  it("and condition", function () {
    ConditionEval.createCondition('?(!.attribute==="asd" && !.check===false)');
    // TODO assert
  });

  it("or condition", function () {
    ConditionEval.createCondition('?(!.attribute==="asd" || !.check===true)');
    // TODO assert
  });

  it("or condition", function () {
    const result = ConditionEval.createCondition('?(!.attribute===1+2 || !.check===true)');
    expect(result.length).toBeGreaterThan(0);
  });

  it("evaluates complex filter expressions", function () {
    const item = { price: 15, inStock: true, address: { city: "Rome" }, tags: ["a", "b"] };
    expect(ConditionEval.evaluateFilter("@.price >= 10 && @.inStock", item)).toBeTrue();
    expect(ConditionEval.evaluateFilter("@.address.city === 'Rome'", item)).toBeTrue();
    expect(ConditionEval.evaluateFilter("@.address.country === 'IT'", item)).toBeFalse();
    expect(ConditionEval.evaluateFilter("@.missing.deep === 1", item)).toBeFalse();
    expect(ConditionEval.evaluateFilter("!@.deleted && @.tags[1] === 'b'", item)).toBeTrue();
    expect(ConditionEval.evaluateFilter("@ > 10", 15)).toBeTrue();
    expect(ConditionEval.evaluateFilter("@ > 10", 5)).toBeFalse();
  });

  it("evaluates script expressions", function () {
    expect(ConditionEval.evaluateScript("1 + 2 * 3", undefined)).toBe(7);
    expect(ConditionEval.evaluateScript("@.length - 1", [10, 20, 30])).toBe(2);
  });

  describe("RFC 9535 §2.3.5.2 Nothing, Existence, Equality and Comparisons", function () {
    it("evaluates existence tests on present falsy values as true and missing paths as false", function () {
      expect(ConditionEval.evaluateFilter("@.a", { a: false })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a", { a: 0 })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a", { a: "" })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a", { a: null })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a", { a: {} })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a", { a: [] })).toBeTrue();

      expect(ConditionEval.evaluateFilter("@.a", {})).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a.b", { a: null })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@[0]", [])).toBeFalse();
      expect(ConditionEval.evaluateFilter("@[-1]", [])).toBeFalse();

      expect(ConditionEval.evaluateFilter("!@.a", { a: false })).toBeFalse();
      expect(ConditionEval.evaluateFilter("!@.a", { a: null })).toBeFalse();
      expect(ConditionEval.evaluateFilter("!@.a", {})).toBeTrue();
    });

    it("implements rfc9535Equals without JS coercion and with deep structural equality", function () {
      expect(rfc9535Equals(NOTHING, NOTHING)).toBeTrue();
      expect(rfc9535Equals(NOTHING, null)).toBeFalse();
      expect(rfc9535Equals(null, null)).toBeTrue();
      expect(rfc9535Equals(1, 1.0)).toBeTrue();
      expect(rfc9535Equals(-0, 0)).toBeTrue();
      expect(rfc9535Equals("1", 1)).toBeFalse();
      expect(rfc9535Equals(true, 1)).toBeFalse();
      expect(rfc9535Equals(false, 0)).toBeFalse();
      expect(rfc9535Equals(null, false)).toBeFalse();
      expect(rfc9535Equals("", 0)).toBeFalse();
      expect(rfc9535Equals([], {})).toBeFalse();

      expect(rfc9535Equals([1, { a: 2, b: 3 }], [1, { b: 3, a: 2 }])).toBeTrue();
      expect(rfc9535Equals([1, 2], [2, 1])).toBeFalse();
      expect(rfc9535Equals({ a: 1 }, { a: 1, b: 2 })).toBeFalse();
      expect(rfc9535Equals({ a: undefined }, {})).toBeFalse();
    });

    it("evaluates == and != per RFC 9535 Table 10", function () {
      const obj = { s: "1", n: 1, t: true, f: false, z: 0, nil: null, arr: [1, 2], rec: { x: 1, y: 2 } };
      expect(ConditionEval.evaluateFilter("@.a == @.b", {})).toBeTrue(); // Nothing == Nothing
      expect(ConditionEval.evaluateFilter("@.a != @.b", {})).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a == null", {})).toBeFalse(); // Nothing != null
      expect(ConditionEval.evaluateFilter("@.a != null", {})).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.nil == null", obj)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.s == 1", obj)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.s != 1", obj)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.t == 1", obj)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.f == 0", obj)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.nil == false", obj)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.rec == @.other", { rec: { x: 1, y: 2 }, other: { y: 2, x: 1 } })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.arr == @.other", { arr: [1, 2], other: [1, 2] })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.arr == @.rec", obj)).toBeFalse();
    });

    it("evaluates <, <=, >, >= strictly for matching number/string types and derived identities", function () {
      // Type-safe ordered comparisons
      expect(ConditionEval.evaluateFilter("@.a < @.b", { a: 1, b: 2 })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a < @.b", { a: "a", b: "b" })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a > @.b", { a: "2", b: 1 })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a < @.b", { a: "1", b: 2 })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a <= @.b", { a: "1", b: 2 })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a < @.b", { a: false, b: true })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a <= @.b", { a: false, b: true })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a <= 0", { a: null })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.a >= 0", { a: null })).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.missing < 1", {})).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.missing > 1", {})).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.missing <= 1", {})).toBeFalse();

      // RFC 9535 §2.3.5.2.2 derived <= and >= from < || ==
      expect(ConditionEval.evaluateFilter("@.missing <= @.other", {})).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.missing >= @.other", {})).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a <= @.b", { a: null, b: null })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a >= @.b", { a: true, b: true })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a <= @.b", { a: { x: 1 }, b: { x: 1 } })).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.a >= @.b", { a: [1, 2], b: [1, 2] })).toBeTrue();
    });

    it("supports negative integer array indexing and returns NOTHING for non-integer or out-of-bounds", function () {
      const data = { arr: [10, 20, 30] };
      expect(ConditionEval.evaluateFilter("@.arr[-1] == 30", data)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.arr[-4]", data)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.arr[1.5]", data)).toBeFalse();
    });
  });

  describe("Issue #21: Full JSONPath queries and root ($) references", function () {
    it("detects root usage via ConditionEval.usesRoot", function () {
      expect(ConditionEval.usesRoot(ConditionEval.compile("@.price > 10"))).toBeFalse();
      expect(ConditionEval.usesRoot(ConditionEval.compile("@..price > 10"))).toBeFalse();
      expect(ConditionEval.usesRoot(ConditionEval.compile("@.tags[*]"))).toBeFalse();
      expect(ConditionEval.usesRoot(ConditionEval.compile("@.items[?(@.active)]"))).toBeFalse();

      expect(ConditionEval.usesRoot(ConditionEval.compile("$.maxPrice"))).toBeTrue();
      expect(ConditionEval.usesRoot(ConditionEval.compile("@.price < $.config.maxPrice"))).toBeTrue();
      expect(ConditionEval.usesRoot(ConditionEval.compile("@.price < $..maxPrice"))).toBeTrue();
      expect(ConditionEval.usesRoot(ConditionEval.compile("@.items[?(@.price < $.limit)]"))).toBeTrue();
    });

    it("evaluates descendant, wildcard, slice, union, and nested filter queries on @", function () {
      const itemA = {
        meta: { nested: { price: 25 } },
        tags: ["core", "ts"],
        nums: [5, 15, 25],
        items: [{ active: true, score: 95 }],
      };
      const itemB = {
        meta: { nested: { price: 5 } },
        tags: [],
        nums: [1, 2],
        items: [{ active: false, score: 99 }],
      };

      expect(ConditionEval.evaluateFilter("@..price > 10", itemA)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@..price > 10", itemB)).toBeFalse();

      expect(ConditionEval.evaluateFilter("@.tags[*]", itemA)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.tags[*]", itemB)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.tags[*] == 'ts'", itemA)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.tags[*] == 'go'", itemA)).toBeFalse();

      expect(ConditionEval.evaluateFilter("@.nums[1:3] == 15", itemA)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@['meta', 'tags'][*]", itemA)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.items[?(@.active == true && @.score > 90)]", itemA)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.items[?(@.active == true && @.score > 90)]", itemB)).toBeFalse();
      // Per RFC 9535, @.active is an existence check (true even when active: false), false only when absent
      expect(ConditionEval.evaluateFilter("@.items[?(@.active && @.score > 90)]", itemB)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.items[?(@.active && @.score > 90)]", { items: [{ score: 99 }] })).toBeFalse();
    });

    it("evaluates root ($) simple and complex queries", function () {
      const root = { config: { maxPrice: 100, tiers: [10, 50, 200] }, tags: ["vip", "beta"] };
      expect(ConditionEval.evaluateFilter("@.price < $.config.maxPrice", { price: 50 }, root)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.price < $.config.maxPrice", { price: 150 }, root)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.price < $..maxPrice", { price: 50 }, root)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.tier == $.config.tiers[*]", { tier: 50 }, root)).toBeTrue();
      expect(ConditionEval.evaluateFilter("@.tier == $.config.tiers[*]", { tier: 99 }, root)).toBeFalse();
      expect(ConditionEval.evaluateFilter("@.price < $.missing", { price: 50 }, root)).toBeFalse();
    });

    it("throws on malformed sub-queries inside filter expressions", function () {
      expect(() => ConditionEval.compile("@.. > 10")).toThrow();
      expect(() => ConditionEval.compile("@.a[ == 1")).toThrow();
    });
  });

  describe("RFC 9535 standard functions (Issue #19)", function () {
    it("evaluates length() on ASCII strings, surrogate pairs, arrays, objects, and Nothing", function () {
      expect(ConditionEval.evaluateFilter('length(@.s) == 3', { s: "abc" })).toBeTrue();
      expect(ConditionEval.evaluateFilter('length(@.s) == 2', { s: "😀a" })).toBeTrue();
      expect(ConditionEval.evaluateFilter('length(@.arr) == 4', { arr: [1, 2, 3, 4] })).toBeTrue();
      expect(ConditionEval.evaluateFilter('length(@.obj) == 2', { obj: { a: 1, b: 2 } })).toBeTrue();
      expect(ConditionEval.evaluateFilter('length(@.n) == 0', { n: 42 })).toBeFalse();
      expect(ConditionEval.evaluateFilter('length(@.missing) == 0', {})).toBeFalse();
    });

    it("evaluates count() on complex and singular queries", function () {
      const doc = { items: [{ ok: true }, { ok: false }, { ok: true }], single: 10 };
      expect(ConditionEval.evaluateFilter("count(@.items[*]) == 3", doc)).toBeTrue();
      expect(ConditionEval.evaluateFilter("count(@.items[?(@.ok == true)]) == 2", doc)).toBeTrue();
      expect(ConditionEval.evaluateFilter("count(@.single) == 1", doc)).toBeTrue();
      expect(ConditionEval.evaluateFilter("count(@.missing) == 0", doc)).toBeTrue();
    });

    it("evaluates value() on 0, 1, and >1 node lists", function () {
      const doc = { one: [42], many: [1, 2], empty: [] };
      expect(ConditionEval.evaluateFilter("value(@.one[*]) == 42", doc)).toBeTrue();
      expect(ConditionEval.evaluateFilter("value(@.many[*]) == 1", doc)).toBeFalse();
      expect(ConditionEval.evaluateFilter("value(@.empty[*]) == 1", doc)).toBeFalse();
      expect(ConditionEval.evaluateFilter("value(@.one[0]) == 42", doc)).toBeTrue();
    });

    it("evaluates match() and search() with I-Regexp (RFC 9485) semantics", function () {
      expect(ConditionEval.evaluateFilter('match(@.s, "a.c")', { s: "abc" })).toBeTrue();
      expect(ConditionEval.evaluateFilter('match(@.s, "a.c")', { s: "xabcy" })).toBeFalse();
      expect(ConditionEval.evaluateFilter('search(@.s, "a.c")', { s: "xabcy" })).toBeTrue();
      // '.' in I-Regexp does not match \n or \r, but matches \u2028
      expect(ConditionEval.evaluateFilter('match(@.s, "a.c")', { s: "a\nc" })).toBeFalse();
      expect(ConditionEval.evaluateFilter('match(@.s, "a.c")', { s: "a\u2028c" })).toBeTrue();
      // Unicode category \p{Lu}
      expect(ConditionEval.evaluateFilter('match(@.s, "\\\\p{Lu}+")', { s: "ABC" })).toBeTrue();
      expect(ConditionEval.evaluateFilter('match(@.s, "\\\\p{Lu}+")', { s: "abc" })).toBeFalse();
      // Non-string input returns false
      expect(ConditionEval.evaluateFilter('match(@.s, "a")', { s: 123 })).toBeFalse();
      expect(ConditionEval.evaluateFilter('search(@.s, "a")', {})).toBeFalse();
      // Invalid I-Regexp returns false instead of throwing
      expect(ConditionEval.evaluateFilter('match(@.s, "^abc$")', { s: "abc" })).toBeFalse();
      expect(ConditionEval.evaluateFilter('search(@.s, "\\\\d+")', { s: "123" })).toBeFalse();
      expect(ConditionEval.evaluateFilter('match(@.s, "a*?")', { s: "aaa" })).toBeFalse();
      // Dynamic pattern
      expect(
        ConditionEval.evaluateFilter("match(@.s, $.pat)", { s: "hello" }, { pat: "h.*o" })
      ).toBeTrue();
    });

    it("throws on invalid function signatures or unknown functions", function () {
      expect(() => ConditionEval.compile("unknown(@.a)")).toThrow();
      expect(() => ConditionEval.compile("length(@.items[*])")).toThrow();
      expect(() => ConditionEval.compile("length()")).toThrow();
      expect(() => ConditionEval.compile("count(123)")).toThrow();
      expect(() => ConditionEval.compile('count("abc")')).toThrow();
      expect(() => ConditionEval.compile("value(123)")).toThrow();
      expect(() => ConditionEval.compile('match(@.a)')).toThrow();
      expect(() => ConditionEval.compile('search(@.a, @.b, @.c)')).toThrow();
      expect(() => ConditionEval.compile('length(match(@.a, "x"))')).toThrow();
    });
  });
});
