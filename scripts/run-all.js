#!/usr/bin/env node

/**
 * Cypress Monorepo Multi-Version Parallel Test Runner
 *
 * Runs Cypress test suites in parallel with:
 * - Configurable concurrency pool (default: 7 parallel jobs)
 * - Clean, non-bulky live progress dashboard
 * - Isolated per-package log redirection (./logs/<package>.log)
 * - Beautiful, structured summary dashboard table (sorted v9 -> v16)
 * - Targeted failure diagnosis with error extraction
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const monorepoRoot = path.resolve(__dirname, '..');
const packagesDir = path.join(monorepoRoot, 'packages');
const logsDir = path.join(monorepoRoot, 'logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Parse CLI flags
const args = process.argv.slice(2);
const isVerbose = args.includes('--verbose') || args.includes('-v');
const shouldBail = args.includes('--bail') || args.includes('-b');
const isSerial = args.includes('--serial') || args.includes('--sequential');

// Parallel jobs option: --jobs=N, -j=N, --max-jobs=N, default is 7
let maxJobs = 7;
if (isSerial) {
  maxJobs = 1;
} else {
  const jobsArg = args.find(a => a.startsWith('--jobs=') || a.startsWith('-j=') || a.startsWith('--max-jobs=') || a.startsWith('--parallel='));
  if (jobsArg) {
    const val = parseInt(jobsArg.split('=')[1], 10);
    if (!isNaN(val) && val > 0) {
      maxJobs = Math.min(val, 7); // capped at max 7 jobs
    }
  }
}

// Filter option
const filterArg = args.find(a => a.startsWith('--filter=') || a.startsWith('-f='));
const filterValue = filterArg ? filterArg.split('=')[1] : null;

// Read and sort package list in version order
const allPackages = fs.readdirSync(packagesDir)
  .filter(p => fs.statSync(path.join(packagesDir, p)).isDirectory() && p.startsWith('cypress-v'))
  .sort((a, b) => {
    const numA = parseInt(a.replace('cypress-v', ''), 10);
    const numB = parseInt(b.replace('cypress-v', ''), 10);
    return numA - numB;
  });

const targetPackages = filterValue
  ? allPackages.filter(p => p.includes(filterValue) || p.replace('cypress-', '').includes(filterValue))
  : allPackages;

if (targetPackages.length === 0) {
  console.log(`${colors.red}No packages matching filter: "${filterValue}"${colors.reset}`);
  console.log(`Available packages: ${allPackages.join(', ')}`);
  process.exit(1);
}

// Strip ANSI utility
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

// Format seconds
function formatSeconds(sec) {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const mins = Math.floor(sec / 60);
  const remainingSec = (sec % 60).toFixed(0);
  return `${mins}m ${remainingSec}s`;
}

// Parse Cypress stdout
function parseCypressOutput(rawOutput) {
  const clean = stripAnsi(rawOutput);

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let durationStr = '';
  let failedSpecs = [];

  // Match: All specs passed! 00:15 12 12 - - -
  const passSummaryMatch = clean.match(/(?:[\u2714\u221AvV]|All specs passed!)\s*(?:All specs passed!)?\s*([0-9:]+)\s+(\d+)\s+(\d+)/i);
  if (passSummaryMatch) {
    durationStr = passSummaryMatch[1];
    totalTests = parseInt(passSummaryMatch[2], 10);
    passedTests = parseInt(passSummaryMatch[3], 10);
    failedTests = 0;
  }

  // Match: 1 of 6 failed (16%) 00:20 12 10 2 - -
  const failSummaryMatch = clean.match(/(?:[\u2716\u00D7xX]|\d+\s+of\s+\d+\s+failed)[^(]*\([^)]*\)\s*([0-9:]+)\s+(\d+)\s+(\d+)\s+(\d+)/i);
  if (failSummaryMatch) {
    durationStr = failSummaryMatch[1];
    totalTests = parseInt(failSummaryMatch[2], 10);
    passedTests = parseInt(failSummaryMatch[3], 10);
    failedTests = parseInt(failSummaryMatch[4], 10);
  }

  // Scan lines for spec results
  const specLines = clean.split('\n');
  for (const line of specLines) {
    if (line.includes('\u2716') || line.includes('\u00D7') || line.includes('(failed)') || line.includes(' failed ')) {
      const specMatch = line.match(/([a-zA-Z0-9_.-]+(?:spec|cy)\.[jt]s)/);
      if (specMatch && !failedSpecs.includes(specMatch[1])) {
        failedSpecs.push(specMatch[1]);
      }
    }
  }

  // Extract failure message snippets if failed
  const errorSnippets = [];
  let capturing = false;
  let snippet = [];
  for (const line of specLines) {
    if (line.includes(') ') && (line.includes('Error') || line.includes('expected') || line.includes('Timed out'))) {
      capturing = true;
      snippet.push(line.trim());
    } else if (capturing) {
      if (line.trim().startsWith('at ') || snippet.length > 3) {
        capturing = false;
        if (snippet.length > 0) {
          errorSnippets.push(snippet.join('\n    '));
          snippet = [];
        }
      } else if (line.trim().length > 0) {
        snippet.push(line.trim());
      }
    }
  }

  return {
    totalTests,
    passedTests,
    failedTests,
    durationStr,
    failedSpecs,
    errorSnippets: errorSnippets.slice(0, 3),
  };
}

// Global active jobs tracking
const activeJobs = new Map();
let finishedCount = 0;
let isBailing = false;

function renderActiveLine() {
  if (isVerbose || activeJobs.size === 0) return;
  const items = [];
  for (const [name, info] of activeJobs.entries()) {
    const elapsed = Math.round((Date.now() - info.startTime) / 1000);
    const shortName = name.replace('cypress-', '');
    const spec = info.currentSpec ? ` (${info.currentSpec.replace('.cy.js', '').replace('.spec.js', '')})` : '';
    items.push(`${colors.cyan}${shortName}${colors.gray}:${colors.yellow}${elapsed}s${colors.dim}${spec}${colors.reset}`);
  }
  const statusLine = `\r  ${colors.cyan}\u23F3 [Running ${activeJobs.size} parallel jobs]${colors.reset} ${items.join(' | ')}   `;
  process.stdout.write(statusLine);
}

// Run single package within worker pool
function runPackage(pkgName, total) {
  return new Promise((resolve) => {
    if (isBailing) {
      return resolve({
        pkgName,
        pkgVersion: 'skipped',
        code: 1,
        isPass: false,
        durationSec: 0,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        failedSpecs: ['(cancelled)'],
      });
    }

    const pkgDir = path.join(packagesDir, pkgName);
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    let pkgVersion = 'unknown';

    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        pkgVersion = pkgData.dependencies?.cypress || pkgData.version || 'unknown';
      } catch (e) {}
    }

    const logFile = path.join(logsDir, `${pkgName}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'w' });

    const startTime = Date.now();
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    const child = spawn(`${npmCmd} run cy:headless`, {
      cwd: pkgDir,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const jobInfo = { startTime, currentSpec: '', child };
    activeJobs.set(pkgName, jobInfo);

    let rawOutput = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      rawOutput += text;
      logStream.write(text);

      if (isVerbose) {
        process.stdout.write(text);
      } else {
        const specMatch = text.match(/Running:\s+([a-zA-Z0-9_.-]+)/);
        if (specMatch) {
          jobInfo.currentSpec = specMatch[1];
        }
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      rawOutput += text;
      logStream.write(text);
      if (isVerbose) {
        process.stderr.write(text);
      }
    });

    child.on('close', (code) => {
      activeJobs.delete(pkgName);
      logStream.end();
      finishedCount++;

      const durationMs = Date.now() - startTime;
      const durationSec = durationMs / 1000;
      const parsed = parseCypressOutput(rawOutput);
      const isPass = code === 0 && parsed.failedTests === 0;

      // Clear the live progress line
      process.stdout.write('\r' + ' '.repeat(130) + '\r');

      if (isPass) {
        console.log(
          `  ${colors.green}\u2714 [${finishedCount}/${total}]${colors.reset} ` +
          `${colors.bold}${pkgName.padEnd(12)}${colors.reset} ` +
          `${colors.gray}(${pkgVersion})${colors.reset} ` +
          `${colors.green}${colors.bold}PASSED${colors.reset} ` +
          `${colors.dim}[${parsed.totalTests || 'all'} tests | ${formatSeconds(durationSec)}]${colors.reset}`
        );
      } else {
        console.log(
          `  ${colors.red}\u2716 [${finishedCount}/${total}]${colors.reset} ` +
          `${colors.bold}${pkgName.padEnd(12)}${colors.reset} ` +
          `${colors.gray}(${pkgVersion})${colors.reset} ` +
          `${colors.red}${colors.bold}FAILED${colors.reset} ` +
          `${colors.dim}[${parsed.failedTests} failed, ${parsed.passedTests} passed | ${formatSeconds(durationSec)}]${colors.reset}`
        );

        if (parsed.failedSpecs.length > 0) {
          console.log(`    ${colors.red}Failed specs:${colors.reset} ${parsed.failedSpecs.join(', ')}`);
        }
        if (parsed.errorSnippets.length > 0) {
          parsed.errorSnippets.forEach(snippet => {
            console.log(`    ${colors.dim}Error: ${snippet}${colors.reset}`);
          });
        }
        console.log(`    ${colors.gray}Full log:${colors.reset} ${colors.cyan}logs/${pkgName}.log${colors.reset}`);

        if (shouldBail) {
          isBailing = true;
          for (const [, j] of activeJobs.entries()) {
            try { j.child.kill(); } catch (e) {}
          }
        }
      }

      renderActiveLine();

      resolve({
        pkgName,
        pkgVersion,
        code,
        isPass,
        durationSec,
        totalTests: parsed.totalTests,
        passedTests: parsed.passedTests,
        failedTests: parsed.failedTests,
        failedSpecs: parsed.failedSpecs,
      });
    });
  });
}

// Parallel Pool Executor
async function runParallelPool(packages, concurrency) {
  const results = [];
  const queue = [...packages];
  const workers = [];

  const actualConcurrency = Math.min(concurrency, packages.length);

  async function worker() {
    while (queue.length > 0 && !isBailing) {
      const pkgName = queue.shift();
      if (!pkgName) break;
      const res = await runPackage(pkgName, packages.length);
      results.push(res);
      if (shouldBail && !res.isPass) {
        break;
      }
    }
  }

  for (let i = 0; i < actualConcurrency; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

// Print dashboard table (sorted in version order v9 -> v16)
function printSummaryTable(results, totalWallClockSec, cumulativeSec, actualConcurrency) {
  const sorted = [...results].sort((a, b) => {
    const numA = parseInt(a.pkgName.replace('cypress-v', ''), 10) || 0;
    const numB = parseInt(b.pkgName.replace('cypress-v', ''), 10) || 0;
    return numA - numB;
  });

  console.log('\n' + colors.cyan + colors.bold + '\u2550'.repeat(82) + colors.reset);
  console.log(colors.bold + '                         \uD83D\uDCCA CYPRESS TEST EXECUTION SUMMARY' + colors.reset);
  console.log(colors.cyan + colors.bold + '\u2550'.repeat(82) + colors.reset);

  const colWidths = {
    pkg: 14,
    version: 12,
    status: 10,
    tests: 8,
    passed: 8,
    failed: 8,
    time: 10,
  };

  // Header
  console.log(
    colors.bold +
    '\u250C' + '\u2500'.repeat(colWidths.pkg + 2) +
    '\u252C' + '\u2500'.repeat(colWidths.version + 2) +
    '\u252C' + '\u2500'.repeat(colWidths.status + 2) +
    '\u252C' + '\u2500'.repeat(colWidths.tests + 2) +
    '\u252C' + '\u2500'.repeat(colWidths.passed + 2) +
    '\u252C' + '\u2500'.repeat(colWidths.failed + 2) +
    '\u252C' + '\u2500'.repeat(colWidths.time + 2) +
    '\u2510' + colors.reset
  );

  console.log(
    colors.bold +
    `\u2502 ${'Package'.padEnd(colWidths.pkg)} ` +
    `\u2502 ${'Cypress Ver'.padEnd(colWidths.version)} ` +
    `\u2502 ${'Status'.padEnd(colWidths.status)} ` +
    `\u2502 ${'Tests'.padStart(colWidths.tests)} ` +
    `\u2502 ${'Passed'.padStart(colWidths.passed)} ` +
    `\u2502 ${'Failed'.padStart(colWidths.failed)} ` +
    `\u2502 ${'Duration'.padStart(colWidths.time)} \u2502` +
    colors.reset
  );

  console.log(
    colors.bold +
    '\u251C' + '\u2500'.repeat(colWidths.pkg + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.version + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.status + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.tests + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.passed + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.failed + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.time + 2) +
    '\u2524' + colors.reset
  );

  let sumTests = 0;
  let sumPassed = 0;
  let sumFailed = 0;
  let allPassed = true;

  for (const r of sorted) {
    const statusText = r.isPass ? `${colors.green}\u2714 PASS${colors.reset}` : `${colors.red}\u2716 FAIL${colors.reset}`;
    if (!r.isPass) allPassed = false;

    sumTests += (r.totalTests || 0);
    sumPassed += (r.passedTests || 0);
    sumFailed += (r.failedTests || 0);

    const testsStr = r.totalTests ? String(r.totalTests) : '-';
    const passedStr = r.passedTests ? String(r.passedTests) : '-';
    const failedStr = r.failedTests !== undefined ? String(r.failedTests) : '-';

    console.log(
      `\u2502 ${colors.bold}${r.pkgName.padEnd(colWidths.pkg)}${colors.reset} ` +
      `\u2502 ${colors.gray}${r.pkgVersion.padEnd(colWidths.version)}${colors.reset} ` +
      `\u2502 ${statusText.padEnd(colWidths.status + 9)} ` +
      `\u2502 ${testsStr.padStart(colWidths.tests)} ` +
      `\u2502 ${colors.green}${passedStr.padStart(colWidths.passed)}${colors.reset} ` +
      `\u2502 ${(r.failedTests > 0 ? colors.red : colors.gray)}${failedStr.padStart(colWidths.failed)}${colors.reset} ` +
      `\u2502 ${formatSeconds(r.durationSec).padStart(colWidths.time)} \u2502`
    );
  }

  // Footer separator
  console.log(
    colors.bold +
    '\u251C' + '\u2500'.repeat(colWidths.pkg + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.version + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.status + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.tests + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.passed + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.failed + 2) +
    '\u253C' + '\u2500'.repeat(colWidths.time + 2) +
    '\u2524' + colors.reset
  );

  // Total summary row
  const totalStatus = allPassed ? `${colors.green}\u2714 ALL PASS${colors.reset}` : `${colors.red}\u2716 FAILURES${colors.reset}`;
  console.log(
    colors.bold +
    `\u2502 ${'TOTAL'.padEnd(colWidths.pkg)} ` +
    `\u2502 ${`${sorted.length} versions`.padEnd(colWidths.version)} ` +
    `\u2502 ${totalStatus.padEnd(colWidths.status + 9)} ` +
    `\u2502 ${String(sumTests).padStart(colWidths.tests)} ` +
    `\u2502 ${colors.green}${String(sumPassed).padStart(colWidths.passed)}${colors.reset} ` +
    `\u2502 ${(sumFailed > 0 ? colors.red : colors.gray)}${String(sumFailed).padStart(colWidths.failed)}${colors.reset} ` +
    `\u2502 ${formatSeconds(totalWallClockSec).padStart(colWidths.time)} \u2502` +
    colors.reset
  );

  console.log(
    colors.bold +
    '\u2514' + '\u2500'.repeat(colWidths.pkg + 2) +
    '\u2534' + '\u2500'.repeat(colWidths.version + 2) +
    '\u2534' + '\u2500'.repeat(colWidths.status + 2) +
    '\u2534' + '\u2500'.repeat(colWidths.tests + 2) +
    '\u2534' + '\u2500'.repeat(colWidths.passed + 2) +
    '\u2534' + '\u2500'.repeat(colWidths.failed + 2) +
    '\u2534' + '\u2500'.repeat(colWidths.time + 2) +
    '\u2518' + colors.reset
  );

  const speedup = cumulativeSec > 0 ? (cumulativeSec / Math.max(totalWallClockSec, 1)).toFixed(1) : '1.0';

  console.log('\n' + colors.bold + 'Summary Metrics:' + colors.reset);
  console.log(`  • ${colors.cyan}Packages Tested:${colors.reset}       ${sorted.length}`);
  console.log(`  • ${colors.green}Total Tests Passed:${colors.reset}    ${sumPassed}`);
  console.log(`  • ${(sumFailed > 0 ? colors.red : colors.gray)}Total Tests Failed:${colors.reset}    ${sumFailed}`);
  console.log(`  • ${colors.yellow}Wall-Clock Time:${colors.reset}       ${formatSeconds(totalWallClockSec)} ${colors.green}(~${speedup}x speedup via ${actualConcurrency} parallel jobs)${colors.reset}`);
  console.log(`  • ${colors.gray}Cumulative Test Time:${colors.reset}  ${formatSeconds(cumulativeSec)}`);
  console.log(`  • ${colors.blue}Execution Logs:${colors.reset}        logs/`);
  console.log(colors.cyan + colors.bold + '\u2550'.repeat(82) + colors.reset + '\n');
}

// Main execution flow
async function main() {
  const actualConcurrency = Math.min(maxJobs, targetPackages.length);

  console.log('\n' + colors.cyan + colors.bold + '\u2554' + '\u2550'.repeat(70) + '\u2557' + colors.reset);
  console.log(colors.cyan + colors.bold + '\u2551' + colors.reset + colors.bold + `   \uD83D\uDE80 Cypress Monorepo Parallel Test Runner (Max Jobs: ${maxJobs})          `.padEnd(73) + colors.cyan + colors.bold + '\u2551' + colors.reset);
  console.log(colors.cyan + colors.bold + '\u255A' + '\u2550'.repeat(70) + '\u255D' + colors.reset);
  console.log(`  ${colors.dim}Target Site:${colors.reset}     https://demo.automationtesting.in`);
  console.log(`  ${colors.dim}Workspace Queue:${colors.reset} ${targetPackages.length} packages (${targetPackages.join(', ')})`);
  console.log(`  ${colors.dim}Parallel Jobs:${colors.reset}   ${actualConcurrency} concurrent workers (allowed max: 7)`);
  console.log(`  ${colors.dim}Logs Directory:${colors.reset}  ${logsDir}`);
  console.log(colors.gray + '\u2500'.repeat(72) + colors.reset + '\n');

  // Start ticker for live active jobs
  const ticker = setInterval(() => {
    renderActiveLine();
  }, 350);

  const suiteStartTime = Date.now();
  const results = await runParallelPool(targetPackages, maxJobs);
  clearInterval(ticker);

  // Clear live line before final table
  process.stdout.write('\r' + ' '.repeat(130) + '\r');

  const totalWallClockSec = (Date.now() - suiteStartTime) / 1000;
  const cumulativeSec = results.reduce((acc, r) => acc + (r.durationSec || 0), 0);

  printSummaryTable(results, totalWallClockSec, cumulativeSec, actualConcurrency);

  const hasFailures = results.some(r => !r.isPass);
  process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
  console.error(`${colors.red}Fatal Runner Error:${colors.reset}`, err);
  process.exit(1);
});