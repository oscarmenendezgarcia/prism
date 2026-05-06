#!/usr/bin/env node
'use strict';

// Reads TAP output from stdin, prints a compact OK/NOT_OK summary.
// Usage: node --test --test-reporter=tap tests/*.test.js | node bin/test-report.js

const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

let passed = 0;
let failed = 0;
const failures = [];

rl.on('line', (line) => {
  const okMatch = line.match(/^ok \d+/);
  const notOkMatch = line.match(/^not ok \d+ - (.+)/);

  if (okMatch) {
    passed++;
  } else if (notOkMatch) {
    failed++;
    failures.push(notOkMatch[1].trim());
  }
});

rl.on('close', () => {
  const total = passed + failed;
  if (failed === 0) {
    console.log(`OK  (${total}/${total})`);
    process.exit(0);
  } else {
    console.log(`NOT_OK  (${passed}/${total})`);
    for (const f of failures) {
      console.log(`FAIL  ${f}`);
    }
    process.exit(1);
  }
});
