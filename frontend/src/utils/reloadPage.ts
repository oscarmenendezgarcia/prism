/** Apart, so that tests can replace it: jsdom has no navigation. */
export function reloadPage(): void {
  window.location.reload();
}
