#!/usr/bin/env node

/**
 * Cypress Monorepo Multi-Version Test Runner
 *
 * Runs Cypress test suites across packages with:
 * - Clean, non-bulky live progress indicators
 * - Automatic log redirection to ./logs/<package>.log
 * - Beautiful, structured summary dashboard table
 * - Failure diagnosis with targeted error extraction
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
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

const monorepoRoot = path.resolve(__dirname, '..');
const packagesDir = path.join(monorepoRoot, 'packages');
const logsDir = path.join(monorepoRoot, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Parse CLI flags
const args = process.argv.slice(2);
const isVerbose = args.includes('--verbose') || args.includes('-v');
const shouldBail = args.includes('--bail') || args.includes('-b');
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

// Format duration
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

// Run single package
function runPackage(pkgName, index, total) {
  return new Promise((resolve) => {
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

    const child = spawn(\ run cy:headless, {
      cwd: pkgDir,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let rawOutput = '';
    let currentSpec = '';

    // Active progress line
    const progressTimer = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const specNote = currentSpec ? ` (${colors.dim}${currentSpec}${colors.cyan})` : '';
      process.stdout.write(
        `\r  ${colors.cyan}\u23F3 [${index}/${total}] ${colors.bold}${pkgName}${colors.reset} ${colors.gray}(Cypress ${pkgVersion})${colors.reset} ... ${colors.yellow}${elapsed}s elapsed${colors.reset}${specNote}   `
      );
    }, 400);

    child.stdout.on('data', (data) => {
      const text = data.toString();
      rawOutput += text;
      logStream.write(text);

      if (isVerbose) {
        process.stdout.write(text);
      } else {
        const specMatch = text.match(/Running:\s+([a-zA-Z0-9_.-]+)/);
        if (specMatch) {
          currentSpec = specMatch[1];
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
      clearInterval(progressTimer);
      logStream.end();

      const durationMs = Date.now() - startTime;
      const durationSec = durationMs / 1000;
      const parsed = parseCypressOutput(rawOutput);

      const isPass = code === 0 && parsed.failedTests === 0;

      // Clear line and output structured status line
      process.stdout.write('\r' + ' '.repeat(100) + '\r');

      if (isPass) {
        console.log(
          `  ${colors.green}\u2714 [${index}/${total}] ${colors.bold}${pkgName}${colors.reset} ${colors.gray}(Cypress ${pkgVersion})${colors.reset} ` +
          `${colors.green}${colors.bold}PASSED${colors.reset} ` +
          `${colors.dim}[${parsed.totalTests || 'all'} tests | ${formatSeconds(durationSec)}]${colors.reset}`
        );
      } else {
        console.log(
          `  ${colors.red}\u2716 [${index}/${total}] ${colors.bold}${pkgName}${colors.reset} ${colors.gray}(Cypress ${pkgVersion})${colors.reset} ` +
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
        console.log(`    ${colors.gray}Log details:${colors.reset} ${colors.cyan}logs/${pkgName}.log${colors.reset}`);
      }

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

// Print dashboard table
function printSummaryTable(results, totalDurationSec) {
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

  for (const r of results) {
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
    `\u2502 ${`${results.length} versions`.padEnd(colWidths.version)} ` +
    `\u2502 ${totalStatus.padEnd(colWidths.status + 9)} ` +
    `\u2502 ${String(sumTests).padStart(colWidths.tests)} ` +
    `\u2502 ${colors.green}${String(sumPassed).padStart(colWidths.passed)}${colors.reset} ` +
    `\u2502 ${(sumFailed > 0 ? colors.red : colors.gray)}${String(sumFailed).padStart(colWidths.failed)}${colors.reset} ` +
    `\u2502 ${formatSeconds(totalDurationSec).padStart(colWidths.time)} \u2502` +
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

  console.log('\n' + colors.bold + 'Summary Metrics:' + colors.reset);
  console.log(`  \u2022 ${colors.cyan}Packages Tested:${colors.reset}   ${results.length}`);
  console.log(`  \u2022 ${colors.green}Total Passed:${colors.reset}      ${sumPassed}`);
  console.log(`  \u2022 ${(sumFailed > 0 ? colors.red : colors.gray)}Total Failed:${colors.reset}      ${sumFailed}`);
  console.log(`  \u2022 ${colors.yellow}Total Execution Time:${colors.reset} ${formatSeconds(totalDurationSec)}`);
  console.log(`  \u2022 ${colors.blue}Execution Logs:${colors.reset}        logs/`);
  console.log(colors.cyan + colors.bold + '\u2550'.repeat(82) + colors.reset + '\n');
}

// Main execution flow
async function main() {
  console.log('\n' + colors.cyan + colors.bold + '\u2554' + '\u2550'.repeat(70) + '\u2557' + colors.reset);
  console.log(colors.cyan + colors.bold + '\u2551' + colors.reset + colors.bold + '   \uD83D\uDE80 Cypress Monorepo Multi-Version Test Runner (v9 - v16)           ' + colors.cyan + colors.bold + '\u2551' + colors.reset);
  console.log(colors.cyan + colors.bold + '\u255A' + '\u2550'.repeat(70) + '\u255D' + colors.reset);
  console.log(`  ${colors.dim}Target Site:${colors.reset}     https://demo.automationtesting.in`);
  console.log(`  ${colors.dim}Workspace Queue:${colors.reset} ${targetPackages.length} packages (${targetPackages.join(', ')})`);
  console.log(`  ${colors.dim}Logs Directory:${colors.reset}  ${logsDir}`);
  console.log(colors.gray + '\u2500'.repeat(72) + colors.reset + '\n');

  const results = [];
  const suiteStartTime = Date.now();

  for (let i = 0; i < targetPackages.length; i++) {
    const pkgName = targetPackages[i];
    const res = await runPackage(pkgName, i + 1, targetPackages.length);
    results.push(res);

    if (shouldBail && !res.isPass) {
      console.log(`\n${colors.red}${colors.bold}[BAIL] Stopping test execution due to failure in ${pkgName}.${colors.reset}\n`);
      break;
    }
  }

  const totalDurationSec = (Date.now() - suiteStartTime) / 1000;
  printSummaryTable(results, totalDurationSec);

  const hasFailures = results.some(r => !r.isPass);
  process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
  console.error(`${colors.red}Fatal Runner Error:${colors.reset}`, err);
  process.exit(1);
});
