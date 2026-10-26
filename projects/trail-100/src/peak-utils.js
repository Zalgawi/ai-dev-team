// Pure, DOM-free helpers shared by the browser app (app.js) and the test suite.

export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function calculateProgress(completedIds, peaks) {
    const validIds = new Set(peaks.map(p => p.id));
    const completed = [...completedIds].filter(id => validIds.has(id)).length;
    const total = peaks.length;
    const remaining = total - completed;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, remaining, total, percentage };
}

// Per-region progress, one entry per region present in the dataset, sorted
// alphabetically by region name (same ordering as getRegions).
export function calculateRegionProgress(completedIds, peaks) {
    return getRegions(peaks).map(region => {
        const regionPeaks = peaks.filter(p => p.region === region);
        const total = regionPeaks.length;
        const completed = regionPeaks.filter(p => completedIds.has(p.id)).length;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { region, completed, total, percentage };
    });
}

// Returns a new Set with the peak's completion status flipped.
export function toggleCompleted(completedIds, peakId) {
    const next = new Set(completedIds);
    if (next.has(peakId)) {
        next.delete(peakId);
    } else {
        next.add(peakId);
    }
    return next;
}

// keepVisibleId (optional): a peak that stays in the list even if it no longer
// matches the filters, e.g. the peak whose details view is/was open, so the
// control that opened the details view still exists when focus returns to it.
export function filterPeaks(peaks, completedIds, regionFilter = 'all', statusFilter = 'all', keepVisibleId = null) {
    return peaks.filter(peak => {
        if (keepVisibleId != null && peak.id === keepVisibleId) return true;
        const matchesRegion = regionFilter === 'all' || peak.region === regionFilter;
        const isCompleted = completedIds.has(peak.id);
        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'completed' && isCompleted) ||
            (statusFilter === 'remaining' && !isCompleted);
        return matchesRegion && matchesStatus;
    });
}

export function getRegions(peaks) {
    return [...new Set(peaks.map(p => p.region))].sort();
}

export function parseStoredCompleted(raw) {
    if (!raw) return new Set();
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch {
        return new Set();
    }
}

export function serializeCompleted(completedIds) {
    return JSON.stringify([...completedIds]);
}

// True only when the dataset provides a non-empty grid reference for the peak.
export function hasGridRef(peak) {
    return typeof peak.gridRef === 'string' && peak.gridRef.trim().length > 0;
}

export function createRegionProgressItem({ region, completed, total, percentage }) {
    const name = escapeHtml(region);
    const itemClass = total > 0 && completed === total ? 'region-progress-item complete' : 'region-progress-item';
    return `
        <li class="${itemClass}">
            <div class="region-progress-header">
                <span class="region-name">${name}</span>
                <span class="region-count">${completed} / ${total} peaks · ${percentage}%</span>
            </div>
            <div class="progress-bar region-progress-bar" role="progressbar" aria-label="${name} completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}" aria-valuetext="${percentage}% (${completed} of ${total} peaks)">
                <div class="progress-fill" style="width: ${percentage}%"></div>
            </div>
        </li>
    `;
}

export function createPeakCard(peak, isCompleted) {
    const cardClass = isCompleted ? 'peak-card completed' : 'peak-card';
    const statusClass = isCompleted ? 'completed' : 'remaining';
    const statusText = isCompleted ? '✓ Completed' : 'Not climbed';
    const buttonClass = isCompleted ? 'mark-remaining' : 'mark-complete';
    const buttonText = isCompleted ? 'Mark as not climbed' : 'Mark as climbed';
    const name = escapeHtml(peak.name);
    // Grid reference is shown only when present in the dataset; it is never invented.
    const gridRef = hasGridRef(peak)
        ? `<p class="peak-gridref">Grid ref: ${escapeHtml(peak.gridRef)}</p>`
        : '';

    return `
        <article class="${cardClass}" data-peak-id="${escapeHtml(peak.id)}">
            <span class="peak-number">#${escapeHtml(peak.number)}</span>
            <h3 class="peak-name">${name}</h3>
            <p class="peak-region">${escapeHtml(peak.region)}</p>
            <p class="peak-height">${escapeHtml(peak.heightM)}m</p>
            ${gridRef}
            <p class="peak-status ${statusClass}">${statusText}</p>
            <button type="button" class="toggle-button ${buttonClass}" data-peak-id="${escapeHtml(peak.id)}" aria-pressed="${isCompleted}" aria-label="${buttonText}: ${name}">
                ${buttonText}
            </button>
            <button type="button" class="details-button" data-peak-id="${escapeHtml(peak.id)}" aria-haspopup="dialog" aria-label="View details for ${name}">
                View details
            </button>
        </article>
    `;
}

// Inner content of the peak details dialog. Only fields present in
// data/peaks.json are shown; the grid reference row is omitted entirely
// when the dataset does not provide one.
export function createPeakDetails(peak, isCompleted) {
    const id = escapeHtml(peak.id);
    const name = escapeHtml(peak.name);
    const statusClass = isCompleted ? 'completed' : 'remaining';
    const statusText = isCompleted ? '✓ Completed' : 'Not climbed';
    const buttonClass = isCompleted ? 'mark-remaining' : 'mark-complete';
    const buttonText = isCompleted ? 'Mark as not climbed' : 'Mark as climbed';
    const gridRefRow = hasGridRef(peak)
        ? `
                <div class="details-row">
                    <dt>Grid reference</dt>
                    <dd>${escapeHtml(peak.gridRef)}</dd>
                </div>`
        : '';

    return `
        <div class="peak-details ${statusClass}" data-peak-id="${id}">
            <div class="peak-details-header">
                <h2 id="peak-details-title" class="peak-details-title">${name}</h2>
                <button type="button" class="details-close-button" aria-label="Close details for ${name}">
                    <span aria-hidden="true">×</span> Close
                </button>
            </div>
            <dl class="peak-details-list">
                <div class="details-row">
                    <dt>Peak number</dt>
                    <dd>#${escapeHtml(peak.number)}</dd>
                </div>
                <div class="details-row">
                    <dt>Region</dt>
                    <dd>${escapeHtml(peak.region)}</dd>
                </div>
                <div class="details-row">
                    <dt>Height</dt>
                    <dd>${escapeHtml(peak.heightM)}m</dd>
                </div>${gridRefRow}
                <div class="details-row">
                    <dt>Status</dt>
                    <dd class="peak-status ${statusClass}">${statusText}</dd>
                </div>
            </dl>
            <button type="button" class="toggle-button details-toggle-button ${buttonClass}" data-peak-id="${id}" aria-pressed="${isCompleted}" aria-label="${buttonText}: ${name}">
                ${buttonText}
            </button>
        </div>
    `;
}
