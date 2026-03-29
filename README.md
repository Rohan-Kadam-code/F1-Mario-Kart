# 🏎️ F1 Mario Kart Visualiser

**F1 Mario Kart Visualiser** is an interactive, browser-based telemetry application that transforms historical Formula 1 data from the [OpenF1 API](https://openf1.org/) into a dynamic, accurate racing map. Track car positions, navigate through time with full playback controls, and visualize the race realistically lap-by-lap.

## ✨ Features

- **Offline-First Telemetry Caching**: A custom-built `IndexedDB` caching engine natively intercepts all OpenF1 location chunk requests. Once you load a race, the multi-gigabyte positional data is persistently stored in your browser, allowing instant, offline reloading and preventing server-side API rate limits.
- **Precise Track Alignment (ICP)**: Automatically calibrates massive point clouds of F1 coordinate data onto GeoJSON track outlines using a specialized Iterative Closest Point (ICP) algorithm. It dynamically accounts for independent X/Y map stretching and rotation bounds to ensure perfectly traced racing lines around complex sectors like hairpins.
- **Millisecond Pit Tracking**: Programmatically reads OpenF1 `/pit` endpoints to execute physically flawless pit entries and exits. Cars are cleanly moved off the main track mapping, and the dynamic leaderboard explicitly calls out their stationary duration.
- **Hardware-Accelerated UI**: Built purely with HTML5 Canvas and Vanilla JS to securely render thousands of telemetry points at smooth 60 FPS, completely avoiding heavy framework overhead architectures. 
- **Time-Scrubbing Controls**: Sub-second playback manipulation allowing you to smoothly scrub across a 2+ hour race in granular, detailed steps.

## 🚀 Quick Start

Ensure you have [Node.js](https://nodejs.org/) installed, then run:

```bash
# 1. Install dependencies
npm install

# 2. Start the local development server 
npm run dev
```

Open your browser to `http://localhost:5173`. Simply select a Year, Meeting, and Racing Session from the dropdowns at the top, hit **Load Race**, and use the Playback scrubber to watch the action unfold!

## 🛠️ Tech Stack

- **Core**: Vanilla JavaScript (ES6+), HTML5 Canvas
- **Data Persistence**: `idb` (IndexedDB Wrapper)
- **API**: [OpenF1 REST API](https://github.com/bracingformula/openf1)
- **Build Tool**: Vite

## 🤝 Contributing

Contributions are completely welcome! If you have any ideas, fixes, or track geometry updates:
1. Fork the Project
2. Create your Feature Branch (\`git checkout -b feature/AmazingFeature\`)
3. Commit your Changes (\`git commit -m 'Add some AmazingFeature'\`)
4. Push to the Branch (\`git push origin feature/AmazingFeature\`)
5. Open a Pull Request!
