/**
 * Phase 5 & RFC 9535 extended benchmark suite:
 *  1. Pure in-memory evaluation: Piffero.query(obj) vs jsonpath-plus (~39 MB parsed JSON)
 *  2. Normalized Paths (resultType: "path") on 200 MiB JSON: piffero-plus vs jsonpath-plus
 *  3. RFC 9535 standard functions (length, search, count) on 200 MiB JSON
 *  4. Web ReadableStream (Readable.toWeb) on 200 MiB JSON: piffero-plus vs json-web-streams
 *
 * RUN: npm run benchmark:phase5
 */
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { performance } = require("perf_hooks");

const { JSONPath } = require("jsonpath-plus");
const { JSONParseStream } = require("json-web-streams");
const { Piffero } = require("../dist/index.js");
const { ensure200MbDataset } = require("./dataset-200mb.js");

const SMALL_FILE = path.join(__dirname, "../spec/jsonFiles/large-file.json");
const DATASET = ensure200MbDataset();
const LARGE_FILE = DATASET.filePath;

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function runPiffero200Mb(jsonPath, options) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    Piffero.findAsString(
      (res, err) => {
        if (err) return reject(err);
        const parsed = JSON.parse(res);
        resolve({ ms: performance.now() - start, count: parsed.length });
      },
      fs.createReadStream(LARGE_FILE),
      jsonPath,
      options
    );
  });
}

function runPifferoWebStream200Mb(jsonPath) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const webStream = Readable.toWeb(fs.createReadStream(LARGE_FILE));
    const chunks = [];
    const s = Piffero.findByPath(webStream, jsonPath);
    s.on("data", (c) => chunks.push(c));
    s.on("end", () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      resolve({ ms: performance.now() - start, count: parsed.length });
    });
    s.on("error", reject);
  });
}

async function runJsonWebStreams200Mb(jsonPath) {
  const start = performance.now();
  const webStream = Readable.toWeb(fs.createReadStream(LARGE_FILE));
  const parsed = webStream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new JSONParseStream([jsonPath]));
  const reader = parsed.getReader();
  let count = 0;
  while (true) {
    const { done } = await reader.read();
    if (done) break;
    count++;
  }
  return { ms: performance.now() - start, count };
}

function runJsonPathPlusFile(jsonPath, resultType = "value") {
  const start = performance.now();
  const data = JSON.parse(fs.readFileSync(LARGE_FILE, "utf8"));
  const res = JSONPath({ path: jsonPath, json: data, resultType });
  return { ms: performance.now() - start, count: res.length };
}

async function main() {
  const RUNS = 3;

  console.log("=== 1. Pure In-Memory Evaluation (large-file.json already parsed in RAM) ===");
  const inMemData = JSON.parse(fs.readFileSync(SMALL_FILE, "utf8"));
  const inMemQueries = [
    ["Wildcard shallow $[*].actor.login", "$[*].actor.login", "value"],
    ["Nested wildcard $[*].payload.commits[*].author.email", "$[*].payload.commits[*].author.email", "value"],
    ["Equality filter $[?(@.type == \"IssuesEvent\")].id", "$[?(@.type == \"IssuesEvent\")].id", "value"],
    ["Normalized Paths $[*].actor.login (resultType=path)", "$[*].actor.login", "path"],
  ];

  for (const [label, q, rt] of inMemQueries) {
    // Warmup
    Piffero.query(inMemData, q, { resultType: rt });
    JSONPath({ path: q, json: inMemData, resultType: rt });

    const pTimes = [];
    const jTimes = [];
    let pCount = 0;
    let jCount = 0;
    for (let i = 0; i < RUNS; i++) {
      if (global.gc) global.gc();
      const t0 = performance.now();
      const pr = Piffero.query(inMemData, q, { resultType: rt });
      pTimes.push(performance.now() - t0);
      pCount = pr.length;

      if (global.gc) global.gc();
      const t1 = performance.now();
      const jr = JSONPath({ path: q, json: inMemData, resultType: rt });
      jTimes.push(performance.now() - t1);
      jCount = jr.length;
    }
    console.log(
      `  ${label}: Piffero.query=${avg(pTimes).toFixed(2)} ms (${pCount}) | jsonpath-plus=${avg(jTimes).toFixed(2)} ms (${jCount})`
    );
  }

  console.log(`\n=== 2. Normalized Paths (resultType="path") on 200 MiB JSON ===`);
  for (const [label, q] of [
    ["Early slice $[0:10:2] (path)", "$[0:10:2]"],
    ["Wildcard $[*].actor.login (path)", "$[*].actor.login"],
  ]) {
    const pTimes = [];
    let pCount = 0;
    for (let i = 0; i < RUNS; i++) {
      if (global.gc) global.gc();
      const r = await runPiffero200Mb(q, { resultType: "path" });
      pTimes.push(r.ms);
      pCount = r.count;
    }
    if (global.gc) global.gc();
    const jRes = runJsonPathPlusFile(q, "path");
    console.log(
      `  ${label}: piffero-plus=${avg(pTimes).toFixed(2)} ms (${pCount}) | jsonpath-plus=${jRes.ms.toFixed(2)} ms (${jRes.count})`
    );
  }

  console.log(`\n=== 3. RFC 9535 Standard Functions on 200 MiB JSON (piffero-plus) ===`);
  for (const [label, q] of [
    ["length(): $[?length(@.payload.commits) > 1].id", "$[?length(@.payload.commits) > 1].id"],
    ["search(): $[?search(@.type, \"Issue\")].id", "$[?search(@.type, \"Issue\")].id"],
    ["count(): $[?count(@.payload.commits[*]) > 1].id", "$[?count(@.payload.commits[*]) > 1].id"],
  ]) {
    const pTimes = [];
    let pCount = 0;
    for (let i = 0; i < RUNS; i++) {
      if (global.gc) global.gc();
      const r = await runPiffero200Mb(q);
      pTimes.push(r.ms);
      pCount = r.count;
    }
    console.log(`  ${label}: piffero-plus=${avg(pTimes).toFixed(2)} ms (${pCount} matches)`);
  }

  console.log(`\n=== 4. Web ReadableStream (Readable.toWeb) on 200 MiB JSON ===`);
  const webQuery = "$[*].actor.login";
  const pWebTimes = [];
  const jWebTimes = [];
  let pWebCount = 0;
  let jWebCount = 0;
  for (let i = 0; i < RUNS; i++) {
    if (global.gc) global.gc();
    const pr = await runPifferoWebStream200Mb(webQuery);
    pWebTimes.push(pr.ms);
    pWebCount = pr.count;

    if (global.gc) global.gc();
    const jr = await runJsonWebStreams200Mb(webQuery);
    jWebTimes.push(jr.ms);
    jWebCount = jr.count;
  }
  console.log(
    `  ${webQuery}: piffero-plus (WebStream)=${avg(pWebTimes).toFixed(2)} ms (${pWebCount}) | json-web-streams=${avg(jWebTimes).toFixed(2)} ms (${jWebCount})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
