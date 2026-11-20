import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import { Readable, Writable } from "stream";
import { runCli, Piffero, PifferoError, PifferoJsonPathError } from "../../index";

const TEST_JSON_FILE = path.join(__dirname, "../jsonFiles/john-doe.json");

function createCaptureBuffers(stdinContent?: string | Buffer) {
  let out = "";
  let err = "";
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      err += chunk.toString();
      cb();
    },
  });
  const stdin =
    stdinContent !== undefined ? Readable.from([stdinContent]) : undefined;
  return {
    io: { stdin, stdout, stderr },
    getStdout: () => out,
    getStderr: () => err,
  };
}

describe("CLI (runCli) & Dual ESM/CJS Packaging", function () {
  it("prints help and version with exit code 0", async function () {
    const h = createCaptureBuffers();
    expect(await runCli(["--help"], h.io)).toBe(0);
    expect(h.getStdout()).toContain("Usage: piffero-plus");
    expect(h.getStdout()).toContain("--ndjson");
    expect(h.getStdout()).toContain("--raw");
    expect(h.getStdout()).toContain("--gzip");

    const v = createCaptureBuffers();
    expect(await runCli(["--version"], v.io)).toBe(0);
    expect(v.getStdout().trim()).toBe("1.1.0");
  });

  it("extracts values from a file in streaming mode and --pretty mode", async function () {
    const c1 = createCaptureBuffers();
    const code1 = await runCli(["$.firstName", TEST_JSON_FILE], c1.io);
    expect(code1).toBe(0);
    expect(JSON.parse(c1.getStdout())).toEqual(["John"]);

    const c2 = createCaptureBuffers();
    const code2 = await runCli(
      ["$.phoneNumbers[*].number", TEST_JSON_FILE, "--pretty"],
      c2.io
    );
    expect(code2).toBe(0);
    expect(c2.getStdout()).toContain('\n  "0123-4567-8888"');
    expect(JSON.parse(c2.getStdout())).toEqual([
      "0123-4567-8888",
      "0123-4567-8910",
    ]);
  });

  it("supports stdin streaming and --path / --pointer / --all / -r options", async function () {
    const payload = JSON.stringify({
      users: [
        { name: "Alice", active: true },
        { name: "Bob", active: false },
      ],
    });

    const cPath = createCaptureBuffers(payload);
    expect(
      await runCli(["$.users[?@.active == true].name", "--path"], cPath.io)
    ).toBe(0);
    expect(JSON.parse(cPath.getStdout())).toEqual(["$['users'][0]['name']"]);

    const cPtr = createCaptureBuffers(payload);
    expect(
      await runCli(["$.users[1].name", "--pointer"], cPtr.io)
    ).toBe(0);
    expect(JSON.parse(cPtr.getStdout())).toEqual(["/users/1/name"]);

    const cAll = createCaptureBuffers(payload);
    expect(
      await runCli(["$.users[0].name", "-r", "all"], cAll.io)
    ).toBe(0);
    expect(JSON.parse(cAll.getStdout())).toEqual([
      {
        path: "$['users'][0]['name']",
        pointer: "/users/0/name",
        value: "Alice",
      },
    ]);

    const cEq = createCaptureBuffers(payload);
    expect(
      await runCli(["$.users[0].name", "--result-type=path"], cEq.io)
    ).toBe(0);
    expect(JSON.parse(cEq.getStdout())).toEqual(["$['users'][0]['name']"]);
  });

  it("supports --ndjson / --jsonl streaming output", async function () {
    const payload = JSON.stringify({
      items: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
    });

    const cNd = createCaptureBuffers(payload);
    expect(await runCli(["$.items[*]", "--ndjson"], cNd.io)).toBe(0);
    const lines = cNd.getStdout().trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0])).toEqual({ id: 1, name: "Alice" });
    expect(JSON.parse(lines[1])).toEqual({ id: 2, name: "Bob" });

    const cJsonl = createCaptureBuffers(payload);
    expect(await runCli(["$.items[*].name", "--jsonl"], cJsonl.io)).toBe(0);
    expect(cJsonl.getStdout()).toBe('"Alice"\n"Bob"\n');

    // Empty result emits nothing
    const cEmpty = createCaptureBuffers(payload);
    expect(await runCli(["$.missing", "--ndjson"], cEmpty.io)).toBe(0);
    expect(cEmpty.getStdout()).toBe("");
  });

  it("supports -R / --raw / --raw-output (unquoted strings, raw JSON for non-strings)", async function () {
    const payload = JSON.stringify({
      values: ["Alice", 'a "quoted" line', 42, true, null, { k: 1 }],
    });

    const cRaw = createCaptureBuffers(payload);
    expect(await runCli(["$.values[*]", "--raw"], cRaw.io)).toBe(0);
    expect(cRaw.getStdout()).toBe(
      'Alice\na "quoted" line\n42\ntrue\nnull\n{"k":1}\n'
    );

    const cShort = createCaptureBuffers(payload);
    expect(await runCli(["$.values[0]", "-R"], cShort.io)).toBe(0);
    expect(cShort.getStdout()).toBe("Alice\n");

    const cPtrRaw = createCaptureBuffers(payload);
    expect(
      await runCli(["$.values[0, 2]", "--pointer", "--raw-output"], cPtrRaw.io)
    ).toBe(0);
    expect(cPtrRaw.getStdout()).toBe("/values/0\n/values/2\n");
  });

  it("transparently decompresses .gz files and supports -z/--gzip on stdin", async function () {
    const tmpGz = path.join(
      os.tmpdir(),
      `piffero-cli-test-${process.pid}-${Date.now()}.json.gz`
    );
    const payload = JSON.stringify({
      events: [
        { id: "e1", ok: true },
        { id: "e2", ok: false },
        { id: "e3", ok: true },
      ],
    });
    const gzBuf = zlib.gzipSync(Buffer.from(payload, "utf8"));
    fs.writeFileSync(tmpGz, gzBuf);

    try {
      // Auto-detected .gz file with --raw
      const cFile = createCaptureBuffers();
      expect(
        await runCli(["$.events[?@.ok == true].id", tmpGz, "--raw"], cFile.io)
      ).toBe(0);
      expect(cFile.getStdout()).toBe("e1\ne3\n");

      // Auto-detected .gz file with --pretty
      const cPretty = createCaptureBuffers();
      expect(
        await runCli(["$.events[0].id", tmpGz, "--pretty"], cPretty.io)
      ).toBe(0);
      expect(JSON.parse(cPretty.getStdout())).toEqual(["e1"]);

      // Explicit --gzip on stdin
      const cStdin = createCaptureBuffers(gzBuf);
      expect(
        await runCli(["$.events[*].id", "--gzip", "--ndjson"], cStdin.io)
      ).toBe(0);
      expect(cStdin.getStdout()).toBe('"e1"\n"e2"\n"e3"\n');

      // Corrupt gzip returns exit code 1
      const cCorrupt = createCaptureBuffers(Buffer.from("not-valid-gzip"));
      expect(await runCli(["$.events[*].id", "-z"], cCorrupt.io)).toBe(1);
      expect(cCorrupt.getStderr()).toContain("Error:");
    } finally {
      if (fs.existsSync(tmpGz)) {
        fs.unlinkSync(tmpGz);
      }
    }
  });

  it("returns exit code 1 and writes error on missing args, unknown flags, bad JSONPath, missing file, or malformed JSON", async function () {
    const noArgs = createCaptureBuffers();
    expect(await runCli([], noArgs.io)).toBe(1);
    expect(noArgs.getStderr()).toContain("Usage: piffero-plus");

    const badFlag = createCaptureBuffers();
    expect(await runCli(["$.a", "--unknown-flag"], badFlag.io)).toBe(1);
    expect(badFlag.getStderr()).toContain("Unknown option");

    const badRt = createCaptureBuffers();
    expect(await runCli(["$.a", "-r", "invalid"], badRt.io)).toBe(1);
    expect(badRt.getStderr()).toContain("Invalid --result-type");

    const noFile = createCaptureBuffers();
    expect(await runCli(["$.a", "./non-existent-file-12345.json"], noFile.io)).toBe(1);
    expect(noFile.getStderr()).toContain("File not found");

    const badPath = createCaptureBuffers("{}");
    expect(await runCli(["invalid_path"], badPath.io)).toBe(1);
    expect(badPath.getStderr()).toContain("Error:");

    const badJson = createCaptureBuffers("{malformed");
    expect(await runCli(["$.a"], badJson.io)).toBe(1);
    expect(badJson.getStderr()).toContain("Error:");
  });

  it("exports Piffero, PifferoError, PifferoJsonPathError, and runCli consistently", function () {
    expect(typeof Piffero.query).toBe("function");
    expect(typeof Piffero.iterate).toBe("function");
    expect(typeof PifferoError).toBe("function");
    expect(typeof PifferoJsonPathError).toBe("function");
    expect(typeof runCli).toBe("function");
  });
});
