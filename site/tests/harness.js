// Minimal zero-dependency test harness for the site layer.
//
// Deliberately not a framework: the site layer is meant to stay dependency-free
// so the published site and the build have nothing to install.

const groups = new Map();

let currentGroup = "general";

function getGroup(groupName) {
    if (!groups.has(groupName)) {
        groups.set(groupName, {
            name: groupName,
            before: [],
            after: [],
            tests: [],
            testFunctions: []
        });
    }

    return groups.get(groupName);
}

/** Group the following test registrations under a name. */
export function describe(groupName, register) {
    const previousGroup = currentGroup;

    currentGroup = groupName;
    register();
    currentGroup = previousGroup;
}

/** Run once before the first test of the current group. */
export function before(setupFunction) {
    getGroup(currentGroup).before.push(setupFunction);
}

/** Run once after the last test of the current group, even when it failed. */
export function after(teardownFunction) {
    getGroup(currentGroup).after.push(teardownFunction);
}

export function test(testName, testFunction) {
    const group = getGroup(currentGroup);

    group.tests.push(testName);
    group.testFunctions.push(testFunction);
}

export class AssertionError extends Error {}

export function assert(condition, message) {
    if (!condition) {
        throw new AssertionError(message || "Assertion failed");
    }
}

export function assertEqual(actualValue, expectedValue, message) {
    if (actualValue !== expectedValue) {
        throw new AssertionError(
            `${message || "Values differ"}\n      expected: ${format(
                expectedValue
            )}\n      actual:   ${format(actualValue)}`
        );
    }
}

export function assertDeepEqual(actualValue, expectedValue, message) {
    const actualJson = JSON.stringify(actualValue);
    const expectedJson = JSON.stringify(expectedValue);

    if (actualJson !== expectedJson) {
        throw new AssertionError(
            `${message || "Structures differ"}\n      expected: ${expectedJson}\n      actual:   ${actualJson}`
        );
    }
}

export function assertIncludes(haystack, needle, message) {
    if (!String(haystack).includes(needle)) {
        throw new AssertionError(
            `${message || "Missing substring"}\n      expected to find: ${needle}\n      in: ${truncate(
                String(haystack)
            )}`
        );
    }
}

export function assertExcludes(haystack, needle, message) {
    if (String(haystack).includes(needle)) {
        throw new AssertionError(
            `${message || "Unexpected substring"}\n      expected NOT to find: ${needle}\n      in: ${truncate(
                String(haystack)
            )}`
        );
    }
}

export function assertThrows(runFunction, message) {
    let didThrow = false;

    try {
        runFunction();
    } catch {
        didThrow = true;
    }

    if (!didThrow) {
        throw new AssertionError(message || "Expected the function to throw");
    }
}

function format(value) {
    return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function truncate(value, maxLength = 400) {
    return value.length > maxLength
        ? `${value.slice(0, maxLength)}…`
        : value;
}

/** Run every registered test and print a summary. Returns the failure count. */
export async function runTests() {
    let passedTests = 0;
    let totalTests = 0;

    const failures = [];

    for (const group of groups.values()) {
        if (group.tests.length === 0) {
            continue;
        }

        totalTests += group.tests.length;

        console.log(`\n▸ ${group.name}`);

        try {
            for (const setupFunction of group.before) {
                await setupFunction();
            }
        } catch (error) {
            failures.push({
                group: group.name,
                name: "(setup)",
                error
            });

            console.log(`  ✗ setup failed — ${error.message}`);

            continue;
        }

        for (let index = 0; index < group.tests.length; index++) {
            const testName = group.tests[index];
            const runTest = group.testFunctions[index];

            try {
                await runTest();

                passedTests++;

                console.log(`  ✓ ${testName}`);
            } catch (error) {
                failures.push({
                    group: group.name,
                    name: testName,
                    error
                });

                console.log(`  ✗ ${testName}`);
            }
        }

        for (const teardownFunction of group.after) {
            try {
                await teardownFunction();
            } catch (error) {
                console.log(`  ✗ teardown failed — ${error.message}`);
            }
        }
    }

    console.log("");

    for (const failure of failures) {
        console.error(
            `✗ [${failure.group}] ${failure.name}\n    ${failure.error.message}`
        );
    }

    if (failures.length > 0) {
        console.error(
            `\n${failures.length} failed, ${passedTests} passed, ${totalTests} total.`
        );

        return failures.length;
    }

    console.log(`✓ ${passedTests} tests passed.`);

    return 0;
}