/**
 * ServerIcon — renders a lucide icon by name for a server.
 *
 * The desktop ConnectionStore picks a name string per server (one of the 30
 * curated lucide icon names below). Surfaced in the server-switcher, the
 * Watching cards, and the terminal tab strip. Unknown / missing names fall
 * back to a neutral Circle.
 */
import React from 'react';
import {
  Circle, Square, Triangle, Diamond, Hexagon,
  Star, Heart, Cloud, Sun, Moon,
  Zap, Flame, Leaf, Flag, Anchor,
  Box, Compass, Crown, Feather, Gem,
  Globe, Key, Lock, Mountain, Rocket,
  Shield, Snowflake, Sparkles, Target, Tent,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  Circle, Square, Triangle, Diamond, Hexagon,
  Star, Heart, Cloud, Sun, Moon,
  Zap, Flame, Leaf, Flag, Anchor,
  Box, Compass, Crown, Feather, Gem,
  Globe, Key, Lock, Mountain, Rocket,
  Shield, Snowflake, Sparkles, Target, Tent,
};

export interface ServerIconProps {
  /** Icon name from the store. If missing or unknown, falls back to Circle. */
  name?: string;
  /** Pixel size; default 14. */
  size?: number;
  className?: string;
  /** Accessible label (e.g. the server label). */
  title?: string;
}

export const ServerIcon: React.FC<ServerIconProps> = ({ name, size = 14, className, title }) => {
  const Comp = (name && ICONS[name]) || Circle;
  return <Comp size={size} className={className} aria-label={title} />;
};

export default ServerIcon;
