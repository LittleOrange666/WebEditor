<script>
  // 第一次在這台裝置登入時：選擇要上傳到雲端的本地專案（spec_new §4.2）
  import Modal from '../components/Modal.svelte';

  let { projects, resolve, onclose } = $props();
  let chosen = $state(new Set(projects.map((p) => p.id)));
  let done = false;

  function finish(ids) {
    if (done) return;
    done = true;
    resolve(ids);
    onclose();
  }

  function toggle(id) {
    const s = new Set(chosen);
    if (s.has(id)) s.delete(id); else s.add(id);
    chosen = s;
  }
</script>

<Modal title="要把哪些專案上傳到雲端？" onclose={() => finish([])}>
  <p class="msg">這台裝置上有 {projects.length} 個尚未同步的專案。上傳後可以在其他裝置登入同一個帳號看到它們；沒有勾選的專案會保留為「僅本地」，之後也可以在專案清單中上傳。</p>
  <ul class="list">
    {#each projects as p (p.id)}
      <li><label><input type="checkbox" checked={chosen.has(p.id)} onchange={() => toggle(p.id)} /> {p.name}</label></li>
    {/each}
  </ul>
  <p class="hint">只會上傳程式檔（.cpp .h .py .js …）；測資與其他檔案只存在這台裝置。</p>
  {#snippet footer()}
    <button onclick={() => finish([])}>都不要</button>
    <button class="primary" onclick={() => finish([...chosen])}>上傳選取的專案（{chosen.size}）</button>
  {/snippet}
</Modal>

<style>
  .msg { font-size: 14px; margin: 0 0 10px; }
  .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow: auto; }
  .list label { display: flex; gap: 8px; align-items: center; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
  .hint { font-size: 12px; color: var(--muted); margin: 10px 0 0; }
</style>
