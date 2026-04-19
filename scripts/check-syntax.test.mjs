import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  listSyntaxCheckTargets,
  runSyntaxCheck
} from "./check-syntax.mjs";

test("listSyntaxCheckTargets returns sorted .mjs files from the configured directories", async () => {
  const repoRoot = path.join("C:", "repo");
  const pluginScriptsDir = path.join(repoRoot, "plugins", "whatsapp-relay", "scripts");
  const rootScriptsDir = path.join(repoRoot, "scripts");
  const readCalls = [];
  const readdir = async (directoryPath) => {
    readCalls.push(directoryPath);
    if (directoryPath === pluginScriptsDir) {
      return [
        { name: "whatsapp-auth.mjs", isFile: () => true },
        { name: "voice-replier.test.mjs", isFile: () => true },
        { name: "chatterbox_tts.py", isFile: () => true },
        { name: "nested", isFile: () => false }
      ];
    }

    return [
      { name: "release.mjs", isFile: () => true },
      { name: "release.test.mjs", isFile: () => true },
      { name: "README.md", isFile: () => true }
    ];
  };

  const targets = await listSyntaxCheckTargets(repoRoot, { readdir });

  assert.deepEqual(readCalls, [
    pluginScriptsDir,
    rootScriptsDir
  ]);
  assert.deepEqual(targets, [
    path.join(pluginScriptsDir, "voice-replier.test.mjs"),
    path.join(pluginScriptsDir, "whatsapp-auth.mjs"),
    path.join(rootScriptsDir, "release.mjs"),
    path.join(rootScriptsDir, "release.test.mjs")
  ]);
});

test("runSyntaxCheck shells out to the current node executable with expanded targets", async () => {
  const repoRoot = path.join("C:", "repo");
  const pluginScriptsDir = path.join(repoRoot, "plugins", "whatsapp-relay", "scripts");
  const rootScriptsDir = path.join(repoRoot, "scripts");
  const spawnCalls = [];
  const spawnSync = (command, args, options) => {
    spawnCalls.push({ command, args, options });
    return { status: 0 };
  };

  const status = await runSyntaxCheck({
    repoRoot,
    nodePath: "/usr/bin/node",
    readdir: async (directoryPath) => {
      if (directoryPath === pluginScriptsDir) {
        return [{ name: "runtime.mjs", isFile: () => true }];
      }

      return [{ name: "release.mjs", isFile: () => true }];
    },
    spawnSync
  });

  assert.equal(status, 0);
  assert.deepEqual(spawnCalls, [{
    command: "/usr/bin/node",
    args: [
      "--check",
      path.join(pluginScriptsDir, "runtime.mjs"),
      path.join(rootScriptsDir, "release.mjs")
    ],
    options: {
      cwd: repoRoot,
      stdio: "inherit"
    }
  }]);
});
