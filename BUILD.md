# Building Crossplane Portal

## Prerequisites
- Node.js (v16 or later)
- npm
- Git

## Building the Application

1. Clone the repository:
```bash
git clone https://github.com/mitchelldavis44/crossplane-portal.git
cd crossplane-portal
```

2. Install dependencies:
```bash
npm install
```

3. Build the application:
```bash
npm run electron-pack
```

## Running on macOS

When you first open the application on macOS, you may see a warning that the app is from an unidentified developer. To open the app:

1. Right-click (or Control-click) the application
2. Select "Open" from the context menu
3. Click "Open" in the dialog that appears

The app will now open and you can use it normally. You only need to do this once.

## Development

To run the app in development mode:
```bash
npm run electron-dev
```

## Troubleshooting

If you encounter any issues:
1. Make sure all dependencies are installed correctly
2. Check that you have the correct Node.js version
3. Try clearing the npm cache: `npm cache clean --force`
4. Delete the `node_modules` folder and run `npm install` again 