// src/music/storage.ts
// Tiny key/value store for auth tokens: SecureStore on native, localStorage
// on web, in-memory as a last resort. Tokens never go in AsyncStorage or
// in the repo.

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const memory = new Map<string, string>();

export async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export async function storageSet(key: string, value: string): Promise<void> {
  memory.set(key, value);
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // memory fallback already set
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // memory fallback already set
  }
}

export async function storageDelete(key: string): Promise<void> {
  memory.delete(key);
  if (Platform.OS === 'web') {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // nothing to do
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // nothing to do
  }
}
