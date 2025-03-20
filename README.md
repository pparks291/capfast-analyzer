# CapFast Latency Analyzer

A powerful desktop application for analyzing network capture files and visualizing latency metrics. CapFast helps network engineers and developers identify performance bottlenecks and understand latency patterns in their network traffic.

![CapFast Screenshot](https://via.placeholder.com/800x450?text=CapFast+Analyzer+Screenshot)

## Features

- **Load and analyze PCAP/PCAPNG files** - Support for standard packet capture formats
- **Batch processing architecture** - Efficiently process GB-sized capture files
- **Multi-core analysis** - Leverage all CPU cores for faster processing
- **Interactive visualization** - Time series, histograms, and statistical analysis
- **Multiple time formats** - Seconds, Wall Clock (UTC, Hawaii, Chile time)
- **Zoom and pan** - Explore data with interactive charts
- **Save/load analysis results** - Export your work for later use

## Getting Started

### Prerequisites

- Capture files in PCAP or PCAPNG format

### Installation

Download the latest release for your platform from the [Releases](https://gitlab.com/nsf-noirlab/gemini/rtsw/user-tools/capfast-analyzer/-/releases) page:

- Windows: `CapFast-Analyzer-Setup.exe`
- macOS: `CapFast-Analyzer.dmg`
- Linux: `CapFast-Analyzer.AppImage`

### Running the Application

1. Launch the application
2. Click "Select Capture File" to choose a PCAP file
3. Press "Analyze File" to begin processing
4. Once analysis completes, explore your data through the interactive charts

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v14 or newer)
- [npm](https://www.npmjs.com/) (v6 or newer)

### Setup Development Environment

```bash
# Clone the repository
git clone https://gitlab.com/nsf-noirlab/gemini/rtsw/user-tools/capfast-analyzer.git
cd capfast-analyzer

# Install dependencies
npm install

# Start the application
npm start
```

### Project Structure

- `main.js` - Electron main process, handles file processing and analysis
- `index.html` - UI layout and renderer process code
- `package.json` - Project configuration and dependencies

## Deployment

### Building from Source

To build the application from source, you'll need Node.js and npm installed on your system.

```bash
# Install dependencies
npm install

# Build for your current platform
npm run build

# Or build for a specific platform
npm run build:win   # Windows
npm run build:mac   # macOS
npm run build:linux # Linux
```

### Platform-Specific Builds

#### Windows (EXE)

```bash
npm run build:win
```
The Windows installer will be created in the `dist` directory.

#### macOS (DMG)

```bash
# macOS build requires a macOS system
npm run build:mac
```
The macOS disk image will be created in the `dist` directory.

#### Linux (AppImage)

```bash
npm run build:linux
```
The AppImage will be created in the `dist` directory.

### Distribution

The app is packaged using [electron-builder](https://www.electron.build/), which handles most platform-specific requirements automatically.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Electron framework for making cross-platform desktop apps easy
- Chart.js for the visualization components 