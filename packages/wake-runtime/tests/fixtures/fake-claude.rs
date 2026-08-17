// Shared with packages/core/tests/fixtures/fake-claude.rs — see that file for
// the full rationale (real compiled binary needed so it can be spawned with
// shell:false the same way the real claude executable is). Duplicated here
// (not imported/symlinked) so this package's tests have zero cross-package
// file dependencies at test time, matching how hook-runtime and core each
// keep their own fixtures self-contained.
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
        "auth_expired" => {
            eprintln!("Not logged in \u{b7} Please run /login");
            exit(1);
        }
        "session_not_found" => {
            eprintln!("No conversation found with session ID: ses_missing");
            exit(1);
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
