import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { CatalogPage } from './features/catalog/CatalogPage';
import { HomePage } from './features/home/HomePage';
import { LivePage } from './features/live/LivePage';
import { PlayerPage } from './features/player/PlayerPage';
import { PhasePage } from './features/system/PhasePage';
import { SearchPage } from './features/search/SearchPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { episodes, movies, series } from './data/demo';
import { FavoritesPage, HistoryPage, WatchlistPage } from './features/library/LibraryViews';
import { LogIn, ScreenShare, Smartphone, Tv, UserRound } from 'lucide-react';

const demoNote = 'Showing clearly fictional demo data until you connect your own IPTV source.';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="live" element={<LivePage />} />
        <Route
          path="movies"
          element={
            <CatalogPage
              eyebrow="Cinema"
              title="Movies"
              description="A showcase of the movie grid and filtering behavior."
              items={movies}
              filters={[{ label: 'All', value: 'all' }, { label: 'Movies', value: 'movie' }]}
              note={demoNote}
            />
          }
        />
        <Route
          path="series"
          element={
            <CatalogPage
              eyebrow="Binge-worthy"
              title="TV Shows"
              description="Series and episode layouts, ready for your provider catalogue."
              items={[...series, ...episodes]}
              note={demoNote}
            />
          }
        />
        <Route path="search" element={<SearchPage />} />
        <Route
          path="library"
          element={
            <CatalogPage
              eyebrow="Everything in one place"
              title="Library"
              description="Your imported channels, movies and shows will live here."
              items={[...movies, ...series, ...episodes]}
              note={demoNote}
            />
          }
        />
        <Route path="favorites" element={<FavoritesPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="watchlist" element={<WatchlistPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="profile"
          element={
            <PhasePage
              eyebrow="Account"
              title="Profile"
              description="Multi-user profiles, devices and sessions."
              phase="Phase 2"
              icon={UserRound}
              bullets={['Secure registration and login', 'Password hashing and sessions', 'Friendly device names']}
            />
          }
        />
        <Route path="player/:id" element={<PlayerPage />} />
        <Route
          path="connect"
          element={
            <PhasePage
              eyebrow="Phone pairing"
              title="Connect to your TV"
              description="Scan a TV code with your phone, then send your playlist directly to the TV."
              phase="Phase 6"
              icon={Smartphone}
              bullets={['Short-lived, single-use QR token', 'Upload M3U, paste URL or enter provider details', 'No credentials in the QR code or URL logs']}
            />
          }
        />
        <Route
          path="tv/pair"
          element={
            <PhasePage
              eyebrow="TV setup"
              title="Add playlist on TV"
              description="Your TV will show a QR code and short pairing code instead of asking you to type a long URL."
              phase="Phase 6"
              icon={Tv}
              bullets={['Client-side QR generation', 'Visible short code', 'One-time token with expiry and rate limiting']}
            />
          }
        />
        <Route
          path="login"
          element={
            <PhasePage
              eyebrow="Welcome back"
              title="Sign in"
              description="Secure access to your Veyro account across web and TV devices."
              phase="Phase 2"
              icon={LogIn}
              bullets={['Hashed passwords', 'Secure session cookies', 'Replaceable auth service module']}
            />
          }
        />
        <Route
          path="register"
          element={
            <PhasePage
              eyebrow="Get started"
              title="Create account"
              description="One account for your playlists, preferences and devices."
              phase="Phase 2"
              icon={ScreenShare}
              bullets={['Email and password registration', 'User-isolated D1 records', 'No provider credentials in accounts']}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
