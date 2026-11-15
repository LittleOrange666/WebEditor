// 全域介面狀態：目前開啟的自訂對話框（各元件都可以開啟）
export const ui = $state({ modal: null }); // { kind, ... }

export function openModal(m) { ui.modal = m; }
export function closeModal() { ui.modal = null; }
