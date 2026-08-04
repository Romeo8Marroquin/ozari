/**
 * BODY SCROLL LOCK — counted, because modals nest.
 *
 * Each modal used to save `body.style.overflow` on open and restore it on close. With one dialog
 * that is correct; with two it depends entirely on the order the cleanups happen to run. React tears
 * down in tree order, so the OUTER modal restored `''` first and the inner one then restored the
 * `'hidden'` it had captured — leaving the page permanently unscrollable behind a closed dialog.
 *
 * A counter removes the ordering question: the first lock stores the real value and applies the
 * lock, the last release puts back what was there. Anything in between only moves the count.
 */

let depth = 0;
let restoreTo = '';

/** Lock the page. Returns the release for THIS lock; releases are idempotent (double-calling one
 *  cannot drop the count twice and unlock while another modal is still open). */
export function lockBodyScroll(): () => void {
  if (depth === 0) {
    restoreTo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  depth += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth -= 1;
    if (depth === 0) {
      document.body.style.overflow = restoreTo;
    }
  };
}
