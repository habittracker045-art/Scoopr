import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { InstallPromptProvider } from './context/InstallPromptContext.jsx';
import { registerServiceWorker } from './utils/registerServiceWorker.js';
import './styles/index.css';
import './components/ui/ui.css';
import './components/layout/layout.css';
import './pages/auth.css';
import './pages/onboarding.css';
import './pages/feed.css';
import './pages/create.css';
import './pages/tipsfacts.css';
import './pages/history.css';
import './pages/settings.css';
import './pages/account.css';
import './pages/admin.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <InstallPromptProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </InstallPromptProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Phase 5, Prompt 2: register the service worker in the background. This
// never blocks or affects the render above — see
// registerServiceWorker.js for the fail-silently-if-unsupported handling.
registerServiceWorker();
