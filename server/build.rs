// rust-embed needs the frontend build directory to exist at compile time. Create it if the
// frontend has not been built yet (dev mode serves the UI from Vite anyway).
fn main() {
    let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist");
    let _ = std::fs::create_dir_all(&dist);
    println!("cargo:rerun-if-changed=../dist");
}
