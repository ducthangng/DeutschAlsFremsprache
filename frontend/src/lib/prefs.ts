import { useEffect, useState } from "react";
import type { Language } from "./api";
import { onVoicesChanged, voicesFor } from "./audio";

export interface Prefs {
  /** Browser speech rate, 0.5..1.5. */
  rate: number;
  /** Chosen voiceURI per language; "" = automatic (one voice per speaker). */
  voice: Partial<Record<Language, string>>;
  autoAdvance: boolean;
  /** Flashcards to review per day. */
  dailyGoal: number;
}

const KEY = "dfs.prefs";
const DEFAULTS: Prefs = { rate: 0.9, voice: {}, autoAdvance: true, dailyGoal: 20 };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

/** Per-browser learner preferences, remembered across visits. */
export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState(load);
  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  return [prefs, update];
}

/** Browser voices for a language, updating once the list has loaded. */
export function useVoices(lang: Language): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => onVoicesChanged(() => setVoices(voicesFor(lang))), [lang]);
  return voices;
}

export const RATE_MIN = 0.5;
export const RATE_MAX = 1.5;
