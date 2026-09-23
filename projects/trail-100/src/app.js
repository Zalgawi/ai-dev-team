const STORAGE_KEY = 'trail100_completed';
const PEAKS_DATA_URL = '../data/peaks.json';

let peaks = [];
let completedPeaks = new Set();

async function loadPeaks() {
    try {
        const response = await fetch(PEAKS_DATA_URL);
        if (!response.ok) {
            throw new Error(`Failed to load peaks: ${response.status}`);
        }
        peaks = await response.json();
        loadCompletedStatus();
        initializeApp();
    } catch (error) {
        console.error('Error loading peaks:', error);
        showError('Failed to load peaks. Please refresh the page.');
    }
}

function loadCompletedStatus() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            completedPeaks = new Set(JSON.parse(stored));
        } catch (e) {
            console.error('Error parsing completed peaks:', e);
            completedPeaks = new Set();
        }
    }
}

function saveCompletedStatus() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...completedPeaks]));
}

function initializeApp() {
    populateRegionFilter();
    renderPeaks();
    updateProgressSummary();
    setupEventListeners();
}

function populateRegionFilter() {
    const regions = [...new Set(peaks.map(p => p.region))].sort();
    const select = document.getElementById('region-filter');

    regions.forEach(region => {
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

    const filteredPeaks = peaks.filter(peak => {
        const matchesRegion = regionFilter === 'all' || peak.region === regionFilter;
        const isCompleted = completedPeaks.has(peak.id);
        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'completed' && isCompleted) ||
            (statusFilter === 'remaining' && !isCompleted);
        return matchesRegion && matchesStatus;
    });

    if (filteredPeaks.length === 0) {
        container.innerHTML = '<div class="empty-state">No peaks match the current filters.</div>';
        return;
    }

    container.innerHTML = filteredPeaks.map(peak => createPeakCard(peak)).join('');
    attachToggleListeners();
}

function createPeakCard(peak) {
    const isCompleted = completedPeaks.has(peak.id);
    const cardClass = isCompleted ? 'peak-card completed' : 'peak-card';
    const statusClass = isCompleted ? 'completed' : 'remaining';
    const statusText = isCompleted ? 'Completed' : 'Not climbed';
    const buttonClass = isCompleted ? 'mark-remaining' : 'mark-complete';
    const buttonText = isCompleted ? 'Mark as not climbed' : 'Mark as climbed';

    return `
        <article class="${cardClass}" data-peak-id="${peak.id}">
            <span class="peak-number">#${peak.number}</span>
            <h3 class="peak-name">${escapeHtml(peak.name)}</h3>
            <p class="peak-region">${escapeHtml(peak.region)}</p>
            <p class="peak-height">${peak.heightM}m</p>
            <p class="peak-status ${statusClass}">${statusText}</p>
            <button class="toggle-button ${buttonClass}" data-peak-id="${peak.id}" aria-label="${isCompleted ? 'Mark as not climbed' : 'Mark as climbed'}: ${escapeHtml(peak.name)}">
                ${buttonText}
            </button>
        </article>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function attachToggleListeners() {
    document.querySelectorAll('.toggle-button').forEach(button => {
        button.addEventListener('click', handleToggleComplete);
    });
}

function handleToggleComplete(event) {
    const peakId = event.currentTarget.dataset.peakId;
    if (completedPeaks.has(peakId)) {
        completedPeaks.delete(peakId);
    } else {
        completedPeaks.add(peakId);
    }
    saveCompletedStatus();
    renderPeaks();
    updateProgressSummary();
}

function updateProgressSummary() {
    const completed = completedPeaks.size;
    const total = peaks.length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    document.getElementById('progress-fill').style.width = `${percentage}%`;
    document.getElementById('progress-text').textContent = `${percentage}% complete (${completed}/${total} peaks)`;
}

function setupEventListeners() {
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
    container.innerHTML = `<div class="empty-state" style="color: #c00;">${escapeHtml(message)}</div>`;
}

document.addEventListener('DOMContentLoaded', loadPeaks);