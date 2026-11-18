import { Readable } from "stream";
import {
  Piffero,
  PifferoError,
  PifferoJsonPathError,
  WebReadableStreamLike,
} from "../../index";
import { streamToString } from "../utils";

const sampleObj = {
  company: "Acme",
  employees: [
    { id: 1, name: "John", active: true, tags: ["dev", "ts"] },
    { id: 2, name: "Joe", active: false, tags: ["ops"] },
    { id: 3, name: "Anna", active: true, tags: ["lead", "arch"] },
  ],
  maxId: 2,
};

function makeWebStream(
  chunks: Array<Uint8Array | string>,
  onCancel?: () => void
): WebReadableStreamLike<Uint8Array | string> {
  let idx = 0;
  return {
    getReader() {
      return {
        async read() {
          if (idx < chunks.length) {
            return { done: false, value: chunks[idx++] };
          }
          return { done: true, value: undefined };
        },
        async cancel() {
          if (onCancel) onCancel();
        },
      };
    },
  };
}

describe("Universal Input Sources & Piffero.query()", function () {
  describe("In-memory JS objects and arrays", function () {
    it("evaluates queries synchronously via Piffero.query() across all resultType modes", function () {
      expect(
        Piffero.query(sampleObj, "$.employees[?@.active == true].name")
      ).toEqual(["John", "Anna"]);

      expect(
        Piffero.query(sampleObj, "$.employees[?@.id <= $.maxId].name", {
          resultType: "path",
        })
      ).toEqual(["$['employees'][0]['name']", "$['employees'][1]['name']"]);

      expect(
        Piffero.query(sampleObj, "$.employees[1].name", {
          resultType: "pointer",
        })
      ).toEqual(["/employees/1/name"]);

      expect(
        Piffero.query(sampleObj, "$.employees[0].id", { resultType: "all" })
      ).toEqual([
        {
          path: "$['employees'][0]['id']",
          pointer: "/employees/0/id",
          value: 1,
        },
      ]);

      // Root $ query
      expect(Piffero.query([10, 20], "$")).toEqual([[10, 20]]);
      expect(Piffero.query([10, 20], "$", { resultType: "path" })).toEqual([
        "$",
      ]);
    });

    it("accepts in-memory JS objects in findByPath, findAsString, and findAsPromise", async function () {
      const streamOut = await streamToString(
        Piffero.findByPath(sampleObj, "$.employees[*].id")
      );
      expect(JSON.parse(streamOut)).toEqual([1, 2, 3]);

      const strOut = await new Promise<string>((resolve, reject) => {
        Piffero.findAsString(
          (res, err) => (err ? reject(err) : resolve(res)),
          sampleObj,
          "$.employees[*].id"
        );
      });
      expect(JSON.parse(strOut)).toEqual([1, 2, 3]);

      const promiseOut = await Piffero.findAsPromise(
        sampleObj,
        "$.employees[?length(@.tags) == 2].name"
      );
      expect(JSON.parse(promiseOut)).toEqual(["John", "Anna"]);
    });
  });

  describe("string, Buffer, and Uint8Array inputs", function () {
    const jsonStr = JSON.stringify(sampleObj);
    const jsonBuf = Buffer.from(jsonStr, "utf8");
    const jsonU8 = new Uint8Array(jsonBuf);

    it("supports Piffero.query() on string, Buffer, and Uint8Array", function () {
      expect(Piffero.query(jsonStr, "$.employees[*].name")).toEqual([
        "John",
        "Joe",
        "Anna",
      ]);
      expect(Piffero.query(jsonBuf, "$.employees[1].name")).toEqual(["Joe"]);
      expect(
        Piffero.query(jsonU8, "$.employees[0].name", { resultType: "path" })
      ).toEqual(["$['employees'][0]['name']"]);
    });

    it("supports findByPath, findAsString, and findAsPromise on string/Buffer/Uint8Array", async function () {
      expect(
        JSON.parse(
          await streamToString(
            Piffero.findByPath(jsonStr, "$.employees[0].name")
          )
        )
      ).toEqual(["John"]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(jsonBuf, "$.employees[1].name")
        )
      ).toEqual(["Joe"]);

      expect(
        JSON.parse(
          await Piffero.findAsPromise(jsonU8, "$.employees[2].name")
        )
      ).toEqual(["Anna"]);
    });

    it("throws PifferoError synchronously in Piffero.query() on malformed JSON", function () {
      expect(() => Piffero.query("{bad json", "$.a")).toThrowError(
        PifferoError
      );
    });

    it("rejects with PifferoError in findAsPromise() on malformed string JSON", async function () {
      await expectAsync(
        Piffero.findAsPromise("{bad json", "$.a")
      ).toBeRejectedWithError(PifferoError);
    });
  });

  describe("WHATWG Web ReadableStream (fetch().body) support", function () {
    it("streams Uint8Array and string chunks across findByPath and findAsPromise", async function () {
      const raw = JSON.stringify(sampleObj);
      const mid = Math.floor(raw.length / 2);
      const web1 = makeWebStream([
        Buffer.from(raw.slice(0, mid), "utf8"),
        Buffer.from(raw.slice(mid), "utf8"),
      ]);
      const streamOut = await streamToString(
        Piffero.findByPath(web1, "$.employees[*].name")
      );
      expect(JSON.parse(streamOut)).toEqual(["John", "Joe", "Anna"]);

      const web2 = makeWebStream([raw.slice(0, mid), raw.slice(mid)]);
      const promiseOut = await Piffero.findAsPromise(
        web2,
        "$.employees[?@.active == true].id",
        { resultType: "pointer" }
      );
      expect(JSON.parse(promiseOut)).toEqual(["/employees/0/id", "/employees/2/id"]);
    });

    it("cancels Web ReadableStream early on deterministic queries", async function () {
      let cancelled = false;
      let chunkIdx = 0;
      const hugeWebStream: WebReadableStreamLike<Uint8Array> = {
        getReader() {
          return {
            async read() {
              if (chunkIdx === 0) {
                chunkIdx++;
                return { done: false, value: Buffer.from("[") };
              }
              if (chunkIdx <= 500) {
                const i = chunkIdx - 1;
                chunkIdx++;
                return {
                  done: false,
                  value: Buffer.from(`${i === 0 ? "" : ","}{"id":${i}}`),
                };
              }
              return { done: true, value: undefined };
            },
            async cancel() {
              cancelled = true;
            },
          };
        },
      };

      const out = await Piffero.findAsPromise(hugeWebStream, "$[0:2].id");
      expect(JSON.parse(out)).toEqual([0, 1]);
      expect(cancelled).toBeTrue();
      expect(chunkIdx).toBeLessThan(20);
    });
  });

  describe("Validation and error handling", function () {
    it("throws PifferoError when passing a stream to Piffero.query() or invalid input", function () {
      expect(() =>
        Piffero.query(Readable.from(["{}"]), "$")
      ).toThrowError(PifferoError);
      expect(() => Piffero.query(null as any, "$")).toThrowError(PifferoError);
      expect(() => Piffero.findByPath(123 as any, "$")).toThrowError(
        PifferoError
      );
      expect(() => Piffero.query(sampleObj, "invalid")).toThrowError(
        PifferoJsonPathError
      );
    });
  });
});
