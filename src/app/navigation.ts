import {
  Bookmark,
  Clapperboard,
  Clock3,
  Compass,
  Film,
  Heart,
  Home,
  Library,
  Radio,
  Search,
  Settings,
  Tv,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  phase?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: 'Discover',
    items: [
      { label: 'Home', path: '/', icon: Home },
      { label: 'Live TV', path: '/live', icon: Radio },
      { label: 'Movies', path: '/movies', icon: Film },
      { label: 'TV Shows', path: '/series', icon: Tv },
      { label: 'Search', path: '/search', icon: Search },
    ],
  },
  {
    label: 'Your library',
    items: [
      { label: 'Library', path: '/library', icon: Library },
      { label: 'Favorites', path: '/favorites', icon: Heart },
      { label: 'History', path: '/history', icon: Clock3 },
      { label: 'Watchlist', path: '/watchlist', icon: Bookmark },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Settings', path: '/settings', icon: Settings },
      { label: 'Profile', path: '/profile', icon: UserRound, phase: 'Phase 2' },
    ],
  },
];

export const secondaryNavItems: NavItem[] = [
  { label: 'Explore catalogue', path: '/library', icon: Compass },
  { label: 'Episodes', path: '/series', icon: Clapperboard },
];

export const mobileNavItems: NavItem[] = [
  { label: 'Home', path: '/', icon: Home },
  { label: 'Live', path: '/live', icon: Radio },
  { label: 'Search', path: '/search', icon: Search },
  { label: 'Library', path: '/library', icon: Library },
  { label: 'Settings', path: '/settings', icon: Settings },
];

export const allNavItems = navGroups.flatMap((group) => group.items);
