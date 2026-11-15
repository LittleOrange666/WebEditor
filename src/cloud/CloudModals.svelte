<script>
  import { ui, closeModal } from '../lib/ui.svelte.js';
  import ShareDialog from './ShareDialog.svelte';
  import ShareImportDialog from './ShareImportDialog.svelte';
  import LoginDialog from './LoginDialog.svelte';
  import AccountDialog from './AccountDialog.svelte';
  import MySharesDialog from './MySharesDialog.svelte';
  import LinkProjectsDialog from './LinkProjectsDialog.svelte';

  let { file } = $props();
</script>

{#if ui.modal?.kind === 'share'}
  <ShareDialog {file} onclose={closeModal} />
{:else if ui.modal?.kind === 'shareImport'}
  <ShareImportDialog initial={ui.modal.id ?? ''} share={ui.modal.share ?? null} onclose={closeModal} ondone={ui.modal.ondone} />
{:else if ui.modal?.kind === 'login'}
  <LoginDialog onclose={closeModal} />
{:else if ui.modal?.kind === 'account'}
  <AccountDialog onclose={closeModal} />
{:else if ui.modal?.kind === 'myshares'}
  <MySharesDialog onclose={closeModal} />
{:else if ui.modal?.kind === 'linkProjects'}
  <LinkProjectsDialog projects={ui.modal.projects} resolve={ui.modal.resolve} onclose={closeModal} />
{/if}
