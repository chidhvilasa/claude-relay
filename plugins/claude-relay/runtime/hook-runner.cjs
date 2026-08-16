"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var crypto = __toESM(require("crypto"));
var import_child_process = require("child_process");
var MAX_STDIN_BYTES = 256 * 1024;
async function main() {
  const stdinBuffer = Buffer.alloc(MAX_STDIN_BYTES);
  let bytesRead = 0;
  try {
    while (true) {
      const chunk = fs.readFileSync(0);
      if (chunk.length === 0)
        break;
      if (bytesRead + chunk.length > MAX_STDIN_BYTES) {
        process.exit(0);
      }
      chunk.copy(stdinBuffer, bytesRead);
      bytesRead += chunk.length;
    }
  } catch (e) {
    if (e.code === "EOF" || e.code === "EAGAIN") {
    } else {
      process.exit(0);
    }
  }
  if (bytesRead === 0)
    process.exit(0);
  const payloadStr = stdinBuffer.subarray(0, bytesRead).toString("utf-8");
  let eventPayload;
  try {
    eventPayload = JSON.parse(payloadStr);
  } catch (e) {
    process.exit(0);
  }
  if (typeof eventPayload !== "object" || eventPayload === null)
    process.exit(0);
  const eventType = eventPayload.type || eventPayload.event;
  if (typeof eventType !== "string" || eventType.length > 64)
    process.exit(0);
  const workspaceInput = eventPayload.cwd || process.cwd();
  if (typeof workspaceInput !== "string" || workspaceInput.length > 1024)
    process.exit(0);
  const handlers = {
    "SessionStart": true,
    "PreCompact": true,
    "StopFailure": true
  };
  if (!handlers[eventType])
    process.exit(0);
  let workspaceRoot;
  try {
    workspaceRoot = fs.realpathSync(path.resolve(workspaceInput));
  } catch (e) {
    process.exit(0);
  }
  const relayDir = path.join(workspaceRoot, ".relay");
  const checkpointsDir = path.join(relayDir, "checkpoints");
  if (!checkpointsDir.startsWith(workspaceRoot)) {
    process.exit(0);
  }
  try {
    const headRes = (0, import_child_process.spawnSync)("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, stdio: "pipe", encoding: "utf-8", timeout: 5e3, shell: false });
    const branchRes = (0, import_child_process.spawnSync)("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: workspaceRoot, stdio: "pipe", encoding: "utf-8", timeout: 5e3, shell: false });
    const statusRes = (0, import_child_process.spawnSync)("git", ["status", "--porcelain"], { cwd: workspaceRoot, stdio: "pipe", encoding: "utf-8", timeout: 5e3, shell: false });
    const head = headRes.stdout ? headRes.stdout.trim() : "unknown";
    const branch = branchRes.stdout ? branchRes.stdout.trim() : "unknown";
    const isDirty = statusRes.stdout ? statusRes.stdout.trim().length > 0 : false;
    const checkpoint = {
      schemaVersion: "1.0",
      id: crypto.randomBytes(8).toString("hex"),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      type: eventType === "PreCompact" || eventType === "StopFailure" ? "recovery" : "lightweight",
      reason: eventType,
      workspace: {
        path: workspaceRoot,
        name: path.basename(workspaceRoot)
      },
      git: { head, branch, isDirty }
    };
    if (!fs.existsSync(checkpointsDir)) {
      fs.mkdirSync(checkpointsDir, { recursive: true });
    }
    const gitignorePath = path.join(relayDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      try {
        fs.writeFileSync(gitignorePath, "*\n", "utf-8");
      } catch {
      }
    }
    const realCheckpointsDir = fs.realpathSync(checkpointsDir);
    if (!realCheckpointsDir.startsWith(workspaceRoot)) {
      process.exit(0);
    }
    const filePath = path.join(realCheckpointsDir, `${checkpoint.id}.json`);
    const tempPath = `${filePath}.tmp.${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tempPath, JSON.stringify(checkpoint, null, 2), "utf-8");
    fs.renameSync(tempPath, filePath);
  } catch (e) {
    process.exit(0);
  }
}
main().catch(() => process.exit(0));
