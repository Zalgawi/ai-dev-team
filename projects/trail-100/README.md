# Trail 100 Tracker

A personal web application for tracking progress through the Live for the Outdoors Trail 100 challenge.

## Overview

The Trail 100 challenge consists of 100 UK peaks. This application allows users to:

- Browse all 100 peaks
- See which peaks they have completed
- Mark peaks as completed
- Track overall progress
- View progress by region
- View individual peak information

## Features

### Display
- Peak name
- Elevation
- Region
- Grid reference

### Interactions
- Mark peaks as completed
- Unmark completed peaks

### Statistics
- Overall completion percentage
- Completed / remaining counts

### Requirements
- Responsive design for mobile and desktop
- Accessible interactive controls
- Automated tests for core functionality

## Getting Started

### Running the Application

1. Install Node.js
2. Run `npm install` to install dependencies
3. Run `npm start` to start the development server
4. Open http://localhost:3000 in your browser

### Structure

- **src/** - Source code and HTML/CSS/JS files
  - `server.js` - Development server
  - `index.html` - Main application page
  - `app.js` - Frontend application logic
  - `style.css` - Styling
- **data/** - Data files
  - `peaks.json` - Trail 100 peak dataset (100 peaks)
- **tests/** - Automated tests
  - `run-tests.js` - Test runner

## Data

Peak data is stored in `data/peaks.json` and contains all 100 Trail 100 peaks with:
- Name
- Region
- Height (in meters)

User completion status is stored separately in `localStorage`.

## Acceptance Criteria

The application must:

- Contain all 100 Trail 100 peaks
- Display peak name, region, and height for each peak
- Allow a user to mark a peak as completed
- Allow a completed peak to be unmarked
- Display overall completion percentage
- Display completed / remaining counts
- Work on mobile and desktop
- Have accessible interactive controls
- Have automated tests for core functionality

## Development

This project uses vanilla JavaScript (ES6+) with no external dependencies to keep it simple and maintainable.