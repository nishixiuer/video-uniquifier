import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** Keep editing state when moving between desktop routes; never enqueue work. */
export function useDraft<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(`draft:${key}`);
      if (saved !== null) return JSON.parse(saved) as T;
    } catch {
      /* An invalid draft must not prevent opening the workspace. */
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  useEffect(() => {
    sessionStorage.setItem(`draft:${key}`, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}
