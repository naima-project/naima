// The desktop entry point. Release builds on Windows open no console window next to the app's.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    naima_lib::run()
}
