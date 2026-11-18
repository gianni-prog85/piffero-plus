import { Readable } from "stream";
import { Piffero } from "../../src/piffero";
import {
  formatNormalizedPath,
  formatJsonPointer,
} from "../../src/handler/jsonpathEngine";
import { streamToString } from "../utils";

const { JSONPath } = require("jsonpath-plus");

function makeStream(data: any): Readable {
  return Readable.from([JSON.stringify(data)]);
}

const sampleData = {
  employees: [
    {
      name: "John",
      active: true,
      address: { city: "Rome" },
      phoneNumbers: [
        { type: "iPhone", number: "0123-4567-8888" },
        { type: "home", number: "0123-4567-8910" },
      ],
    },
    {
      name: "Joe",
      active: false,
      address: { city: "Milan" },
      phoneNumbers: [],
    },
    {
      name: "Anna",
      active: true,
      address: { city: "Turin" },
      phoneNumbers: [{ type: "work", number: "0999-1111-2222" }],
    },
  ],
  scores: [5, 12, 8, 20, 15],
  special: {
    "a'b": 1,
    "c\\d": 2,
    "e/f~g": 3,
    'quote"ok': 4,
    "ctrl\n\t\x00": 5,
  },
};

describe("Normalized Paths & resultType (RFC 9535 §2.7)", function () {
  describe("formatNormalizedPath and formatJsonPointer helpers", function () {
    it("formats canonical RFC 9535 Normalized Paths with single-quote escapes", function () {
      expect(formatNormalizedPath([])).toBe("$");
      expect(formatNormalizedPath(["employees", 0, "name"])).toBe(
        "$['employees'][0]['name']"
      );
      expect(formatNormalizedPath(["a'b", "c\\d", 'quote"ok'])).toBe(
        "$['a\\'b']['c\\\\d']['quote\"ok']"
      );
      expect(formatNormalizedPath(["\b\t\n\f\r\x00\x1f"])).toBe(
        "$['\\b\\t\\n\\f\\r\\u0000\\u001f']"
      );
    });

    it("formats RFC 6901 JSON Pointers with ~0 and ~1 escapes", function () {
      expect(formatJsonPointer([])).toBe("");
      expect(formatJsonPointer(["employees", 0, "name"])).toBe(
        "/employees/0/name"
      );
      expect(formatJsonPointer(["e/f~g", "~tilde", "/slash"])).toBe(
        "/e~1f~0g/~0tilde/~1slash"
      );
    });
  });

  describe("Streaming resultType modes across findByPath, findAsString, and findAsPromise", function () {
    it("supports root $ query for path, pointer, and all", async function () {
      const obj = { a: 1, b: "ok" };
      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(obj), "$", {
            resultType: "path",
          })
        )
      ).toEqual(["$"]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(obj), "$", {
            resultType: "pointer",
          })
        )
      ).toEqual([""]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(obj), "$", {
            resultType: "all",
          })
        )
      ).toEqual([{ path: "$", pointer: "", value: obj }]);
    });

    it("supports findByPath stream and findAsString callback with resultType", async function () {
      const stream = Piffero.findByPath(
        makeStream(sampleData),
        "$.employees[*].name",
        { resultType: "path" }
      );
      const streamOut = await streamToString(stream);
      expect(JSON.parse(streamOut)).toEqual([
        "$['employees'][0]['name']",
        "$['employees'][1]['name']",
        "$['employees'][2]['name']",
      ]);

      const cbOut = await new Promise<string>((resolve, reject) => {
        Piffero.findAsString(
          (res, err) => (err ? reject(err) : resolve(res)),
          makeStream(sampleData),
          "$.employees[*].name",
          { resultType: "pointer" }
        );
      });
      expect(JSON.parse(cbOut)).toEqual([
        "/employees/0/name",
        "/employees/1/name",
        "/employees/2/name",
      ]);
    });

    it("handles recursive descent, special characters, and container matches", async function () {
      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(sampleData), "$..number", {
            resultType: "path",
          })
        )
      ).toEqual([
        "$['employees'][0]['phoneNumbers'][0]['number']",
        "$['employees'][0]['phoneNumbers'][1]['number']",
        "$['employees'][2]['phoneNumbers'][0]['number']",
      ]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(makeStream(sampleData), "$.special.*", {
            resultType: "all",
          })
        )
      ).toEqual([
        { path: "$['special']['a\\'b']", pointer: "/special/a'b", value: 1 },
        { path: "$['special']['c\\\\d']", pointer: "/special/c\\d", value: 2 },
        { path: "$['special']['e/f~g']", pointer: "/special/e~1f~0g", value: 3 },
        {
          path: "$['special']['quote\"ok']",
          pointer: '/special/quote"ok',
          value: 4,
        },
        {
          path: "$['special']['ctrl\\n\\t\\u0000']",
          pointer: "/special/ctrl\n\t\x00",
          value: 5,
        },
      ]);

      // Container match (object) with resultType: "path"
      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(sampleData),
            "$.employees[1].address",
            { resultType: "path" }
          )
        )
      ).toEqual(["$['employees'][1]['address']"]);
    });

    it("handles negative slices, scripts, and heterogeneous unions preserving order", async function () {
      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(sampleData),
            "$.scores[3:0:-1]",
            { resultType: "path" }
          )
        )
      ).toEqual(["$['scores'][3]", "$['scores'][2]", "$['scores'][1]"]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(sampleData),
            "$.employees[(@.length-1)].name",
            { resultType: "pointer" }
          )
        )
      ).toEqual(["/employees/2/name"]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(sampleData),
            "$.scores[2, 0, 2]",
            { resultType: "all" }
          )
        )
      ).toEqual([
        { path: "$['scores'][2]", pointer: "/scores/2", value: 8 },
        { path: "$['scores'][0]", pointer: "/scores/0", value: 5 },
        { path: "$['scores'][2]", pointer: "/scores/2", value: 8 },
      ]);
    });

    it("handles object filters, scalar filters, post-filter steps, and deferred $ root refs", async function () {
      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(sampleData),
            "$.employees[?@.active == true].address.city",
            { resultType: "all" }
          )
        )
      ).toEqual([
        {
          path: "$['employees'][0]['address']['city']",
          pointer: "/employees/0/address/city",
          value: "Rome",
        },
        {
          path: "$['employees'][2]['address']['city']",
          pointer: "/employees/2/address/city",
          value: "Turin",
        },
      ]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(sampleData),
            "$.scores[?(@ > 10)]",
            { resultType: "path" }
          )
        )
      ).toEqual(["$['scores'][1]", "$['scores'][3]", "$['scores'][4]"]);

      const deferredData = {
        items: [
          { id: 1, price: 10 },
          { id: 2, price: 60 },
          { id: 3, price: 25 },
        ],
        maxPrice: 30,
      };
      expect(
        JSON.parse(
          await Piffero.findAsPromise(
            makeStream(deferredData),
            "$.items[?(@.price < $.maxPrice)].id",
            { resultType: "all" }
          )
        )
      ).toEqual([
        { path: "$['items'][0]['id']", pointer: "/items/0/id", value: 1 },
        { path: "$['items'][2]['id']", pointer: "/items/2/id", value: 3 },
      ]);
    });

    it("matches jsonpath-plus path and pointer output on standard queries", async function () {
      const queries = [
        "$.employees[*].name",
        "$.employees[0].phoneNumbers[*].number",
        "$..city",
        "$.employees[?(@.active === true)].name",
      ];
      for (const q of queries) {
        const pPaths = JSON.parse(
          await Piffero.findAsPromise(makeStream(sampleData), q, {
            resultType: "path",
          })
        );
        const jpPaths = JSONPath({ path: q, json: sampleData, resultType: "path" });
        expect(pPaths).toEqual(jpPaths);

        const pPtrs = JSON.parse(
          await Piffero.findAsPromise(makeStream(sampleData), q, {
            resultType: "pointer",
          })
        );
        const jpPtrs = JSONPath({
          path: q,
          json: sampleData,
          resultType: "pointer",
        });
        expect(pPtrs).toEqual(jpPtrs);
      }
    });

    it("stops reading source stream early for deterministic path queries", async function () {
      let chunksRead = 0;
      const source = new Readable({
        read() {
          if (chunksRead === 0) {
            chunksRead++;
            this.push("[");
          } else if (chunksRead <= 500) {
            const idx = chunksRead - 1;
            chunksRead++;
            this.push(`${idx === 0 ? "" : ","}{"id":${idx}}`);
          } else {
            this.push("]");
            this.push(null);
          }
        },
      });

      const out = await Piffero.findAsPromise(source, "$[0:2].id", {
        resultType: "path",
      });
      expect(JSON.parse(out)).toEqual(["$[0]['id']", "$[1]['id']"]);
      expect(chunksRead).toBeLessThan(20);
    });
  });
});
