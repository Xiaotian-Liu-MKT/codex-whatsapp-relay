import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyRunLifecycleEvent,
  buildVoiceReplyTextCompanion,
  buildDangerFullAccessConfirmationMessage,
  formatThreadTimestamp,
  formatProjectRunReplyPrefix,
  buildVoiceReplyPrompt,
  extractVoiceReplyEnvelope,
  extractOneShotVoiceReplyRequest,
  renderThreadListReply,
  WhatsAppControllerBridge,
  parseImplicitProjectCommand,
  parseApprovalTargetPayload,
  parseVoiceReplyCommandPayload,
  normalizeVoiceCommandText,
  parseIncomingCommand,
  planFinalReplyDelivery,
  parseVoiceTranscript,
  requiresTextConfirmationForVoicePrompt,
  resolveProjectSelection,
  resolveRunVoiceReply,
  resolveThreadSelection,
  sanitizeReplyTextForWhatsApp,
  summarizeThreadChoice,
  shouldIgnoreInboundMessage,
  shouldSplitCompoundVoiceControlRequest
} from "./controller-bridge.mjs";
import { normalizePermissionLevel } from "./controller-permissions.mjs";
import { ControllerStateStore } from "./controller-state.mjs";

test("parseIncomingCommand accepts shortcut aliases for admin commands", () => {
  assert.deepEqual(parseIncomingCommand("/h", true), { type: "help" });
  assert.deepEqual(parseIncomingCommand("/st", true), { type: "status", payload: "" });
  assert.deepEqual(parseIncomingCommand("/n review this diff", true), {
    type: "new",
    prompt: "review this diff"
  });
  assert.deepEqual(parseIncomingCommand("/projects", true), { type: "projects" });
  assert.deepEqual(parseIncomingCommand("/project alpha-app", true), {
    type: "project",
    payload: "alpha-app"
  });
  assert.deepEqual(parseIncomingCommand("/project 2", true), {
    type: "project",
    payload: "2"
  });
  assert.deepEqual(parseIncomingCommand("/in alpha-app review this diff", true), {
    type: "projectPrompt",
    payload: "alpha-app review this diff"
  });
  assert.deepEqual(parseIncomingCommand("/btw what time is it?", true), {
    type: "btw",
    prompt: "what time is it?"
  });
  assert.deepEqual(parseIncomingCommand("/ls", true), { type: "sessions", payload: "" });
  assert.deepEqual(parseIncomingCommand("/more alpha-app", true), {
    type: "more",
    payload: "alpha-app"
  });
  assert.deepEqual(parseIncomingCommand("/session 2", true), {
    type: "connect",
    payload: "2"
  });
  assert.deepEqual(parseIncomingCommand("/1", true), {
    type: "connect",
    payload: "1"
  });
  assert.deepEqual(parseIncomingCommand("/p ww", true), {
    type: "permissions",
    payload: "ww"
  });
  assert.deepEqual(parseIncomingCommand("/ro", true), {
    type: "permissions",
    payload: "ro"
  });
  assert.deepEqual(parseIncomingCommand("/ww alpha-app", true), {
    type: "permissions",
    payload: "alpha-app ww"
  });
  assert.deepEqual(parseIncomingCommand("/dfa alpha-app", true), {
    type: "permissions",
    payload: "alpha-app dfa"
  });
  assert.deepEqual(parseIncomingCommand("/dfa 263593", true), {
    type: "permissions",
    payload: "dfa 263593"
  });
  assert.deepEqual(parseIncomingCommand("/dfa alpha-app 263593", true), {
    type: "permissions",
    payload: "alpha-app dfa 263593"
  });
  assert.deepEqual(parseIncomingCommand("/voice on 2x", true), {
    type: "voiceReplySettings",
    payload: "on 2x"
  });
  assert.deepEqual(parseIncomingCommand("/a session", true), {
    type: "approvalDecision",
    decision: "accept",
    payload: "session"
  });
  assert.deepEqual(parseIncomingCommand("/d", true), {
    type: "approvalDecision",
    decision: "decline",
    payload: ""
  });
  assert.deepEqual(parseIncomingCommand("/q", true), {
    type: "approvalDecision",
    decision: "cancel",
    payload: ""
  });
  assert.deepEqual(parseIncomingCommand("/x", true), { type: "stop", payload: "" });
});

test("parseIncomingCommand recognizes the natural-language new project session shortcut", () => {
  assert.deepEqual(
    parseIncomingCommand("start new session in alpha app inside code directory", true),
    {
      type: "newProjectSession",
      target: "alpha app inside code directory"
    }
  );
});

test("shouldIgnoreInboundMessage ignores WhatsApp protocol messages", () => {
  assert.equal(shouldIgnoreInboundMessage("protocolMessage"), true);
  assert.equal(shouldIgnoreInboundMessage("conversation"), false);
  assert.equal(shouldIgnoreInboundMessage("extendedTextMessage"), false);
});

test("planFinalReplyDelivery defers very long replies and keeps continuation state", () => {
  const bodyText = Array.from({ length: 8 }, (_, index) =>
    [`Section ${index + 1}`, "x".repeat(1200)].join("\n")
  ).join("\n\n");

  const planned = planFinalReplyDelivery({
    introText: "Background result from alpha-checkin session 019d39a1 completed.",
    bodyText,
    continuationCommand: "/more alpha-checkin"
  });

  assert.equal(planned.mode, "deferred");
  assert.equal(planned.messages.length, 1);
  assert.ok(planned.pendingLongReply);
  assert.ok(planned.pendingLongReply.parts.length > 3);
  assert.equal(planned.pendingLongReply.nextIndex, 1);
  assert.match(planned.messages[0], /Part 1\//);
  assert.match(planned.messages[0], /Reply \/more alpha-checkin for the next part\./);
});

test("parseApprovalTargetPayload keeps multi-word project targets intact", () => {
  assert.deepEqual(parseApprovalTargetPayload("alpha checkin session", "accept"), {
    decision: "acceptForSession",
    targetToken: "alpha checkin"
  });
  assert.deepEqual(parseApprovalTargetPayload("session beta checkin", "accept"), {
    decision: "acceptForSession",
    targetToken: "beta checkin"
  });
});

test("resolveThreadSelection honors numbered shortcuts from the last listed sessions", () => {
  const threads = [
    {
      id: "thread-current",
      name: "Current",
      preview: "current preview",
      updatedAt: "2026-03-28T08:00:00.000Z"
    },
    {
      id: "thread-other",
      name: "Other",
      preview: "other preview",
      updatedAt: "2026-03-28T09:00:00.000Z"
    }
  ];
  const session = {
    lastThreadChoicesAt: new Date().toISOString(),
    lastThreadChoices: [threads[1], threads[0]]
  };

  assert.equal(resolveThreadSelection(threads, "1", session).match?.id, "thread-other");
  assert.equal(resolveThreadSelection(threads, "2", {}).match?.id, "thread-other");
  assert.equal(resolveThreadSelection(threads, "3", {}).requestedShortcut, 3);
});

test("formatThreadTimestamp renders compact UTC timestamps for same-day and older sessions", () => {
  const now = new Date("2026-04-19T09:30:00.000Z");

  assert.equal(formatThreadTimestamp("2026-04-19T05:36:11.000Z", { now }), "05:36Z");
  assert.equal(
    formatThreadTimestamp(new Date("2026-04-19T05:11:15.000Z").getTime() / 1000, {
      now
    }),
    "05:11Z"
  );
  assert.equal(formatThreadTimestamp("2026-04-17T12:19:09.000Z", { now }), "Apr 17 12:19Z");
});

test("summarizeThreadChoice renders a compact two-line session entry", () => {
  const summary = summarizeThreadChoice(
    {
      id: "019da0499f34abcd",
      name: "WhatsApp: self [home]",
      preview:
        "This preview should stay on one line even when it is much longer than the compact list wants to show inside WhatsApp.",
      updatedAt: "2026-04-19T05:51:46.000Z"
    },
    "019da0499f34abcd",
    3,
    {
      now: new Date("2026-04-19T09:30:00.000Z")
    }
  );

  assert.equal(summary.split("\n").length, 2);
  assert.match(
    summary,
    /^\/3: \[current\] WhatsApp: self \[home\] · 019da049 · 05:51Z$/m
  );
  assert.match(summary, /^-> This preview should stay on one line even when it is much longer than\.\.\.$/m);
});

test("renderThreadListReply keeps /ls output compact and shortcut-first", () => {
  const reply = renderThreadListReply({
    projectAlias: "home",
    currentThreadId: "019da0499f34abcd",
    now: new Date("2026-04-19T09:30:00.000Z"),
    threads: [
      {
        id: "019da0499f34abcd",
        name: "WhatsApp: self [home]",
        preview: "你看一下我电脑上链接 codex 和 whatsapp 的那个工具",
        updatedAt: "2026-04-19T05:51:46.000Z"
      },
      {
        id: "019da42811112222",
        preview: "Short follow-up preview",
        updatedAt: "2026-04-19T05:36:11.000Z"
      }
    ]
  });

  assert.equal(
    reply,
    [
      "Recent Codex sessions for home:",
      "",
      "/1: [current] WhatsApp: self [home] · 019da049 · 05:51Z",
      "-> 你看一下我电脑上链接 codex 和 whatsapp 的那个工具",
      "",
      "/2: 019da428 · 05:36Z",
      "-> Short follow-up preview",
      "",
      "Switch: /1 /2, /session <n>, or /connect <id>.",
      "Project shortcut: /session home <n>."
    ].join("\n")
  );
  assert.equal(reply.includes("name="), false);
  assert.equal(reply.includes("preview="), false);
  assert.equal(reply.includes("updated_at="), false);
});

test("resolveProjectSelection honors numbered configured project shortcuts", () => {
  const projects = [
    { alias: "main", workspace: "/workspace/main" },
    { alias: "alpha-app", workspace: "/workspace/alpha-app" }
  ];

  assert.equal(resolveProjectSelection(projects, "2").match?.alias, "alpha-app");
  assert.equal(resolveProjectSelection(projects, "3").requestedShortcut, 3);
  assert.equal(resolveProjectSelection(projects, "alpha-app").match, null);
});

test("buildDangerFullAccessConfirmationMessage keeps the active-project confirmation short", () => {
  assert.equal(
    buildDangerFullAccessConfirmationMessage({
      projectAlias: "alpha-checkin",
      confirmationCode: "263593",
      activeProjectAlias: "alpha-checkin"
    }),
    [
      "Danger full access for alpha-checkin disables sandboxing and approval prompts.",
      "Reply /dfa 263593 within 1 minute."
    ].join("\n")
  );
});

test("buildDangerFullAccessConfirmationMessage includes the project when confirming another project", () => {
  assert.equal(
    buildDangerFullAccessConfirmationMessage({
      projectAlias: "alpha-checkin",
      confirmationCode: "263593",
      activeProjectAlias: "codex-whatsapp"
    }),
    [
      "Danger full access for alpha-checkin disables sandboxing and approval prompts.",
      "Reply /dfa alpha-checkin 263593 within 1 minute."
    ].join("\n")
  );
});

test("requiresTextConfirmationForVoicePrompt flags high-impact repo actions", () => {
  assert.equal(requiresTextConfirmationForVoicePrompt("merge PR 49 to main"), true);
  assert.equal(
    requiresTextConfirmationForVoicePrompt("release this version after tagging it"),
    true
  );
  assert.equal(
    requiresTextConfirmationForVoicePrompt("delete the current branch after the release"),
    true
  );
  assert.equal(requiresTextConfirmationForVoicePrompt("review PR 49 for regressions"), false);
  assert.equal(requiresTextConfirmationForVoicePrompt("explain the merge strategy"), false);
  assert.equal(requiresTextConfirmationForVoicePrompt("review the release notes"), false);
  assert.equal(requiresTextConfirmationForVoicePrompt("delete button is broken"), false);
});

test("shouldSplitCompoundVoiceControlRequest catches project-switch instructions chained with another action", () => {
  assert.equal(
    shouldSplitCompoundVoiceControlRequest(
      "switch to kiosk project and then review PR 48"
    ),
    true
  );
  assert.equal(
    shouldSplitCompoundVoiceControlRequest(
      "review PR 49 and check for regressions"
    ),
    false
  );
});

test("formatProjectRunReplyPrefix marks background completions clearly", () => {
  assert.equal(
    formatProjectRunReplyPrefix({
      projectAlias: "alpha-checkin",
      threadId: "019d39a1-9e5b-7bc2-b6e6-36f74d0c079d",
      activeProjectAlias: "beta-checkin"
    }),
    [
      "Background result from alpha-checkin session 019d39a1 completed.",
      "You are currently in beta-checkin."
    ].join("\n")
  );
});

test("applyRunLifecycleEvent tracks live progress and approvals for an active run", () => {
  const activeRun = {
    status: "starting",
    threadId: null,
    progressPhase: null,
    progressPreview: null,
    lastEventAt: null,
    lastProgressAt: null
  };

  applyRunLifecycleEvent(
    activeRun,
    {
      type: "turnStarted",
      threadId: "thread-backend"
    },
    "2026-03-30T10:00:00.000Z"
  );
  assert.equal(activeRun.status, "running");
  assert.equal(activeRun.threadId, "thread-backend");

  applyRunLifecycleEvent(
    activeRun,
    {
      type: "agentMessageDelta",
      phase: "analysis",
      text: "  Reviewing the failing tests for the active project.  "
    },
    "2026-03-30T10:00:02.000Z"
  );
  assert.equal(activeRun.status, "running");
  assert.equal(activeRun.progressPhase, "analysis");
  assert.equal(activeRun.progressPreview, "Reviewing the failing tests for the active project.");
  assert.equal(activeRun.lastProgressAt, "2026-03-30T10:00:02.000Z");

  applyRunLifecycleEvent(
    activeRun,
    {
      type: "approvalRequested"
    },
    "2026-03-30T10:00:03.000Z"
  );
  assert.equal(activeRun.status, "waiting_for_approval");
  assert.equal(activeRun.lastEventAt, "2026-03-30T10:00:03.000Z");
});

test("WhatsAppControllerBridge summary reports the active project's thread id", () => {
  const bridge = new WhatsAppControllerBridge({
    runtime: {},
    configStore: {
      data: {
        defaultProject: "alpha-app",
        permissionLevel: "workspace-write"
      }
    },
    stateStore: {
      data: {
        process: {}
      },
      listSessions() {
        return [
          {
            phoneKey: "123",
            activeProject: "alpha-app",
            projects: {
              "alpha-app": {
                threadId: "thread-backend",
                permissionLevel: "workspace-write"
              }
            }
          }
        ];
      },
      getSession() {
        return {
          phoneKey: "123",
          activeProject: "alpha-app",
          projects: {
            "alpha-app": {
              threadId: "thread-backend",
              permissionLevel: "workspace-write"
            }
          }
        };
      }
    }
  });
  bridge.activeRuns.set("project:123:alpha-app", {
    status: "running",
    progressPreview: "Reviewing the failing tests",
    lastEventAt: "2026-03-30T10:00:00.000Z"
  });

  const summary = bridge.summary();
  assert.equal(summary.sessions[0].threadId, "thread-backend");
  assert.equal(summary.sessions[0].runStatus, "running");
  assert.equal(summary.sessions[0].runPreview, "Reviewing the failing tests");
});

test("renderSessionStatus includes live run status and preview for active projects", () => {
  const bridge = new WhatsAppControllerBridge({
    runtime: {},
    configStore: {
      data: {
        defaultProject: "alpha-app",
        permissionLevel: "workspace-write"
      }
    },
    stateStore: {
      data: {
        process: {}
      },
      getSession() {
        return {
          phoneKey: "123",
          activeProject: "alpha-app",
          projects: {
            "alpha-app": {
              threadId: "thread-backend",
              permissionLevel: "workspace-write"
            }
          }
        };
      }
    }
  });
  bridge.activeRuns.set("project:123:alpha-app", {
    status: "finalizing",
    progressPreview: "Preparing the final answer",
    lastProgressAt: "2026-03-30T10:00:04.000Z"
  });

  const status = bridge.renderSessionStatus("123");
  assert.match(status, /run_status: finalizing/);
  assert.match(status, /run_preview: Preparing the final answer/);
  assert.match(status, /run_progress_at: 2026-03-30T10:00:04.000Z/);
});

test("renderSessionStatus includes queued message counts for project and btw scopes", () => {
  const bridge = new WhatsAppControllerBridge({
    runtime: {},
    configStore: {
      data: {
        defaultProject: "alpha-app",
        permissionLevel: "workspace-write"
      }
    },
    stateStore: {
      data: {
        process: {}
      },
      getSession() {
        return {
          phoneKey: "123",
          activeProject: "alpha-app",
          projects: {
            "alpha-app": {
              threadId: "thread-backend",
              permissionLevel: "workspace-write",
              queuedPrompts: [
                { prompt: "follow up 1" },
                { prompt: "follow up 2" }
              ]
            }
          },
          btw: {
            queuedPrompts: [{ prompt: "side question" }]
          }
        };
      }
    }
  });

  assert.match(bridge.renderSessionStatus("123"), /queued_messages: 2/);
  assert.match(bridge.renderSessionStatus("123", "btw"), /queued_messages: 1/);
});

test("runNextQueuedPrompt dequeues and dispatches the next queued prompt", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "controller-bridge-test-"));
  const filePath = path.join(tempDir, "controller-state.json");

  try {
    const stateStore = new ControllerStateStore(filePath);
    await stateStore.load();
    await stateStore.upsertSession("123", {
      phoneKey: "123",
      activeProject: "alpha-app",
      remoteJid: "123@s.whatsapp.net",
      label: "Test User",
      projects: {
        "alpha-app": {
          threadId: "thread-backend",
          queuedPrompts: [
            {
              prompt: "review the failing tests",
              queuedAt: "2026-03-30T10:00:00.000Z",
              forceNewThread: false
            }
          ]
        }
      }
    });

    const bridge = new WhatsAppControllerBridge({
      runtime: {},
      configStore: {
        data: {
          defaultProject: "alpha-app",
          permissionLevel: "workspace-write"
        }
      },
      stateStore
    });

    const dispatched = [];
    bridge.runPrompt = async (args) => {
      dispatched.push(args);
    };

    const handled = await bridge.runNextQueuedPrompt({
      phoneKey: "123",
      remoteJid: "123@s.whatsapp.net",
      label: "Test User",
      scopeType: "project",
      projectAlias: "alpha-app"
    });

    assert.equal(handled, true);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].prompt, "review the failing tests");
    assert.equal(dispatched[0].statusPrelude, "Running your queued follow-up in alpha-app now.");
    assert.equal(
      stateStore.getSession("123").projects["alpha-app"].queuedPrompts.length,
      0
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("stopActiveRun clears queued follow-ups for the stopped project scope", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "controller-bridge-stop-test-"));
  const filePath = path.join(tempDir, "controller-state.json");

  try {
    const stateStore = new ControllerStateStore(filePath);
    await stateStore.load();
    await stateStore.upsertSession("123", {
      phoneKey: "123",
      activeProject: "alpha-app",
      remoteJid: "123@s.whatsapp.net",
      label: "Test User",
      projects: {
        "alpha-app": {
          threadId: "thread-backend",
          queuedPrompts: [
            { prompt: "follow up 1", queuedAt: "2026-03-30T10:00:00.000Z" },
            { prompt: "follow up 2", queuedAt: "2026-03-30T10:00:05.000Z" }
          ]
        }
      }
    });

    const bridge = new WhatsAppControllerBridge({
      runtime: {},
      configStore: {
        data: {
          defaultProject: "alpha-app",
          permissionLevel: "workspace-write"
        }
      },
      stateStore
    });

    const replies = [];
    bridge.sendReply = async (_remoteJid, text) => {
      replies.push(text);
    };
    bridge.activeRuns.set("project:123:alpha-app", {
      cancelled: false,
      pendingApproval: null,
      interrupt: async () => {},
      child: {
        killed: true,
        kill() {}
      }
    });

    await bridge.stopActiveRun("123", "123@s.whatsapp.net", "");

    assert.equal(
      stateStore.getSession("123").projects["alpha-app"].queuedPrompts.length,
      0
    );
    assert.match(replies[0], /Cleared 2 queued follow-up messages for this scope\./);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("buildVoiceReplyTextCompanion extracts actionable artifacts for spoken replies", () => {
  assert.equal(
    buildVoiceReplyTextCompanion(
      [
        "Preview is ready.",
        "Open https://example.com/preview/123",
        "Then run /project beta-checkin",
        "Confirmation code: 263593"
      ].join("\n")
    ),
    [
      "Open https://example.com/preview/123",
      "Then run /project beta-checkin",
      "Confirmation code: 263593"
    ].join("\n")
  );
});

test("normalizeVoiceCommandText removes accents and punctuation", () => {
  assert.equal(
    normalizeVoiceCommandText("  Start over, please! "),
    "start over please"
  );
});

test("parseVoiceTranscript maps exact spoken control commands conservatively", () => {
  assert.deepEqual(parseVoiceTranscript("help"), { type: "help" });
  assert.deepEqual(parseVoiceTranscript("status"), { type: "status", payload: "" });
  assert.deepEqual(parseVoiceTranscript("stop"), { type: "stop", payload: "" });
  assert.deepEqual(parseVoiceTranscript("cancel"), {
    type: "approvalDecision",
    decision: "cancel",
    payload: ""
  });
  assert.deepEqual(parseVoiceTranscript("new session"), { type: "new", prompt: "" });
  assert.deepEqual(parseVoiceTranscript("please fix the checkout button"), {
    type: "prompt",
    prompt: "please fix the checkout button"
  });
});

test("parseVoiceTranscript respects captureAllDirectMessages when no voice command matches", () => {
  assert.deepEqual(parseVoiceTranscript("please fix the checkout button", false), {
    type: "ignored"
  });
});

test("parseVoiceTranscript extracts one-shot voice replies from spoken prompts", () => {
  assert.deepEqual(
    parseVoiceTranscript("reply in voice at 2x explain what changed in this PR"),
    {
      type: "prompt",
      prompt: "explain what changed in this PR",
      voiceReply: {
        enabled: true,
        speed: "2x"
      }
    }
  );
});

test("parseVoiceReplyCommandPayload parses status and speed controls", () => {
  assert.deepEqual(parseVoiceReplyCommandPayload(""), { action: "status" });
  assert.deepEqual(parseVoiceReplyCommandPayload("on"), {
    action: "on",
    speed: "1x"
  });
  assert.deepEqual(parseVoiceReplyCommandPayload("on 2x"), {
    action: "on",
    speed: "2x"
  });
  assert.deepEqual(parseVoiceReplyCommandPayload("2x"), {
    action: "on",
    speed: "2x"
  });
  assert.deepEqual(parseVoiceReplyCommandPayload("off"), { action: "off" });
});

test("resolveRunVoiceReply prefers the latest active-run voice setting", () => {
  assert.deepEqual(
    resolveRunVoiceReply(
      {
        voiceReply: {
          enabled: false,
          speed: "1x"
        }
      },
      {
        enabled: true,
        speed: "2x"
      }
    ),
    {
      enabled: false,
      speed: "1x"
    }
  );
});

test("handleVoiceReplyCommand updates active runs without requiring /stop", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "voice-mode-test-"));
  const filePath = path.join(tempDir, "controller-state.json");

  try {
    const stateStore = new ControllerStateStore(filePath);
    await stateStore.load();
    await stateStore.upsertSession("123", {
      phoneKey: "123",
      activeProject: "alpha-app",
      remoteJid: "123@s.whatsapp.net",
      label: "Test User",
      voiceReply: {
        enabled: false,
        speed: "1x"
      },
      projects: {
        "alpha-app": {
          threadId: "thread-backend"
        }
      }
    });

    const bridge = new WhatsAppControllerBridge({
      runtime: {},
      configStore: {
        data: {
          defaultProject: "alpha-app",
          permissionLevel: "workspace-write"
        }
      },
      stateStore
    });

    const replies = [];
    bridge.sendReply = async (_remoteJid, text) => {
      replies.push(text);
    };
    bridge.activeRuns.set("project:123:alpha-app", {
      voiceReply: {
        enabled: false,
        speed: "1x"
      }
    });

    await bridge.handleVoiceReplyCommand({
      phoneKey: "123",
      remoteJid: "123@s.whatsapp.net",
      payload: "on 2x",
      label: "Test User"
    });

    assert.deepEqual(stateStore.getSession("123").voiceReply, {
      enabled: true,
      speed: "2x"
    });
    assert.deepEqual(bridge.projectRun("123", "alpha-app").voiceReply, {
      enabled: true,
      speed: "2x"
    });
    assert.equal(
      replies[0],
      "Voice replies are now on for this chat at 2x. Active runs will use the new voice setting."
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("handleMoreCommand sends the next deferred part for the active project and clears it when done", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "controller-bridge-more-test-"));
  const filePath = path.join(tempDir, "controller-state.json");

  try {
    const stateStore = new ControllerStateStore(filePath);
    await stateStore.load();
    await stateStore.upsertSession("123", {
      phoneKey: "123",
      activeProject: "alpha-app",
      remoteJid: "123@s.whatsapp.net",
      label: "Test User",
      projects: {
        "alpha-app": {
          pendingLongReply: {
            parts: ["First deferred chunk", "Second deferred chunk"],
            nextIndex: 1
          }
        }
      }
    });

    const bridge = new WhatsAppControllerBridge({
      runtime: {},
      configStore: {
        data: {
          defaultProject: "alpha-app",
          permissionLevel: "workspace-write",
          projects: [{ alias: "alpha-app", workspace: "/workspace/alpha-app" }]
        }
      },
      stateStore
    });

    const replies = [];
    bridge.sendReply = async (_remoteJid, text) => {
      replies.push(text);
    };

    await bridge.handleMoreCommand({
      phoneKey: "123",
      remoteJid: "123@s.whatsapp.net",
      payload: "",
      label: "Test User"
    });

    assert.match(replies[0], /Part 2\/2/);
    assert.match(replies[0], /Second deferred chunk/);
    assert.equal(stateStore.getSession("123").projects["alpha-app"].pendingLongReply, null);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("handleMoreCommand keeps background project continuations addressable by alias", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "controller-bridge-more-bg-test-"));
  const filePath = path.join(tempDir, "controller-state.json");

  try {
    const stateStore = new ControllerStateStore(filePath);
    await stateStore.load();
    await stateStore.upsertSession("123", {
      phoneKey: "123",
      activeProject: "beta-app",
      remoteJid: "123@s.whatsapp.net",
      label: "Test User",
      projects: {
        "alpha-app": {
          pendingLongReply: {
            parts: ["Alpha chunk 1", "Alpha chunk 2", "Alpha chunk 3"],
            nextIndex: 1
          }
        },
        "beta-app": {
          threadId: "thread-beta"
        }
      }
    });

    const bridge = new WhatsAppControllerBridge({
      runtime: {},
      configStore: {
        data: {
          defaultProject: "beta-app",
          permissionLevel: "workspace-write",
          projects: [
            { alias: "alpha-app", workspace: "/workspace/alpha-app" },
            { alias: "beta-app", workspace: "/workspace/beta-app" }
          ]
        }
      },
      stateStore
    });

    const replies = [];
    bridge.sendReply = async (_remoteJid, text) => {
      replies.push(text);
    };

    await bridge.handleMoreCommand({
      phoneKey: "123",
      remoteJid: "123@s.whatsapp.net",
      payload: "alpha-app",
      label: "Test User"
    });

    assert.match(replies[0], /Part 2\/3/);
    assert.match(replies[0], /Reply \/more alpha-app for part 3\/3\./);
    assert.equal(
      stateStore.getSession("123").projects["alpha-app"].pendingLongReply.nextIndex,
      2
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("extractOneShotVoiceReplyRequest pulls a one-off spoken reply directive out of text", () => {
  assert.deepEqual(
    extractOneShotVoiceReplyRequest(
      "Reply in voice at 2x explain what changed in this PR"
    ),
    {
      prompt: "explain what changed in this PR",
      voiceReply: {
        enabled: true,
        speed: "2x"
      }
    }
  );
});

test("extractOneShotVoiceReplyRequest accepts transcribed speed variants like onex", () => {
  assert.deepEqual(
    extractOneShotVoiceReplyRequest(
      "Reply in voice at onex what project are we working on"
    ),
    {
      prompt: "what project are we working on",
      voiceReply: {
        enabled: true,
        speed: "1x"
      }
    }
  );
});

test("buildVoiceReplyPrompt instructs Codex to emit a hidden reply language tag", () => {
  const prompt = buildVoiceReplyPrompt("Explain the change.");
  assert.match(prompt, /\[\[reply_language:<language-code>\]\]/);
  assert.match(prompt, /for example en, es, it, or pt-BR/i);
  assert.match(prompt, /do not mention the metadata/i);
});

test("extractVoiceReplyEnvelope strips the language tag before delivery", () => {
  assert.deepEqual(
    extractVoiceReplyEnvelope("[[reply_language:pt-BR]]\nClaro, eu te dou o resumo curto agora."),
    {
      text: "Claro, eu te dou o resumo curto agora.",
      languageId: "pt-br",
      hasLanguageTag: true
    }
  );
  assert.deepEqual(extractVoiceReplyEnvelope("Plain reply"), {
    text: "Plain reply",
    languageId: null,
    hasLanguageTag: false
  });
});

test("extractVoiceReplyEnvelope tolerates whitespace and never falls back to the raw tag", () => {
  assert.deepEqual(
    extractVoiceReplyEnvelope(" \n [[ reply_language : es ]] \n Hola."),
    {
      text: "Hola.",
      languageId: "es",
      hasLanguageTag: true
    }
  );
  assert.deepEqual(extractVoiceReplyEnvelope("[[reply_language:it]]"), {
    text: "",
    languageId: "it",
    hasLanguageTag: true
  });
});

test("normalizePermissionLevel accepts short aliases", () => {
  assert.equal(normalizePermissionLevel("ro"), "read-only");
  assert.equal(normalizePermissionLevel("ww"), "workspace-write");
  assert.equal(normalizePermissionLevel("dfa"), "danger-full-access");
  assert.equal(normalizePermissionLevel("read only"), "read-only");
  assert.equal(normalizePermissionLevel("workspace write"), "workspace-write");
  assert.equal(normalizePermissionLevel("danger full access"), "danger-full-access");
});

test("parseImplicitProjectCommand stays conservative and requires the new-session phrasing", () => {
  assert.equal(parseImplicitProjectCommand("switch to alpha app"), null);
  assert.deepEqual(
    parseImplicitProjectCommand("please start a new project session in alpha app"),
    {
      type: "newProjectSession",
      target: "alpha app"
    }
  );
});

test("sanitizeReplyTextForWhatsApp unwraps markdown links and code fences into copy-safe text", () => {
  assert.equal(
    sanitizeReplyTextForWhatsApp(
      "Use:\n\n```text\n/project /workspace/current-project\n```\n\nSee [README](/workspace/current-project/README.md)."
    ),
    [
      "Use:",
      "",
      "/project /workspace/current-project",
      "",
      "See /workspace/current-project/README.md."
    ].join("\n")
  );
});
