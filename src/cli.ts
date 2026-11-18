import * as fs from "fs";
import { Readable, Writable } from "stream";
import { Piffero, PifferoResultType } from "./piffero";

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
  [file]                     Path to JSON file (reads from stdin if omitted or '-')

Options:
  -r, --result-type <type>   Output mode: value | path | pointer | all (default: value)
      --path                 Shorthand for --result-type path (RFC 9535 §2.7 Normalized Paths)
      --pointer              Shorthand for --result-type pointer (RFC 6901 JSON Pointers)
      --all                  Shorthand for --result-type all ({ path, pointer, value })
  -p, --pretty               Pretty-print the JSON array output
  -v, --version              Print package version
  -h, --help                 Show this help message

Examples:
  npx piffero-plus '$.employees[*].name' employees.json
  npx piffero-plus '$[0:5].id' huge-200mb.json --path --pretty
  cat events.json | npx piffero-plus '$[?@.type == "IssuesEvent"].id'
`;

export async function runCli(
  argv: string[],
  io: CliIo = {}
): Promise<number> {
  const stdin = io.stdin || process.stdin;
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;

  let resultType: PifferoResultType = "value";
  let pretty = false;
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

  let inputStream: Readable;
  if (filePath && filePath !== "-") {
    if (!fs.existsSync(filePath)) {
      stderr.write(`Error: File not found: ${filePath}\n`);
      return 1;
    }
    inputStream = fs.createReadStream(filePath);
  } else {
    inputStream = stdin;
  }

  try {
    if (pretty) {
      const raw = await Piffero.findAsPromise(inputStream, jsonPath, {
        resultType,
      });
      const formatted = JSON.stringify(JSON.parse(raw), null, 2);
      stdout.write(`${formatted}\n`);
      return 0;
    }

    const outStream = Piffero.findByPath(inputStream, jsonPath, {
      resultType,
    }) as Readable;

    return await new Promise<number>((resolve) => {
      let settled = false;
      const fail = (err: any) => {
        if (settled) return;
        settled = true;
        stderr.write(`Error: ${err && err.message ? err.message : String(err)}\n`);
        resolve(1);
      };

      inputStream.on("error", (err) => {
        outStream.destroy(err);
        fail(err);
      });

      outStream.on("data", (chunk) => {
        stdout.write(chunk);
      });

      outStream.on("error", fail);

      outStream.on("end", () => {
        if (settled) return;
        settled = true;
        stdout.write("\n");
        resolve(0);
      });
    });
  } catch (err: any) {
    if (filePath && filePath !== "-" && typeof inputStream.destroy === "function") {
      inputStream.destroy();
    }
    stderr.write(`Error: ${err && err.message ? err.message : String(err)}\n`);
    return 1;
  }
}
