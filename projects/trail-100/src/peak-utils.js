// Pure, DOM-free helpers shared by the browser app (app.js) and the test suite.

export const PAGE_SIZE = 12;

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

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

// Number of pages needed for totalItems; always at least 1 (an empty result
// still has one, empty, page).
export function getPageCount(totalItems, pageSize = PAGE_SIZE) {
    const size = Math.max(1, Math.floor(Number(pageSize)) || 1);
    const total = Math.max(0, Math.floor(Number(totalItems)) || 0);
    return Math.max(1, Math.ceil(total / size));
}

// Clamp a (1-based) page number into 1..pageCount. Non-numeric values go to 1.
export function clampPage(page, pageCount) {
    const count = Math.max(1, Math.floor(Number(pageCount)) || 1);
    const n = Math.floor(Number(page));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, count);
}

// Slice one page out of items. The requested page is clamped, so an
// out-of-range page (e.g. after filtering shrinks the results) returns the
// nearest valid page. start/end are 1-based positions for "Showing x–y of n".
export function paginate(items, page, pageSize = PAGE_SIZE) {
    const size = Math.max(1, Math.floor(Number(pageSize)) || 1);
    const totalItems = items.length;
    const pageCount = getPageCount(totalItems, size);
    const current = clampPage(page, pageCount);
    const offset = (current - 1) * size;
    const pageItems = items.slice(offset, offset + size);
    return {
        items: pageItems,
        page: current,
        pageCount,
        totalItems,
        start: pageItems.length ? offset + 1 : 0,
        end: offset + pageItems.length,
    };
}

// 1-based page that contains the item at the given 0-based index.
export function pageForIndex(index, pageSize = PAGE_SIZE) {
    return Math.floor(Math.max(0, index) / pageSize) + 1;
}

// Previous / numbered / Next controls. Returns '' when there is nothing to page.
export function createPagination(page, pageCount) {
    const count = Math.max(1, Math.floor(Number(pageCount)) || 1);
    const current = clampPage(page, count);
    const numbers = [];
    for (let n = 1; n <= count; n++) {
        const isCurrent = n === current;
        numbers.push(`<li><button type="button" class="page-button page-number${isCurrent ? ' is-current' : ''}" data-page="${n}" aria-label="Page ${n}"${isCurrent ? ' aria-current="page"' : ''}>${n}</button></li>`);
    }
    return `
        <nav class="pagination" aria-label="Peak gallery pages">
            <button type="button" class="page-button page-prev" data-page="${current - 1}" aria-label="Previous page"${current <= 1 ? ' disabled' : ''}>
                <span aria-hidden="true">←</span> Previous
            </button>
            <ol class="page-list">${numbers.join('')}</ol>
            <button type="button" class="page-button page-next" data-page="${current + 1}" aria-label="Next page"${current >= count ? ' disabled' : ''}>
                Next <span aria-hidden="true">→</span>
            </button>
        </nav>
    `;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// True only when the dataset provides a non-empty grid reference for the peak.
export function hasGridRef(peak) {
    return typeof peak.gridRef === 'string' && peak.gridRef.trim().length > 0;
}

const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0;

// True when the media entry has an image with a usable src.
export function hasPhoto(media) {
    return Boolean(media && media.image && isNonEmptyString(media.image.src));
}

// True when the media entry has a route with both a route page and a GPX file.
export function hasRoute(media) {
    const route = media && media.route;
    return Boolean(route && isNonEmptyString(route.url) && isNonEmptyString(route.gpxUrl));
}

function photoAlt(peak, image) {
    return isNonEmptyString(image.alt) ? image.alt : `${peak.name}, ${peak.region}`;
}

const NEW_TAB = 'target="_blank" rel="noopener noreferrer"';
const NEW_TAB_HINT = '<span class="visually-hidden"> (opens in a new tab)</span>';

function externalLink(href, text, className) {
    return `<a class="${className}" href="${escapeHtml(href)}" ${NEW_TAB}>${text}${NEW_TAB_HINT}</a>`;
}

// Card photo: lazy-loaded inside a fixed aspect-ratio frame (see .peak-photo
// in style.css) so cards do not change size while images load. Peaks without
// a photo keep the same frame with a neutral background.
export function createCardPhoto(peak, media) {
    if (!hasPhoto(media)) {
        return '<div class="peak-photo no-photo" aria-hidden="true"></div>';
    }
    const image = media.image;
    return `<div class="peak-photo"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(photoAlt(peak, image))}" loading="lazy" decoding="async"></div>`;
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

// media (optional): the peak's entry from data/peak-media.json.
export function createPeakCard(peak, isCompleted, media = null) {
    const cardClass = isCompleted ? 'peak-card completed' : 'peak-card';
    const statusClass = isCompleted ? 'completed' : 'remaining';
    const statusText = isCompleted ? '✓ Completed' : 'Not climbed';
    const buttonClass = isCompleted ? 'mark-remaining' : 'mark-complete';
    const buttonText = isCompleted ? 'Mark as not climbed' : 'Mark as climbed';
    const name = escapeHtml(peak.name);
    const id = escapeHtml(peak.id);
    // Grid reference is shown only when present in the dataset; it is never invented.
    const gridRef = hasGridRef(peak)
        ? `<p class="peak-gridref">Grid ref: ${escapeHtml(peak.gridRef)}</p>`
        : '';

    return `
        <article class="${cardClass}" data-peak-id="${id}">
            <div class="peak-card-media" data-peak-id="${id}">
                ${createCardPhoto(peak, media)}
                <span class="peak-number">#${escapeHtml(peak.number)}</span>
            </div>
            <div class="peak-card-body">
                <h3 class="peak-name">${name}</h3>
                <p class="peak-meta">
                    <span class="peak-region">${escapeHtml(peak.region)}</span>
                    <span class="peak-height">${escapeHtml(peak.heightM)}m</span>
                </p>
                ${gridRef}
                <p class="peak-status ${statusClass}">${statusText}</p>
                <div class="peak-card-actions">
                    <button type="button" class="toggle-button ${buttonClass}" data-peak-id="${id}" aria-pressed="${isCompleted}" aria-label="${buttonText}: ${name}">
                        ${buttonText}
                    </button>
                    <button type="button" class="details-button" data-peak-id="${id}" aria-haspopup="dialog" aria-label="View details for ${name}">
                        View details
                    </button>
                </div>
            </div>
        </article>
    `;
}

// Large photo for the details dialog with credit, licence (linked when the
// data provides a licence URL) and a link to the photo's source page.
export function createDetailsPhoto(peak, media) {
    if (!hasPhoto(media)) return '';
    const image = media.image;
    const parts = [];
    if (isNonEmptyString(image.credit)) {
        parts.push(`<span class="photo-credit">Photo: ${escapeHtml(image.credit)}</span>`);
    }
    if (isNonEmptyString(image.licence)) {
        parts.push(isNonEmptyString(image.licenceUrl)
            ? `<span class="photo-licence">Licence: ${externalLink(image.licenceUrl, escapeHtml(image.licence), 'licence-link')}</span>`
            : `<span class="photo-licence">Licence: ${escapeHtml(image.licence)}</span>`);
    }
    if (isNonEmptyString(image.sourceUrl)) {
        const sourceName = isNonEmptyString(image.source) ? escapeHtml(image.source) : 'source page';
        parts.push(`<span class="photo-source">${externalLink(image.sourceUrl, `View on ${sourceName}`, 'photo-source-link')}</span>`);
    }
    const caption = parts.length ? `<figcaption class="peak-details-caption">${parts.join(' ')}</figcaption>` : '';
    return `
            <figure class="peak-details-photo">
                <img src="${escapeHtml(image.src)}" alt="${escapeHtml(photoAlt(peak, image))}" decoding="async">
                ${caption}
            </figure>`;
}

// Walking route section of the details dialog. Peaks without a verified route
// get a plain message and no links.
export function createRouteSection(media) {
    if (!hasRoute(media)) {
        return `
            <section class="route-section no-route" aria-labelledby="route-heading">
                <h3 id="route-heading" class="route-heading">Walking route</h3>
                <p class="route-unavailable">A verified walking route is not available for this peak yet.</p>
            </section>`;
    }
    const route = media.route;
    const title = isNonEmptyString(route.title) ? escapeHtml(route.title) : 'Walking route';
    const source = isNonEmptyString(route.source)
        ? `<p class="route-source">Route source: ${escapeHtml(route.source)}</p>`
        : '';
    return `
            <section class="route-section has-route" aria-labelledby="route-heading">
                <h3 id="route-heading" class="route-heading">Walking route</h3>
                <p class="route-title">${title}</p>
                ${source}
                <div class="route-links">
                    ${externalLink(route.url, 'View route page', 'route-link')}
                    ${externalLink(route.gpxUrl, 'Download GPX', 'gpx-link')}
                </div>
                <div class="garmin-help">
                    <h4 class="garmin-heading">Load the route onto a Garmin watch</h4>
                    <ol class="garmin-steps">
                        <li>Download the GPX file to your computer.</li>
                        <li>Sign in to Garmin Connect on the web, open Training &amp; Planning › Courses and choose Import.</li>
                        <li>Select the GPX file, save it as a course and choose Send to Device.</li>
                        <li>Sync your watch with the Garmin Connect app or Garmin Express, then find the route under Navigation › Courses.</li>
                    </ol>
                </div>
            </section>`;
}

// Inner content of the peak details dialog. Only fields present in
// data/peaks.json and data/peak-media.json are shown; the grid reference row is
// omitted entirely when the dataset does not provide one.
export function createPeakDetails(peak, isCompleted, media = null) {
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
        <div class="peak-details ${statusClass}" data-peak-id="${id}">${createDetailsPhoto(peak, media)}
            <div class="peak-details-body">
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
                </button>${createRouteSection(media)}
            </div>
        </div>
    `;
}
