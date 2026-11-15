<script>
  import ShareDialog from '../components/ShareDialog.svelte';
  import ImportDialog from '../components/ImportDialog.svelte';
  import { ui, closeModal } from '../lib/ui.svelte.js';
  let { file } = $props();
</script>

{#if ui.modal?.kind === 'share' && file}
  <ShareDialog {file} onclose={closeModal} />
{:else if ui.modal?.kind === 'import'}
  <ImportDialog initialId={ui.modal.id ?? ''} onclose={closeModal} />
{/if}
