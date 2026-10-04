// Site layer test runner.
//
//   node site/tests/runTests.js
//
// Runs, in order:
//   1. unit tests for the pure helpers
//   2. end-to-end tests that drive the real build and inspect the result
//   3. the original module's own test suite (`tests/testRenderer.js`) to prove
//      the site layer leaves it working
//
// Exits with a non-zero status as soon as anything fails.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { after, describe, test, assert } from "./harness.js";
import { PROJECT_ROOT } from "../paths.js";
import { cleanupFixtureArtifacts } from "./fixtures.js";

// Safety net: an interrupted earlier run must never leave fixture notes behind.
await cleanupFixtureArtifacts();

import "./unitTests.js";
import "./integrationTests.js";

const runCommand = promisify(execFile);

describe("original renderer test suite", () => {
    test("tests/testRenderer.js still passes", async () => {
        const { stdout, stderr } = await runCommand(
            process.execPath,
            [path.join("tests", "testRenderer.js")],
            { cwd: PROJECT_ROOT }
        );

        assert(
            stdout.includes("7 tests passed."),
            `unexpected renderer test output:\n${stdout}\n${stderr}`
        );
    });
});

const { runTests } = await import("./harness.js");

const failureCount = await runTests();

process.exit(failureCount === 0 ? 0 : 1);