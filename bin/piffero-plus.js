#!/usr/bin/env node
"use strict";

const { runCli } = require("../dist/src/cli");

runCli(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  },
  (err) => {
    process.stderr.write(`Error: ${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
);
