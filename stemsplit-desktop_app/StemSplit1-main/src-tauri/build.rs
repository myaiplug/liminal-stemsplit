fn main() {
    let production_site =
        std::env::var("SITE_URL").unwrap_or_else(|_| "https://liminal-stemsplit.onrender.com".to_string());
    let license_server = std::env::var("STEMSPLIT_LICENSE_SERVER_URL")
        .or_else(|_| std::env::var("NEXT_PUBLIC_LICENSE_API_URL"))
        .unwrap_or_else(|_| production_site.clone());
    let checkout_api = std::env::var("NEXT_PUBLIC_CHECKOUT_API_URL")
        .unwrap_or_else(|_| format!("{}/api/checkout", production_site.trim_end_matches('/')));
    let pricing_page = std::env::var("NEXT_PUBLIC_PRICING_PAGE_URL")
        .unwrap_or_else(|_| format!("{}/#pricing", production_site.trim_end_matches('/')));

    let models_root = std::env::var("STEMSPLIT_MODELS_ROOT")
        .unwrap_or_else(|_| "D:\\AudioSeperationModels".to_string());
    let uvr_path = std::env::var("STEMSPLIT_UVR_PATH")
        .unwrap_or_else(|_| "D:\\Ultimate Vocal Remover".to_string());

    println!("cargo:rustc-env=STEMSPLIT_LICENSE_SERVER_URL={}", license_server);
    println!("cargo:rustc-env=STEMSPLIT_CHECKOUT_API_URL={}", checkout_api);
    println!("cargo:rustc-env=STEMSPLIT_PRICING_PAGE_URL={}", pricing_page);
    println!("cargo:rustc-env=STEMSPLIT_DEFAULT_MODELS_ROOT={}", models_root);
    println!("cargo:rustc-env=STEMSPLIT_DEFAULT_UVR_PATH={}", uvr_path);

    tauri_build::build()
}