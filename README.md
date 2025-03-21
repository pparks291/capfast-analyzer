# CapFast Latency Analyzer

A powerful desktop application for analyzing network capture files and visualizing latency metrics. CapFast helps network engineers and developers identify performance bottlenecks and understand latency patterns in their network traffic.

![CapFast Screenshot](https://via.placeholder.com/800x450?text=CapFast+Analyzer+Screenshot)

## How Latency is Calculated

CapFast calculates real network latency by measuring the time between data packets and their corresponding acknowledgments in TCP flows. Here's how it works:

### 1. Packet Flow Tracking
In `main.js` (lines 1341-1342), CapFast maintains a map of TCP flows:
```javascript
// Map to track packet flows for latency calculation
const packetFlowMap = new Map();
```

### 2. Signal Identification
For each packet, CapFast identifies TCP flows using source and destination IP/port combinations (`main.js` lines 1348-1500):
```javascript
function calculateLatencyMetric(header, data, signalId) {
  // For TCP flows, we need to calculate real latency between related packets
  if (signalId.startsWith('TCP-') && data.length > 34) {
    // Extract TCP header information
    const tcpFlags = data[tcpHeaderStart + 13];
    const isSYN = (tcpFlags & 0x02) !== 0;
    const isACK = (tcpFlags & 0x10) !== 0;
    const isPSH = (tcpFlags & 0x08) !== 0;
```

### 3. Latency Measurement
The actual latency is calculated when an acknowledgment packet is received (`main.js` lines 1422-1427):
```javascript
// This is acknowledging a data packet, calculate latency
const latency = timestamp - prevPacket.timestamp;

if (latency > 0 && latency < 1000000) { // Sanity check: 0 < latency < 1 second
  matchedPackets++;
  return latency;
}
```

Key points about the latency calculation:

1. **Real Network Latency**: Only measures actual round-trip time between data packets and their ACKs
2. **Sanity Checks**: 
   - Latency must be positive (> 0)
   - Latency must be less than 1 second (< 1,000,000 microseconds)
   - Only counts packets with payload (or SYN packets)
3. **Flow Management**:
   - Maintains up to 50 packets per flow in memory
   - Cleans up packets older than 5 seconds
   - Performs flow cleanup every 10 seconds
4. **Memory Efficiency**:
   - Uses a Map to track flows efficiently
   - Implements automatic cleanup to prevent memory leaks
   - Only stores necessary packet information

### 4. Statistics Collection
For each signal, CapFast collects:
- Average latency
- Maximum latency
- Minimum latency
- Standard deviation
- Jitter (variation in inter-arrival times)
- Histogram of latency values

The statistics are calculated in `main.js` (lines 1528-1600) using the collected latency measurements.

### 5. Data Storage
To handle large files efficiently, CapFast uses a temporary storage system (`main.js` lines 666-800) that:
- Buffers data points in memory
- Automatically flushes to disk when memory pressure is high
- Uses adaptive buffer sizes based on available heap memory
- Maintains data integrity with proper cleanup

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