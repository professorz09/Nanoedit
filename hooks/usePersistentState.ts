import { useEffect, useState } from 'react';
import type React from 'react';
import { getFromLocalStorage, saveToLocalStorage } from '../services/storageService';

// A drop-in useState that transparently persists to localStorage under `key`.
// Reads synchronously on first render (no flash of default content) and writes
// back whenever the value changes. Behaviour matches the old inline
// useState(() => getFromLocalStorage(...)) + useEffect(save) pairs exactly.
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => getFromLocalStorage(key, initial));
  useEffect(() => {
    saveToLocalStorage(key, value);
  }, [key, value]);
  return [value, setValue];
}
