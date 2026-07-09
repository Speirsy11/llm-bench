import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import type {
  AgenticTask,
  MetricDefinition,
  MetricObservation,
  TaskLanguage,
} from "@llm-bench/contracts";
import type {
  HiddenTest,
  RepairScenario,
  Workspace,
} from "@llm-bench/runner-engine";
import { AgenticBenchmark } from "@llm-bench/contracts";

/**
 * Deterministic repository-repair corpus. Each fixture writes a small broken
 * project plus a visible specification, then hidden tests are withheld until
 * grading and execute the repaired module directly.
 */

export const REPOSITORY_REPAIR_BENCHMARK_VERSION = "1.0.0";
export const DEFAULT_FIXTURE_ID = "typescript-clamp-bounds";

export type RepairFixtureId =
  | "typescript-clamp-bounds"
  | "typescript-async-cache"
  | "typescript-state-reducer"
  | "python-parse-duration"
  | "python-api-boundary"
  | "python-resource-cleanup";

export interface RuntimeRequirement {
  kind: "node" | "python";
  version: string;
  offline: true;
}

export interface RepairFixture {
  id: RepairFixtureId;
  title: string;
  language: TaskLanguage;
  modulePath: string;
  visibleSpec: string;
  visibleTestPath: string;
  visibleTestSource: string;
  brokenSource: string;
  knownPatch: string;
  incompletePatch: string;
  constraints: string[];
  runtime: RuntimeRequirement;
  contentHash: string;
  graderHash: string;
}

export interface RepairCorpusSample {
  fixtureId: RepairFixtureId;
  fixtureContentHash: string;
  graderHash: string;
  grade: { passed: number; total: number } | null;
}

interface RepairFixtureInternal extends RepairFixture {
  hiddenTests: HiddenTest[];
}

/** Workspace-relative path of the original TypeScript module under repair. */
export const MODULE_PATH = "src/clamp.cjs";

/** Broken implementation: the bounds are ignored entirely. */
export const BROKEN_SOURCE = `function clamp(value, lower, upper) {
  // BUG: returns the input unchanged, ignoring the bounds.
  return value;
}
module.exports = { clamp };
`;

/** Known good patch: clamps to both the lower and upper bound. */
export const KNOWN_PATCH = `function clamp(value, lower, upper) {
  if (value < lower) return lower;
  if (value > upper) return upper;
  return value;
}
module.exports = { clamp };
`;

/** Incomplete patch: clamps the lower bound but forgets the upper bound. */
export const PARTIAL_PATCH = `function clamp(value, lower, upper) {
  if (value < lower) return lower;
  return value;
}
module.exports = { clamp };
`;

/** Visible specification the agent sees while attempting the original repair. */
export const VISIBLE_SPEC = `clamp(value, lower, upper) must return:
- lower when value < lower
- upper when value > upper
- value otherwise
`;

type Clamp = (value: number, lower: number, upper: number) => number;
type LoadOnce = (
  key: string,
  loader: (key: string) => Promise<string>,
  cache?: Map<string, unknown>,
) => Promise<string>;
interface Cart {
  items: { sku: string; quantity: number }[];
  currency?: string;
}
type CartEvent =
  | { type: "add"; sku: string; quantity: number }
  | { type: "remove"; sku: string }
  | { type: "noop" };
type ReduceCart = (cart: Cart, event: CartEvent) => Cart;

const requireModule = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

/**
 * Loads the repaired module to exercise its real behaviour.
 *
 * SECURITY: this runs in-process. That is acceptable here because the only code
 * written into the workspace is this package's own first-party fixture source
 * (see the harnesses in `./harness`) — no model-authored or otherwise untrusted
 * code is executed in this epic, and there are no real model calls yet. When a
 * real harness later produces patches from model output, that code MUST run
 * behind the runner's process/sandbox boundary (EPIC-05+) rather than being
 * required into the engine process.
 */
async function loadClamp(workspace: Workspace): Promise<Clamp> {
  const modulePath = await workspace.resolve(MODULE_PATH);
  const loaded = requireModule(modulePath) as { clamp: Clamp };
  return loaded.clamp;
}

async function loadAsyncCache(workspace: Workspace): Promise<LoadOnce> {
  const modulePath = await workspace.resolve("src/cache.cjs");
  const loaded = requireModule(modulePath) as { loadOnce: LoadOnce };
  return loaded.loadOnce;
}

async function loadCartReducer(workspace: Workspace): Promise<ReduceCart> {
  const modulePath = await workspace.resolve("src/cart.cjs");
  const loaded = requireModule(modulePath) as { reduceCart: ReduceCart };
  return loaded.reduceCart;
}

async function runPython(
  workspace: Workspace,
  script: string,
): Promise<boolean> {
  const root = await workspace.resolve(".");
  await execFileAsync(
    process.env.LLMBENCH_PYTHON ?? "python3",
    ["-c", script],
    {
      cwd: root,
      env: { ...process.env, PYTHONPATH: root },
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    },
  );
  return true;
}

const CLAMP_HIDDEN_TESTS: HiddenTest[] = [
  {
    id: "in-range",
    run: async (workspace) => (await loadClamp(workspace))(5, 0, 10) === 5,
  },
  {
    id: "below-lower",
    run: async (workspace) => (await loadClamp(workspace))(-3, 0, 10) === 0,
  },
  {
    id: "above-upper",
    run: async (workspace) => (await loadClamp(workspace))(15, 0, 10) === 10,
  },
];

const ASYNC_CACHE_HIDDEN_TESTS: HiddenTest[] = [
  {
    id: "sequential-hit-reuses-loader",
    run: async (workspace) => {
      const loadOnce = await loadAsyncCache(workspace);
      const cache = new Map<string, unknown>();
      let calls = 0;
      const first = await loadOnce(
        "profile",
        () => {
          calls += 1;
          return Promise.resolve("ada");
        },
        cache,
      );
      const second = await loadOnce(
        "profile",
        () => {
          calls += 1;
          return Promise.resolve("grace");
        },
        cache,
      );
      return first === "ada" && second === "ada" && calls === 1;
    },
  },
  {
    id: "concurrent-hit-shares-loader",
    run: async (workspace) => {
      const loadOnce = await loadAsyncCache(workspace);
      const cache = new Map<string, unknown>();
      let calls = 0;
      const loader = async (): Promise<string> => {
        calls += 1;
        await Promise.resolve();
        return "shared";
      };
      const [first, second] = await Promise.all([
        loadOnce("settings", loader, cache),
        loadOnce("settings", loader, cache),
      ]);
      return first === "shared" && second === "shared" && calls === 1;
    },
  },
  {
    id: "failed-loads-are-not-cached",
    run: async (workspace) => {
      const loadOnce = await loadAsyncCache(workspace);
      const cache = new Map<string, unknown>();
      let calls = 0;
      const loader = (): Promise<string> => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error("temporary failure"));
        }
        return Promise.resolve("recovered");
      };
      await loadOnce("token", loader, cache).catch(() => undefined);
      const recovered = await loadOnce("token", loader, cache);
      return recovered === "recovered" && calls === 2;
    },
  },
];

const STATE_REDUCER_HIDDEN_TESTS: HiddenTest[] = [
  {
    id: "add-event-is-immutable",
    run: async (workspace) => {
      const reduceCart = await loadCartReducer(workspace);
      const original: Cart = {
        currency: "GBP",
        items: [{ sku: "book", quantity: 1 }],
      };
      const result = reduceCart(original, {
        type: "add",
        sku: "pen",
        quantity: 2,
      });
      return (
        result !== original &&
        result.items !== original.items &&
        original.items.length === 1 &&
        result.items.length === 2 &&
        result.items[1]?.sku === "pen"
      );
    },
  },
  {
    id: "remove-event-is-immutable",
    run: async (workspace) => {
      const reduceCart = await loadCartReducer(workspace);
      const original: Cart = {
        items: [
          { sku: "tea", quantity: 1 },
          { sku: "mug", quantity: 1 },
        ],
      };
      const result = reduceCart(original, { type: "remove", sku: "tea" });
      return (
        result !== original &&
        result.items !== original.items &&
        original.items.length === 2 &&
        result.items.length === 1 &&
        result.items[0]?.sku === "mug"
      );
    },
  },
  {
    id: "unknown-event-clones-state",
    run: async (workspace) => {
      const reduceCart = await loadCartReducer(workspace);
      const original: Cart = {
        currency: "USD",
        items: [{ sku: "notebook", quantity: 3 }],
      };
      const result = reduceCart(original, { type: "noop" });
      return (
        result !== original &&
        result.items !== original.items &&
        JSON.stringify(result) === JSON.stringify(original)
      );
    },
  },
];

const DURATION_HIDDEN_TESTS: HiddenTest[] = [
  {
    id: "milliseconds-and-bare-values",
    run: (workspace) =>
      runPython(
        workspace,
        `from src.duration import parse_duration
assert parse_duration("150ms") == 150
assert parse_duration("42") == 42
`,
      ),
  },
  {
    id: "seconds-convert-to-ms",
    run: (workspace) =>
      runPython(
        workspace,
        `from src.duration import parse_duration
assert parse_duration("2s") == 2000
assert parse_duration("0.25s") == 250
`,
      ),
  },
  {
    id: "minutes-and-decimals-convert-to-ms",
    run: (workspace) =>
      runPython(
        workspace,
        `from src.duration import parse_duration
assert parse_duration("2m") == 120000
assert parse_duration("1.5m") == 90000
`,
      ),
  },
];

const API_BOUNDARY_HIDDEN_TESTS: HiddenTest[] = [
  {
    id: "only-public-fields-cross-boundary",
    run: (workspace) =>
      runPython(
        workspace,
        `from src.profile_dto import public_profile
user = {
    "id": 42,
    "username": "ada",
    "display_name": "Ada",
    "email": "ada@example.test",
    "password_hash": "secret",
    "api_token": "tok_live",
    "internal_notes": "vip",
}
profile = public_profile(user)
assert profile == {
    "id": "42",
    "display_name": "Ada",
    "email": "ada@example.test",
}
`,
      ),
  },
  {
    id: "display-name-falls-back-to-username",
    run: (workspace) =>
      runPython(
        workspace,
        `from src.profile_dto import public_profile
profile = public_profile({
    "id": "u-1",
    "username": "grace",
    "display_name": "",
    "email": "grace@example.test",
    "api_token": "tok_live",
})
assert profile == {
    "id": "u-1",
    "display_name": "grace",
    "email": "grace@example.test",
}
`,
      ),
  },
  {
    id: "input-user-is-not-mutated",
    run: (workspace) =>
      runPython(
        workspace,
        `from copy import deepcopy
from src.profile_dto import public_profile
user = {
    "id": 7,
    "username": "lin",
    "display_name": "Lin",
    "email": "lin@example.test",
    "password_hash": "secret",
}
before = deepcopy(user)
public_profile(user)
assert user == before
`,
      ),
  },
];

const RESOURCE_CLEANUP_HIDDEN_TESTS: HiddenTest[] = [
  {
    id: "copies-trimmed-lines",
    run: (workspace) =>
      runPython(
        workspace,
        `from pathlib import Path
from src.report_copy import copy_report
Path("input.txt").write_text("alpha  \\nbeta\\n", encoding="utf-8")
copy_report("input.txt", "output.txt")
assert Path("output.txt").read_text(encoding="utf-8") == "alpha\\nbeta\\n"
`,
      ),
  },
  {
    id: "closes-files-after-success",
    run: (workspace) =>
      runPython(
        workspace,
        `import builtins
from src.report_copy import copy_report

opened = []

class Reader:
    def __init__(self):
        self.closed = False
    def __iter__(self):
        return iter(["alpha  \\n"])
    def close(self):
        self.closed = True
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        self.close()

class Writer:
    def __init__(self):
        self.closed = False
        self.buffer = []
    def write(self, text):
        self.buffer.append(text)
        return len(text)
    def close(self):
        self.closed = True
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        self.close()

def fake_open(path, mode="r", *args, **kwargs):
    handle = Writer() if "w" in mode else Reader()
    opened.append(handle)
    return handle

builtins.open = fake_open
copy_report("source.txt", "dest.txt")
assert [type(handle).__name__ for handle in opened] == ["Reader", "Writer"]
assert opened[1].buffer == ["alpha\\n"]
assert all(handle.closed for handle in opened)
`,
      ),
  },
  {
    id: "closes-files-when-write-fails",
    run: (workspace) =>
      runPython(
        workspace,
        `import builtins
from src.report_copy import copy_report

opened = []

class Reader:
    def __init__(self):
        self.closed = False
    def __iter__(self):
        return iter(["alpha\\n"])
    def close(self):
        self.closed = True
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        self.close()

class FailingWriter:
    def __init__(self):
        self.closed = False
    def write(self, text):
        raise RuntimeError("disk full")
    def close(self):
        self.closed = True
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        self.close()

def fake_open(path, mode="r", *args, **kwargs):
    handle = FailingWriter() if "w" in mode else Reader()
    opened.append(handle)
    return handle

builtins.open = fake_open
try:
    copy_report("source.txt", "dest.txt")
except RuntimeError as error:
    assert str(error) == "disk full"
else:
    raise AssertionError("copy_report should propagate the write failure")
assert [type(handle).__name__ for handle in opened] == ["Reader", "FailingWriter"]
assert all(handle.closed for handle in opened)
`,
      ),
  },
];

const NODE_RUNTIME: RuntimeRequirement = {
  kind: "node",
  version: ">=22",
  offline: true,
};

const PYTHON_RUNTIME: RuntimeRequirement = {
  kind: "python",
  version: ">=3.11",
  offline: true,
};

const REPOSITORY_REPAIR_METRICS: MetricDefinition[] = [
  {
    id: "hidden_test_pass_ratio",
    label: "Hidden test pass ratio",
    kind: "ratio",
    unit: "ratio",
    direction: "higher_is_better",
  },
  {
    id: "sample_count",
    label: "Sample count",
    kind: "count",
    unit: "samples",
    direction: "higher_is_better",
  },
  {
    id: "typescript_hidden_test_pass_ratio",
    label: "TypeScript hidden test pass ratio",
    kind: "ratio",
    unit: "ratio",
    direction: "higher_is_better",
  },
  {
    id: "typescript_sample_count",
    label: "TypeScript sample count",
    kind: "count",
    unit: "samples",
    direction: "higher_is_better",
  },
  {
    id: "python_hidden_test_pass_ratio",
    label: "Python hidden test pass ratio",
    kind: "ratio",
    unit: "ratio",
    direction: "higher_is_better",
  },
  {
    id: "python_sample_count",
    label: "Python sample count",
    kind: "count",
    unit: "samples",
    direction: "higher_is_better",
  },
  {
    id: "duration_ms",
    label: "Duration",
    kind: "duration",
    unit: "ms",
    direction: "lower_is_better",
  },
];

const FIXTURE_INPUTS = [
  {
    id: "typescript-clamp-bounds",
    title: "Clamp numeric values to both bounds",
    language: "typescript",
    modulePath: MODULE_PATH,
    visibleSpec: VISIBLE_SPEC,
    visibleTestPath: "tests/visible.test.cjs",
    visibleTestSource: `const assert = require("node:assert/strict");
const { clamp } = require("../src/clamp.cjs");

assert.equal(clamp(5, 0, 10), 5);
assert.equal(clamp(-3, 0, 10), 0);
`,
    brokenSource: BROKEN_SOURCE,
    knownPatch: KNOWN_PATCH,
    incompletePatch: PARTIAL_PATCH,
    constraints: [
      "Do not modify the hidden tests.",
      "Keep the clamp signature.",
    ],
    runtime: NODE_RUNTIME,
    hiddenTests: CLAMP_HIDDEN_TESTS,
  },
  {
    id: "typescript-async-cache",
    title: "Cache asynchronous loader results by key",
    language: "typescript",
    modulePath: "src/cache.cjs",
    visibleSpec: `loadOnce(key, loader, cache) must:
- call loader only when the key is missing
- return the cached value for repeated keys
- share one in-flight load for concurrent callers
`,
    visibleTestPath: "tests/visible.test.cjs",
    visibleTestSource: `const assert = require("node:assert/strict");
const { loadOnce } = require("../src/cache.cjs");

(async () => {
  const cache = new Map();
  let calls = 0;
  const first = await loadOnce("user", () => {
    calls += 1;
    return Promise.resolve("ada");
  }, cache);
  const second = await loadOnce("user", () => {
    calls += 1;
    return Promise.resolve("grace");
  }, cache);
  assert.equal(first, "ada");
  assert.equal(second, "ada");
  assert.equal(calls, 1);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`,
    brokenSource: `async function loadOnce(key, loader, cache = new Map()) {
  if (cache.has(key)) return cache.get(key);
  const value = await loader(key);
  // BUG: the loaded value is returned but never cached.
  return value;
}
module.exports = { loadOnce };
`,
    knownPatch: `async function loadOnce(key, loader, cache = new Map()) {
  if (cache.has(key)) return cache.get(key);
  const pending = Promise.resolve().then(() => loader(key));
  cache.set(key, pending);
  try {
    const value = await pending;
    cache.set(key, value);
    return value;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}
module.exports = { loadOnce };
`,
    incompletePatch: `async function loadOnce(key, loader, cache = new Map()) {
  if (cache.has(key)) return cache.get(key);
  const value = await loader(key);
  cache.set(key, value);
  return value;
}
module.exports = { loadOnce };
`,
    constraints: [
      "Keep the loadOnce(key, loader, cache) signature.",
      "Do not add external dependencies.",
    ],
    runtime: NODE_RUNTIME,
    hiddenTests: ASYNC_CACHE_HIDDEN_TESTS,
  },
  {
    id: "typescript-state-reducer",
    title: "Apply cart events without mutating state",
    language: "typescript",
    modulePath: "src/cart.cjs",
    visibleSpec: `reduceCart(cart, event) must:
- return a new cart object for every event
- add { sku, quantity } items for add events
- remove all items with a matching sku for remove events
`,
    visibleTestPath: "tests/visible.test.cjs",
    visibleTestSource: `const assert = require("node:assert/strict");
const { reduceCart } = require("../src/cart.cjs");

const cart = { items: [] };
const next = reduceCart(cart, { type: "add", sku: "pen", quantity: 2 });

assert.deepEqual(next.items, [{ sku: "pen", quantity: 2 }]);
`,
    brokenSource: `function reduceCart(cart, event) {
  if (event.type === "add") {
    cart.items.push({ sku: event.sku, quantity: event.quantity });
    return cart;
  }
  if (event.type === "remove") {
    cart.items = cart.items.filter((item) => item.sku !== event.sku);
    return cart;
  }
  return cart;
}
module.exports = { reduceCart };
`,
    knownPatch: `function reduceCart(cart, event) {
  if (event.type === "add") {
    return {
      ...cart,
      items: [...cart.items, { sku: event.sku, quantity: event.quantity }],
    };
  }
  if (event.type === "remove") {
    return {
      ...cart,
      items: cart.items.filter((item) => item.sku !== event.sku),
    };
  }
  return { ...cart, items: [...cart.items] };
}
module.exports = { reduceCart };
`,
    incompletePatch: `function reduceCart(cart, event) {
  if (event.type === "add") {
    return {
      ...cart,
      items: [...cart.items, { sku: event.sku, quantity: event.quantity }],
    };
  }
  if (event.type === "remove") {
    cart.items = cart.items.filter((item) => item.sku !== event.sku);
    return cart;
  }
  return cart;
}
module.exports = { reduceCart };
`,
    constraints: [
      "Keep the reduceCart(cart, event) signature.",
      "Do not mutate the cart passed by the caller.",
    ],
    runtime: NODE_RUNTIME,
    hiddenTests: STATE_REDUCER_HIDDEN_TESTS,
  },
  {
    id: "python-parse-duration",
    title: "Parse duration strings into milliseconds",
    language: "python",
    modulePath: "src/duration.py",
    visibleSpec: `parse_duration(text) must return milliseconds for:
- bare millisecond numbers
- values ending in ms
- values ending in s
- values ending in m
`,
    visibleTestPath: "tests/test_visible.py",
    visibleTestSource: `from src.duration import parse_duration

assert parse_duration("150ms") == 150
assert parse_duration("2s") == 2000
`,
    brokenSource: `def parse_duration(text):
    if text.endswith("ms"):
        return int(text[:-2])
    if text.endswith("s"):
        return int(text[:-1])
    return int(text)
`,
    knownPatch: `def parse_duration(text):
    value = str(text).strip().lower()
    if value.endswith("ms"):
        return int(float(value[:-2]))
    if value.endswith("s"):
        return int(float(value[:-1]) * 1000)
    if value.endswith("m"):
        return int(float(value[:-1]) * 60_000)
    return int(float(value))
`,
    incompletePatch: `def parse_duration(text):
    value = str(text).strip().lower()
    if value.endswith("ms"):
        return int(float(value[:-2]))
    if value.endswith("s"):
        return int(float(value[:-1]) * 1000)
    return int(float(value))
`,
    constraints: [
      "Keep the parse_duration(text) signature.",
      "Use only the Python standard library.",
    ],
    runtime: PYTHON_RUNTIME,
    hiddenTests: DURATION_HIDDEN_TESTS,
  },
  {
    id: "python-api-boundary",
    title: "Return a sanitized public profile DTO",
    language: "python",
    modulePath: "src/profile_dto.py",
    visibleSpec: `public_profile(user) must:
- return only id, display_name, and email
- use username when display_name is missing
- never expose password_hash, api_token, or internal_notes
`,
    visibleTestPath: "tests/test_visible.py",
    visibleTestSource: `from src.profile_dto import public_profile

profile = public_profile({
    "id": 42,
    "username": "ada",
    "display_name": "Ada",
    "email": "ada@example.test",
    "password_hash": "secret",
})

assert "password_hash" not in profile
`,
    brokenSource: `def public_profile(user):
    # BUG: leaks internal fields across the API boundary.
    return dict(user)
`,
    knownPatch: `def public_profile(user):
    return {
        "id": str(user["id"]),
        "display_name": user.get("display_name") or user.get("username"),
        "email": user.get("email"),
    }
`,
    incompletePatch: `def public_profile(user):
    profile = dict(user)
    profile.pop("password_hash", None)
    return profile
`,
    constraints: [
      "Keep the public_profile(user) signature.",
      "Do not mutate the input user mapping.",
    ],
    runtime: PYTHON_RUNTIME,
    hiddenTests: API_BOUNDARY_HIDDEN_TESTS,
  },
  {
    id: "python-resource-cleanup",
    title: "Copy report lines while closing file handles",
    language: "python",
    modulePath: "src/report_copy.py",
    visibleSpec: `copy_report(source_path, destination_path) must:
- copy every line without trailing spaces
- create newline-terminated output
- close both files, even when writing fails
`,
    visibleTestPath: "tests/test_visible.py",
    visibleTestSource: `from pathlib import Path
from src.report_copy import copy_report

Path("input.txt").write_text("alpha  \\nbeta\\n", encoding="utf-8")
copy_report("input.txt", "output.txt")

assert Path("output.txt").read_text(encoding="utf-8") == "alpha\\nbeta\\n"
`,
    brokenSource: `def copy_report(source_path, destination_path):
    source = open(source_path, encoding="utf-8")
    destination = open(destination_path, "w", encoding="utf-8")
    for line in source:
        destination.write(line.rstrip() + "\\n")
`,
    knownPatch: `def copy_report(source_path, destination_path):
    with open(source_path, encoding="utf-8") as source:
        with open(destination_path, "w", encoding="utf-8") as destination:
            for line in source:
                destination.write(line.rstrip() + "\\n")
`,
    incompletePatch: `def copy_report(source_path, destination_path):
    source = open(source_path, encoding="utf-8")
    destination = open(destination_path, "w", encoding="utf-8")
    try:
        for line in source:
            destination.write(line.rstrip() + "\\n")
    finally:
        source.close()
`,
    constraints: [
      "Keep the copy_report(source_path, destination_path) signature.",
      "Use context managers or equivalent cleanup for every opened file.",
    ],
    runtime: PYTHON_RUNTIME,
    hiddenTests: RESOURCE_CLEANUP_HIDDEN_TESTS,
  },
] as const satisfies readonly Omit<
  RepairFixtureInternal,
  "contentHash" | "graderHash"
>[];

const FIXTURES: RepairFixtureInternal[] = FIXTURE_INPUTS.map((fixture) => ({
  ...fixture,
  contentHash: hashFixture(fixture),
  graderHash: hashGrader(fixture.hiddenTests),
}));

export class RepositoryRepairBenchmark extends AgenticBenchmark {
  tasks(): AgenticTask[] {
    return FIXTURES.map((fixture) => taskFor(fixture));
  }
}

export class ClampRepairBenchmark extends RepositoryRepairBenchmark {}

function repositoryRepairBenchmark(): RepositoryRepairBenchmark {
  return new RepositoryRepairBenchmark({
    id: "repository-repair",
    version: REPOSITORY_REPAIR_BENCHMARK_VERSION,
    kind: "agentic",
    primaryMetricId: "hidden_test_pass_ratio",
    metrics: REPOSITORY_REPAIR_METRICS,
    requiredCapabilities: ["workspaces", "files"],
  });
}

/** All repository-repair fixture manifests in deterministic execution order. */
export function repairFixtures(): RepairFixture[] {
  return FIXTURES.map(({ hiddenTests: _hiddenTests, ...fixture }) => ({
    ...fixture,
    constraints: [...fixture.constraints],
  }));
}

/** Returns a single repair fixture manifest by id. */
export function repairFixture(id: RepairFixtureId): RepairFixture {
  const fixture = findFixture(id);
  const { hiddenTests: _hiddenTests, ...publicFixture } = fixture;
  return { ...publicFixture, constraints: [...publicFixture.constraints] };
}

/** The runnable repair scenario consumed by the local execution engine. */
export function repairScenario(
  fixtureId: RepairFixtureId = DEFAULT_FIXTURE_ID,
): RepairScenario {
  const fixture = findFixture(fixtureId);
  return {
    benchmark: repositoryRepairBenchmark(),
    task: taskFor(fixture),
    prepare: async (workspace) => {
      await workspace.writeFile(fixture.modulePath, fixture.brokenSource);
      await workspace.writeFile("SPEC.md", fixture.visibleSpec);
      await workspace.writeFile(
        fixture.visibleTestPath,
        fixture.visibleTestSource,
      );
    },
    hiddenTests: fixture.hiddenTests,
  };
}

/** Builds a result-level corpus sample stamped with fixture and grader hashes. */
export function repairCorpusSample(
  fixtureId: RepairFixtureId,
  grade: RepairCorpusSample["grade"],
): RepairCorpusSample {
  const fixture = findFixture(fixtureId);
  return {
    fixtureId,
    fixtureContentHash: fixture.contentHash,
    graderHash: fixture.graderHash,
    grade,
  };
}

/** Summarizes fixture-level grades into corpus and per-language observations. */
export function summarizeRepairCorpus(
  samples: readonly RepairCorpusSample[],
): MetricObservation[] {
  const overall = aggregate(samples);
  const typescript = aggregate(
    samples.filter(
      (sample) => findFixture(sample.fixtureId).language === "typescript",
    ),
  );
  const python = aggregate(
    samples.filter(
      (sample) => findFixture(sample.fixtureId).language === "python",
    ),
  );
  return [
    { metricId: "hidden_test_pass_ratio", value: overall.ratio },
    { metricId: "sample_count", value: samples.length },
    {
      metricId: "typescript_hidden_test_pass_ratio",
      value: typescript.ratio,
    },
    { metricId: "typescript_sample_count", value: typescript.sampleCount },
    { metricId: "python_hidden_test_pass_ratio", value: python.ratio },
    { metricId: "python_sample_count", value: python.sampleCount },
  ];
}

function findFixture(id: RepairFixtureId): RepairFixtureInternal {
  const fixture = FIXTURES.find((candidate) => candidate.id === id);
  if (fixture === undefined) {
    throw new Error(`Unknown repository-repair fixture: ${id}`);
  }
  return fixture;
}

function taskFor(fixture: RepairFixture): AgenticTask {
  return {
    id: fixture.id,
    language: fixture.language,
    constraints: [
      ...fixture.constraints,
      `Runtime requirement: ${fixture.runtime.kind} ${fixture.runtime.version}.`,
      "Offline execution only; do not use the network.",
    ],
    repetitions: 1,
  };
}

function aggregate(samples: readonly RepairCorpusSample[]): {
  ratio: number | null;
  sampleCount: number;
} {
  let passed = 0;
  let total = 0;
  for (const sample of samples) {
    if (sample.grade === null) {
      continue;
    }
    passed += sample.grade.passed;
    total += sample.grade.total;
  }
  return {
    ratio: total === 0 ? null : passed / total,
    sampleCount: samples.length,
  };
}

function hashFixture(
  fixture: Omit<RepairFixtureInternal, "contentHash" | "graderHash">,
): string {
  return createHash("sha256")
    .update(fixture.id)
    .update("\0")
    .update(fixture.language)
    .update("\0")
    .update(fixture.modulePath)
    .update("\0")
    .update(fixture.visibleSpec)
    .update("\0")
    .update(fixture.visibleTestPath)
    .update("\0")
    .update(fixture.visibleTestSource)
    .update("\0")
    .update(fixture.brokenSource)
    .update("\0")
    .update(fixture.knownPatch)
    .digest("hex");
}

function hashGrader(hiddenTests: readonly HiddenTest[]): string {
  const hash = createHash("sha256");
  for (const test of hiddenTests) {
    hash.update(test.id);
    hash.update("\0");
    const run = (test as { readonly run: unknown }).run;
    hash.update(String(run));
    hash.update("\0");
  }
  return hash.digest("hex");
}
