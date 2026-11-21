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
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { ProfilePage } from './features/auth/ProfilePage';
import { Smartphone, Tv } from 'lucide-react';

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
        <Route path="profile" element={<ProfilePage />} />
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
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
