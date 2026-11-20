import * as fs from "fs";
import * as zlib from "zlib";
import { Readable, Writable } from "stream";
import { Piffero, PifferoResultType } from "./piffero";
import { JsonArrayItemSplitter } from "./utils/jsonArraySplitter";

export interface CliIo {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
}

const VALID_RESULT_TYPES: PifferoResultType[] = [
  "value",
  "path",
  "pointer",
  "all",
];

const HELP_TEXT = `Usage: piffero-plus <jsonpath> [file] [options]
       cat data.json | piffero-plus <jsonpath> [options]

Zero-dependency streaming RFC 9535 JSONPath CLI for large JSON files & streams.

Arguments:
  <jsonpath>                 JSONPath expression starting with '$' (e.g. '$.items[*].id')
  [file]                     Path to JSON or .gz file (reads from stdin if omitted or '-')

Options:
  -r, --result-type <type>   Output mode: value | path | pointer | all (default: value)
      --path                 Shorthand for --result-type path (RFC 9535 §2.7 Normalized Paths)
      --pointer              Shorthand for --result-type pointer (RFC 6901 JSON Pointers)
      --all                  Shorthand for --result-type all ({ path, pointer, value })
      --ndjson, --jsonl      Stream one compact JSON value per line (newline-delimited JSON)
  -R, --raw, --raw-output    Stream one value per line without quotes for strings (like jq -r)
  -z, --gzip                 Decompress gzip input (auto-enabled for .gz files)
  -p, --pretty               Pretty-print the JSON array output
  -v, --version              Print package version
  -h, --help                 Show this help message

Examples:
  npx piffero-plus '$.employees[*].name' employees.json
  npx piffero-plus '$[0:5].id' huge-200mb.json.gz --raw
  npx piffero-plus '$[0:5]' huge-200mb.json --ndjson
  npx piffero-plus '$[0:5].id' huge-200mb.json --path --pretty
  curl -s https://example.com/events.json.gz | npx piffero-plus '$[*].id' --gzip --raw
`;

function formatRawItem(jsonItem: string): string {
  if (jsonItem.length >= 2 && jsonItem.charCodeAt(0) === 0x22) {
    return JSON.parse(jsonItem);
  }
  return jsonItem;
}

export async function runCli(
  argv: string[],
  io: CliIo = {}
): Promise<number> {
  const stdin = io.stdin || process.stdin;
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;

  let resultType: PifferoResultType = "value";
  let pretty = false;
  let ndjson = false;
  let rawOutput = false;
  let gzipFlag = false;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      stdout.write(HELP_TEXT);
      return 0;
    }
    if (arg === "-v" || arg === "--version") {
      let pkg: { version: string };
      try {
        pkg = require("../package.json");
      } catch (_e) {
        pkg = require("../../package.json");
      }
      stdout.write(`${pkg.version}\n`);
      return 0;
    }
    if (arg === "-p" || arg === "--pretty") {
      pretty = true;
      continue;
    }
    if (arg === "--ndjson" || arg === "--jsonl") {
      ndjson = true;
      continue;
    }
    if (arg === "-R" || arg === "--raw" || arg === "--raw-output") {
      rawOutput = true;
      continue;
    }
    if (arg === "-z" || arg === "--gzip") {
      gzipFlag = true;
      continue;
    }
    if (arg === "--path") {
      resultType = "path";
      continue;
    }
    if (arg === "--pointer") {
      resultType = "pointer";
      continue;
    }
    if (arg === "--all") {
      resultType = "all";
      continue;
    }
    if (arg === "-r" || arg === "--result-type") {
      const next = argv[++i] as PifferoResultType;
      if (!next || VALID_RESULT_TYPES.indexOf(next) === -1) {
        stderr.write(
          `Error: Invalid --result-type "${next || ""}". Expected one of: value, path, pointer, all\n`
        );
        return 1;
      }
      resultType = next;
      continue;
    }
    if (arg.indexOf("--result-type=") === 0) {
      const val = arg.slice("--result-type=".length) as PifferoResultType;
      if (VALID_RESULT_TYPES.indexOf(val) === -1) {
        stderr.write(
          `Error: Invalid --result-type "${val}". Expected one of: value, path, pointer, all\n`
        );
        return 1;
      }
      resultType = val;
      continue;
    }
    if (arg.length > 1 && arg[0] === "-") {
      stderr.write(`Error: Unknown option "${arg}". Run with --help for usage.\n`);
      return 1;
    }
    positionals.push(arg);
  }

  if (positionals.length === 0) {
    stderr.write(HELP_TEXT);
    return 1;
  }

  const jsonPath = positionals[0];
  const filePath = positionals[1];
  const isFileInput = Boolean(filePath && filePath !== "-");
  const useGzip =
    gzipFlag || (isFileInput && /\.gz$/i.test(filePath as string));

  let rawSource: Readable;
  if (isFileInput) {
    if (!fs.existsSync(filePath)) {
      stderr.write(`Error: File not found: ${filePath}\n`);
      return 1;
    }
    rawSource = fs.createReadStream(filePath);
  } else {
    rawSource = stdin;
  }

  let gunzip: zlib.Gunzip | null = null;
  let inputStream: Readable = rawSource;
  if (useGzip) {
    gunzip = zlib.createGunzip();
    rawSource.pipe(gunzip);
    inputStream = gunzip;
  }

  const cleanupSource = () => {
    if (gunzip) {
      rawSource.unpipe(gunzip);
      if (!gunzip.destroyed) {
        gunzip.destroy();
      }
    }
    if (isFileInput && !rawSource.destroyed && typeof rawSource.destroy === "function") {
      rawSource.destroy();
    }
  };

  try {
    if (pretty && !ndjson && !rawOutput) {
      const raw = await new Promise<string>((resolve, reject) => {
        const onSourceErr = (err: Error) => {
          cleanupSource();
          reject(err);
        };
        rawSource.on("error", onSourceErr);
        if (gunzip) {
          gunzip.on("error", onSourceErr);
        }
        Piffero.findAsPromise(inputStream, jsonPath, { resultType }).then(
          (res) => {
            rawSource.removeListener("error", onSourceErr);
            if (gunzip) gunzip.removeListener("error", onSourceErr);
            resolve(res);
          },
          (err) => {
            rawSource.removeListener("error", onSourceErr);
            if (gunzip) gunzip.removeListener("error", onSourceErr);
            cleanupSource();
            reject(err);
          }
        );
      });
      const formatted = JSON.stringify(JSON.parse(raw), null, 2);
      stdout.write(`${formatted}\n`);
      return 0;
    }

    const outStream = Piffero.findByPath(inputStream, jsonPath, {
      resultType,
    }) as Readable;

    const lineMode = ndjson || rawOutput;
    const splitter = lineMode ? new JsonArrayItemSplitter() : null;

    return await new Promise<number>((resolve) => {
      let settled = false;
      const fail = (err: any) => {
        if (settled) return;
        settled = true;
        cleanupSource();
        if (!outStream.destroyed) {
          outStream.destroy();
        }
        stderr.write(
          `Error: ${err && err.message ? err.message : String(err)}\n`
        );
        resolve(1);
      };

      const onUpstreamError = (err: Error) => {
        outStream.destroy(err);
        fail(err);
      };

      rawSource.on("error", onUpstreamError);
      if (gunzip) {
        gunzip.on("error", onUpstreamError);
      }

      const emitLineItems = (items: string[]) => {
        for (let i = 0; i < items.length; i++) {
          const line = rawOutput ? formatRawItem(items[i]) : items[i];
          stdout.write(`${line}\n`);
        }
      };

      outStream.on("data", (chunk) => {
        if (splitter) {
          emitLineItems(splitter.push(chunk as Buffer | string));
        } else {
          stdout.write(chunk);
        }
      });

      outStream.on("error", fail);

      outStream.on("end", () => {
        if (settled) return;
        settled = true;
        if (splitter) {
          emitLineItems(splitter.end());
        } else {
          stdout.write("\n");
        }
        cleanupSource();
        resolve(0);
      });
    });
  } catch (err: any) {
    cleanupSource();
    stderr.write(`Error: ${err && err.message ? err.message : String(err)}\n`);
    return 1;
  }
}

