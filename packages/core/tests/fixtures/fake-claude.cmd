@echo off
REM Minimal real Windows batch-script test double, used specifically to
REM regression-test spawnFallbackResumer's cmd.exe /d /s /c wrapper for
REM .cmd/.bat executables (the real shape `claude` resolves to via npm's
REM global-bin shim on Windows -- see fallback-resumer.ts's comment on why
REM this exists at all). A compiled binary (fake-claude.rs) can't stand in
REM for this specific regression: the whole point is proving a genuine .cmd
REM file, spawned the same way the real claude.cmd is, actually runs instead
REM of throwing EINVAL.
if "%FAKE_CLAUDE_BEHAVIOR%"=="success" (
  echo {"result":"ok","session_id":"ses_test"}
  exit /b 0
)
echo Error: fake-claude.cmd generic failure 1>&2
exit /b 2
