import { isTauri } from '@tauri-apps/api/core';

export function isTauriRuntime(): boolean {
  return isTauri();
}