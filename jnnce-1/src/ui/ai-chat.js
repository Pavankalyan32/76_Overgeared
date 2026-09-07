// AI Chat Module
// Handles AI assistant: chat, voice recognition, screen capture, Gemini API integration

// Module state
const aiState = {
    isListening: false,
    isChatOpen: true,
    recognition: null,
    chatHistory: [],
    isProcessing: false,
    voiceOutput: true,
    lastVoiceQuestionAt: 0,
};

const AI_ENDPOINT = '/api/ai';

// External function references (set by main.js)
let getRendererFn = null;
let getActiveObjectFn = null;
let getCameraFn = null;
let getGestureStateFn = null;
let getFeatureFlagsFn = null;
let updateAIStatusFn = null;
let addMessageFn = null;

// Initialize AI chat with dependencies
export function initAIChat(dependencies) {
    getRendererFn = dependencies.getRenderer;
    getActiveObjectFn = dependencies.getActiveObject;
    getCameraFn = dependencies.getCamera;
    getGestureStateFn = dependencies.getGestureState;
    getFeatureFlagsFn = dependencies.getFeatureFlags;
    updateAIStatusFn = dependencies.updateAIStatus;
    addMessageFn = dependencies.addMessage;
    
    initSpeechRecognition();
}

// Initialize speech recognition
function initSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        aiState.recognition = new SpeechRecognition();
        aiState.recognition.continuous = false;
        aiState.recognition.interimResults = false;
        aiState.recognition.lang = 'en-US';
        
        aiState.recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            handleVoiceInput(transcript);
        };
        
        aiState.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            stopVoiceRecognition();
        };
        
        aiState.recognition.onend = () => {
            stopVoiceRecognition();
        };
    } else {
        console.warn('Speech recognition not supported');
    }
}

// Voice recognition controls
export function startVoiceRecognition() {
    if (aiState.recognition && !aiState.isListening) {
        aiState.recognition.start();
        aiState.isListening = true;
        updateVoiceUI(true);
        if (addMessageFn) addMessageFn('Listening...', 'ai', true);
    }
}

export function stopVoiceRecognition() {
    if (aiState.recognition && aiState.isListening) {
        aiState.recognition.stop();
        aiState.isListening = false;
        updateVoiceUI(false);
    }
}

function updateVoiceUI(isListening) {
    const voiceBtn = document.getElementById('btn_voice_toggle');
    const voiceIndicator = document.getElementById('voice_indicator');
    
    if (voiceBtn) {
        voiceBtn.classList.toggle('active', isListening);
        voiceBtn.textContent = isListening ? '⏹️' : '🎤';
    }
    
    if (voiceIndicator) {
        voiceIndicator.classList.toggle('active', isListening);
    }
}

// Capture screen for AI analysis
async function captureScreenForAI() {
    try {
        console.log('Starting screen capture...');
        
        const renderer = getRendererFn ? getRendererFn() : null;
        const canvas = renderer?.domElement;
        if (!canvas) {
            console.error('Renderer canvas not found');
            return null;
        }
        
        console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
        const dataURL = canvas.toDataURL('image/png');
        console.log('Scene captured, data length:', dataURL.length);
        
        const video = document.getElementById('input_video');
        let videoDataURL = null;
        
        if (video && video.videoWidth > 0) {
            console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);
            const videoCanvas = document.createElement('canvas');
            videoCanvas.width = video.videoWidth;
            videoCanvas.height = video.videoHeight;
            const ctx = videoCanvas.getContext('2d');
            ctx.drawImage(video, 0, 0);
            videoDataURL = videoCanvas.toDataURL('image/png');
            console.log('Video captured, data length:', videoDataURL.length);
        } else {
            console.log('Video not available or not ready');
        }
        
        const activeObject = getActiveObjectFn ? getActiveObjectFn() : null;
        const camera = getCameraFn ? getCameraFn() : null;
        const gestureState = getGestureStateFn ? getGestureStateFn() : { current: 'None', pinchActive: false };
        const featureFlags = getFeatureFlagsFn ? getFeatureFlagsFn() : {};
        
        const contextData = {
            timestamp: new Date().toISOString(),
            activeObject: activeObject ? {
                type: activeObject.type || 'unknown',
                position: activeObject.position ? {
                    x: Math.round(activeObject.position.x * 100) / 100,
                    y: Math.round(activeObject.position.y * 100) / 100,
                    z: Math.round(activeObject.position.z * 100) / 100
                } : null,
                rotation: activeObject.rotation ? {
                    x: Math.round(activeObject.rotation.x * 180 / Math.PI) / 1,
                    y: Math.round(activeObject.rotation.y * 180 / Math.PI) / 1,
                    z: Math.round(activeObject.rotation.z * 180 / Math.PI) / 1
                } : null,
                scale: activeObject.scale ? {
                    x: Math.round(activeObject.scale.x * 100) / 100,
                    y: Math.round(activeObject.scale.y * 100) / 100,
                    z: Math.round(activeObject.scale.z * 100) / 100
                } : null
            } : null,
            camera: camera ? {
                position: {
                    x: Math.round(camera.position.x * 100) / 100,
                    y: Math.round(camera.position.y * 100) / 100,
                    z: Math.round(camera.position.z * 100) / 100
                },
                fov: camera.fov,
                near: camera.near,
                far: camera.far
            } : null,
            gestureState: {
                currentGesture: gestureState.current || 'None',
                pinchActive: gestureState.pinchActive || false
            },
            featureFlags: {
                twoHand: featureFlags.twoHand || false,
                hologram: featureFlags.hologram || false,
                multiplayer: featureFlags.multiplayer || false
            }
        };
        
        return {
            scene: dataURL,
            video: videoDataURL,
            context: contextData
        };
    } catch (error) {
        console.error('Screen capture error:', error);
        return null;
    }
}

// Gemini API integration
async function analyzeWithGemini(screenshots, userQuestion) {
    try {
        let prompt = `You are an AI assistant helping with a 3D modeling application called Gesture3D. 
        
        The user is asking: "${userQuestion}"`;
        
        if (screenshots) {
            const context = screenshots.context;
            let contextInfo = '';
            
            if (context) {
                contextInfo = `
                
        **Real-Time Context Data (${context.timestamp}):**
        - Active Object: ${context.activeObject ? `${context.activeObject.type} at position (${context.activeObject.position.x}, ${context.activeObject.position.y}, ${context.activeObject.position.z})` : 'None'}
        - Object Rotation: ${context.activeObject && context.activeObject.rotation ? `X: ${context.activeObject.rotation.x}°, Y: ${context.activeObject.rotation.y}°, Z: ${context.activeObject.rotation.z}°` : 'None'}
        - Object Scale: ${context.activeObject && context.activeObject.scale ? `X: ${context.activeObject.scale.x}, Y: ${context.activeObject.scale.y}, Z: ${context.activeObject.scale.z}` : 'None'}
        - Camera Position: ${context.camera ? `(${context.camera.position.x}, ${context.camera.position.y}, ${context.camera.position.z})` : 'Unknown'}
        - Current Gesture: ${context.gestureState.currentGesture}
        - Features Active: ${Object.entries(context.featureFlags).filter(([k,v]) => v).map(([k]) => k).join(', ') || 'None'}`;
            }
            
            prompt += `
            
        I have captured real-time screenshots of the current screen and camera feed.${contextInfo}
        
        Please analyze the visual content AND the real-time data to provide a short answer as 3-5 concise bullet points covering:
        
        **Current Screen Analysis:**
        - What 3D objects are visible and their current state
        - Exact hand positions and gesture tracking status
        - Object transformation details (rotation angles, scale factors, position coordinates)
        - Camera view and perspective information
        - Any visible UI elements or controls
        
        **Real-Time Assessment:**
        - Immediate observations about what's working or not working
        - Specific technical details visible in the current moment
        - Precise measurements or positions if discernible
        - Current gesture recognition status
        
        **Actionable Guidance:**
        - What the user should do next based on current state
        - Immediate improvements or adjustments needed
        - Specific troubleshooting steps if issues are visible
        
        Use both the visual screenshots and the real-time context data. Be precise, factual, and focused on what is visible now. Output only 3-5 bullet points, one sentence each, no preamble or headings, and keep the total under 120 words.`;
        } else {
            prompt += `
            
        This appears to be a general question. Provide a short answer as 3-5 concise bullet points covering:
        - 3D modeling techniques and best practices
        - Gesture3D application features and capabilities
        - How to use hand tracking for 3D object manipulation
        - Troubleshooting common issues
        - Tips for effective 3D modeling workflow
        
        If the user needs help with something specific on their screen, suggest they ask a more specific question. Output only 3-5 bullet points, one sentence each, no preamble or headings, and keep the total under 120 words.`;
        }
        
        const images = [];
        if (screenshots) {
            if (screenshots.scene) images.push(screenshots.scene.split(',')[1]);
            if (screenshots.video) images.push(screenshots.video.split(',')[1]);
        }

        const response = await fetch(AI_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, images })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Request failed (${response.status}).`);
        }
        return data.text;

    } catch (error) {
        console.error('AI request failed:', error);
        return `Sorry, I encountered an error: ${error.message}`;
    }
}

// Add message to chat
function addMessage(content, sender = 'user', transient = false) {
    if (addMessageFn) {
        addMessageFn(content, sender, transient);
        return;
    }
    
    const chatMessages = document.getElementById('chat_messages');
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = String(content);
    messageDiv.appendChild(contentDiv);
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    if (transient) return;

    aiState.chatHistory.push({ content, sender, timestamp: Date.now() });

    if (sender === 'ai' && aiState.voiceOutput && 'speechSynthesis' in window) {
        try {
            const utter = new SpeechSynthesisUtterance(String(content));
            utter.rate = 1.0; utter.pitch = 1.0; utter.volume = 1.0;
            speechSynthesis.cancel();
            speechSynthesis.speak(utter);
        } catch (e) {
            console.warn('TTS failed:', e);
        }
    }
}

// Handle user input
export async function handleUserInput(input) {
    if (!input.trim()) return;
    
    addMessage(input, 'user');
    
    const screenKeywords = [
        'screen', 'what', 'see', 'show', 'display', 'current', 'now', 'this', 'that',
        'object', 'model', '3d', 'scene', 'gesture', 'hand', 'tracking', 'camera',
        'rotate', 'scale', 'move', 'position', 'size', 'color', 'shape', 'view',
        'help', 'how', 'why', 'problem', 'issue', 'error', 'working', 'not working'
    ];
    
    const isScreenRelated = screenKeywords.some(keyword => 
        input.toLowerCase().includes(keyword.toLowerCase())
    );
    
    addMessage('Analyzing your request...', 'ai', true);
    
    try {
        let screenshots = null;
        
        if (isScreenRelated) {
            const chatMessages = document.getElementById('chat_messages');
            const placeholder = chatMessages.lastChild?.querySelector('.message-content');
            if (placeholder) placeholder.textContent = '📸 Capturing screen...';
            
            const response = await performRealTimeAnalysis(input);
            
            if (chatMessages.lastChild) {
                chatMessages.removeChild(chatMessages.lastChild);
            }
            addMessage(response, 'ai');
            if (aiState.isListening && (Date.now() - aiState.lastVoiceQuestionAt) < 5000) {
                stopVoiceRecognition();
            }
            return;
        }
        
        const response = await analyzeWithGemini(null, input);
        
        const chatMessages = document.getElementById('chat_messages');
        if (chatMessages.lastChild) {
            chatMessages.removeChild(chatMessages.lastChild);
        }
        
        addMessage(response, 'ai');
        if (aiState.isListening && (Date.now() - aiState.lastVoiceQuestionAt) < 5000) {
            stopVoiceRecognition();
        }
        
    } catch (error) {
        console.error('AI processing error:', error);
        const chatMessages = document.getElementById('chat_messages');
        if (chatMessages.lastChild) {
            chatMessages.removeChild(chatMessages.lastChild);
        }
        addMessage('Sorry, I encountered an error processing your request. Please try again.', 'ai');
    }
}

function handleVoiceInput(transcript) {
    addMessage(transcript, 'user');
    aiState.lastVoiceQuestionAt = Date.now();
    handleUserInput(transcript);
}

// Toggle chat visibility
export function toggleChat() {
    const aiContent = document.getElementById('ai_content');
    const chatBtn = document.getElementById('btn_chat_toggle');
    
    if (aiContent) {
        aiState.isChatOpen = !aiState.isChatOpen;
        aiContent.style.display = aiState.isChatOpen ? 'flex' : 'none';
        chatBtn.classList.toggle('active', aiState.isChatOpen);
    }
}

// Update AI status indicator
export function updateAIStatus(status, message) {
    if (updateAIStatusFn) {
        updateAIStatusFn(status, message);
        return;
    }
    
    const statusElement = document.getElementById('ai_status');
    if (!statusElement) return;
    
    statusElement.className = `ai-status ${status}`;
    const statusText = statusElement.querySelector('.status-text');
    if (statusText) {
        statusText.textContent = message;
    }
}

// Loading indicator
export function showLoadingIndicator() {
    const indicator = document.getElementById('loading_indicator');
    if (indicator) indicator.style.display = 'flex';
}

export function hideLoadingIndicator() {
    const indicator = document.getElementById('loading_indicator');
    if (indicator) indicator.style.display = 'none';
}

// Enhanced real-time analysis
export async function performRealTimeAnalysis(userQuestion = null) {
    console.log('Starting real-time analysis with question:', userQuestion);
    updateAIStatus('analyzing', 'Analyzing screen in real-time...');
    
    try {
        console.log('Calling captureScreenForAI...');
        const screenshots = await captureScreenForAI();
        console.log('Screenshots captured:', screenshots);
        
        if (screenshots) {
            const question = userQuestion || 'Please describe the current state of the screen, including any 3D objects, gestures, or technical details visible.';
            console.log('Calling analyzeWithGemini with question:', question);
            const response = await analyzeWithGemini(screenshots, question);
            console.log('Gemini response received:', response);
            updateAIStatus('', 'Ready for real-time analysis');
            return response;
        } else {
            console.log('No screenshots captured');
            updateAIStatus('error', 'Failed to capture screen');
            return 'Sorry, I couldn\'t capture your screen. Please try again.';
        }
    } catch (error) {
        console.error('Real-time analysis error:', error);
        updateAIStatus('error', 'Analysis failed');
        return `Sorry, I encountered an error: ${error.message}`;
    }
}

// Get AI state for external access
export function getAIState() { return aiState; }
export function isListening() { return aiState.isListening; }