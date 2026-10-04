import { bump } from "../features";
import type { EvTarget, Extractor, FieldState, Transient } from "./extractor";

/** A value growing by more than this with no keystrokes is a fill, not typing. */
const JUMP_CHARS = 3;
/** Right-click paste: a context menu in the field this recently makes a jump abstain. */
const MENU_MS = 10000;
/** Keyless input types a person produces with dictation, Voice Control or autocorrect. */
const HUMAN_KEYLESS = new Set(["insertText", "insertReplacementText", "insertFromDictation"]);
/** `autocomplete` tokens that are not autofill hints. */
const NO_HINT = new Set(["", "off", "on"]);

function field(tr: Transient, el: object): FieldState {
  let s = tr.fields.get(el);
  if (!s) {
    s = {
      keys: 0,
      len: 0,
      composed: false,
      menuAt: Number.NEGATIVE_INFINITY,
      flagged: false,
      trio: 0,
    };
    tr.fields.set(el, s);
  }
  return s;
}

const valueOf = (el: EvTarget): string | null => (typeof el.value === "string" ? el.value : null);

/**
 * #5 and #8. Per field: keystrokes, composition, context menus and value growth, so a value
 * that jumps with no keys can be told from typing, dictation, autofill and right-click paste.
 * Also detects Browser Use's synthetic trio: an untrusted `input` whose `data` is the whole
 * value, then an untrusted `change`, then an untrusted `blur`. Values are read to measure
 * growth and dropped; only counts are kept.
 */
export const form: Extractor = {
  events: [
    "keydown",
    "compositionstart",
    "contextmenu",
    "paste",
    "copy",
    "cut",
    "input",
    "change",
    "blur",
  ],
  skipIgnored: true,
  fold(f, tr, e, sink) {
    const c = f.counts;
    const t = e.timeStamp;
    if (e.type === "copy" || e.type === "cut") {
      if (e.isTrusted) bump(c, "copies");
      return;
    }
    if (e.type === "paste") {
      if (!e.isTrusted) return;
      bump(c, "pastes");
      if (c.copies === 0 && c.contextmenus === 0) bump(c, "pasteNoCopy");
      return;
    }
    const el = e.target;
    if (!el || typeof el !== "object") return;
    const value = valueOf(el);
    if (e.type === "contextmenu") {
      if (!e.isTrusted) return;
      bump(c, "contextmenus");
      if (value !== null) field(tr, el).menuAt = t;
      return;
    }
    if (value === null) return;
    const s = field(tr, el);

    switch (e.type) {
      case "keydown":
        if (e.isTrusted) s.keys++;
        return;
      case "compositionstart":
        s.composed = true;
        bump(c, "compositions");
        return;
      case "change":
        s.trio = !e.isTrusted && s.trio === 1 ? 2 : 0;
        return;
      case "blur":
        if (!e.isTrusted && s.trio === 2) {
          bump(c, "buTrio");
          sink.tell();
        }
        s.trio = 0;
        return;
    }

    // input
    bump(c, "inputs");
    if (!e.isTrusted) bump(c, "untrustedInputs");
    const data = e.data;
    s.trio =
      !e.isTrusted && typeof data === "string" && data.length > 0 && data.length === value.length
        ? 1
        : 0;
    const grew = value.length - s.len > JUMP_CHARS;
    s.len = value.length;
    if (!grew || s.keys > 0) return;

    bump(c, "valueJumps");
    sink.action(t);
    const hint = typeof el.autocomplete === "string" && !NO_HINT.has(el.autocomplete);
    if (hint) {
      bump(c, "autofillJumps");
      return;
    }
    if (s.composed || t - s.menuAt < MENU_MS) return;
    if (e.isTrusted && HUMAN_KEYLESS.has(e.inputType ?? "")) {
      bump(c, "keylessInsertText");
      return;
    }
    if (!s.flagged) {
      s.flagged = true;
      bump(c, "fillFields");
    }
  },
};
