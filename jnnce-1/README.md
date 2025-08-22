# Tesseract - 3D Gesture Control Platform

## Project Structure

This project has been reorganized to provide a better user experience:

- **`index.html`** - The home page (landing page) with beautiful cards for different use cases
- **`app.html`** - The main 3D gesture control application
- **`style.css`** - Styling for the 3D application
- **`app.js`** - Main application logic for 3D rendering and gesture control
- **`server/`** - Express server for serving the application

## How to Use

1. **Start the server:**
   ```bash
   cd server
   npm start
   ```

2. **Access the application:**
   - Open your browser and go to `http://localhost:3000`
   - You'll see the beautiful Tesseract home page with 4 cards

3. **Navigate to the 3D app:**
   - Click any of the cards (Education, Medical, Architecture, Science) 
   - Or click the "🚀 Launch App" button in the top-right corner
   - This will take you to the 3D gesture control application

4. **Return to home:**
   - In the 3D app, click the home button (🏠) in the navigation bar
   - This will take you back to the home page

## Features

### Home Page (`index.html`)
- Beautiful animated landing page with gradient backgrounds
- 4 interactive cards for different use cases
- Smooth animations and hover effects
- Responsive design for all devices

### 3D Application (`app.html`)
- Real-time hand gesture tracking
- 3D model manipulation with natural gestures
- AI assistant integration
- Multiple 3D model types (cube, sphere, torus, etc.)
- File import support (.glb, .gltf, .obj, .stl)
- Camera controls and navigation
- Recording and replay functionality

## Navigation Flow

```
Home Page (index.html) ←→ 3D App (app.html)
     ↑                        ↑
   Cards                  Home Button (🏠)
```

The application now provides a seamless user experience where users start at the beautiful home page and can easily navigate to the 3D application by clicking on any of the cards or the launch button.
