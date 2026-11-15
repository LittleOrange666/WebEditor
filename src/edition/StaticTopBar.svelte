<script>
  import { openModal } from '../lib/ui.svelte.js';
  let { file } = $props();
</script>

<button disabled={!file || !!file?.binary} onclick={() => openModal({ kind: 'share' })} title="上傳目前的檔案到 APCS Code Noter">分享</button>
<button onclick={() => openModal({ kind: 'import' })} title="從 APCS Code Noter 匯入">匯入</button>
