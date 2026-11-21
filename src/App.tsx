import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './features/home/HomePage';
import { LivePage } from './features/live/LivePage';
import { MoviesPage } from './features/content/MoviesPage';
import { SeriesPage } from './features/content/SeriesPage';
import { SeriesDetailPage } from './features/content/SeriesDetailPage';
import { ContentDetailsPage } from './features/content/ContentDetailsPage';
import { PlayerPage } from './features/player/PlayerPage';
import { PhasePage } from './features/system/PhasePage';
import { SearchPage } from './features/search/SearchPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { FavoritesPage, HistoryPage, WatchlistPage } from './features/library/LibraryViews';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { ProfilePage } from './features/auth/ProfilePage';
import { Library, Smartphone, Tv } from 'lucide-react';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="live" element={<LivePage />} />
        <Route path="movies" element={<MoviesPage />} />
        <Route path="series" element={<SeriesPage />} />
        <Route path="series/:id" element={<SeriesDetailPage />} />
        <Route path="details/:kind/:id" element={<ContentDetailsPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route
          path="library"
          element={
            <PhasePage
              eyebrow="Personal library"
              title="Library"
              description="Favorites, history and watchlist will use your real imported catalogue in a later phase."
              phase="Phase 7"
              icon={Library}
              bullets={['Favorites across providers', 'Continue watching from history', 'Saved watchlist']}
            />
          }
        />
        <Route path="favorites" element={<FavoritesPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="watchlist" element={<WatchlistPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="player/channel/:id" element={<PlayerPage />} />
        <Route path="player/movie/:id" element={<PlayerPage />} />
        <Route path="player/episode/:id" element={<PlayerPage />} />
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
