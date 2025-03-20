// main.js - Electron Main Process
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const BinaryParser = require('binary-parser').Parser;
const os = require('os');
const { Worker } = require('worker_threads');
const v8 = require('v8');

// Set memory limits before app is ready
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('js-flags', '--expose-gc');

// Early startup logging
console.log('Starting CapFast Analyzer...');
console.log('Platform:', process.platform);
console.log('Arch:', process.arch);
console.log('Node version:', process.versions.node);
console.log('Electron version:', process.versions.electron);

// Write to a log file in case console output isn't visible
const logFile = path.join(os.homedir(), 'capfast-startup.log');
fs.writeFileSync(logFile, 'CapFast Analyzer starting at ' + new Date().toString() + '\n');

// Log system information
console.log('System Information:');
console.log('Total Memory:', (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2), 'GB');
console.log('Free Memory:', (os.freemem() / (1024 * 1024 * 1024)).toFixed(2), 'GB');

// Log V8 heap limits
const heapStats = v8.getHeapStatistics();
console.log('V8 Heap Limits:', {
    totalHeapSize: (heapStats.total_heap_size / (1024 * 1024)).toFixed(2) + ' MB',
    heapSizeLimit: (heapStats.heap_size_limit / (1024 * 1024)).toFixed(2) + ' MB',
    totalAvailable: (heapStats.total_available_size / (1024 * 1024)).toFixed(2) + ' MB'
});

// Handle unhandled exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  fs.appendFileSync(logFile, 'Uncaught Exception: ' + error.toString() + '\n' + error.stack + '\n');
});

let mainWindow;

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Ensure only one instance of the app is running
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is already running. Quitting...');
  app.quit();
} else {
  // Someone tried to run a second instance, focus our window instead
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('Second instance detected. Focusing the existing window...');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Proceed with normal application startup
  app.whenReady().then(() => {
    createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Define the pcap global header parser
const GlobalHeaderParser = new BinaryParser()
  .endianess('little')
  .uint32('magic_number')   // Magic number
  .uint16('version_major')  // Major version
  .uint16('version_minor')  // Minor version
  .int32('thiszone')        // GMT to local correction
  .uint32('sigfigs')        // Accuracy of timestamps
  .uint32('snaplen')        // Max length of captured packets
  .uint32('network');       // Data link type

// Define the pcap packet header parser
const PacketHeaderParser = new BinaryParser()
  .endianess('little')
  .uint32('ts_sec')         // Timestamp seconds
  .uint32('ts_usec')        // Timestamp microseconds/nanoseconds
  .uint32('incl_len')       // Included length
  .uint32('orig_len');      // Original length

// Common pcap magic numbers
const PCAP_MAGIC_NUMBERS = [
  0xa1b2c3d4, // Standard pcap
  0xd4c3b2a1, // Standard pcap (reverse byte order)
  0xa1b23c4d, // pcap with nanosecond resolution
  0x4d3cb2a1,  // pcap with nanosecond resolution (reverse byte order)
  0xa1b23c4d  // Custom CapFast variant we detected
];

// Handle file selection
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Capture Files', extensions: ['cap', 'pcap', 'pcapng'] }
    ]
  });
  
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

// Handle file stats requests
ipcMain.handle('get-file-stats', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime
    };
  } catch (error) {
    console.error(`Error getting file stats: ${error.message}`);
    return null;
  }
});

// Handle save dialog
ipcMain.handle('show-save-dialog', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'CapFast Analysis', extensions: ['cfa'] }],
    defaultPath: 'analysis_results.cfa'
  });
  
  if (!result.canceled) {
    return result.filePath;
  }
  return null;
});

// Handle load dialog
ipcMain.handle('show-load-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'CapFast Analysis', extensions: ['cfa'] }],
    properties: ['openFile']
  });
  
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

// Handle saving analysis data
ipcMain.handle('save-analysis', async (event, analysisData, savePath) => {
  try {
    // Save analysis data to file
    fs.writeFileSync(savePath, JSON.stringify(analysisData, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle loading analysis data
ipcMain.handle('load-analysis', async (event, loadPath) => {
  try {
    // Load analysis data from file
    const data = fs.readFileSync(loadPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { error: error.message };
  }
});

// Handle file analysis
ipcMain.handle('analyze-file', async (event, filePath) => {
  try {
    // Get file stats
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    
    // Send initial status message
    updateAnalysisStatus({
      status: 'starting',
      message: 'Beginning file analysis...',
      fileSize: fileSize,
      progress: 0
    });
    
    // Open the file for reading
    const fd = fs.openSync(filePath, 'r');

    // Read the global header (24 bytes)
    const headerBuffer = Buffer.alloc(24);
    fs.readSync(fd, headerBuffer, 0, 24, 0);
    
    // Parse the global header
    const globalHeader = GlobalHeaderParser.parse(headerBuffer);
    
    // Send header info
    updateAnalysisStatus({
      status: 'header',
      message: 'File header parsed',
      header: globalHeader,
      progress: 0
    });
    
    // Validate magic number
    if (!PCAP_MAGIC_NUMBERS.includes(globalHeader.magic_number)) {
      fs.closeSync(fd);
      return { 
        error: "Unsupported file format", 
        details: `Magic number 0x${globalHeader.magic_number.toString(16)} not recognized` 
      };
    }
    
    // PASS 1: Identify all signals using batch processing
    updateAnalysisStatus({
      status: 'pass1',
      message: 'Pass 1: Identifying signals...',
      progress: 0
    });
    
    const signalCounts = await identifyActiveSignals(fd, fileSize, (progress, packetCount, signalCount) => {
      // Update UI with progress
      updateAnalysisStatus({
        status: 'pass1',
        message: `Pass 1: Identified ${signalCount} signals (${packetCount.toLocaleString()} packets)`,
        progress: progress,
        packetCount: packetCount,
        signalCount: signalCount
      });
    });
    
    // Filter out signals with low counts to reduce memory usage
    const MIN_SIGNAL_COUNT = 10;
    const filteredSignals = Object.entries(signalCounts)
      .filter(([_, count]) => count >= MIN_SIGNAL_COUNT)
      .map(([signal, _]) => signal);
    
    // If too many signals, only take the top N to prevent memory overload
    const MAX_SIGNALS = 1000;
    let allSignals = filteredSignals;
    
    if (filteredSignals.length > MAX_SIGNALS) {
      // Sort by count (frequency) and take top MAX_SIGNALS
      allSignals = Object.entries(signalCounts)
        .sort((a, b) => b[1] - a[1]) // Sort by count descending
        .slice(0, MAX_SIGNALS)
        .map(([signal, _]) => signal);
      
      updateAnalysisStatus({
        status: 'filtered',
        message: `Limiting analysis to top ${MAX_SIGNALS} signals to preserve memory`,
        progress: 0,
        totalSignals: filteredSignals.length,
        analyzingSignals: MAX_SIGNALS
      });
    }
    
    // PASS 2: Collect detailed data for signals in batches
    updateAnalysisStatus({
      status: 'pass2',
      message: `Pass 2: Collecting metrics for ${allSignals.length} signals...`,
      progress: 0
    });
    
    const signalData = await collectSignalMetrics(fd, fileSize, allSignals, (progress, packetCount) => {
      // Update UI with progress
      updateAnalysisStatus({
        status: 'pass2',
        message: `Pass 2: Processed ${packetCount.toLocaleString()} packets`,
        progress: progress,
        packetCount: packetCount
      });
    });
    
    // Close the file
    fs.closeSync(fd);
    
    // Process the signal data to calculate metrics
    updateAnalysisStatus({
      status: 'processing',
      message: 'Calculating metrics using multiple CPU cores...',
      progress: 100
    });
    
    // Use multiple cores for processing the signals
    const results = await processSignalsWithMultiCore(signalData);
    
    // Clean up large data objects to free memory
    Object.keys(signalData).forEach(key => {
      delete signalData[key];
    });
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    // Add source file information to results for reference
    results._fileInfo = {
      path: filePath,
      size: fileSize,
      date: new Date().toISOString(),
      header: globalHeader,
      signalCount: {
        total: Object.keys(signalCounts).length,
        analyzed: allSignals.length
      }
    };
    
    // Send completion status
    updateAnalysisStatus({
      status: 'complete',
      message: 'Analysis complete',
      signalCount: Object.keys(results).length - 1, // Subtract 1 for the _fileInfo key
      progress: 100
    });
    
    return results;
    
  } catch (error) {
    updateAnalysisStatus({
      status: 'error',
      message: `Error: ${error.message}`,
      progress: 0
    });
    
    return { error: error.message, stack: error.stack };
  }
});

// First pass: count occurrences of each signal to identify all signals - USING BATCHES
async function identifyActiveSignals(fd, fileSize, progressCallback) {
  const signalCounts = {};
  let packetCount = 0;
  let processedBytes = 24; // Start after global header
  let currentPosition = 24;
  let lastProgressReport = 0;
  
  // Batch processing configuration
  const BATCH_SIZE = 1000; // Process 1000 packets per batch
  const packetHeaderBuffer = Buffer.alloc(16);
  
  // Process packets in batches until the end of file
  while (processedBytes < fileSize) {
    let batchPackets = 0;
    
    // Process a batch of packets
    while (batchPackets < BATCH_SIZE && processedBytes < fileSize) {
      try {
        // Read packet header (16 bytes)
        const bytesRead = fs.readSync(fd, packetHeaderBuffer, 0, 16, currentPosition);
        if (bytesRead < 16) {
          break; // End of file or incomplete packet header
        }
        
        // Parse packet header
        const packetHeader = PacketHeaderParser.parse(packetHeaderBuffer);
        
        // Update position
        currentPosition += 16;
        
        // Sanity check on packet length
        if (packetHeader.incl_len === 0 || packetHeader.incl_len > 65535) {
          // Skip this packet and try to resync
          currentPosition += 4;
          processedBytes += 20;
          continue;
        }
        
        // Read packet data
        const packetDataBuffer = Buffer.alloc(packetHeader.incl_len);
        fs.readSync(fd, packetDataBuffer, 0, packetHeader.incl_len, currentPosition);
        
        // Identify signal (don't store data yet)
        const signalIds = identifySignals(packetHeader, packetDataBuffer);
        
        // Increment counter for each signal
        signalIds.forEach(signalId => {
          signalCounts[signalId] = (signalCounts[signalId] || 0) + 1;
        });
        
        // Update counters
        packetCount++;
        currentPosition += packetHeader.incl_len;
        processedBytes += 16 + packetHeader.incl_len;
        batchPackets++;
        
      } catch (err) {
        // On error, try to skip ahead and resync
        currentPosition += 1024;
        processedBytes += 1024;
        break; // Exit batch on error
      }
    }
    
    // After each batch, report progress and allow GC to run
    const progressPercent = Math.floor((processedBytes / fileSize) * 100);
    if (progressPercent !== lastProgressReport) {
      progressCallback(progressPercent, packetCount, Object.keys(signalCounts).length);
      lastProgressReport = progressPercent;
    }
    
    // Allow event loop to process and GC to run
    await new Promise(resolve => setTimeout(resolve, 0));
    if (global.gc) global.gc();
  }
  
  return signalCounts;
}

// Second pass: collect detailed metrics for all signals - USING BATCHES
async function collectSignalMetrics(fd, fileSize, selectedSignals, progressCallback) {
  const signalData = {};
  let packetCount = 0;
  let processedBytes = 24; // Start after global header
  let currentPosition = 24;
  let lastProgressReport = 0;
  
  // Initialize data structure for each selected signal
  selectedSignals.forEach(signalId => {
    signalData[signalId] = [];
  });
  
  // Build lookup set for faster checking
  const selectedSignalsSet = new Set(selectedSignals);
  
  // Batch processing configuration
  const BATCH_SIZE = 1000; // Process 1000 packets per batch
  const packetHeaderBuffer = Buffer.alloc(16);
  
  // Process packets in batches until the end of file
  while (processedBytes < fileSize) {
    let batchPackets = 0;
    
    // Process a batch of packets
    while (batchPackets < BATCH_SIZE && processedBytes < fileSize) {
      try {
        // Read packet header (16 bytes)
        const bytesRead = fs.readSync(fd, packetHeaderBuffer, 0, 16, currentPosition);
        if (bytesRead < 16) {
          break; // End of file or incomplete packet header
        }
        
        // Parse packet header
        const packetHeader = PacketHeaderParser.parse(packetHeaderBuffer);
        
        // Update position
        currentPosition += 16;
        
        // Sanity check on packet length
        if (packetHeader.incl_len === 0 || packetHeader.incl_len > 65535) {
          // Skip this packet and try to resync
          currentPosition += 4;
          processedBytes += 20;
          continue;
        }
        
        // Extract timestamp
        const timestamp = packetHeader.ts_sec + (packetHeader.ts_usec / 1000000);
        
        // Read packet data
        const packetDataBuffer = Buffer.alloc(packetHeader.incl_len);
        fs.readSync(fd, packetDataBuffer, 0, packetHeader.incl_len, currentPosition);
        
        // Identify signals and collect metrics only for selected signals
        const signalIds = identifySignals(packetHeader, packetDataBuffer);
        
        // Add data point for each signal that's in our selected list
        signalIds.forEach(signalId => {
          if (selectedSignalsSet.has(signalId)) {
            const latencyMetric = calculateLatencyMetric(packetHeader, packetDataBuffer, signalId);
            
            // Add data point
            signalData[signalId].push({
              timestamp,
              latency: latencyMetric
            });
          }
        });
        
        // Update counters
        packetCount++;
        currentPosition += packetHeader.incl_len;
        processedBytes += 16 + packetHeader.incl_len;
        batchPackets++;
        
      } catch (err) {
        // On error, try to skip ahead and resync
        currentPosition += 1024;
        processedBytes += 1024;
        break; // Exit batch on error
      }
    }
    
    // After each batch, report progress and allow GC to run
    const progressPercent = Math.floor((processedBytes / fileSize) * 100);
    if (progressPercent !== lastProgressReport) {
      progressCallback(progressPercent, packetCount);
      lastProgressReport = progressPercent;
    }
    
    // Allow event loop to process and GC to run
    await new Promise(resolve => setTimeout(resolve, 0));
    if (global.gc) global.gc();
  }
  
  return signalData;
}

// Process signals using multiple cores with batch processing
async function processSignalsWithMultiCore(signalData) {
  // Get the available CPU cores, keep one free for the UI
  const numCpus = Math.max(1, os.cpus().length - 1);
  const signalIds = Object.keys(signalData);
  const results = {};
  
  console.log(`Using ${numCpus} CPU cores for processing`);
  
  // If very few signals, process directly
  if (signalIds.length <= 10) {
    return calculateLatencyMetrics(signalData);
  }
  
  // Create chunks of signals for parallel processing
  const chunks = [];
  const chunkSize = Math.ceil(signalIds.length / numCpus);
  
  for (let i = 0; i < numCpus; i++) {
    const startIdx = i * chunkSize;
    const endIdx = Math.min(startIdx + chunkSize, signalIds.length);
    if (startIdx < endIdx) {
      const chunkIds = signalIds.slice(startIdx, endIdx);
      const chunkData = {};
      
      chunkIds.forEach(id => {
        chunkData[id] = signalData[id];
      });
      
      chunks.push(chunkData);
    }
  }
  
  // Create workers for each chunk
  const workers = chunks.map((chunk, index) => {
    return createWorker(chunk, index);
  });
  
  // Process all chunks in parallel
  const chunkResults = await Promise.all(workers);
  
  // Merge results
  chunkResults.forEach(chunkResult => {
    Object.assign(results, chunkResult);
  });
  
  return results;
}

// Create a worker for processing a chunk of signals
function createWorker(signalChunk, workerId) {
  return new Promise((resolve, reject) => {
    // Create a temporary file for the worker data
    const tempDataPath = path.join(os.tmpdir(), `worker_data_${workerId}_${Date.now()}.json`);
    fs.writeFileSync(tempDataPath, JSON.stringify(signalChunk));
    
    // Create a worker script file
    const workerScriptPath = path.join(os.tmpdir(), `worker_script_${workerId}_${Date.now()}.js`);
    
    const workerScript = `
      const fs = require('fs');
      const { parentPort, workerData } = require('worker_threads');
      
      // Read the input data file
      const signalData = JSON.parse(fs.readFileSync(workerData.dataPath, 'utf8'));
      
      // Process the signals in batches
      const results = processSignalsInBatches(signalData);
      
      // Write results to output file
      fs.writeFileSync(workerData.outputPath, JSON.stringify(results));
      
      // Notify parent process that we're done
      parentPort.postMessage({ done: true });
      
      // Calculate histogram of latency values - OPTIMIZED TO AVOID STACK OVERFLOW
      function createHistogram(values, bins) {
        if (values.length === 0) return { bins: [], counts: [] };
        
        // Find min/max without using Math.min/max on full array to avoid stack issues
        let min = values[0];
        let max = values[0];
        for (let i = 1; i < values.length; i++) {
          if (values[i] < min) min = values[i];
          if (values[i] > max) max = values[i];
        }
        
        const range = max - min;
        
        // Handle case where all values are the same
        if (range === 0) {
          return {
            bins: [min],
            counts: [values.length]
          };
        }
        
        const binWidth = range / bins;
        const counts = Array(bins).fill(0);
        const binEdges = [];
        
        // Create bin edges
        for (let i = 0; i <= bins; i++) {
          binEdges.push(min + i * binWidth);
        }
        
        // Count values in each bin
        for (let i = 0; i < values.length; i++) {
          const binIndex = Math.min(Math.floor((values[i] - min) / binWidth), bins - 1);
          counts[binIndex]++;
        }
        
        // Create bin centers
        const binCenters = [];
        for (let i = 0; i < bins; i++) {
          binCenters.push(binEdges[i] + binWidth / 2);
        }
        
        return {
          bins: binCenters,
          counts
        };
      }
      
      // Process signals in batches to conserve memory
      function processSignalsInBatches(signalData) {
        const results = {};
        const MIN_DATA_POINTS = 10;
        const BATCH_SIZE = 5000; // Process in batches of 5000 data points
        
        // Process each signal
        Object.keys(signalData).forEach(signalId => {
          const signal = signalData[signalId];
          
          // Skip signals with too few data points
          if (signal.length < MIN_DATA_POINTS) {
            return;
          }
          
          // Sort data points by timestamp - use a more memory efficient sort
          signal.sort((a, b) => a.timestamp - b.timestamp);
          
          // Initialize aggregation variables
          let latencySum = 0;
          let latencyMin = Infinity;
          let latencyMax = -Infinity;
          let sumSquaredDiffs = 0;
          let prevTimestamp = null;
          let timeIntervals = [];
          let latencyValues = [];
          
          // Calculate stats in batches
          for (let startIdx = 0; startIdx < signal.length; startIdx += BATCH_SIZE) {
            const endIdx = Math.min(startIdx + BATCH_SIZE, signal.length);
            const batch = signal.slice(startIdx, endIdx);
            
            // Process each data point in the batch
            for (let i = 0; i < batch.length; i++) {
              const dataPoint = batch[i];
              const latency = dataPoint.latency;
              
              // Update basic stats
              latencySum += latency;
              latencyMin = Math.min(latencyMin, latency);
              latencyMax = Math.max(latencyMax, latency);
              
              // Store for histogram calculation
              latencyValues.push(latency);
              
              // Calculate time interval if not first point
              const timestamp = dataPoint.timestamp;
              if (prevTimestamp !== null) {
                timeIntervals.push(timestamp - prevTimestamp);
              }
              prevTimestamp = timestamp;
            }
          }
          
          // Calculate final statistics
          const count = signal.length;
          const avgLatency = latencySum / count;
          
          // Calculate standard deviation in a second pass
          for (let i = 0; i < latencyValues.length; i++) {
            sumSquaredDiffs += Math.pow(latencyValues[i] - avgLatency, 2);
          }
          const stdDev = Math.sqrt(sumSquaredDiffs / count);
          
          // Calculate jitter (variation in inter-arrival times)
          let jitter = 0;
          if (timeIntervals.length > 1) {
            const avgInterval = timeIntervals.reduce((sum, val) => sum + val, 0) / timeIntervals.length;
            const intervalVariance = timeIntervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / timeIntervals.length;
            jitter = Math.sqrt(intervalVariance);
          }
          
          // Create histogram data for frequency analysis - with limited batch size
          const histogram = createHistogram(latencyValues, 20);
          
          // Use all data points for visualization
          const sampleData = signal;
          
          // Store results
          results[signalId] = {
            stats: {
              count,
              avgLatency,
              maxLatency: latencyMax,
              minLatency: latencyMin,
              stdDev,
              jitter
            },
            histogram,
            sampleData
          };
          
          // Clean up to save memory
          latencyValues = null;
          timeIntervals = null;
        });
        
        return results;
      }
    `;
    
    fs.writeFileSync(workerScriptPath, workerScript);
    
    // Create output file path
    const outputPath = path.join(os.tmpdir(), `worker_result_${workerId}_${Date.now()}.json`);
    
    // Create the worker
    const worker = new Worker(workerScriptPath, {
      workerData: {
        dataPath: tempDataPath,
        outputPath: outputPath
      }
    });
    
    // Handle worker completion
    worker.on('message', () => {
      // Read the results
      const resultData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      
      // Clean up temporary files
      try {
        fs.unlinkSync(tempDataPath);
        fs.unlinkSync(workerScriptPath);
        fs.unlinkSync(outputPath);
      } catch (err) {
        console.error('Error cleaning up temp files:', err);
      }
      
      resolve(resultData);
    });
    
    // Handle worker errors
    worker.on('error', err => {
      console.error(`Worker ${workerId} error:`, err);
      
      // Clean up temporary files
      try {
        fs.unlinkSync(tempDataPath);
        fs.unlinkSync(workerScriptPath);
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      } catch (cleanupErr) {
        console.error('Error cleaning up temp files:', cleanupErr);
      }
      
      reject(err);
    });
    
    // Handle worker exit
    worker.on('exit', code => {
      if (code !== 0) {
        const err = new Error(`Worker ${workerId} exited with code ${code}`);
        
        // Clean up temporary files
        try {
          fs.unlinkSync(tempDataPath);
          fs.unlinkSync(workerScriptPath);
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch (cleanupErr) {
          console.error('Error cleaning up temp files:', cleanupErr);
        }
        
        reject(err);
      }
    });
  });
}

// Identify potential signals in a packet
function identifySignals(header, data) {
  const signalIds = [];
  
  try {
    // Method 1: Identify flows based on IP/port combinations (if packet is IP)
    if (data.length > 34) { // Minimum for Ethernet + IP + TCP/UDP header
      const etherType = (data[12] << 8) | data[13];
      
      // Check if this is an IPv4 packet (EtherType 0x0800)
      if (etherType === 0x0800) {
        const ipHeaderStart = 14;
        const ipVersion = (data[ipHeaderStart] >> 4) & 0xF;
        
        if (ipVersion === 4) {
          // Extract protocol and calculate header length
          const protocol = data[ipHeaderStart + 9];
          const ipHeaderLength = (data[ipHeaderStart] & 0x0F) * 4;
          const transportHeaderStart = ipHeaderStart + ipHeaderLength;
          
          // Source and destination IP addresses
          const srcIp = `${data[ipHeaderStart + 12]}.${data[ipHeaderStart + 13]}.${data[ipHeaderStart + 14]}.${data[ipHeaderStart + 15]}`;
          const dstIp = `${data[ipHeaderStart + 16]}.${data[ipHeaderStart + 17]}.${data[ipHeaderStart + 18]}.${data[ipHeaderStart + 19]}`;
          
          // Handle TCP and UDP packets
          if ((protocol === 6 || protocol === 17) && data.length > transportHeaderStart + 4) {
            // Get ports
            const srcPort = (data[transportHeaderStart] << 8) | data[transportHeaderStart + 1];
            const dstPort = (data[transportHeaderStart + 2] << 8) | data[transportHeaderStart + 3];
            
            // Create flow identifier
            const flowId = `${protocol === 6 ? "TCP" : "UDP"}-${srcIp}:${srcPort}->${dstIp}:${dstPort}`;
            signalIds.push(flowId);
          }
        }
      }
    }
    
    // Method 2: Use a simple hash of the first 8 bytes as an alternate signal identifier
    if (data.length > 8) {
      const dataHash = data.readUInt32LE(0) ^ data.readUInt32LE(4);
      const signalId = `Pattern-${dataHash.toString(16)}`;
      signalIds.push(signalId);
    }
    
  } catch (e) {
    // Ignore errors in signal identification
  }
  
  return signalIds;
}

// Calculate a latency metric for a signal
function calculateLatencyMetric(header, data, signalId) {
  // For TCP flows, try to extract sequence-based metrics
  if (signalId.startsWith('TCP-') && data.length > 34) {
    try {
      const etherType = (data[12] << 8) | data[13];
      
      if (etherType === 0x0800) {
        const ipHeaderStart = 14;
        const ipHeaderLength = (data[ipHeaderStart] & 0x0F) * 4;
        const tcpHeaderStart = ipHeaderStart + ipHeaderLength;
        
        // Use sequence number information if available
        if (data.length > tcpHeaderStart + 8) {
          const seqNum = (data[tcpHeaderStart + 4] << 24) | 
                        (data[tcpHeaderStart + 5] << 16) | 
                        (data[tcpHeaderStart + 6] << 8) | 
                        data[tcpHeaderStart + 7];
          
          return seqNum % 1000; // Simple example
        }
      }
    } catch (e) {
      // Fall back to timestamp-based metric
    }
  }
  
  // Default: use microsecond component of timestamp as latency metric
  return header.ts_usec % 1000;
}

// Calculate latency metrics for each signal (used for small datasets)
function calculateLatencyMetrics(signalData) {
  const results = {};
  
  // Minimum number of data points required for analysis
  const MIN_DATA_POINTS = 10;
  
  // Process each signal
  Object.keys(signalData).forEach(signalId => {
    const signal = signalData[signalId];
    
    // Skip signals with too few data points
    if (signal.length < MIN_DATA_POINTS) {
      return;
    }
    
    // Sort data points by timestamp
    signal.sort((a, b) => a.timestamp - b.timestamp);
    
    // Extract latency values and calculate inter-packet timing
    const latencyValues = [];
    const timeIntervals = [];
    
    for (let i = 0; i < signal.length; i++) {
      latencyValues.push(signal[i].latency);
      
      if (i > 0) {
        timeIntervals.push(signal[i].timestamp - signal[i-1].timestamp);
      }
    }
    
    // Calculate basic statistics
    const avgLatency = latencyValues.reduce((sum, val) => sum + val, 0) / latencyValues.length;
    const maxLatency = Math.max(...latencyValues);
    const minLatency = Math.min(...latencyValues);
    
    // Calculate standard deviation of latency
    const variance = latencyValues.reduce((sum, val) => sum + Math.pow(val - avgLatency, 2), 0) / latencyValues.length;
    const stdDev = Math.sqrt(variance);
    
    // Calculate jitter (variation in inter-arrival times)
    let jitter = 0;
    if (timeIntervals.length > 1) {
      const avgInterval = timeIntervals.reduce((sum, val) => sum + val, 0) / timeIntervals.length;
      const intervalVariance = timeIntervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / timeIntervals.length;
      jitter = Math.sqrt(intervalVariance);
    }
    
    // Create histogram data for frequency analysis
    const histogram = createHistogram(latencyValues, 20);
    
    // Use all data points for visualization
    const sampleData = signal;
    
    // Store results
    results[signalId] = {
      stats: {
        count,
        avgLatency,
        maxLatency,
        minLatency,
        stdDev,
        jitter
      },
      histogram,
      sampleData
    };
  });
  
  return results;
}

// Create histogram of latency values
function createHistogram(values, bins) {
  if (values.length === 0) return { bins: [], counts: [] };
  
  // Find min/max without using Math.min/max on full array to avoid stack issues
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  
  const range = max - min;
  
  // Handle case where all values are the same
  if (range === 0) {
    return {
      bins: [min],
      counts: [values.length]
    };
  }
  
  const binWidth = range / bins;
  const counts = Array(bins).fill(0);
  const binEdges = [];
  
  // Create bin edges
  for (let i = 0; i <= bins; i++) {
    binEdges.push(min + i * binWidth);
  }
  
  // Count values in each bin
  for (let i = 0; i < values.length; i++) {
    const binIndex = Math.min(Math.floor((values[i] - min) / binWidth), bins - 1);
    counts[binIndex]++;
  }
  
  // Create bin centers
  const binCenters = [];
  for (let i = 0; i < bins; i++) {
    binCenters.push(binEdges[i] + binWidth / 2);
  }
  
  return {
    bins: binCenters,
    counts
  };
}

// Update progress bar and status
function updateAnalysisStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('analysis-status', status);
  }
}