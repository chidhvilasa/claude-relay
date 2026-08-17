// Deterministic stand-in for the real `claude` CLI binary, compiled to a real,
// directly-executable native binary specifically so it can be spawned with
// `shell: false` exactly the way fallback-resumer.ts spawns the real claude
// executable (Part 11 of the automatic-wake task). A scripted (.cjs/.cmd/.sh)
// double can't stand in for this on Windows: `child_process.spawn` with
// `shell:false` refuses to launch .cmd/.bat directly (Node's own fix for
// CVE-2024-27980), and Node's own CLI flag parser rejects `--resume`/
// `--output-format` if `node.exe` itself is used as a stand-in claudePath —
// both tried and empirically confirmed to fail before settling on this.
//
// Deliberately ignores argv entirely (real claude.exe receives -p/--resume/
// --output-format as normal args and does its own thing with them; this
// fixture doesn't need to parse them to be a useful test double — only the
// caller-controlled FAKE_CLAUDE_BEHAVIOR env var matters).
use std::env;
use std::io::Write;
use std::process::exit;
use std::thread::sleep;
use std::time::Duration;

fn main() {
    let behavior = env::var("FAKE_CLAUDE_BEHAVIOR").unwrap_or_else(|_| "generic_error".to_string());
    let delay_ms: u64 = env::var("FAKE_CLAUDE_DELAY_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(150);

    match behavior.as_str() {
        "success" => {
            println!("{{\"result\":\"ok\",\"session_id\":\"ses_test\"}}");
            exit(0);
        }
        "delayed_success" => {
            sleep(Duration::from_millis(delay_ms));
            println!("{{\"result\":\"ok\",\"session_id\":\"ses_test\"}}");
            exit(0);
        }
        "permission_block" => {
            eprintln!("Error: this action requires approval under the current permission mode");
            exit(1);
        }
        "user_input_block" => {
            println!("Claude is waiting for user input to continue.");
            exit(1);
        }
        "auth_expired" => {
            eprintln!("Not logged in \u{b7} Please run /login");
            exit(1);
        }
        "session_not_found" => {
            eprintln!("No conversation found with session ID: ses_missing");
            exit(1);
        }
        "crash" => {
            exit(134);
        }
        "hang" => {
            loop {
                sleep(Duration::from_secs(3600));
            }
        }
        _ => {
            let _ = std::io::stderr().write_all(b"Error: something went wrong\n");
            exit(2);
        }
    }
}
