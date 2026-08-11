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
async function main() {
  const stdinBuffer = fs.readFileSync(0);
  if (stdinBuffer.length === 0)
    process.exit(0);
  let eventPayload;
  try {
    eventPayload = JSON.parse(stdinBuffer.toString("utf-8"));
  } catch (e) {
    process.exit(0);
  }
  const eventType = eventPayload.type || eventPayload.event;
  const workspacePath = eventPayload.cwd || process.cwd();
  if (!eventType)
    process.exit(0);
  const relevantEvents = ["PreCompact", "StopFailure", "Stop", "SessionEnd", "SessionStart", "PostCompact"];
  if (!relevantEvents.includes(eventType))
    process.exit(0);
  if (["PreCompact", "StopFailure", "Stop", "SessionEnd"].includes(eventType)) {
    try {
      const head = (0, import_child_process.execSync)("git rev-parse HEAD", { cwd: workspacePath, stdio: "pipe" }).toString().trim();
      const branch = (0, import_child_process.execSync)("git rev-parse --abbrev-ref HEAD", { cwd: workspacePath, stdio: "pipe" }).toString().trim();
      const status = (0, import_child_process.execSync)("git status --porcelain", { cwd: workspacePath, stdio: "pipe" }).toString().trim();
      const isDirty = status.length > 0;
      const checkpoint = {
        schemaVersion: "1.0",
        id: crypto.randomBytes(8).toString("hex"),
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        type: eventType === "PreCompact" || eventType === "StopFailure" ? "recovery" : "lightweight",
        reason: eventType,
        workspace: {
          path: workspacePath,
          name: path.basename(workspacePath)
        },
        git: { head, branch, isDirty }
      };
      const dir = path.join(workspacePath, ".relay", "checkpoints");
      if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${checkpoint.id}.json`);
      const tempPath = `${filePath}.tmp.${crypto.randomBytes(4).toString("hex")}`;
      fs.writeFileSync(tempPath, JSON.stringify(checkpoint, null, 2), "utf-8");
      fs.renameSync(tempPath, filePath);
    } catch (e) {
      process.exit(0);
    }
  }
  process.exit(0);
}
main().catch(() => process.exit(0));
