fn main() {
    // tauri-plugin-notifications links the macOS Swift bridge against the
    // Swift concurrency runtime shipped in /usr/lib/swift.
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    tauri_build::build()
}
