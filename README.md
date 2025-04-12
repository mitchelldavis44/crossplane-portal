# Crossplane Portal

A desktop application for managing Crossplane resources, built with React and Electron.

## Features

- View and manage Crossplane Composite Resources
- Visualize resource relationships with interactive graphs
- Switch between different Kubernetes contexts
- Direct cluster access using local kubeconfig
- No need for kubectl proxy

## Prerequisites

- Node.js (v14 or later)
- npm or yarn
- A Kubernetes cluster with Crossplane installed
- Valid kubeconfig file (typically at `~/.kube/config`)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/crossplane-portal.git
cd crossplane-portal
```

2. Install dependencies:
```bash
npm install
```

## Development

To run the application in development mode:

```bash
npm run electron-dev
```

This will:
1. Start the React development server
2. Launch the Electron application
3. Open the DevTools for debugging

## Building for Production

To create a production build:

```bash
npm run electron-pack
```

This will:
1. Build the React application
2. Package it with Electron
3. Create distributable files in the `dist` directory

## Project Structure

```
crossplane-portal/
├── public/                 # Static files and Electron main process
│   ├── electron.js        # Electron main process
│   └── index.html         # HTML template
├── src/                    # React application source
│   ├── services/          # Service layer for Kubernetes operations
│   └── App.js             # Main application component
├── package.json           # Project configuration and dependencies
├── webpack.config.js      # Webpack configuration
├── postcss.config.js      # PostCSS configuration
└── tailwind.config.js     # Tailwind CSS configuration
```

## Architecture

The application is built using:
- React for the user interface
- Electron for desktop application functionality
- @kubernetes/client-node for Kubernetes API access
- ReactFlow for resource relationship visualization
- Tailwind CSS for styling

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
