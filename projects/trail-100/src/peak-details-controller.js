// Behaviour of the peak details dialog, written against a minimal dialog
// interface so it can be tested without a browser. In the app `dialog` is the
// native <dialog id="peak-details"> element; showModal() makes the rest of the
// page inert, so keyboard focus cannot reach the content behind it while open.
//
// Options:
//   dialog          - element with: open, innerHTML, showModal(), close(),
//                     querySelector(selector), addEventListener(type, fn)
//   renderDetails   - (peakId) => HTML string for the dialog content, or null
//   togglePeak      - (peakId) => void; flips completion and refreshes the
//                     cards, overall progress and region progress
//   findOpener      - (peakId) => the "View details" control for that peak, or null
//   fallbackFocus   - () => element to focus when the opener no longer exists
export function createPeakDetailsController({ dialog, renderDetails, togglePeak, findOpener, fallbackFocus }) {
    let currentPeakId = null;

    function render() {
        const html = renderDetails(currentPeakId);
        if (html == null) return false;
        dialog.innerHTML = html;
        return true;
    }

    function focusSelector(selector) {
        const el = dialog.querySelector(selector);
        if (el) el.focus();
    }

    function open(peakId) {
        currentPeakId = peakId;
        if (!render()) {
            currentPeakId = null;
            return;
        }
        if (!dialog.open) dialog.showModal();
        // Move focus into the dialog explicitly (close control first).
        focusSelector('.details-close-button');
    }

    // Clean up and return focus to the opener. Safe to call more than once:
    // it runs synchronously from close() and again (as a no-op) from the
    // dialog's asynchronous "close" event, which also covers closes that do
    // not go through close() (e.g. a browser-initiated cancel).
    function handleClosed() {
        const peakId = currentPeakId;
        if (!peakId) return;
        currentPeakId = null;
        dialog.innerHTML = '';
        // Cards are re-rendered after toggling, so look up the current opener
        // for the same peak. If its card is hidden by filters, use the fallback.
        const opener = findOpener(peakId);
        const target = opener || fallbackFocus();
        if (target) target.focus();
    }

    function close() {
        if (dialog.open) dialog.close();
        // Restore focus immediately rather than waiting for the queued
        // "close" event, so focus is never left inside the closed dialog.
        handleClosed();
    }

    function handleClick(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        if (target.closest('.details-close-button')) {
            close();
            return;
        }
        const toggle = target.closest('.details-toggle-button');
        if (toggle && currentPeakId) {
            togglePeak(currentPeakId);
            render();
            focusSelector('.details-toggle-button');
        }
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
    }

    dialog.addEventListener('click', handleClick);
    dialog.addEventListener('keydown', handleKeydown);
    dialog.addEventListener('close', handleClosed);

    return {
        open,
        close,
        get currentPeakId() {
            return currentPeakId;
        },
    };
}
