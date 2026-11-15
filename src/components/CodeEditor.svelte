<script>
  // CodeMirror 6 編輯器（spec §3.3）：每個檔案保留各自的編輯狀態（游標、復原紀錄）
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { EditorState, Compartment } from '@codemirror/state';
  import { keymap } from '@codemirror/view';
  import { indentWithTab } from '@codemirror/commands';
  import { indentUnit } from '@codemirror/language';
  import { python } from '@codemirror/lang-python';
  import { javascript } from '@codemirror/lang-javascript';
  import { cpp } from '@codemirror/lang-cpp';
  import { oneDark } from '@codemirror/theme-one-dark';

  let {
    fileId, value = '', lang = null, readOnly = false, dark = false, fontSize = 14, tabSize = 4,
    onchange = () => {}, onrun = () => {}, api = $bindable(null),
  } = $props();

  let host;
  let view;
  const states = new Map(); // fileId -> EditorState
  let currentId = null;
  let applying = false;
  const themeComp = new Compartment();
  const roComp = new Compartment();
  const fontComp = new Compartment();
  const indentComp = new Compartment();

  function langExt(l) {
    if (l === 'py') return python();
    if (l === 'js') return javascript();
    if (l === 'cpp') return cpp();
    return [];
  }

  const fontExt = () => EditorView.theme({ '&': { fontSize: `${fontSize}px` } });
  const indentExt = () => [indentUnit.of(' '.repeat(tabSize)), EditorState.tabSize.of(tabSize)];
  const roExt = () => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];

  function makeState(doc, l) {
    return EditorState.create({
      doc,
      extensions: [
        basicSetup,
        keymap.of([
          { key: 'Mod-Enter', run: () => { onrun(); return true; } },
          indentWithTab,
        ]),
        langExt(l),
        themeComp.of(dark ? oneDark : []),
        roComp.of(roExt()),
        fontComp.of(fontExt()),
        indentComp.of(indentExt()),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !applying) onchange(u.state.doc.toString());
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { fontFamily: 'var(--mono)' },
        }),
      ],
    });
  }

  function reconfigureAll() {
    view?.dispatch({
      effects: [
        themeComp.reconfigure(dark ? oneDark : []),
        roComp.reconfigure(roExt()),
        fontComp.reconfigure(fontExt()),
        indentComp.reconfigure(indentExt()),
      ],
    });
  }

  function switchTo(id) {
    if (currentId && view) states.set(currentId, view.state);
    currentId = id;
    let st = states.get(id);
    if (!st || st.doc.toString() !== value) {
      st = makeState(value, lang);
    }
    view.setState(st);
    reconfigureAll();
  }

  onMount(() => {
    view = new EditorView({ state: makeState(value, lang), parent: host });
    currentId = fileId;
    api = {
      focus: () => view.focus(),
      gotoLine(line, col = 1) {
        const doc = view.state.doc;
        const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
        const pos = Math.min(l.from + Math.max(0, col - 1), l.to);
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
      },
      forget: (id) => states.delete(id),
    };
  });

  onDestroy(() => view?.destroy());

  // 切換檔案或語言
  let lastKey = '';
  $effect(() => {
    const key = `${fileId}|${lang}`;
    if (view && key !== lastKey) {
      const sameFile = lastKey.startsWith(`${fileId}|`);
      lastKey = key;
      if (sameFile) { states.delete(fileId); currentId = null; }
      switchTo(fileId);
    }
  });

  // 外部修改內容（其他分頁同步、上傳取代）
  $effect(() => {
    const v = value;
    if (!view || fileId !== currentId) return;
    const cur = view.state.doc.toString();
    if (v !== cur) {
      applying = true;
      const sel = view.state.selection.main.head;
      view.dispatch({ changes: { from: 0, to: cur.length, insert: v }, selection: { anchor: Math.min(sel, v.length) } });
      applying = false;
    }
  });

  $effect(() => {
    void dark; void readOnly; void fontSize; void tabSize;
    reconfigureAll();
  });
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor { height: 100%; min-height: 0; overflow: hidden; background: var(--surface); }
  .editor :global(.cm-editor) { height: 100%; }
  .editor :global(.cm-editor.cm-focused) { outline: none; }
</style>
