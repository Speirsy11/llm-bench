#!/usr/bin/env node
import { createInterface } from "node:readline";

import { runPluginSession } from "./plugin";

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

await runPluginSession(input, (line) => {
  process.stdout.write(line);
});
