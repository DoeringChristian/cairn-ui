import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput, indentUnit, foldGutter, foldKeymap } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";

/** Shared source and inline editor, adapted from Prism's CodeEditor. */
export function CodeEditor({value, onChange, language = "markdown", onRun, onSave, focus = false, readOnly = false, label = "Report source", minHeight = "24rem"}: {
  value: string; onChange: (value: string) => void; language?: string; onRun?: () => void; onSave?: () => void;
  focus?: boolean; readOnly?: boolean; label?: string; minHeight?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useRef(onChange), run = useRef(onRun), save = useRef(onSave);
  const externalUpdate = useRef(false);
  const editable = useRef(new Compartment());
  changed.current = onChange; run.current = onRun; save.current = onSave;
  useEffect(() => {
    if (!host.current) return;
    const pythonLanguage = python();
    const mode = language === "python" ? pythonLanguage : language === "yaml" ? yaml() : markdown({base: markdownLanguage, codeLanguages: info => /^\{?python(?:\s|\}|$)/i.test(info) || info === "py" ? pythonLanguage.language : /^ya?ml$/i.test(info) ? yaml().language : null});
    const editor = new EditorView({parent: host.current, state: EditorState.create({doc: value, extensions: [
      history(), drawSelection(), lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), bracketMatching(), closeBrackets(), indentOnInput(), indentUnit.of("    "), foldGutter(), highlightSelectionMatches(), syntaxHighlighting(defaultHighlightStyle), mode,
      editable.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      EditorView.contentAttributes.of({"aria-label": label}),
      EditorView.lineWrapping,
      keymap.of([{key: "Mod-s", run: () => {save.current?.(); return true;}}, {key: "Mod-Enter", run: () => {run.current?.(); return true;}}, {key: "Shift-Enter", run: () => {run.current?.(); return true;}}, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      EditorView.updateListener.of(update => {if (update.docChanged && !externalUpdate.current) changed.current(update.state.doc.toString());}),
      EditorView.theme({"&": {fontSize: "13px", backgroundColor: "var(--bg, #f8f7f1)", color: "var(--fg, #25312b)", border: "1px solid var(--border, #d7ddd3)", borderRadius: "6px", maxWidth: "100%"}, ".cm-content": {fontFamily: "ui-monospace, SFMono-Regular, monospace", minHeight, padding: "14px 0"}, ".cm-scroller": {overflow: "auto", maxHeight: "65vh"}, ".cm-gutters": {background: "transparent", color: "var(--fg-subtle, #879287)", border: "none"}, ".cm-activeLine,.cm-activeLineGutter": {background: "#176b5b09"}, ".cm-cursor": {borderLeftColor: "var(--accent, #176b5b)"}, "&.cm-focused": {outline: "2px solid var(--accent, #176b5b)", outlineOffset: "1px"}, ".cm-panels": {background: "var(--bg-elevated, #fffdf6)", color: "inherit"}, ".cm-search input": {background: "var(--bg, #f8f7f1)", color: "inherit"}}),
    ]})});
    view.current = editor; externalUpdate.current = false;
    if (focus) editor.focus();
    return () => {externalUpdate.current = true; editor.destroy(); view.current = null;};
  }, [language, label, minHeight]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {externalUpdate.current = true; try {editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: value}});} finally {externalUpdate.current = false;}}
  }, [value]);
  useEffect(() => {view.current?.dispatch({effects: editable.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)])});}, [readOnly]);
  useEffect(() => {if (focus) view.current?.focus();}, [focus]);
  return <div className="min-w-0 max-w-full"><div className="flex flex-wrap justify-between gap-2 mb-2 text-xs text-fg-muted"><span>Tab indents · Escape then Tab leaves editor{onSave && " · ⌘/Ctrl+S saves"}{onRun && " · ⌘/Ctrl+Enter runs"}</span><button type="button" onClick={() => {if (view.current) openSearchPanel(view.current);}}>Find / replace</button></div><div ref={host} /></div>;
}
