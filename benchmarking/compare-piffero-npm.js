/**
 * Benchmark comparison on 200 MiB GitHub events dataset:
 * piffero-plus@1.0.0 (local ./dist) vs legacy piffero@1.1.13 (installed from npm)
 *
 * Each engine/mode runs in an isolated child Node.js process (--expose-gc, 1.5 GiB heap cap)
 * so peakHeapMb / peakRssMb are uncontaminated across engines and legacy OOMs cannot crash the suite.
 *
 * RUN: node benchmarking/compare-piffero-npm.js
 */
const fs = require("fs");
const { performance } = require("perf_hooks");
const { spawnSync } = require("child_process");

const { ensure200MbDataset } = require("./dataset-200mb.js");

const DATASET = ensure200MbDataset();
const JSON_FILE = DATASET.filePath;

function runEngineStream(Engine, jsonPath) {
  return new Promise((resolve) => {
    const start = performance.now();
    try {
      const chunks = [];
      const s = Engine.findByPath(fs.createReadStream(JSON_FILE), jsonPath);
      s.on("data", (c) => chunks.push(c));
      s.on("end", () => {
        const ms = performance.now() - start;
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          const parsed = JSON.parse(raw);
          resolve({ ms, status: "ok", count: parsed.length });
        } catch {
          resolve({ ms, status: "invalid-json", count: raw.length });
        }
      });
      s.on("error", (err) => {
        resolve({
          ms: performance.now() - start,
          status: "error",
          error: (err && err.message ? err.message : String(err)).split("\n")[0],
        });
      });
    } catch (err) {
      resolve({
        ms: performance.now() - start,
        status: "throw",
        error: (err && err.message ? err.message : String(err)).split("\n")[0],
      });
    }
  });
}

function runEngineString(Engine, jsonPath) {
  return new Promise((resolve) => {
    const start = performance.now();
    try {
      Engine.findAsString(
        (res, err) => {
          const ms = performance.now() - start;
          if (err) {
            resolve({
              ms,
              status: "error",
              error: (err && err.message ? err.message : String(err)).split("\n")[0],
            });
            return;
          }
          try {
            const parsed = JSON.parse(res);
            resolve({ ms, status: "ok", count: parsed.length });
          } catch {
            resolve({ ms, status: "invalid-json", count: res.length });
          }
        },
        fs.createReadStream(JSON_FILE),
        jsonPath
      );
    } catch (err) {
      resolve({
        ms: performance.now() - start,
        status: "throw",
        error: (err && err.message ? err.message : String(err)).split("\n")[0],
      });
    }
  });
}

async function runWorker(engineName, mode, jsonPath, runs) {
  const Engine =
    engineName === "plus"
      ? require("../dist/index.js").Piffero
      : require("piffero").Piffero;

  const fn =
    mode === "stream"
      ? () => runEngineStream(Engine, jsonPath)
      : () => runEngineString(Engine, jsonPath);

  const label =
    engineName === "plus"
      ? `piffero-plus@1.0.0 (${mode})`
      : `piffero@1.1.13 npm (${mode})`;

  const warmup = await fn();
  if (warmup.status === "throw" || warmup.status === "error") {
    return {
      label,
      avgMs: Number(warmup.ms.toFixed(2)),
      medianMs: Number(warmup.ms.toFixed(2)),
      opsSec: "N/A",
      peakHeapMb: "N/A",
      peakRssMb: "N/A",
      result: `${warmup.status.toUpperCase()}: ${warmup.error}`,
    };
  }

  const times = [];
  let last = warmup;
  let maxHeap = 0;
  let maxRss = 0;

  for (let i = 0; i < runs; i++) {
    if (typeof global.gc === "function") {
      global.gc();
    }
    const startMem = process.memoryUsage();
    let runPeakHeap = startMem.heapUsed;
    let runPeakRss = startMem.rss;
    const sampler = setInterval(() => {
      const m = process.memoryUsage();
      if (m.heapUsed > runPeakHeap) runPeakHeap = m.heapUsed;
      if (m.rss > runPeakRss) runPeakRss = m.rss;
    }, 10);
    if (typeof sampler.unref === "function") {
      sampler.unref();
    }

    try {
      last = await fn();
      times.push(last.ms);
    } finally {
      clearInterval(sampler);
      const endMem = process.memoryUsage();
      if (endMem.heapUsed > runPeakHeap) runPeakHeap = endMem.heapUsed;
      if (endMem.rss > runPeakRss) runPeakRss = endMem.rss;
    }

    if (runPeakHeap > maxHeap) maxHeap = runPeakHeap;
    if (runPeakRss > maxRss) maxRss = runPeakRss;
  }

  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const median = times[Math.floor(times.length / 2)];

  let resultStr;
  if (last.status === "ok") {
    resultStr = `${last.count}`;
  } else if (last.status === "invalid-json") {
    resultStr = `INVALID JSON (${last.count} chars)`;
  } else {
    resultStr = `${last.status.toUpperCase()}: ${last.error}`;
  }

  return {
    label,
    avgMs: Number(avg.toFixed(2)),
    medianMs: Number(median.toFixed(2)),
    opsSec: Number((1000 / avg).toFixed(2)),
    peakHeapMb: Number((maxHeap / (1024 * 1024)).toFixed(2)),
    peakRssMb: Number((maxRss / (1024 * 1024)).toFixed(2)),
    result: resultStr,
  };
}

function runIsolated(engineName, mode, jsonPath, runs) {
  const label =
    engineName === "plus"
      ? `piffero-plus@1.0.0 (${mode})`
      : `piffero@1.1.13 npm (${mode})`;

  const payload = JSON.stringify({ engineName, mode, jsonPath, runs });
  const proc = spawnSync(
    process.execPath,
    ["--expose-gc", "--max-old-space-size=1536", __filename, "--worker", payload],
    {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  if (proc.error) {
    const isTimeout = proc.error.code === "ETIMEDOUT";
    return {
      label,
      avgMs: isTimeout ? ">30000" : "N/A",
      medianMs: "N/A",
      opsSec: "N/A",
      peakHeapMb: "N/A",
      peakRssMb: "N/A",
      result: isTimeout ? "TIMEOUT (>30s)" : `SPAWN ERR: ${proc.error.message}`,
    };
  }

  if (proc.status !== 0) {
    const stderr = (proc.stderr || "").trim();
    const isOom =
      /heap out of memory|Allocation failed|ERR_STRING_TOO_LONG/i.test(stderr) ||
      proc.signal === "SIGABRT" ||
      proc.signal === "SIGKILL";
    return {
      label,
      avgMs: "N/A",
      medianMs: "N/A",
      opsSec: "N/A",
      peakHeapMb: isOom ? ">1536 (OOM)" : "N/A",
      peakRssMb: "N/A",
      result: isOom
        ? "OOM / CRASH (>1.5 GiB heap)"
        : `EXIT ${proc.status || proc.signal}: ${stderr.split("\n")[0]}`,
    };
  }

  const marker = "__WORKER_RESULT__:";
  const line = (proc.stdout || "")
    .split("\n")
    .find((l) => l.startsWith(marker));
  if (!line) {
    return {
      label,
      avgMs: "N/A",
      medianMs: "N/A",
      opsSec: "N/A",
      peakHeapMb: "N/A",
      peakRssMb: "N/A",
      result: "NO WORKER OUTPUT",
    };
  }
  return JSON.parse(line.slice(marker.length));
}

async function main() {
  if (process.argv[2] === "--worker") {
    const cfg = JSON.parse(process.argv[3]);
    const res = await runWorker(cfg.engineName, cfg.mode, cfg.jsonPath, cfg.runs);
    console.log("__WORKER_RESULT__:" + JSON.stringify(res));
    return;
  }

  console.log(
    `Dataset ${JSON_FILE}: ${(DATASET.bytesWritten / (1024 * 1024)).toFixed(2)} MiB (${(
      DATASET.bytesWritten / 1e6
    ).toFixed(2)} MB), ${DATASET.totalElements} elements, endIdx=${DATASET.endIdx}`
  );

  const midIdx = DATASET.midIdx;
  const endIdx = DATASET.endIdx;

  const cases = [
    {
      name: "1. Early file ($.[1].payload)",
      plusPath: "$.[1].payload",
      legacyPath: "$.[1].payload",
      runs: 5,
    },
    {
      name: "2. Nested array index ($.[23].payload.commits[1].author)",
      plusPath: "$.[23].payload.commits[1].author",
      legacyPath: "$.[23].payload.commits[1].author",
      runs: 5,
    },
    {
      name: "3. Single-element slice ($.[1:2])",
      plusPath: "$.[1:2]",
      legacyPath: "$.[1:2]",
      runs: 3,
    },
    {
      name: `4. Mid file ($.[${midIdx}].payload)`,
      plusPath: `$.[${midIdx}].payload`,
      legacyPath: `$.[${midIdx}].payload`,
      runs: 2,
    },
    {
      name: `5. End file ($.[${endIdx}].payload.issue.user.received_events_url)`,
      plusPath: `$.[${endIdx}].payload.issue.user.received_events_url`,
      legacyPath: `$.[${endIdx}].payload.issue.user.received_events_url`,
      runs: 2,
    },
    {
      name: "6. Multi-element slice ($.[0:10:2])",
      plusPath: "$.[0:10:2]",
      legacyPath: "$.[0:10:2]",
      runs: 3,
    },
    {
      name: "7. Index union ($.[0,2,4,6,8])",
      plusPath: "$.[0,2,4,6,8]",
      legacyPath: "$.[0,2,4,6,8]",
      runs: 3,
    },
    {
      name: '8. Root equality filter ($.[?(@.type==="IssuesEvent")])',
      plusPath: '$.[?(@.type==="IssuesEvent")]',
      legacyPath: '$.[?(@.type==="IssuesEvent")]',
      runs: 2,
    },
    {
      name: '9. Equality filter + projection ($.[?(@.type==="IssuesEvent")].id)',
      plusPath: '$.[?(@.type==="IssuesEvent")].id',
      legacyPath: '$.[?(@.type==="IssuesEvent")].id',
      runs: 2,
    },
    {
      name: "10. Wildcard ($[*].actor.login)",
      plusPath: "$[*].actor.login",
      legacyPath: "$[*].actor.login",
      runs: 2,
    },
    {
      name: "11. Recursive descent ($..user.login)",
      plusPath: "$..user.login",
      legacyPath: "$..user.login",
      runs: 2,
    },
    {
      name: "12. Existence filter ($[?(@.payload.issue)].payload.issue.number)",
      plusPath: "$[?(@.payload.issue)].payload.issue.number",
      legacyPath: "$[?(@.payload.issue)].payload.issue.number",
      runs: 2,
    },
    {
      name: "13. Reverse slice ($[10:0:-1])",
      plusPath: "$[10:0:-1]",
      legacyPath: "$[10:0:-1]",
      runs: 2,
    },
    {
      name: "14. Heterogeneous union ($[2,0,2,1:3].id)",
      plusPath: "$[2,0,2,1:3].id",
      legacyPath: "$[2,0,2,1:3].id",
      runs: 3,
    },
  ];

  const plusFirst = process.argv.includes("--plus-first");
  const engineOrder = plusFirst ? ["plus", "legacy"] : ["legacy", "plus"];
  console.log(
    `Execution order: ${
      plusFirst
        ? "piffero-plus@1.0.0 first -> legacy piffero@1.1.13 second"
        : "legacy piffero@1.1.13 first -> piffero-plus@1.0.0 second"
    }`
  );

  const filterArgIdx = process.argv.indexOf("--filter");
  const filterRegex =
    filterArgIdx !== -1 && process.argv[filterArgIdx + 1]
      ? new RegExp(process.argv[filterArgIdx + 1], "i")
      : null;
  const activeCases = filterRegex
    ? cases.filter((c) => filterRegex.test(c.name))
    : cases;

  const summary = [];
  for (const c of activeCases) {
    const rows = [];
    for (const eng of engineOrder) {
      rows.push(runIsolated(eng, "stream", eng === "plus" ? c.plusPath : c.legacyPath, c.runs));
      rows.push(runIsolated(eng, "string", eng === "plus" ? c.plusPath : c.legacyPath, c.runs));
    }

    console.log(`\n=== ${c.name} ===`);
    console.table(rows);
    summary.push({ scenario: c.name, rows });
  }

  if (process.argv.includes("--json")) {
    console.log("\n=== JSON_SUMMARY_START ===");
    console.log(JSON.stringify(summary, null, 2));
    console.log("=== JSON_SUMMARY_END ===");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
