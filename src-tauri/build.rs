fn main() {
    // Windows executable resources must be rebuilt when the icon changes.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icon.svg");
    tauri_build::build()
}
