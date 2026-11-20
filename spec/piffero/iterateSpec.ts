import { Readable } from "stream";
import {
  Piffero,
  PifferoAllResult,
  PifferoError,
  PifferoJsonPathError,
  WebReadableStreamLike,
} from "../../index";

interface Employee {
  id: number;
  name: string;
  active: boolean;
  note?: string;
}

const sampleData = {
  employees: [
    { id: 1, name: "John", active: true, note: 'a,b]c"d\\😀' },
    { id: 2, name: "Joe", active: false, note: "" },
    { id: 3, name: "Anna", active: true, note: "line1\nline2" },
  ] as Employee[],
  mixed: [null, false, 0, "", "hello", { k: [1, 2] }],
};

function makeChunkedReadable(payload: string, chunkSize: number): Readable {
  const buf = Buffer.from(payload, "utf8");
  let offset = 0;
  return new Readable({
    read() {
      if (offset >= buf.length) {
        this.push(null);
        return;
      }
      const end = Math.min(offset + chunkSize, buf.length);
      this.push(buf.subarray(offset, end));
      offset = end;
    },
  });
}

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

describe("Piffero.iterate() & TypeScript Generics", function () {
  it("iterates over Node Readable streams with arbitrary chunk boundaries and multi-byte UTF-8", async function () {
    const json = JSON.stringify(sampleData);
    // 3-byte chunks intentionally split UTF-8 4-byte emoji (😀) and escaped quotes
    const stream = makeChunkedReadable(json, 3);
    const out: Employee[] = [];
    for await (const emp of Piffero.iterate<Employee>(
      stream,
      "$.employees[?@.active == true]"
    )) {
      out.push(emp);
    }
    expect(out).toEqual([sampleData.employees[0], sampleData.employees[2]]);
  });

  it("handles mixed primitives, empty strings, null, and empty match sets", async function () {
    const json = JSON.stringify(sampleData);
    const mixed: any[] = [];
    for await (const val of Piffero.iterate(
      makeChunkedReadable(json, 5),
      "$.mixed[*]"
    )) {
      mixed.push(val);
    }
    expect(mixed).toEqual(sampleData.mixed);

    const empty: any[] = [];
    for await (const val of Piffero.iterate(
      makeChunkedReadable(json, 16),
      "$.doesNotExist"
    )) {
      empty.push(val);
    }
    expect(empty).toEqual([]);
  });

  it("supports all PifferoInput types (Web ReadableStream, string, Buffer, Uint8Array, JS object)", async function () {
    const json = JSON.stringify(sampleData);

    // Web ReadableStream
    const webNames: string[] = [];
    const webStream = makeWebStream([
      Buffer.from(json.slice(0, 40)),
      Buffer.from(json.slice(40)),
    ]);
    for await (const name of Piffero.iterate<string>(
      webStream,
      "$.employees[*].name"
    )) {
      webNames.push(name);
    }
    expect(webNames).toEqual(["John", "Joe", "Anna"]);

    // string
    const strIds: number[] = [];
    for await (const id of Piffero.iterate<number>(json, "$.employees[*].id")) {
      strIds.push(id);
    }
    expect(strIds).toEqual([1, 2, 3]);

    // Buffer
    const bufIds: number[] = [];
    for await (const id of Piffero.iterate<number>(
      Buffer.from(json, "utf8"),
      "$.employees[*].id"
    )) {
      bufIds.push(id);
    }
    expect(bufIds).toEqual([1, 2, 3]);

    // Uint8Array
    const u8Ids: number[] = [];
    for await (const id of Piffero.iterate<number>(
      new Uint8Array(Buffer.from(json, "utf8")),
      "$.employees[*].id"
    )) {
      u8Ids.push(id);
    }
    expect(u8Ids).toEqual([1, 2, 3]);

    // In-memory JS object
    const objNames: string[] = [];
    for await (const name of Piffero.iterate<string>(
      sampleData,
      "$.employees[?@.active == true].name"
    )) {
      objNames.push(name);
    }
    expect(objNames).toEqual(["John", "Anna"]);
  });

  it("supports resultType 'path', 'pointer', and 'all' with typed generics in iterate() and query()", async function () {
    const json = JSON.stringify(sampleData);

    const paths: string[] = [];
    for await (const p of Piffero.iterate(
      makeChunkedReadable(json, 17),
      "$.employees[?@.active == true].name",
      { resultType: "path" }
    )) {
      paths.push(p);
    }
    expect(paths).toEqual([
      "$['employees'][0]['name']",
      "$['employees'][2]['name']",
    ]);

    const pointers: string[] = [];
    for await (const ptr of Piffero.iterate(sampleData, "$.employees[1].name", {
      resultType: "pointer",
    })) {
      pointers.push(ptr);
    }
    expect(pointers).toEqual(["/employees/1/name"]);

    const allStream: PifferoAllResult<Employee>[] = [];
    for await (const entry of Piffero.iterate<Employee>(
      makeChunkedReadable(json, 23),
      "$.employees[0]",
      { resultType: "all" }
    )) {
      allStream.push(entry);
    }
    expect(allStream).toEqual([
      {
        path: "$['employees'][0]",
        pointer: "/employees/0",
        value: sampleData.employees[0],
      },
    ]);

    // Typed Piffero.query<T>()
    const typedEmployees: Employee[] = Piffero.query<Employee>(
      sampleData,
      "$.employees[?@.active == true]"
    );
    expect(typedEmployees.length).toBe(2);
    expect(typedEmployees[0].name).toBe("John");

    const typedPaths: string[] = Piffero.query(
      sampleData,
      "$.employees[*].name",
      { resultType: "path" }
    );
    expect(typedPaths.length).toBe(3);

    const typedAll: PifferoAllResult<string>[] = Piffero.query<string>(
      sampleData,
      "$.employees[0].name",
      { resultType: "all" }
    );
    expect(typedAll[0].value).toBe("John");
  });

  it("destroys upstream Node Readable and cancels Web ReadableStream on early break", async function () {
    // 1. Node Readable: large stream of 5000 items, break after 2
    const totalItems = 5000;
    let produced = 0;
    const hugeNodeStream = new Readable({
      read() {
        if (produced === 0) {
          this.push("[");
        }
        if (produced >= totalItems) {
          this.push("]");
          this.push(null);
          return;
        }
        const batch: string[] = [];
        const limit = Math.min(produced + 50, totalItems);
        for (let i = produced; i < limit; i++) {
          const prefix = i === 0 ? "" : ",";
          batch.push(`${prefix}{"id":${i},"pad":"${"x".repeat(200)}"}`);
        }
        produced = limit;
        this.push(batch.join(""));
      },
    });

    const taken: number[] = [];
    for await (const item of Piffero.iterate<{ id: number }>(
      hugeNodeStream,
      "$[*]"
    )) {
      taken.push(item.id);
      if (taken.length === 2) {
        break;
      }
    }
    expect(taken).toEqual([0, 1]);
    expect(hugeNodeStream.destroyed).toBe(true);
    expect(produced).toBeLessThan(totalItems);

    // 2. Web ReadableStream: cancel() is invoked on early break
    let cancelled = false;
    const chunks: string[] = ["["];
    for (let i = 0; i < 1000; i++) {
      chunks.push(`${i === 0 ? "" : ","}{"id":${i},"pad":"${"y".repeat(200)}"}`);
    }
    chunks.push("]");
    const webStream = makeWebStream(chunks, () => {
      cancelled = true;
    });

    const webTaken: number[] = [];
    for await (const id of Piffero.iterate<number>(webStream, "$[*].id")) {
      webTaken.push(id);
      if (webTaken.length === 2) {
        break;
      }
    }
    expect(webTaken).toEqual([0, 1]);
    expect(cancelled).toBe(true);
  });

  it("throws synchronously on invalid JSONPath or invalid input, and rejects asynchronously on malformed JSON or stream error", async function () {
    expect(() => Piffero.iterate(sampleData, "not_a_path")).toThrowError(
      PifferoJsonPathError
    );
    expect(() => Piffero.iterate(123 as any, "$")).toThrowError(PifferoError);

    // Malformed JSON
    let caughtParseErr: any = null;
    try {
      for await (const _item of Piffero.iterate(
        Readable.from(["{malformed"]),
        "$.a"
      )) {
        // should not yield
      }
    } catch (err) {
      caughtParseErr = err;
    }
    expect(caughtParseErr instanceof PifferoError).toBe(true);

    // Upstream Readable I/O error
    let caughtIoErr: any = null;
    const failingStream = new Readable({
      read() {
        process.nextTick(() => this.destroy(new Error("boom-io")));
      },
    });
    try {
      for await (const _item of Piffero.iterate(failingStream, "$.a")) {
        // should not yield
      }
    } catch (err) {
      caughtIoErr = err;
    }
    expect(caughtIoErr).toBeTruthy();
    expect(caughtIoErr.message).toContain("boom-io");
  });
});
