# Tauri Implementation Details

## Overview
The Tauri implementation in the StemSplit project bridges the frontend (React) and backend (Rust) to enable advanced audio stem separation. It leverages Tauri's IPC (Inter-Process Communication) for seamless communication between the two layers.

---

## Frontend (React) Integration

### Layout Design and Branding
The frontend of StemSplit is designed with a focus on simplicity and user engagement. Key design principles include:
- **Minimalist Layout**: The interface is clean and uncluttered, ensuring users can focus on the core functionality.
- **Responsive Design**: Tailwind CSS ensures the layout adapts seamlessly to different screen sizes and resolutions.
- **Custom Branding**: The application incorporates:
  - **Color Palette**: A gradient-based theme with vibrant colors that reflect the dynamic nature of audio processing.
  - **Typography**: Modern sans-serif fonts for readability and a professional look.
  - **Logo and Icons**: Custom-designed assets that align with the StemSplit brand identity.

### Styling
The application uses Tailwind CSS for styling, with additional customizations:
- **Gradients**: Smooth gradient backgrounds and buttons to enhance visual appeal.
- **Animations**: Subtle animations (e.g., hover effects, progress bar transitions) implemented using Framer Motion.
- **Dark Mode**: A dark theme is available to reduce eye strain during extended use.

### IPC Bridge
The `tauri-bridge.ts` file defines the communication layer:
- **`startStemSplit`**: Initiates the stem separation process by invoking the `execute_splice` command in the backend.
- **`cancelStemSplit`**: Cancels an ongoing separation process.
- **`getSeparatorStatus`**: Retrieves the current status of the separator (e.g., idle, processing).
- **`healthCheck`**: Performs a health check on the backend.
- **`onStemSplitProgress`**: Listens for progress updates from the backend.

### Progress Updates
- The `onStemSplitProgress` function listens for `stem-split-progress` events emitted by the backend.
- React components can use the `useStemSplitProgress` hook to subscribe to these updates.

### Error Handling
- All IPC functions include robust error handling to log and throw errors when backend commands fail.

---

## Backend (Rust) Implementation

### Commands
The backend defines several Tauri commands in `main.rs`:
- **`execute_splice`**: Executes the stem separation process by invoking the `splitter.py` script.
- **`cancel_stem_split`**: Cancels the active separation process.
- **`get_separator_status`**: Returns the current status of the separator.
- **`health_check`**: Checks the health of the backend and Python environment.
- **`apply_stem_fx`**: Applies audio effects to a stem.
- **`preview_vst_plugin`**: Previews a VST plugin.

### Python Integration
- The backend invokes Python scripts (e.g., `splitter.py`) for audio processing.
- Python environment management includes:
  - Resolving the Python executable path.
  - Checking for required packages (e.g., `torch`, `demucs`).
  - Installing missing packages if necessary.

### License Enforcement
- Trial limitations are enforced in the `execute_splice` command:
  - Limits the number of stems to 2.
  - Forces MP3 output format.
- Full access is granted with a valid license key.

### Progress Tracking
- The `execute_splice` command streams progress updates to the frontend via `stem-split-progress` events.
- Progress includes:
  - Current step.
  - Total steps.
  - Percentage completed.

### Error Handling
- Errors during Python script execution are captured and returned to the frontend.
- Common issues include:
  - Missing Python executable.
  - Script errors (e.g., invalid input file).

---

## Key Files

### Frontend
- **`src/lib/tauri-bridge.ts`**: Defines the IPC bridge.

### Backend
- **`src-tauri/src/main.rs`**: Implements Tauri commands.
- **`src-tauri/build.rs`**: Configures the Tauri build process.
- **`src-tauri/Cargo.toml`**: Manages Rust dependencies.

---

## Dependencies

### Rust
- **`tauri`**: Provides the core framework for building the application.
- **`serde`**: Handles JSON serialization/deserialization.
- **`tokio`**: Enables asynchronous programming.
- **`reqwest`**: Used for HTTP requests (e.g., license validation).

### Python
- **`torch`**: Machine learning library for audio processing.
- **`demucs`**: AI model for stem separation.
- **`librosa`**: Audio analysis library.
- **`soundfile`**: Reads and writes audio files.
- **`pedalboard`**: Applies audio effects.

---

## Build and Run

### Build
- The `build.rs` script configures the Tauri build process.
- Release builds are optimized with:
  - Code stripping.
  - Link-time optimization (LTO).

### Run
- The `main.rs` file initializes the Tauri application and registers all commands.
- The `tauri::Builder` is used to configure the application.

---

## Summary
The Tauri implementation in StemSplit is a robust and efficient solution for integrating a React frontend with a Rust backend. It leverages Tauri's IPC capabilities to enable advanced audio processing workflows while maintaining a responsive user experience.