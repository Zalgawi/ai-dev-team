import {
    calculateProgress,
    calculateRegionProgress,
    toggleCompleted,
    filterPeaks,
    getRegions,
    parseStoredCompleted,
    serializeCompleted,
    createPeakCard,
    createRegionProgressItem,
    escapeHtml,
} from './peak-utils.js';

const STORAGE_KEY = 'trail100_completed';
const PEAKS_DATA_URL = '/data/peaks.json';

let peaks = [];
let completedPeaks = new Set();

async function loadPeaks() {
    try {
        const response = await fetch(PEAKS_DATA_URL);
        if (!response.ok) {
            throw new Error(`Failed to load peaks: ${response.status}`);
        }
        peaks = await response.json();
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

function renderPeaks() {
    const container = document.getElementById('peaks-container');
    const regionFilter = document.getElementById('region-filter').value;
    const statusFilter = document.getElementById('status-filter').value;

    const filteredPeaks = filterPeaks(peaks, completedPeaks, regionFilter, statusFilter);

    if (filteredPeaks.length === 0) {
        container.innerHTML = '<div class="empty-state">No peaks match the current filters.</div>';
        return;
    }

    container.innerHTML = filteredPeaks
        .map(peak => createPeakCard(peak, completedPeaks.has(peak.id)))
        .join('');
}

function handleToggleComplete(event) {
    const button = event.target.closest('.toggle-button');
    if (!button) return;
    const peakId = button.dataset.peakId;
    completedPeaks = toggleCompleted(completedPeaks, peakId);
    saveCompletedStatus();
    renderPeaks();
    updateProgressSummary();
    // Keep keyboard focus on the re-rendered button for the same peak.
    const sameButton = document.querySelector(`.toggle-button[data-peak-id="${CSS.escape(peakId)}"]`);
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

function setupEventListeners() {
    document.getElementById('peaks-container').addEventListener('click', handleToggleComplete);
    document.getElementById('region-filter').addEventListener('change', renderPeaks);
    document.getElementById('status-filter').addEventListener('change', renderPeaks);
    document.getElementById('reset-filters').addEventListener('click', () => {
        document.getElementById('region-filter').value = 'all';
        document.getElementById('status-filter').value = 'all';
        renderPeaks();
    });
}

function showError(message) {
    const container = document.getElementById('peaks-container');
    container.innerHTML = `<div class="empty-state" role="alert" style="color: #c00;">${escapeHtml(message)}</div>`;
}

document.addEventListener('DOMContentLoaded', loadPeaks);
