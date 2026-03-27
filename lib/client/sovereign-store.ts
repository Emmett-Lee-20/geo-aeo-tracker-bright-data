"use client";

import { get, set, del } from "idb-keyval";
import { supabase } from "./supabase";

/**
 * Load state — Supabase is the source of truth when available.
 * Falls back to IndexedDB → localStorage for offline or pre-migration data.
 */
export async function loadSovereignValue<T>(key: string, fallback: T): Promise<T> {
  // 1. Try Supabase first (cloud, authoritative)
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("app_data")
        .select("value")
        .eq("key", key)
        .maybeSingle();

      if (!error && data?.value !== undefined) {
        // Cache locally so the app works offline
        await set(key, data.value).catch(() => {});
        return data.value as T;
      }
    } catch {
      // Network error — fall through to local cache
    }
  }

  // 2. Fall back to IndexedDB (local cache / offline)
  try {
    const indexed = await get<T>(key);
    if (indexed !== undefined) return indexed;

    // 3. Fall back to localStorage (legacy data from older versions)
    const localRaw = window.localStorage.getItem(key);
    if (localRaw) {
      const parsed = JSON.parse(localRaw) as T;
      await set(key, parsed).catch(() => {});
      return parsed;
    }
  } catch {
    try {
      const localRaw = window.localStorage.getItem(key);
      if (localRaw) return JSON.parse(localRaw) as T;
    } catch { /* give up */ }
  }

  return fallback;
}

/**
 * Save state — writes to IndexedDB immediately (fast, local cache),
 * then syncs to Supabase in the background (cloud persistence).
 */
export async function saveSovereignValue<T>(key: string, value: T): Promise<void> {
  // Always write locally first so the UI never waits on the network
  await set(key, value);

  // localStorage best-effort cache
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  }

  // Sync to Supabase in the background — don't block the UI
  if (supabase) {
    supabase
      .from("app_data")
      .upsert({ key, value, updated_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) console.warn("[supabase] sync failed:", error.message);
      });
  }
}

export async function clearSovereignStore(key: string): Promise<void> {
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  await del(key);

  // Also delete from Supabase
  if (supabase) {
    supabase.from("app_data").delete().eq("key", key).then(({ error }) => {
      if (error) console.warn("[supabase] delete failed:", error.message);
    });
  }
}
