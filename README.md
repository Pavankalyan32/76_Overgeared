# Tesseract - 3D Gesture Control Platform

![Tesseract Logo](https://img.shields.io/badge/Tesseract-3D%20Gesture%20Control-blueviolet)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## 🌟 Overview

Tesseract is an advanced 3D gesture control platform that allows users to manipulate 3D objects using natural hand gestures. The application combines cutting-edge technologies including Three.js for 3D rendering, hand tracking for gesture recognition, and real-time collaboration features.

## ✨ Features

### 🏠 Home Page (`index.html`)
- Beautiful animated landing page with gradient backgrounds and particle effects
- 4 interactive cards for different use cases (Education, Medical, Architecture, Science)
- Smooth animations and hover effects
- Responsive design for all devices

### 🖐️ 3D Application (`app.html`)
- **Real-time hand gesture tracking** - Control 3D objects with natural hand movements
- **Multi-gesture support**:
  - Pinch to scale objects
  - Fist to grab and move objects
  - Two-finger gestures for rotation
  - Three-finger gestures for advanced controls
- **3D model manipulation** with intuitive controls
- **Multiple 3D model types** (cube, sphere, torus, etc.)
- **File import support** (.glb, .gltf, .obj, .stl)
- **Camera controls** and navigation
- **Recording and replay** functionality

### 🔄 Real-time Collaboration
- Share your 3D workspace with others in real-time
- See changes made by collaborators instantly
- Socket.io powered backend for efficient real-time updates

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- Modern web browser with WebGL support (Chrome, Firefox, Edge recommended)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Pavankalyan32/76_Overgeared.git
   cd 76_Overgeared
   ```

2. Install dependencies:
   ```bash
   cd server
   npm install
   ```

### Running the Application

1. Start the server:
   ```bash
   cd server
   npm start
   ```

2. Access the application:
   - Open your browser and go to `http://localhost:3000`
   - You'll see the Tesseract home page with interactive cards

## 🧭 Navigation Flow

```
Home Page (index.html) ←→ 3D App (app.html)
     ↑                        ↑
   Cards                  Home Button (🏠)
```

The application provides a seamless user experience where users start at the beautiful home page and can easily navigate to the 3D application by clicking on any of the cards or the launch button.

## 📁 Project Structure

```
├── index.html          # Home/landing page
├── app.html            # Main 3D gesture control application
├── app.js              # Core application logic for 3D rendering and gestures
├── style.css           # Styling for the application
├── scene.gltf          # Default 3D model
├── scene.bin           # Binary data for the 3D model
├── server/             # Backend server
│   ├── index.js        # Express server setup with Socket.io
│   ├── package.json    # Server dependencies
```

## 🛠️ Technologies Used

- **Frontend**:
  - Three.js - 3D rendering engine
  - WebGL - Hardware-accelerated graphics
  - HTML5/CSS3/JavaScript - Core web technologies

- **Backend**:
  - Node.js - JavaScript runtime
  - Express - Web server framework
  - Socket.io - Real-time communication

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgements

- Three.js community for the excellent 3D library
- Contributors to the hand tracking and gesture recognition technologies
- All open-source projects that made this application possible

---

<p align="center">Made with ❤️ by Team Overgeared</p>