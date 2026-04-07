// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
use std::process::Command;

#[cfg(target_os = "linux")]
const LINUX_COMPAT_GUARD: &str = "BOOKSTORY_LINUX_COMPAT_APPLIED";

#[cfg(target_os = "linux")]
fn command_succeeds(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn has_nvidia_gpu() -> bool {
    if command_succeeds("nvidia-smi", &[]) {
        return true;
    }

    Command::new("lspci")
        .output()
        .map(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .to_ascii_lowercase()
                    .contains("nvidia")
        })
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn relaunch_for_linux_compat() {
    if std::env::var_os(LINUX_COMPAT_GUARD).is_some() {
        return;
    }

    if std::env::var("XDG_SESSION_TYPE").ok().as_deref() != Some("wayland") {
        return;
    }

    let current_exe = match std::env::current_exe() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("Failed to resolve current executable for Linux compatibility relaunch: {error}");
            return;
        }
    };

    let mut command = Command::new(current_exe);
    command.args(std::env::args_os().skip(1));
    command.env(LINUX_COMPAT_GUARD, "1");
    command.env("GDK_BACKEND", "x11");

    if has_nvidia_gpu() {
        command.env("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    match command.status() {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(error) => eprintln!("Failed to relaunch with Linux compatibility env: {error}"),
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    relaunch_for_linux_compat();

    audiobookshelf_client_lib::run()
}
