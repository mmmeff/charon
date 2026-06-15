import { useEffect, useRef, useState } from "react";
import type { KeyBinding } from "../types";
import {
  bindingFromEvent,
  formatShortcut,
  normalizeBinding,
  validateBinding,
  type ShortcutDef,
} from "../lib/shortcuts";

interface ShortcutRecorderProps {
  action: ShortcutDef;
  binding: KeyBinding | null;
  conflict: ShortcutDef | null;
  onChange: (binding: KeyBinding | null) => void;
  onReset: () => void;
}

export function ShortcutRecorder({
  action,
  binding,
  conflict,
  onChange,
  onReset,
}: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(false);
        setError("");
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        onChange(null);
        setRecording(false);
        setError("");
        return;
      }

      const next = bindingFromEvent(event);
      const validation = validateBinding(next);
      if (!next || validation) {
        setError(validation ?? "Press a non-modifier key to finish recording.");
        return;
      }
      onChange(normalizeBinding(next));
      setRecording(false);
      setError("");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onChange, recording]);

  const startRecording = () => {
    setError("");
    setRecording(true);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  return (
    <div className="shortcut-recorder" data-shortcut-recorder>
      <button
        ref={buttonRef}
        type="button"
        className={`shortcut-input ${recording ? "recording" : ""}`}
        onClick={startRecording}
        aria-label={`Record shortcut for ${action.label}`}
      >
        {recording ? "Press keys..." : formatShortcut(binding)}
      </button>
      <button type="button" className="link small" onClick={() => onChange(null)}>
        clear
      </button>
      <button type="button" className="link small" onClick={onReset}>
        reset
      </button>
      {(error || conflict) && (
        <div className={`shortcut-note ${error ? "err" : ""}`}>
          {error || `Also assigned to ${conflict?.label}; saving here will clear that binding.`}
        </div>
      )}
    </div>
  );
}
