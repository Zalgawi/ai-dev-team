import {
    PAGE_SIZE,
    calculateProgress,
    calculateRegionProgress,
    toggleCompleted,
    filterPeaks,
    getRegions,
    parseStoredCompleted,
    serializeCompleted,
    paginate,
    createPagination,
    createPeakCard,
    createPeakDetails,
    createRegionProgressItem,
    escapeHtml,
} from './peak-utils.js';
import { createPeakDetailsController } from './peak-details-controller.js';

const STORAGE_KEY = 'trail100_completed';
const PEAKS_DATA_URL = '/data/peaks.json';
const MEDIA_DATA_URL = '/data/peak-media.json';

let peaks = [];
// Photos and routes keyed by peak id (data/peak-media.json).
let mediaById = {};
let completedPeaks = new Set();
// Current (1-based) gallery page.
let currentPage = 1;
// Controller for the peak details dialog (created in setupEventListeners).
let peakDetails = null;
// Peak whose details view was last opened. Its card stays in the list even if
// it stops matching the filters (e.g. unmarked from the details view while
// filtered to "Completed"), so focus can return to its "View details" button.
// Cleared whenever the user changes the filters.
let pinnedPeakId = null;

async function loadMedia() {
    try {
        const response = await fetch(MEDIA_DATA_URL);
        if (!response.ok) throw new Error(`Failed to load peak media: ${response.status}`);
        return await response.json();
    } catch (error) {
        // Photos and routes are optional extras: the tracker still works without them.
        console.error('Error loading peak media:', error);
        return {};
    }
}

async function loadPeaks() {
    try {
        const mediaPromise = loadMedia();
        const response = await fetch(PEAKS_DATA_URL);
        if (!response.ok) {
            throw new Error(`Failed to load peaks: ${response.status}`);
        }
        peaks = await response.json();
        mediaById = (await mediaPromise) || {};
        completedPeaks = parseStoredCompleted(localStorage.getItem(STORAGE_KEY));
        initializeApp();
    } catch (error) {
        console.error('Error loading peaks:', error);
        showError('Failed to load peaks. Please refresh the page.');
    }
}

function saveCompletedStatus() {
    localStorage.setItem(STORAGE_KEY, serializeCompleted(completedPeaks));
}

function initializeApp() {
    populateRegionFilter();
    renderPeaks();
    updateProgressSummary();
    setupEventListeners();
}

function populateRegionFilter() {
    const select = document.getElementById('region-filter');
    getRegions(peaks).forEach(region => {
        const option = document.createElement('option');
        option.value = region;
        option.textContent = region;
        select.appendChild(option);
    });
}

const mediaFor = peakId => (Object.prototype.hasOwnProperty.call(mediaById, peakId) ? mediaById[peakId] : null);

function renderPeaks() {
    const container = document.getElementById('peaks-container');
    const pagination = document.getElementById('pagination');
    const status = document.getElementById('gallery-status');
    const regionFilter = document.getElementById('region-filter').value;
    const statusFilter = document.getElementById('status-filter').value;

    const filteredPeaks = filterPeaks(peaks, completedPeaks, regionFilter, statusFilter, pinnedPeakId);

    if (filteredPeaks.length === 0) {
        currentPage = 1;
        container.innerHTML = '<div class="empty-state">No peaks match the current filters.</div>';
        pagination.innerHTML = '';
        status.textContent = 'No peaks match the current filters.';
        return;
    }

    const result = paginate(filteredPeaks, currentPage, PAGE_SIZE);
    currentPage = result.page;

    container.innerHTML = result.items
        .map(peak => createPeakCard(peak, completedPeaks.has(peak.id), mediaFor(peak.id)))
        .join('');
    pagination.innerHTML = result.pageCount > 1 ? createPagination(result.page, result.pageCount) : '';
    status.textContent = `Showing ${result.start}–${result.end} of ${result.totalItems} peaks` +
        (result.pageCount > 1 ? ` (page ${result.page} of ${result.pageCount})` : '');
}

// The user changed the filters: stop pinning the last opened peak, go back to
// the first page and re-render.
function applyFilters() {
    pinnedPeakId = null;
    currentPage = 1;
    renderPeaks();
}

function goToPage(page) {
    currentPage = page;
    renderPeaks();
    // Move keyboard focus to the start of the gallery.
    const heading = document.getElementById('peaks-heading');
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start' });
}

function handlePaginationClick(event) {
    const button = event.target.closest('.page-button');
    if (!button || button.disabled) return;
    const page = Number(button.dataset.page);
    if (Number.isFinite(page)) goToPage(page);
}

function findCardButton(selector, peakId) {
    return document.getElementById('peaks-container')
        .querySelector(`${selector}[data-peak-id="${CSS.escape(peakId)}"]`);
}

// Flip a peak's completion and refresh every view that depends on it.
function setPeakToggled(peakId) {
    completedPeaks = toggleCompleted(completedPeaks, peakId);
    saveCompletedStatus();
    renderPeaks();
    updateProgressSummary();
}

function openDetails(peakId) {
    pinnedPeakId = peakId;
    peakDetails.open(peakId);
}

function handlePeaksContainerClick(event) {
    const detailsButton = event.target.closest('.details-button');
    if (detailsButton) {
        openDetails(detailsButton.dataset.peakId);
        return;
    }
    // Clicking the photo is a mouse shortcut for "View details"; keyboard and
    // screen reader users use the View details button.
    const photo = event.target.closest('.peak-card-media');
    if (photo) {
        openDetails(photo.dataset.peakId);
        return;
    }
    handleToggleComplete(event);
}

function handleToggleComplete(event) {
    const button = event.target.closest('.toggle-button');
    if (!button) return;
    const peakId = button.dataset.peakId;
    setPeakToggled(peakId);
    // Keep keyboard focus on the re-rendered button for the same peak.
    const sameButton = findCardButton('.toggle-button', peakId);
    if (sameButton) sameButton.focus();
}

function updateProgressSummary() {
    const { completed, remaining, total, percentage } = calculateProgress(completedPeaks, peaks);
    const bar = document.getElementById('overall-progress-bar');
    bar.setAttribute('aria-valuenow', String(percentage));
    document.getElementById('progress-fill').style.width = `${percentage}%`;
    document.getElementById('progress-text').textContent =
        `${percentage}% complete (${completed}/${total} peaks, ${remaining} remaining)`;
    renderRegionProgress();
}

function renderRegionProgress() {
    document.getElementById('region-progress-list').innerHTML =
        calculateRegionProgress(completedPeaks, peaks)
            .map(createRegionProgressItem)
            .join('');
}

function renderPeakDetailsHtml(peakId) {
    const peak = peaks.find(p => p.id === peakId);
    return peak ? createPeakDetails(peak, completedPeaks.has(peak.id), mediaFor(peak.id)) : null;
}

function setupEventListeners() {
    document.getElementById('peaks-container').addEventListener('click', handlePeaksContainerClick);
    document.getElementById('pagination').addEventListener('click', handlePaginationClick);
    document.getElementById('region-filter').addEventListener('change', applyFilters);
    document.getElementById('status-filter').addEventListener('change', applyFilters);
    document.getElementById('reset-filters').addEventListener('click', () => {
        document.getElementById('region-filter').value = 'all';
        document.getElementById('status-filter').value = 'all';
        applyFilters();
    });

    peakDetails = createPeakDetailsController({
        dialog: document.getElementById('peak-details'),
        renderDetails: renderPeakDetailsHtml,
        togglePeak: setPeakToggled,
        findOpener: peakId => findCardButton('.details-button', peakId),
        fallbackFocus: () => document.getElementById('peaks-heading'),
    });
}

function showError(message) {
    const container = document.getElementById('peaks-container');
    container.innerHTML = `<div class="empty-state" role="alert" style="color: #c00;">${escapeHtml(message)}</div>`;
}

document.addEventListener('DOMContentLoaded', loadPeaks);
