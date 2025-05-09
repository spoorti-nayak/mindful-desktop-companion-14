
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification, screen } = require('electron');
const path = require('path');
const activeWin = require('active-win'); // Updated from get-windows
const express = require('express');
const { BlinkDetector } = require('./services/blink-detector');
const { connectDB } = require('./db/mongodb');
const { app: expressApp } = require('./index');
require('dotenv').config(); // Load environment variables from .env file

let mainWindow;
let tray = null;
let activeWindowInterval;
let blinkDetector;
let server;
let isMonitoring = true;
let isAppQuitting = false;
let lastActiveWindow = null;
let lastActiveWindowTime = Date.now();

async function createWindow() {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Start Express server
    const PORT = process.env.PORT || 5000;
    server = expressApp.listen(PORT, () => {
      console.log(`Express server running on port ${PORT}`);
    });

    // Get display dimensions
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    // Create the browser window and show it by default
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: true, // Changed to true to show the window on startup
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      }
    });

    // Load the app - in development, load from the Vite dev server on port 8080
    const startUrl = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:8080' 
      : `file://${path.join(__dirname, '../build/index.html')}`;
    
    console.log(`Loading application from: ${startUrl}`);
      
    mainWindow.loadURL(startUrl);

    // Open DevTools in development mode
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools();
    }

    // Initialize system tray
    createTray();
    
    // Start monitoring active windows
    startActiveWindowMonitoring();
    
    // Initialize blink detection
    initializeBlinkDetection();
    
    // Handle window close event - hide instead of closing
    mainWindow.on('close', (event) => {
      if (!isAppQuitting) {
        event.preventDefault();
        mainWindow.hide();
        showNotification("App Minimized", "Mindful Desktop Companion is still running in the system tray.");
        return false;
      }
      
      return true;
    });
    
    // Add minimize handler to hide to system tray
    mainWindow.on('minimize', (event) => {
      event.preventDefault();
      mainWindow.hide();
      showNotification("App Minimized", "Mindful Desktop Companion is still running in the system tray.");
    });
    
    // Test notification on startup
    setTimeout(() => {
      showNotification("App Started", "Mindful Desktop Companion is now running.");
    }, 2000);
  } catch (error) {
    console.error("Error during startup:", error);
    app.exit(1);
  }
}

function createTray() {
  try {
    // Use a proper icon path that works in production
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    console.log("Loading tray icon from:", iconPath);
    
    // Create native image from file
    const trayIcon = nativeImage.createFromPath(iconPath);
    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
    
    // Create context menu
    updateTrayMenu();
    
    tray.setToolTip('Mindful Desktop Companion');
    
    tray.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      }
    });
    
    console.log("Tray icon created successfully");
  } catch (error) {
    console.error("Error creating tray icon:", error);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  
  try {
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? 'Hide App' : 'Show App', 
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
          }
        }
      },
      { 
        label: isMonitoring ? 'Pause Monitoring' : 'Resume Monitoring', 
        click: toggleMonitoring 
      },
      { 
        label: 'Show Test Notification', 
        click: () => showNotification("Test", "This is a test notification") 
      },
      { type: 'separator' },
      { label: 'Quit', click: () => {
        isAppQuitting = true;
        app.quit();
      }}
    ]);
    
    tray.setContextMenu(contextMenu);
  } catch (error) {
    console.error("Error updating tray menu:", error);
  }
}

function startActiveWindowMonitoring() {
  // Clear any existing interval
  if (activeWindowInterval) {
    clearInterval(activeWindowInterval);
  }
  
  activeWindowInterval = setInterval(async () => {
    if (!isMonitoring || isAppQuitting) {
      return;
    }
    
    try {
      const activeWindow = await activeWin(); // Updated usage for active-win
      const now = Date.now();
      
      if (activeWindow) {
        // Calculate time spent in this window
        let timeInWindow = 0;
        if (lastActiveWindow && lastActiveWindow.owner?.path === activeWindow.owner?.path) {
          timeInWindow = now - lastActiveWindowTime;
        } else {
          // Window changed, reset timer
          lastActiveWindowTime = now;
        }
        
        // Store current window info
        lastActiveWindow = activeWindow;
        
        // Send to renderer process
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('active-window-changed', {
            title: activeWindow.title,
            owner: activeWindow.owner?.name || 'Unknown',
            path: activeWindow.owner?.path || 'Unknown',
            timeActive: timeInWindow
          });
        }
      }
    } catch (error) {
      console.error('Error getting active window:', error);
    }
  }, 1000);
}

function initializeBlinkDetection() {
  try {
    blinkDetector = new BlinkDetector();
    blinkDetector.on('blink', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('blink-detected');
      }
    });
    
    if (isMonitoring) {
      blinkDetector.start();
    }
    
    // Set up automatic eye care reminders (20-20-20 rule)
    setInterval(() => {
      if (isMonitoring) {
        showNotification("Eye Care Reminder", "Remember to blink and look 20ft away for 20 seconds.");
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('eye-care-reminder');
        }
      }
    }, 20 * 60 * 1000); // Every 20 minutes
  } catch (error) {
    console.error("Error initializing blink detection:", error);
  }
}

function toggleMonitoring() {
  isMonitoring = !isMonitoring;
  
  if (!isMonitoring) {
    if (activeWindowInterval) {
      clearInterval(activeWindowInterval);
      activeWindowInterval = null;
    }
    
    if (blinkDetector) {
      blinkDetector.stop();
    }
  } else {
    startActiveWindowMonitoring();
    
    if (blinkDetector) {
      blinkDetector.start();
    }
  }
  
  // Update the tray menu to reflect the new state
  updateTrayMenu();
}

// Function to show center-screen notifications
function showNotification(title, body) {
  try {
    console.log(`Showing notification: ${title} - ${body}`);
    
    if (Notification.isSupported()) {
      // Get the primary display dimensions
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;
      
      // Create a small invisible window to position the notification
      const notificationWindow = new BrowserWindow({
        width: 1,
        height: 1,
        x: Math.floor(width / 2),
        y: Math.floor(height / 2),
        show: false,
        frame: false,
        skipTaskbar: true,
        transparent: true,
        focusable: false,
        alwaysOnTop: true, // Make sure notification is on top
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      
      // Create the notification
      const notification = new Notification({
        title: title,
        body: body,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        silent: false,
        urgency: 'critical' // Make notification more visible
      });
      
      // After the window is created, show the notification
      notificationWindow.once('ready-to-show', () => {
        notification.show();
        
        // Clean up the notification window after a delay
        setTimeout(() => {
          if (notificationWindow && !notificationWindow.isDestroyed()) {
            notificationWindow.destroy();
          }
        }, 5000);
      });
      
      notificationWindow.loadURL('about:blank');
      
      // Handle notification click
      notification.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
      
      console.log("Notification shown from center of screen");
    } else {
      console.log("Native notifications not supported");
    }
  } catch (error) {
    console.error("Error showing notification:", error);
  }
}

// Handle IPC events from the renderer
ipcMain.on('show-tray', () => {
  if (!tray) createTray();
});

ipcMain.on('hide-tray', () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

ipcMain.on('set-tray-tooltip', (event, tooltip) => {
  if (tray) tray.setToolTip(tooltip);
});

// Add a new handler for setting tray icon
ipcMain.on('set-tray-icon', (event, iconType) => {
  if (!tray) return;
  
  let iconName = 'icon.png';
  if (iconType === 'active') iconName = 'icon-active.png';
  if (iconType === 'rest') iconName = 'icon-rest.png';
  
  const iconPath = path.join(__dirname, 'assets', iconName);
  try {
    const trayIcon = nativeImage.createFromPath(iconPath);
    tray.setImage(trayIcon.resize({ width: 16, height: 16 }));
  } catch (error) {
    console.error(`Error setting tray icon ${iconType}:`, error);
  }
});

// Add handler for native notifications
ipcMain.on('show-native-notification', (event, {title, body}) => {
  console.log(`IPC notification received: ${title} - ${body}`);
  showNotification(title, body);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.isQuitting = true;
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isAppQuitting = true;
  app.isQuitting = true;
  if (server) {
    server.close();
  }
  
  // Clear interval to prevent further errors
  if (activeWindowInterval) {
    clearInterval(activeWindowInterval);
    activeWindowInterval = null;
  }
});

// Ensure the app doesn't quit when all windows are closed
app.on('window-all-closed', (event) => {
  if (process.platform !== 'darwin') {
    // Don't quit the app
    event.preventDefault();
  }
});
