<script>
  // 自訂內容的對話框外框（分享、匯入、設定、範例等），行為同 Dialogs.svelte（spec §9）
  import { onMount, tick } from 'svelte';

  let { title, onclose, wide = false, dirty = false, children, footer } = $props();
  let panel;
  let returnFocus = null;
  const id = `modal-${Math.random().toString(36).slice(2)}`;

  onMount(() => {
    returnFocus = document.activeElement;
    tick().then(() => {
      const el = panel?.querySelector('[autofocus], input, select, textarea, button.primary') ?? panel?.querySelector('button');
      el?.focus();
    });
    return () => {
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus?.();
    };
  });

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose(); }
    else if (e.key === 'Tab' && panel) {
      const items = [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget && !dirty) onclose(); }} onkeydown={onKeydown}>
  <div class="panel" class:wide role="dialog" aria-modal="true" aria-labelledby={id} bind:this={panel}>
    <header>
      <h2 {id}>{title}</h2>
      <button class="close" aria-label="關閉" onclick={onclose}>✕</button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45);
    display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 90;
  }
  .panel {
    background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 12px;
    width: 100%; max-width: 480px; max-height: calc(100dvh - 32px); display: flex; flex-direction: column;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  }
  .panel.wide { max-width: 720px; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 6px; }
  h2 { margin: 0; font-size: 17px; }
  .close { border: none; background: none; font-size: 16px; padding: 4px 8px; }
  .body { padding: 6px 18px 12px; overflow: auto; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 18px 14px; border-top: 1px solid var(--border); flex-wrap: wrap; }
</style>
