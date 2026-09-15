export function isEditableTarget(target) {
  if (!target || typeof target.closest !== 'function') return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
}
