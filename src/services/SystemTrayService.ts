
// This service handles system tray functionality and active window monitoring

class SystemTrayService {
  private static instance: SystemTrayService;
  private lastActiveWindow: string | null = null;
  private windowSwitches: number = 0;
  private switchThreshold: number = 3;
  private switchTimeframe: number = 30000;
  private switchTimer: NodeJS.Timeout | null = null;
  private listeners: Array<(message: string, isFocusAlert: boolean) => void> = [];
  private isDesktopApp: boolean = false;
  private apiBaseUrl: string = 'http://localhost:5000/api';
  private trayIconState: 'default' | 'active' | 'rest' = 'default';
  private lastNotificationTime: number = 0;
  private notificationCooldown: number = 180000;

  // Screen time tracking variables
  private screenTimeStart: number = 0;
  private screenTimeToday: number = 0;
  private lastScreenTimeUpdate: number = 0;
  private idleThreshold: number = 60000;
  private lastActivityTime: number = 0;
  private screenTimeListeners: Array<(screenTime: number) => void> = [];
  private focusScoreListeners: Array<(score: number) => void> = [];
  private appUsageListeners: Array<(appUsage: Array<{name: string, time: number, type: string}>) => void> = [];
  private appUsageData: Map<string, {time: number, type: string}> = new Map();
  
  private userIdleTime: number = 0;
  private idleCheckInterval: NodeJS.Timeout | null = null;
  private focusScore: number = 100;
  private distractionCount: number = 0;
  private focusScoreUpdateListeners: Array<(score: number, distractions: number) => void> = [];

  private constructor() {
    console.log("System tray service initialized");
    
    // Check if running in Electron or similar desktop environment
    this.isDesktopApp = this.checkIsDesktopApp();
    
    // Initialize screen time tracking
    this.initializeScreenTimeTracking();
    
    if (this.isDesktopApp) {
      this.initializeDesktopMonitoring();
    }
    // Removed the simulation code that was creating fake data
  }

  // Initialize screen time tracking
  private initializeScreenTimeTracking(): void {
    // Start tracking screen time
    this.screenTimeStart = Date.now();
    this.lastActivityTime = Date.now();
    this.lastScreenTimeUpdate = Date.now();
    
    // Update screen time every minute
    setInterval(() => {
      this.updateScreenTime();
    }, 60000); // Update every minute
    
    // Check for user idle every 10 seconds
    this.idleCheckInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - this.lastActivityTime;
      
      if (timeSinceLastActivity > this.idleThreshold) {
        this.userIdleTime = timeSinceLastActivity;
      } else {
        this.userIdleTime = 0;
      }
    }, 10000);
    
    // Setup daily reset at midnight
    this.setupDailyReset();
  }
  
  // Setup daily reset at midnight
  private setupDailyReset(): void {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    
    const timeToMidnight = midnight.getTime() - now.getTime();
    
    setTimeout(() => {
      console.log("Resetting daily stats");
      this.resetDailyStats();
      
      // Setup next day's reset
      this.setupDailyReset();
    }, timeToMidnight);
  }
  
  // Reset daily statistics
  private resetDailyStats(): void {
    this.screenTimeToday = 0;
    this.distractionCount = 0;
    this.focusScore = 100;
    this.appUsageData.clear();
    
    // Notify listeners of reset
    this.notifyScreenTimeListeners();
    this.notifyFocusScoreListeners();
    this.notifyAppUsageListeners();
  }
  
  // Update screen time calculation
  private updateScreenTime(): void {
    const now = Date.now();
    
    // Don't count time if user is idle
    if (this.userIdleTime < this.idleThreshold) {
      const timeElapsed = now - this.lastScreenTimeUpdate;
      this.screenTimeToday += timeElapsed;
      
      // Notify listeners
      this.notifyScreenTimeListeners();
    }
    
    this.lastScreenTimeUpdate = now;
  }
  
  // Format screen time as hours:minutes
  public formatScreenTime(milliseconds: number): string {
    const totalMinutes = Math.floor(milliseconds / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    return `${hours}h ${minutes}m`;
  }

  // Detect if we're running in a desktop environment
  private checkIsDesktopApp(): boolean {
    // Check for Electron or similar desktop app environment
    const hasElectron = typeof window !== 'undefined' && 
                        window.electron !== undefined && 
                        typeof window.electron.send === 'function';
    console.log("Is electron environment:", hasElectron);
    return hasElectron;
  }

  // Allow external components to check if we're in desktop mode
  public isDesktopEnvironment(): boolean {
    return this.isDesktopApp;
  }

  // Initialize real monitoring for desktop environments
  private initializeDesktopMonitoring(): void {
    console.log("Initializing real desktop monitoring");
    
    // This connects to native APIs via Electron IPC in a real app
    if (this.isDesktopApp && window.electron) {
      // Listen for active window changes from main process
      const unsubscribeActiveWindow = window.electron.receive('active-window-changed', (windowInfo: any) => {
        this.handleRealWindowSwitch(windowInfo.title);
        
        // Track app usage
        this.trackAppUsage(windowInfo.title, windowInfo.owner || "Unknown");
        
        // Update last activity time
        this.lastActivityTime = Date.now();
      });
      
      // Listen for blink detection events
      const unsubscribeBlink = window.electron.receive('blink-detected', () => {
        this.notifyEyeCare();
      });
      
      // Set up eye care notification handler
      const unsubscribeEyeCare = window.electron.receive('eye-care-reminder', () => {
        this.notifyEyeCareBreak();
      });

      // Force a test notification on initialization
      setTimeout(() => {
        this.notifyTest();
      }, 3000);
    }
  }

  // Track app usage for a specific application
  private trackAppUsage(appTitle: string, appOwner: string): void {
    const appName = appOwner !== "Unknown" ? appOwner : appTitle;
    const now = Date.now();
    
    // Determine app type (productive, distraction, communication)
    let appType = this.determineAppType(appName);
    
    // Get or create app usage data
    if (!this.appUsageData.has(appName)) {
      this.appUsageData.set(appName, { time: 0, type: appType });
    }
    
    // Update app usage time (only if not idle)
    if (this.userIdleTime < this.idleThreshold && this.lastActiveWindow === appName) {
      const timeElapsed = now - this.lastActivityTime;
      const appData = this.appUsageData.get(appName);
      if (appData) {
        appData.time += timeElapsed;
        this.appUsageData.set(appName, appData);
      }
    }
    
    // Notify listeners
    this.notifyAppUsageListeners();
  }
  
  // Determine app type based on name
  private determineAppType(appName: string): "productive" | "distraction" | "communication" {
    const appNameLower = appName.toLowerCase();
    
    // Productive apps
    if (
      appNameLower.includes("code") || 
      appNameLower.includes("word") || 
      appNameLower.includes("excel") || 
      appNameLower.includes("powerpoint") || 
      appNameLower.includes("outlook") ||
      appNameLower.includes("terminal") ||
      appNameLower.includes("studio") ||
      appNameLower.includes("notepad") ||
      appNameLower.includes("editor")
    ) {
      return "productive";
    }
    
    // Communication apps
    if (
      appNameLower.includes("teams") || 
      appNameLower.includes("slack") || 
      appNameLower.includes("zoom") || 
      appNameLower.includes("meet") || 
      appNameLower.includes("mail") ||
      appNameLower.includes("outlook") ||
      appNameLower.includes("gmail")
    ) {
      return "communication";
    }
    
    // Distraction apps
    if (
      appNameLower.includes("youtube") || 
      appNameLower.includes("netflix") || 
      appNameLower.includes("facebook") || 
      appNameLower.includes("instagram") || 
      appNameLower.includes("twitter") ||
      appNameLower.includes("game") ||
      appNameLower.includes("reddit") ||
      appNameLower.includes("tiktok")
    ) {
      return "distraction";
    }
    
    // Default to productive if unknown
    return "productive";
  }
  
  // Add a screen time listener
  public addScreenTimeListener(callback: (screenTime: number) => void): void {
    this.screenTimeListeners.push(callback);
    
    // Initial callback with current value
    callback(this.screenTimeToday);
  }
  
  // Remove a screen time listener
  public removeScreenTimeListener(callback: (screenTime: number) => void): void {
    const index = this.screenTimeListeners.indexOf(callback);
    if (index > -1) {
      this.screenTimeListeners.splice(index, 1);
    }
  }
  
  // Notify all screen time listeners
  private notifyScreenTimeListeners(): void {
    this.screenTimeListeners.forEach(listener => {
      listener(this.screenTimeToday);
    });
  }
  
  // Add a focus score update listener
  public addFocusScoreListener(callback: (score: number, distractions: number) => void): void {
    this.focusScoreUpdateListeners.push(callback);
    
    // Initial callback with current values
    callback(this.focusScore, this.distractionCount);
  }
  
  // Remove a focus score update listener
  public removeFocusScoreListener(callback: (score: number, distractions: number) => void): void {
    const index = this.focusScoreUpdateListeners.indexOf(callback);
    if (index > -1) {
      this.focusScoreUpdateListeners.splice(index, 1);
    }
  }
  
  // Notify all focus score listeners
  private notifyFocusScoreListeners(): void {
    this.focusScoreUpdateListeners.forEach(listener => {
      listener(this.focusScore, this.distractionCount);
    });
  }
  
  // Add an app usage listener
  public addAppUsageListener(callback: (appUsage: Array<{name: string, time: number, type: string}>) => void): void {
    this.appUsageListeners.push(callback);
    
    // Initial callback with current values
    const appUsageArray = Array.from(this.appUsageData.entries()).map(([name, data]) => ({
      name,
      time: data.time,
      type: data.type
    }));
    
    callback(appUsageArray);
  }
  
  // Remove an app usage listener
  public removeAppUsageListener(callback: (appUsage: Array<{name: string, time: number, type: string}>) => void): void {
    const index = this.appUsageListeners.indexOf(callback);
    if (index > -1) {
      this.appUsageListeners.splice(index, 1);
    }
  }
  
  // Notify all app usage listeners
  private notifyAppUsageListeners(): void {
    const appUsageArray = Array.from(this.appUsageData.entries())
      .map(([name, data]) => ({
        name,
        time: data.time,
        type: data.type as "productive" | "distraction" | "communication"
      }))
      .sort((a, b) => b.time - a.time) // Sort by time descending
      .slice(0, 10); // Limit to top 10
    
    this.appUsageListeners.forEach(listener => {
      listener(appUsageArray);
    });
  }

  public static getInstance(): SystemTrayService {
    if (!SystemTrayService.instance) {
      SystemTrayService.instance = new SystemTrayService();
    }
    return SystemTrayService.instance;
  }

  // Handle real window switch data from desktop APIs
  private handleRealWindowSwitch(windowTitle: string): void {
    console.log(`Real active window changed to: ${windowTitle}`);
    this.handleWindowSwitch(windowTitle);
  }

  // Handle window switch 
  private handleWindowSwitch(newWindow: string): void {
    console.log(`Active window changed to: ${newWindow}`);
    
    if (this.lastActiveWindow === newWindow) return;
    
    this.lastActiveWindow = newWindow;
    this.windowSwitches++;
    
    // Reset timer if exists
    if (this.switchTimer) {
      clearTimeout(this.switchTimer);
    }
    
    // Set new timer to reset counter after timeframe
    this.switchTimer = setTimeout(() => {
      this.windowSwitches = 0;
    }, this.switchTimeframe);
    
    // Check if we've exceeded the threshold
    if (this.windowSwitches >= this.switchThreshold) {
      // Only send notification if cooldown period has passed
      const now = Date.now();
      if (now - this.lastNotificationTime > this.notificationCooldown) {
        this.notifyFocusNeeded();
        this.lastNotificationTime = now;
        
        // Update focus score
        this.distractionCount++;
        this.focusScore = Math.max(0, 100 - (this.distractionCount * 5));
        
        // Notify listeners of focus score update
        this.notifyFocusScoreListeners();
      }
      this.windowSwitches = 0;
    }
  }

  // Test notification method - updated to ensure it works
  private notifyTest(): void {
    const message = "System tray notification test - if you see this, notifications are working!";
    
    // Show as native notification when in desktop mode
    if (this.isDesktopApp && window.electron) {
      console.log("Sending test notification via IPC");
      try {
        window.electron.send('show-native-notification', {
          title: "Notification Test", 
          body: message
        });
        console.log("Test notification sent successfully");
      } catch (error) {
        console.error("Error sending test notification:", error);
      }
    }
    
    this.listeners.forEach(listener => listener(message, true));
  }

  private notifyFocusNeeded(): void {
    const message = "You seem distracted. Try focusing on one task at a time.";
    
    if (this.isDesktopApp && window.electron) {
      console.log("Sending focus notification via IPC");
      window.electron.send('show-native-notification', {
        title: "Focus Reminder", 
        body: message
      });
    }
    
    this.listeners.forEach(listener => listener(message, true));
  }

  private notifyEyeCare(): void {
    const message = "Remember to blink regularly to reduce eye strain.";
    
    if (this.isDesktopApp && window.electron) {
      console.log("Sending eye care notification via IPC");
      window.electron.send('show-native-notification', {
        title: "Blink Reminder", 
        body: message
      });
    }
    
    this.listeners.forEach(listener => listener(message, true));
  }
  
  private notifyEyeCareBreak(): void {
    const message = "Time to rest your eyes! Look 20ft away for 20 seconds.";
    
    if (this.isDesktopApp && window.electron) {
      console.log("Sending eye care break notification via IPC");
      window.electron.send('show-native-notification', {
        title: "Eye Care Break", 
        body: message
      });
    }
    
    // Update tray icon to rest mode
    this.setTrayIcon('rest');
    
    this.listeners.forEach(listener => listener(message, true));
  }

  public addNotificationListener(callback: (message: string, isFocusAlert: boolean) => void): void {
    this.listeners.push(callback);
  }

  public removeNotificationListener(callback: (message: string, isFocusAlert: boolean) => void): void {
    const index = this.listeners.indexOf(callback);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  // Save user preferences to MongoDB
  public async savePreferences(userId: string, preferences: any): Promise<boolean> {
    if (!userId) return false;
    
    try {
      const response = await fetch(`${this.apiBaseUrl}/preferences/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(preferences)
      });
      
      return response.ok;
    } catch (error) {
      console.error('Failed to save preferences:', error);
      return false;
    }
  }
  
  // Load user preferences from MongoDB
  public async loadPreferences(userId: string): Promise<any> {
    if (!userId) return null;
    
    try {
      const response = await fetch(`${this.apiBaseUrl}/preferences/${userId}`);
      
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error('Failed to load preferences:', error);
      return null;
    }
  }

  // Improved methods to interact with the system tray
  public showTrayIcon(): void {
    if (this.isDesktopApp && window.electron) {
      console.log("Showing system tray icon via IPC");
      try {
        window.electron.send('show-tray');
        console.log("Show tray command sent successfully");
      } catch (error) {
        console.error("Error showing tray:", error);
      }
    }
    console.log("System tray icon shown");
  }

  public hideTrayIcon(): void {
    if (this.isDesktopApp && window.electron) {
      console.log("Hiding system tray icon via IPC");
      window.electron.send('hide-tray');
    }
    console.log("System tray icon hidden");
  }

  public setTrayTooltip(tooltip: string): void {
    if (this.isDesktopApp && window.electron) {
      console.log(`Setting tray tooltip to: ${tooltip}`);
      window.electron.send('set-tray-tooltip', tooltip);
    }
    console.log(`Set tray tooltip to: ${tooltip}`);
  }
  
  // Updated method to set the tray icon state
  public setTrayIcon(state: 'default' | 'active' | 'rest'): void {
    if (this.trayIconState === state) return; // No change needed
    
    this.trayIconState = state;
    console.log(`Setting tray icon state to: ${state}`);
    
    if (this.isDesktopApp && window.electron) {
      window.electron.send('set-tray-icon', state);
    }
  }
  
  // Get current screen time
  public getScreenTime(): number {
    this.updateScreenTime(); // Force update to get current value
    return this.screenTimeToday;
  }
  
  // Get formatted screen time
  public getFormattedScreenTime(): string {
    return this.formatScreenTime(this.getScreenTime());
  }
  
  // Get current focus score
  public getFocusScore(): number {
    return this.focusScore;
  }
  
  // Get current distraction count
  public getDistractionCount(): number {
    return this.distractionCount;
  }
}

export default SystemTrayService;
