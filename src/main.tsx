import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { BrandProvider } from './brand/BrandProvider';
import { LibraryProvider } from './state/LibraryContext';
import { PreferencesProvider } from './state/PreferencesContext';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Veyro root element is missing');

createRoot(root).render(
  <StrictMode>
    <BrandProvider>
      <PreferencesProvider>
        <LibraryProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </LibraryProvider>
      </PreferencesProvider>
    </BrandProvider>
  </StrictMode>,
);
