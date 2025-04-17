const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { KubeConfig, CoreV1Api, CustomObjectsApi } = require('@kubernetes/client-node');
const { execSync } = require('child_process');
const fs = require('fs');

let mainWindow;
let kubeConfig = null;

// Function to get the shell environment
function getShellEnvironment() {
  try {
    // For macOS, we need to get the environment from the shell
    if (process.platform === 'darwin') {
      const shell = process.env.SHELL || '/bin/bash';
      const envCommand = `${shell} -l -c 'env'`;
      const envOutput = execSync(envCommand).toString();
      
      const env = {};
      envOutput.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
          env[key] = values.join('=');
        }
      });
      
      return env;
    }
    return process.env;
  } catch (error) {
    console.error('Error getting shell environment:', error);
    return process.env;
  }
}

// Initialize environment variables
const shellEnv = getShellEnvironment();
process.env = { ...process.env, ...shellEnv };

function initializeKubeConfig() {
  try {
    kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();

    const currentContext = kubeConfig.getCurrentContext();
    const context = kubeConfig.getContextObject(currentContext);
    if (!context) {
      console.error(`Context '${currentContext}' not found in kubeconfig.`);
      return;
    }

    const user = kubeConfig.getUser(context.user);
    if (!user) {
      console.error(`User '${context.user}' not found in kubeconfig.`);
      return;
    }

    if (user.exec && user.exec.command === 'aws') {
      const commonAwsPaths = [
        '/usr/local/bin/aws',
        '/opt/homebrew/bin/aws',
        '/usr/bin/aws',
        `${process.env.HOME}/.local/bin/aws`,
        `${process.env.HOME}/bin/aws`
      ];

      let resolvedPath = null;

      // First check if the command is already an absolute path
      if (user.exec.command.startsWith('/')) {
        if (fs.existsSync(user.exec.command)) {
          resolvedPath = user.exec.command;
          console.log(`Using provided absolute AWS CLI path: ${resolvedPath}`);
        }
      }

      // If not an absolute path or the path doesn't exist, try to resolve it
      if (!resolvedPath) {
        // Try using 'which' with the shell environment
        try {
          const whichOutput = execSync('which aws', { env: process.env });
          const whichPath = whichOutput.toString().trim();
          if (fs.existsSync(whichPath)) {
            resolvedPath = whichPath;
            user.exec.command = resolvedPath;
            console.log(`Resolved AWS CLI via 'which': ${resolvedPath}`);
          }
        } catch (err) {
          console.warn('Could not resolve aws with "which aws":', err.message);
        }

        // If 'which' failed, try searching in common installation locations
        if (!resolvedPath) {
          for (const possiblePath of commonAwsPaths) {
            if (fs.existsSync(possiblePath)) {
              resolvedPath = possiblePath;
              user.exec.command = resolvedPath;
              console.log(`Found AWS CLI at: ${resolvedPath}`);
              break;
            }
          }
        }
      }

      if (!resolvedPath) {
        const error = new Error(
          'Unable to find AWS CLI. Please ensure AWS CLI is installed and either:\n' +
          '1. Specify the absolute path to AWS CLI in your kubeconfig (e.g., command: /path/to/aws)\n' +
          '2. Install AWS CLI in a standard location or add it to your PATH'
        );
        console.error(error.message);
        throw error;
      }

      // Ensure environment variables are properly set
      user.exec.env = user.exec.env || [];
      // Add AWS environment variables if they exist
      if (process.env.AWS_ACCESS_KEY_ID) {
        user.exec.env.push({ name: 'AWS_ACCESS_KEY_ID', value: process.env.AWS_ACCESS_KEY_ID });
      }
      if (process.env.AWS_SECRET_ACCESS_KEY) {
        user.exec.env.push({ name: 'AWS_SECRET_ACCESS_KEY', value: process.env.AWS_SECRET_ACCESS_KEY });
      }
      if (process.env.AWS_SESSION_TOKEN) {
        user.exec.env.push({ name: 'AWS_SESSION_TOKEN', value: process.env.AWS_SESSION_TOKEN });
      }
      if (process.env.AWS_DEFAULT_REGION) {
        user.exec.env.push({ name: 'AWS_DEFAULT_REGION', value: process.env.AWS_DEFAULT_REGION });
      }

      // Log the final exec configuration for debugging
      console.log('Final exec configuration:', {
        command: user.exec.command,
        args: user.exec.args,
        env: user.exec.env
      });
    }

    console.log('Successfully initialized KubeConfig for context:', currentContext);
  } catch (error) {
    console.error('Error initializing KubeConfig:', error);
    kubeConfig = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Log the URL we're trying to load
  const loadUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../build/index.html')}`;
  console.log('Loading URL:', loadUrl);
  console.log('Current directory:', __dirname);
  console.log('Build path:', path.join(__dirname, '../build/index.html'));

  // Prevent navigation to non-local URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost:3000') && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  // Add error handler for page load failures
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  // Listen for console messages from the renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('Renderer Console:', message);
  });

  mainWindow.loadURL(loadUrl).catch(error => {
    console.error('Error loading URL:', error);
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  initializeKubeConfig();
  createWindow();
});

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

// Handle Kubernetes configuration
ipcMain.handle('get-kubeconfig', async () => {
  try {
    if (!kubeConfig) {
      initializeKubeConfig();
    }

    const contexts = kubeConfig.getContexts();
    const clusters = kubeConfig.getClusters();
    const users = kubeConfig.getUsers();
    let currentContext = kubeConfig.getCurrentContext();

    // If no context is selected but we have contexts available, select the first one
    if (!currentContext && contexts.length > 0) {
      currentContext = contexts[0].name;
      kubeConfig.setCurrentContext(currentContext);
    }

    return {
      currentContext,
      contexts,
      clusters,
      users
    };
  } catch (error) {
    console.error('Error loading kubeconfig:', error);
    return {
      currentContext: '',
      contexts: [],
      clusters: [],
      users: []
    };
  }
});

ipcMain.handle('set-context', async (event, contextName) => {
  try {
    if (!kubeConfig) {
      initializeKubeConfig();
    }

    kubeConfig.setCurrentContext(contextName);
    return true;
  } catch (error) {
    console.error('Error setting context:', error);
    return false;
  }
});

// Handle Kubernetes API calls
ipcMain.handle('k8s-api', async (event, { path, method = 'GET', body }) => {
  try {
    console.log(`Handling k8s-api request: ${method} ${path}`);
    
    if (!kubeConfig) {
      console.log('Initializing kubeConfig...');
      initializeKubeConfig();
    }
    
    const currentContext = kubeConfig.getCurrentContext();
    if (!currentContext) {
      throw new Error('No Kubernetes context selected. Please select a context from the dropdown.');
    }

    const currentCluster = kubeConfig.getCurrentCluster();
    if (!currentCluster) {
      throw new Error(`No cluster configuration found for context '${currentContext}'. Please check your kubeconfig.`);
    }

    if (!currentCluster.server) {
      throw new Error(`No server URL found for cluster '${currentCluster.name}'. Please check your kubeconfig.`);
    }

    console.log(`Using cluster: ${currentCluster.name} (${currentCluster.server})`);

    // Create the appropriate API client based on the path
    let client;
    if (path.startsWith('/apis/')) {
      console.log('Using CustomObjectsApi client');
      client = kubeConfig.makeApiClient(CustomObjectsApi);
      // For Crossplane resources, we need to parse the path to get group, version, and plural
      const pathParts = path.split('/').filter(Boolean);
      const group = pathParts[1];
      const version = pathParts[2];
      const plural = pathParts[3];
      const namespace = path.includes('/namespaces/') ? path.split('/namespaces/')[1].split('/')[0] : undefined;
      const name = pathParts[pathParts.length - 1];

      console.log('Parsed path parts:', { group, version, plural, namespace, name });

      try {
        let response;
        if (method === 'GET') {
          if (name && name !== plural) { // Only use name if it's not the same as the plural
            if (namespace) {
              //console.log(`Getting namespaced custom object: ${group}/${version}/${plural}/${name} in namespace ${namespace}`);
              response = await client.getNamespacedCustomObject(group, version, namespace, plural, name);
            } else {
              //console.log(`Getting cluster custom object: ${group}/${version}/${plural}/${name}`);
              response = await client.getClusterCustomObject(group, version, plural, name);
            }
          } else {
            if (namespace) {
              console.log(`Listing namespaced custom objects: ${group}/${version}/${plural} in namespace ${namespace}`);
              response = await client.listNamespacedCustomObject(group, version, namespace, plural);
            } else {
              //console.log(`Listing cluster custom objects: ${group}/${version}/${plural}`);
              response = await client.listClusterCustomObject(group, version, plural);
            }
          }
        } else if (method === 'POST') {
          if (namespace) {
            //console.log(`Creating namespaced custom object in ${namespace}`);
            response = await client.createNamespacedCustomObject(group, version, namespace, plural, body);
          } else {
            //console.log('Creating cluster custom object');
            response = await client.createClusterCustomObject(group, version, plural, body);
          }
        } else {
          throw new Error(`Unsupported method: ${method}`);
        }

        // Handle the response
        if (response && typeof response === 'object') {
          // If response is a Response object with a body property
          const data = response.body || response;
          
          // Validate the data is proper JSON
          try {
            // Test that we can stringify/parse the data
            JSON.parse(JSON.stringify(data));
            return { data };
          } catch (err) {
            console.error('Invalid JSON in response:', err);
            throw new Error('Invalid JSON response from Kubernetes API');
          }
        }
        
        throw new Error('Invalid response format from Kubernetes API');
      } catch (err) {
        console.error('Error making API request:', err);
        throw err;
      }
    } else {
      client = kubeConfig.makeApiClient(CoreV1Api);
      // For core resources, we need to parse the path to get the resource type
      const resourceType = path.split('/')[1];
      const namespace = path.includes('/namespaces/') ? path.split('/namespaces/')[1].split('/')[0] : undefined;
      const name = path.split('/').pop();

      try {
        let response;
        if (method === 'GET') {
          if (name && name !== resourceType) { // Only use name if it's not the same as the resource type
            if (namespace) {
              response = await client.readNamespacedResource(resourceType, name, namespace);
            } else {
              response = await client.readResource(resourceType, name);
            }
          } else {
            if (namespace) {
              response = await client.listNamespacedResource(resourceType, namespace);
            } else {
              response = await client.listResource(resourceType);
            }
          }
        } else if (method === 'POST') {
          if (namespace) {
            response = await client.createNamespacedResource(resourceType, namespace, body);
          } else {
            response = await client.createResource(resourceType, body);
          }
        } else {
          throw new Error(`Unsupported method: ${method}`);
        }

        // Handle the response
        if (response && typeof response === 'object') {
          // If response is a Response object with a body property
          const data = response.body || response;
          
          // Validate the data is proper JSON
          try {
            // Test that we can stringify/parse the data
            JSON.parse(JSON.stringify(data));
            return { data };
          } catch (err) {
            console.error('Invalid JSON in response:', err);
            throw new Error('Invalid JSON response from Kubernetes API');
          }
        }
        
        throw new Error('Invalid response format from Kubernetes API');
      } catch (err) {
        console.error('Error making API request:', err);
        throw err;
      }
    }
  } catch (error) {
    console.error('Kubernetes API error:', error);
    
    // Check if this is an AWS CLI exec error
    if (error.message && error.message.includes('aws')) {
      console.error('AWS CLI error detected:', error);
      return {
        error: 'AWS CLI authentication failed',
        details: error.message || 'Unknown AWS CLI error',
        code: 'AWS_CLI_ERROR',
        statusCode: 401,
        stack: error.stack
      };
    }
    
    // Create a serializable error response
    const errorResponse = {
      error: error.message || 'Failed to communicate with Kubernetes cluster',
      details: error.response?.body || error.message || null,
      code: error.code || error.statusCode || 'UNKNOWN_ERROR',
      statusCode: error.statusCode || 500,
      stack: error.stack // Include stack trace for debugging
    };

    // If the error has a response body that's HTML, clean it up
    if (errorResponse.details && typeof errorResponse.details === 'string' && errorResponse.details.startsWith('<!DOCTYPE')) {
      console.warn('Received HTML response instead of JSON:', errorResponse.details);
      errorResponse.details = 'Invalid response format received from server';
    }

    // Log the final error response for debugging
    console.error('Final error response:', errorResponse);

    return errorResponse;
  }
}); 