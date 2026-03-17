// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::process::Command;

fn main() {
    // Auto-detect Wayland + NVIDIA and set required env vars
    configure_platform_env();
    
    audiobookshelf_client_lib::run()
}

fn configure_platform_env() {
    // Check if running on Wayland
    let session_type = env::var("XDG_SESSION_TYPE").unwrap_or_default();
    if session_type.to_lowercase() == "wayland" {
        // Check for NVIDIA GPU
        if has_nvidia_gpu() {
            // Set env vars needed for Wayland + NVIDIA
            env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            env::set_var("GDK_BACKEND", "X11");
            
            eprintln!(
                "Detected Wayland + NVIDIA GPU. Setting X11 backend for compatibility."
            );
        }
    }
}

fn has_nvidia_gpu() -> bool {
    // Try nvidia-smi first (faster and more reliable)
    if Command::new("nvidia-smi")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
    {
        return true;
    }

    // Fallback: check lspci for NVIDIA
    if let Ok(output) = Command::new("lspci").output() {
        let lspci_output = String::from_utf8_lossy(&output.stdout);
        if lspci_output.to_lowercase().contains("nvidia") {
            return true;
        }
    }

    false
}
